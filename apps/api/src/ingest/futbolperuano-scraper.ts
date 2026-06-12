import { setTimeout as sleep } from 'node:timers/promises';
import * as cheerio from 'cheerio';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { ScrapedEvent } from '@disruption-intelligence/shared';
import { fetchWithRetry } from './fetch';
import { VENUES, type ClubSlug } from './futbolperuano-venues';
import type { ScrapeResult } from './types';

const SOURCE_ID = 'futbolperuano';
const BASE_URL = 'https://www.futbolperuano.com';
const LISTING_PATH = '/liga-1/';
// ≥1–2s between requests per host (V1-BRIEF operating constraints); centred on the range.
const DETAIL_FETCH_DELAY_MS = 1500;

// Trailing m<digits> is the source's stable per-match identifier → our externalId.
const MATCH_PATH_RE = /^\/liga-1\/.+-m(\d+)$/;

// eventStatus values we have seen and mapped. Anything else throws: schema.org allows
// more states (postponed, rescheduled, movedOnline) and the mapping for each should be
// decided deliberately when it first appears, not guessed silently.
const EVENT_STATUS_TO_STATE: Record<string, ScrapedEvent['state']> = {
    EventScheduled: 'scheduled',
    EventCancelled: 'cancelled',
};

// Shape of Review.itemReviewed in futbolperuano's per-match JSON-LD. The z.literal
// doubles as the "itemReviewed is a SportsEvent" programmer-error check.
const sportsEventJsonLdSchema = z.object({
    '@type': z.literal('SportsEvent'),
    name: z.string(),
    description: z.string().min(1),
    startDate: z.string(),
    endDate: z.string().optional(),
    location: z.string(),
    eventStatus: z.string(),
    competitor: z.array(z.object({ name: z.string() })).optional(),
});

export type ListingParse = {
    totalMatches: number;
    // Matches whose href fits the m<id> path scheme — the signal that distinguishes
    // "slug scheme changed" (0 parseable in a populated listing) from "no target
    // club at home this window" (parseable > 0, targets empty).
    parseableMatches: number;
    targetPaths: string[];
};

function homeClubOf(path: string): ClubSlug | undefined {
    const slug = path.slice(LISTING_PATH.length);
    return (Object.keys(VENUES) as ClubSlug[]).find((club) => slug.startsWith(`${club}-vs-`));
}

export function parseListingHtml(html: string): ListingParse {
    const $ = cheerio.load(html);
    const matchEls = $('div.match');
    const seen = new Set<string>();
    const targetPaths: string[] = [];

    // Each div.match links the same URL twice (hour + result anchors) — dedup via `seen`.
    matchEls.find(`a[href^="${LISTING_PATH}"]`).each((_, el) => {
        const href = $(el).attr('href');
        if (!href || !MATCH_PATH_RE.test(href) || seen.has(href)) return;
        seen.add(href);
        if (homeClubOf(href)) {
            targetPaths.push(href);
        }
    });

    return { totalMatches: matchEls.length, parseableMatches: seen.size, targetPaths };
}

export function parseMatchHtml(html: string, path: string): ScrapedEvent {
    const idMatch = MATCH_PATH_RE.exec(path);
    const club = homeClubOf(path);
    if (!idMatch || !club) {
        throw new Error(
            `futbolperuano: "${path}" is not a target-club match path — caller must filter via parseListingHtml`,
        );
    }
    const externalId = `m${idMatch[1]}`;
    const venue = VENUES[club];

    const $ = cheerio.load(html);
    const blocks: unknown[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            blocks.push(JSON.parse($(el).text()));
        } catch {
            // Other structured-data blocks aren't our contract; the Review check below
            // fails loudly if the block we need is missing or malformed.
        }
    });

    const review = blocks.find(
        (b): b is { itemReviewed?: unknown } =>
            typeof b === 'object' &&
            b !== null &&
            (b as Record<string, unknown>)['@type'] === 'Review',
    );
    if (!review) {
        throw new Error(
            `futbolperuano: no Review JSON-LD block on ${path} — futbolperuano markup likely changed`,
        );
    }

    const item = sportsEventJsonLdSchema.parse(review.itemReviewed);

    if (!item.location.includes(venue.jsonLdLocationContains)) {
        throw new Error(
            `futbolperuano: venue cross-check failed on ${path} — JSON-LD location "${item.location}" does not contain "${venue.jsonLdLocationContains}"; venue swap or rename, update futbolperuano-venues.ts`,
        );
    }

    const state = EVENT_STATUS_TO_STATE[item.eventStatus];
    if (!state) {
        throw new Error(
            `futbolperuano: unmapped eventStatus "${item.eventStatus}" on ${path} — decide its state mapping before continuing`,
        );
    }

    return {
        sourceId: SOURCE_ID,
        externalId,
        title: item.description,
        // Stable category string, not the per-phase competition label ("Torneo Apertura …").
        category: 'futbol',
        state,
        startAt: item.startDate,
        endAt: item.endDate,
        venueName: venue.stadiumName,
        location: venue.location,
        sourceUrl: `${BASE_URL}${path}`,
        sourcePayload: {
            path,
            competition: item.name,
            competitors: item.competitor?.map((c) => c.name),
            jsonLdLocation: item.location,
            eventStatus: item.eventStatus,
            stadium: venue.stadiumName,
        },
    };
}

