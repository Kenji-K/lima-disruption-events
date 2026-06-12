import { setTimeout as sleep } from 'node:timers/promises';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import type { Logger } from 'pino';
import { newsDedupKey, type ScrapedEvent } from '@disruption-intelligence/shared';
import { fetchWithRetry } from './fetch';
import { extractDateRange, normalize, toEndIso, toStartIso } from './extract-dates';
import type { ScrapeResult } from './types';

export const LIMA_EXPRESA_SOURCE_ID = 'lima-expresa';
// The pressroom subdomain is the real source; www.limaexpresa.pe/feed/ returns
// 200 but is empty (V1-BRIEF trap, re-verified 2026-06-11). robots.txt only
// disallows /lima-expresa/ — the listing and /news/* are allowed (checked
// 2026-06-11).
const LISTING_URL = 'https://prensa.limaexpresa.pe/';
const ORIGIN = 'https://prensa.limaexpresa.pe';
const DETAIL_DELAY_MS = 1500;
// seenUrls cap: the listing only surfaces recent posts (~1-3/week upstream), so
// 200 covers years of history while keeping the jsonb cursor bounded (ADR-007).
const MAX_SEEN_URLS = 200;

const cursorSchema = z.object({ seenUrls: z.array(z.string()) });

/** Lima Expresa is a road concessionaire: every post is about their three
 *  arteries, so MML's road-context gate is meaningless here — context is
 *  implicit. What separates disruption announcements from PR noise (open
 *  tours, sensibilización campaigns) is the operational trigger vocabulary. */
const TRIGGER_RE =
    /\b(cierres?|cerrad[oa]s?|desvios?|mantenimientos?|interrupcion(?:es)?|restriccion(?:es)?|cortes?|inhabilitad[oa]s?)\b/g;
const CLOSURE_RE = /\b(cierres?|cerrad[oa]s?|cortes?|desvios?|inhabilitad[oa]s?)\b/;

/** The three concession arteries, for sourcePayload tagging (no coordinates at
 *  v0.5 — these are line-shaped roads, not points; the Tier-2 geospatial layer
 *  is the right home for road geometry). */
const ARTERIES: [string, RegExp][] = [
    ['Vía de Evitamiento', /via de evitamiento/],
    ['Línea Amarilla', /linea amarilla/],
    ['Vía Expresa Paseo de la República', /via expresa|paseo de la republica/],
];

export type NewsListing = { paths: string[] };

/** Pure listing parse: news detail paths in page order (newest first). Exported
 *  for fixture tests. */
