import { setTimeout as sleep } from 'node:timers/promises';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import type { Logger } from 'pino';
import type { ScrapedEvent } from '@disruption-intelligence/shared';
import { fetchWithRetry } from './fetch';
import { joinnusVenueLocation } from './joinnus-venues';
import type { ScrapeResult } from './types';

/** Joinnus ticketer scraper (V1-BRIEF Tier 2 item 3).
 *
 *  Re-verified 2026-06-11: robots.txt allows /events/* under `User-agent: *`
 *  (the disallowed /activity path is legacy; the AI-bot block section names
 *  training-crawler UAs, not ours), the sitemap publishes every event URL, and
 *  the ToS has no scraping clause — its no-commercial-reproduction clause is
 *  respected by transforming listings into disruption records (no verbatim
 *  redistribution) and by the internal+demo fence on ticketer data.
 *
 *  Teleticket was dropped at build time: its event pages are bespoke marketing
 *  microsites with venue/date baked into images, and the structured listing
 *  pages (/Categoria*) are robots-disallowed — nothing rule-extractable within
 *  the v1 fence. Revisit only with a partnership or an official feed.
 *
 *  Strategy: sitemap.xml (one fetch — the politest crawl: exactly the URLs
 *  they publish for crawlers) → Lima events in traffic-relevant categories →
 *  detail fetch for NEW ids only (seen-id cursor) → JSON-LD Event extraction.
 *
 *  TIME TRAP (verified 2026-06-11): Joinnus JSON-LD timestamps carry a Z
 *  suffix but hold Lima wall-clock (page shows "9:00p" where the JSON-LD says
 *  21:00Z). The Z is stripped and the wall-clock re-anchored to -05:00. */

export const JOINNUS_SOURCE_ID = 'joinnus';
const SITEMAP_URL = 'https://www.joinnus.com/sitemap.xml';
const DETAIL_DELAY_MS = 2000;
// The sitemap holds ~400 live events; ids are monotonically increasing, so
// keeping the numerically largest 800 seen ids bounds the cursor (ADR-007)
// while comfortably out-lasting any event's sitemap lifetime.
const MAX_SEEN_IDS = 800;

const TARGET_URL_RE = /\/events\/(concerts|sports|futbol)\/lima-[a-z0-9-]*?-?(\d+)$/;

const CATEGORY_MAP: Record<string, string> = {
    concerts: 'concert',
    sports: 'sport',
    futbol: 'futbol',
};

const STATE_MAP: Record<string, 'scheduled' | 'cancelled'> = {
    'https://schema.org/EventScheduled': 'scheduled',
    'https://schema.org/EventRescheduled': 'scheduled',
    'https://schema.org/EventCancelled': 'cancelled',
    'https://schema.org/EventPostponed': 'cancelled',
};

const cursorSchema = z.object({ seenIds: z.array(z.string()) });

// The JSON-LD Event block, fields we consume. Joinnus emits literal nulls for
// unset fields, hence the .nullable() sprinkling.
const ldEventSchema = z.object({
    '@type': z.literal('Event'),
    name: z.string().min(1),
    startDate: z.string().min(1),
    endDate: z.string().nullable().optional(),
    eventStatus: z.string(),
    location: z
        .object({
            name: z.string().nullable().optional(),
            address: z
                .object({ streetAddress: z.string().nullable().optional() })
                .loose()
                .nullable()
                .optional(),
        })
        .loose()
        .nullable()
        .optional(),
});

export type JoinnusSitemapEntry = { url: string; id: string; category: string };

export function parseJoinnusSitemap(xml: string): JoinnusSitemapEntry[] {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    if (locs.length === 0) {
        throw new Error('joinnus: sitemap parsed to zero <loc> entries');
    }
    return locs.flatMap((url) => {
        const m = TARGET_URL_RE.exec(url);
        return m ? [{ url, id: m[2]!, category: m[1]! }] : [];
    });
}

/** Lima wall-clock mislabeled as Z → true -05:00 instant (see TIME TRAP). */
function fakeUtcToLima(isoZ: string): string {
    return isoZ.replace(/(\.\d+)?Z$/, '-05:00');
}