export async function futbolperuanoScraper(log: Logger): Promise<ScrapeResult> {
    const scraperLog = log.child({ source: SOURCE_ID });
    const startedAt = Date.now();
    const listingUrl = `${BASE_URL}${LISTING_PATH}`;

    let listing = await fetchWithRetry(listingUrl, scraperLog);
    if (!listing.ok && listing.reason === 'transient') {
        scraperLog.info({ url: listingUrl }, 'listing retry pass');
        listing = await fetchWithRetry(listingUrl, scraperLog, []);
    }
    if (!listing.ok) {
        // The listing is the entry point: a 4xx means the URL scheme changed, exhausted
        // transient retries mean no work is possible. Either way abort this source's run
        // (run.ts isolates per-source failures from the other scrapers).
        const status = 'status' in listing && listing.status ? ` ${listing.status}` : '';
        throw new Error(`futbolperuano: listing fetch failed (${listing.reason}${status})`);
    }

    const { totalMatches, parseableMatches, targetPaths } = parseListingHtml(listing.html);
    if (totalMatches === 0) {
        scraperLog.warn(
            'listing contains no matches at all (off-season?) — completing with zero events',
        );
        return { events: [], sweepWindowEnd: null };
    }
    if (parseableMatches === 0) {
        // Matches render but none fit the m<id> path scheme — upstream structure
        // drift, not a quiet matchday. Fail loud.
        throw new Error(
            `futbolperuano: listing has ${totalMatches} matches but none parseable — slug scheme likely changed`,
        );
    }
    if (targetPaths.length === 0) {
        // All three Lima clubs away in the visible window is a legitimate,
        // recurring matchday shape — not an error.
        scraperLog.warn(
            { parseableMatches },
            'no target-club home matches in this listing window — completing with zero events',
        );
        return { events: [], sweepWindowEnd: null };
    }

    const events: ScrapedEvent[] = [];
    const failedList: string[] = [];
    let skipped4xx = 0;

    for (const path of targetPaths) {
        // Listing fetch hits the same host, so the first detail fetch also waits.
        await sleep(DETAIL_FETCH_DELAY_MS);
        const url = `${BASE_URL}${path}`;
        const outcome = await fetchWithRetry(url, scraperLog);
        if (outcome.ok) {
            events.push(parseMatchHtml(outcome.html, path));
        } else if (outcome.reason === 'http-4xx') {
            skipped4xx++;
            scraperLog.warn({ url, status: outcome.status }, '4xx — skipping match');
        } else {
            failedList.push(path);
            scraperLog.warn(
                { url, status: outcome.status, cause: outcome.cause },
                'transient failure — queued for retry pass',
            );
        }
    }

    let droppedAfterRetry = 0;
    if (failedList.length > 0) {
        scraperLog.info({ count: failedList.length }, 'retry pass');
        for (const path of failedList) {
            await sleep(DETAIL_FETCH_DELAY_MS);
            const outcome = await fetchWithRetry(`${BASE_URL}${path}`, scraperLog, []);
            if (outcome.ok) {
                events.push(parseMatchHtml(outcome.html, path));
            } else {
                droppedAfterRetry++;
                scraperLog.warn({ path, finalOutcome: outcome }, 'retry failed — dropping match');
            }
        }
    }

    scraperLog.info(
        {
            listingMatches: totalMatches,
            targetMatches: targetPaths.length,
            eventsParsed: events.length,
            skipped4xx,
            phase1Failed: failedList.length,
            droppedAfterRetry,
            durationMs: Date.now() - startedAt,
        },
        'scrape complete',
    );
    // No sweep window: the listing is a rolling matchday view with no defined date
    // bounds, and cancellations propagate via the source's own eventStatus field.
    return { events, sweepWindowEnd: null };
}