export function parseListingHtml(html: string): NewsListing {
    const $ = cheerio.load(html);
    const paths = new Set<string>();
    $('a[href]').each((_i, el) => {
        const href = $(el).attr('href')!;
        // Links are protocol-relative ("//prensa.limaexpresa.pe/news/<slug>.html").
        const match = /^(?:https?:)?\/\/prensa\.limaexpresa\.pe(\/news\/[^/?#]+\.html)$/.exec(href);
        if (match) paths.add(match[1]!);
    });
    if (paths.size === 0) {
        // HTTP 200 + zero news links = the listing markup contract broke —
        // programmer error per the scraper conventions: loud, immediate.
        throw new Error('lima-expresa: listing parsed to zero news links');
    }
    return { paths: [...paths] };
}

/** Pure detail parse: null when the post is not a disruption announcement.
 *  Only the headline + article body are considered — the page chrome contains
 *  trigger words ("Mantenimiento víal" gallery labels) that must not count.
 *  Exported for fixture tests. */
export function parseNewsHtml(html: string, path: string, log?: Logger): ScrapedEvent | null {
    const $ = cheerio.load(html);

    // JSON-LD NewsArticle carries the authoritative headline + datePublished.
    let headline: string | undefined;
    let datePublished: string | undefined;
    $('script[type="application/ld+json"]').each((_i, el) => {
        try {
            const data: unknown = JSON.parse($(el).text());
            const article = z
                .object({
                    '@type': z.literal('NewsArticle'),
                    headline: z.string().min(1),
                    datePublished: z.iso.datetime({ offset: true }),
                })
                .safeParse(data);
            if (article.success) {
                headline = article.data.headline;
                datePublished = article.data.datePublished;
            }
        } catch {
            // unrelated ld+json blocks are fine to skip
        }
    });
    const body = $('.content-text').text().trim();
    if (!headline || !datePublished || !body) {
        // Markup/JSON-LD contract broke — loud failure, not silent under-coverage.
        throw new Error(`lima-expresa: detail page missing headline/date/body (${path})`);
    }

    const text = `${headline}\n${body}`;
    const norm = normalize(text);
    const triggers = [...new Set([...norm.matchAll(TRIGGER_RE)].map((m) => m[1]!))];
    if (triggers.length === 0) {
        log?.debug({ path }, 'lima-expresa: post without disruption triggers — skipped');
        return null;
    }

    // Dates: an explicit announced window when the text has one; otherwise the
    // publication instant — Lima Expresa announcements describe conditions in
    // effect as of publication (e.g. an incident closure already in place).
    const published = {
        y: Number(datePublished.slice(0, 4)),
        m: Number(datePublished.slice(5, 7)),
        d: Number(datePublished.slice(8, 10)),
    };
    const range = extractDateRange(text, published);
    const startAt = range ? toStartIso(range.start) : datePublished;
    const endAt = range?.end ? toEndIso(range.end) : undefined;

    const arteries = ARTERIES.filter(([, re]) => re.test(norm)).map(([name]) => name);
    // externalId = the URL slug (immutable per post, ADR-007); sourceUrl = the
    // canonical detail URL (Tier-2 cross-channel dedup join key).
    const slug = path.replace(/^\/news\//, '').replace(/\.html$/, '');

    return {
        sourceId: LIMA_EXPRESA_SOURCE_ID,
        externalId: slug,
        title: headline,
        category: CLOSURE_RE.test(norm) ? 'road_closure' : 'road_work',
        state: 'scheduled',
        startAt,
        ...(endAt ? { endAt } : {}),
        sourcePayload: {
            path,
            datePublished,
            matchedKeywords: triggers,
            matchedDate: range?.raw ?? null,
            arteries,
        },
        sourceUrl: `${ORIGIN}${path}`,
        // ADR-009 cross-channel key.
        ...(newsDedupKey(headline) ? { dedupKey: newsDedupKey(headline) } : {}),
    };
}

export async function limaExpresaScraper(log: Logger, cursor: unknown): Promise<ScrapeResult> {
    const parsedCursor = cursorSchema.safeParse(cursor);
    if (cursor !== null && !parsedCursor.success) {
        // Self-heal: an unreadable cursor just means re-fetching the listing's
        // current page of details once (idempotent upserts absorb it).
        log.warn({ cursor }, 'lima-expresa: unreadable cursor — treating all posts as new');
    }
    const seen = new Set(parsedCursor.success ? parsedCursor.data.seenUrls : []);

    const listing = await fetchWithRetry(LISTING_URL, log);
    if (!listing.ok) {
        throw new Error(`lima-expresa: listing fetch failed (${listing.reason})`);
    }
    const { paths } = parseListingHtml(listing.html);
    const fresh = paths.filter((p) => !seen.has(p));

    const events: ScrapedEvent[] = [];
    const processed: string[] = [];
    for (const path of fresh) {
        // Unconditional: the first detail fetch was back-to-back with the
        // listing fetch on the same host (review C3).
        await sleep(DETAIL_DELAY_MS);
        const detail = await fetchWithRetry(`${ORIGIN}${path}`, log);
        if (!detail.ok) {
            // Skip without marking seen: the next run re-attempts this post.
            log.warn({ path, reason: detail.reason }, 'lima-expresa: detail fetch failed');
            continue;
        }
        const event = parseNewsHtml(detail.html, path, log);
        if (event) events.push(event);
        processed.push(path);
    }

    // Cursor: previously-seen URLs first (so pruning drops the oldest), newly
    // processed appended; failed fetches stay out and retry next run.
    const nextSeen = [...seen, ...processed].slice(-MAX_SEEN_URLS);
    log.info(
        {
            listed: paths.length,
            fresh: fresh.length,
            processed: processed.length,
            eventsExtracted: events.length,
        },
        'lima-expresa: scrape complete',
    );

    return {
        events,
        sweepWindowEnd: null, // incremental listing poll — never sweeps (ADR-007)
        ...(processed.length > 0 ? { nextCursor: { seenUrls: nextSeen } } : {}),
    };
}