export function parseJoinnusEventHtml(
    html: string,
    url: string,
    sitemapCategory: string,
): ScrapedEvent {
    const $ = cheerio.load(html);
    let ld: z.infer<typeof ldEventSchema> | undefined;
    $('script[type="application/ld+json"]').each((_i, el) => {
        try {
            const parsed = ldEventSchema.safeParse(JSON.parse($(el).text().trim()));
            if (parsed.success) ld = parsed.data;
        } catch {
            /* other ld+json blocks on the page are not the Event */
        }
    });
    if (!ld) {
        throw new Error(`joinnus: no JSON-LD Event block at ${url}`);
    }

    const state = STATE_MAP[ld.eventStatus];
    if (!state) {
        // Unmapped statuses are a contract change we must look at, not guess.
        throw new Error(`joinnus: unmapped eventStatus "${ld.eventStatus}" at ${url}`);
    }

    const idMatch = TARGET_URL_RE.exec(url);
    if (!idMatch) {
        throw new Error(`joinnus: no event id in url ${url}`);
    }

    const startAt = fakeUtcToLima(ld.startDate);
    let endAt = ld.endDate ? fakeUtcToLima(ld.endDate) : undefined;
    if (endAt && new Date(endAt) <= new Date(startAt)) {
        // Upstream occasionally emits degenerate ranges; an honest "unknown
        // end" beats an invalid one.
        endAt = undefined;
    }

    const venue = ld.location?.name ?? null;
    const location = venue ? joinnusVenueLocation(venue) : undefined;

    return {
        sourceId: JOINNUS_SOURCE_ID,
        externalId: idMatch[2]!,
        title: ld.name,
        category: CATEGORY_MAP[sitemapCategory] ?? sitemapCategory,
        state,
        startAt,
        ...(endAt ? { endAt } : {}),
        ...(venue ? { venueName: venue } : {}),
        ...(location ? { location } : {}),
        sourcePayload: {
            venue,
            address: ld.location?.address?.streetAddress ?? null,
            eventStatus: ld.eventStatus,
            rawStartDate: ld.startDate,
        },
        sourceUrl: url,
    };
}

export async function joinnusScraper(log: Logger, cursor: unknown): Promise<ScrapeResult> {
    const parsedCursor = cursorSchema.safeParse(cursor);
    if (cursor !== null && !parsedCursor.success) {
        log.warn({ cursor }, 'joinnus: unreadable cursor — full sitemap pass');
    }
    const seen = new Set(parsedCursor.success ? parsedCursor.data.seenIds : []);

    const outcome = await fetchWithRetry(SITEMAP_URL, log);
    if (!outcome.ok) {
        throw new Error(`joinnus: sitemap fetch failed (${outcome.reason})`);
    }
    const entries = parseJoinnusSitemap(outcome.html);
    const fresh = entries.filter((e) => !seen.has(e.id));

    const events: ScrapedEvent[] = [];
    for (const entry of fresh) {
        // TRANSIENT detail failure aborts the run: the cursor stays frozen and
        // the next run re-covers the same ids (idempotent upserts make that
        // free). A definitive 4xx is warn + skip (review C2/A7): a sold-out or
        // pulled event whose page 404s while still sitemapped would otherwise
        // wedge the source — and re-fetching ~80 pages per retry against the
        // most ToS-sensitive host is the worst possible failure mode.
        await sleep(DETAIL_DELAY_MS);
        const detail = await fetchWithRetry(entry.url, log);
        if (!detail.ok && detail.reason === 'http-4xx') {
            log.warn(
                { eventId: entry.id, status: detail.status },
                'joinnus: detail page gone (4xx) — event skipped',
            );
            continue;
        }
        if (!detail.ok) {
            throw new Error(`joinnus: detail fetch failed for ${entry.id} (${detail.reason})`);
        }
        events.push(parseJoinnusEventHtml(detail.html, entry.url, entry.category));
    }

    // Cursor: union of seen + processed ids, numerically largest kept (ids
    // grow over time, so largest = newest).
    const merged = [...new Set([...seen, ...fresh.map((e) => e.id)])]
        .sort((a, b) => Number(b) - Number(a))
        .slice(0, MAX_SEEN_IDS);

    log.info(
        {
            sitemapEvents: entries.length,
            newEvents: fresh.length,
            eventsExtracted: events.length,
        },
        'joinnus: scrape complete',
    );

    return {
        events,
        sweepWindowEnd: null, // sitemap drops past events — absence ≠ cancelled (ADR-007)
        ...(fresh.length > 0 ? { nextCursor: { seenIds: merged } } : {}),
    };
}
