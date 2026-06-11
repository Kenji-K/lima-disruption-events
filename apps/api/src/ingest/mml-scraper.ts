import { setTimeout as sleep } from 'node:timers/promises';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import type { Logger } from 'pino';
import { newsDedupKey, type ScrapedEvent } from '@disruption-intelligence/shared';
import { fetchWithRetry } from './fetch';
import { extractDateRange, normalize, toEndIso, toStartIso } from './extract-dates';
import { matchRoadDisruption, ROAD_MENTION_RE } from './road-filter';
import type { ScrapeResult } from './types';

export const MML_SOURCE_ID = 'mml';
const POSTS_URL = 'https://www.munlima.gob.pe/wp-json/wp/v2/posts';
const PER_PAGE = 50;
// Safety cap per run. Not silent truncation: the cursor only advances to the
// newest FETCHED post (order=asc), so anything beyond the cap is picked up by
// the next run.
const MAX_PAGES = 5;
const PAGE_DELAY_MS = 2000;
// First run (no cursor): posts older than this describe disruptions too stale
// to matter on a forward-looking map.
const FIRST_RUN_BACKFILL_DAYS = 30;

// IMPORTANT (verified 2026-06-11): munlima.gob.pe sits behind a WAF whose rule
// set blocks any request whose `_fields` parameter names `content` — it serves
// an HTML JavaScript-challenge page with HTTP 200 instead. Fetching WITHOUT
// `_fields` (full post objects, content included) passes. Do not "optimize"
// this URL with _fields.
const listingUrl = (after: string, page: number): string =>
    `${POSTS_URL}?after=${encodeURIComponent(after)}&orderby=date&order=asc&per_page=${PER_PAGE}&page=${page}`;

// WP REST post — the fields we consume. `date` is site-local time (America/Lima,
// fixed UTC-5) WITHOUT an offset suffix; it is both the `?after=` comparison
// clock and our cursor value, so it stays a verbatim string end to end.
const wpPostSchema = z.object({
    id: z.number().int(),
    date: z.string().min(19),
    link: z.url(),
    title: z.object({ rendered: z.string() }),
    content: z.object({ rendered: z.string() }),
});
type WpPost = z.infer<typeof wpPostSchema>;

const cursorSchema = z.object({ after: z.string().min(19) });

/** MML's disruption-trigger vocabulary — precision-tuned against live MML
 *  fixture batches 2026-06-11. The road-context + proximity gates that make
 *  it safe live in road-filter.ts (shared with the gob.pe scraper). */
const DISRUPTION_TRIGGER_RE =
    /\b(cierres?|cerrad[oa]s?|cortes?|clausuras?|desvios?|interferencias?)\b/g;

/** Pure per-post extraction: null when the post is not a datable road
 *  disruption. Exported for fixture-driven tests. */
export function extractDisruptionEvent(post: WpPost, log?: Logger): ScrapedEvent | null {
    const title = cheerio.load(post.title.rendered).text().trim();
    const body = cheerio.load(post.content.rendered).text();
    if (!title) return null; // degenerate posts with empty titles exist in the live feed

    const text = `${title}\n${body}`;
    const norm = normalize(text);

    const gate = matchRoadDisruption(norm, DISRUPTION_TRIGGER_RE);
    if (gate.keywords === null) {
        if (gate.reason === 'no-road-context') {
            log?.debug({ postId: post.id }, 'mml: trigger without nearby road context');
        }
        return null;
    }
    const keywords = gate.keywords;

    const postDay = {
        y: Number(post.date.slice(0, 4)),
        m: Number(post.date.slice(5, 7)),
        d: Number(post.date.slice(8, 10)),
    };
    const range = extractDateRange(text, postDay);
    if (!range) {
        log?.debug({ postId: post.id, keywords }, 'mml: keywords but no extractable date');
        return null;
    }

    const closure = /\b(cierres?|cerrad[oa]s?|cortes?|clausuras?|desvios?)\b/.test(norm);
    const roadMentions = [...new Set([...text.matchAll(ROAD_MENTION_RE)].map((m) => m[0].trim()))];

    return {
        sourceId: MML_SOURCE_ID,
        externalId: String(post.id), // immutable WP post ID per ADR-007
        title,
        category: closure ? 'road_closure' : 'road_work',
        state: 'scheduled',
        startAt: toStartIso(range.start),
        ...(range.end ? { endAt: toEndIso(range.end) } : {}),
        // No coordinates at v0.5: rule-based extraction yields road NAMES, not
        // points. regionId falls back to Lima level-1 in the upsert layer.
        sourcePayload: {
            postId: post.id,
            postDate: post.date,
            matchedKeywords: keywords,
            matchedDate: range.raw,
            roadMentions: roadMentions.slice(0, 5),
        },
        sourceUrl: post.link,
        // ADR-009 cross-channel key (gob.pe's munilima channel mirrors these posts).
        ...(newsDedupKey(title) ? { dedupKey: newsDedupKey(title) } : {}),
    };
}

/** Pure page parse: validates the WP response shape. Exported for fixture tests. */
export function parseMmlPostsJson(json: string): WpPost[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        // The WAF intermittently serves its HTML challenge with HTTP 200 (see
        // header comment). Operational, not a markup-contract break: abort this
        // source run; the cursor stays frozen and tomorrow's run retries.
        throw new Error('mml: response is not JSON (WAF challenge page?)');
    }
    return z.array(wpPostSchema).parse(parsed);
}

const defaultAfter = (): string =>
    new Date(Date.now() - FIRST_RUN_BACKFILL_DAYS * 86_400_000 - 5 * 3_600_000)
        .toISOString()
        .slice(0, 19);

export async function mmlScraper(log: Logger, cursor: unknown): Promise<ScrapeResult> {
    const parsedCursor = cursorSchema.safeParse(cursor);
    if (cursor !== null && !parsedCursor.success) {
        // Self-heal: a malformed cursor falls back to the first-run window
        // (idempotent upserts make re-coverage free).
        log.warn({ cursor }, 'mml: unreadable cursor — falling back to backfill window');
    }
    const after = parsedCursor.success ? parsedCursor.data.after : defaultAfter();

    const posts: WpPost[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        if (page > 1) await sleep(PAGE_DELAY_MS);
        const outcome = await fetchWithRetry(listingUrl(after, page), log);
        if (!outcome.ok) {
            // One listing URL IS the source — any fetch failure aborts the run
            // (cursor frozen; next scheduled run re-covers the same window).
            throw new Error(`mml: listing fetch failed (${outcome.reason})`);
        }
        const pagePosts = parseMmlPostsJson(outcome.html);
        posts.push(...pagePosts);
        if (pagePosts.length < PER_PAGE) break;
        if (page === MAX_PAGES) {
            log.warn({ after, maxPages: MAX_PAGES }, 'mml: page cap hit — rest resumes next run');
        }
    }

    const events = posts
        .map((post) => extractDisruptionEvent(post, log))
        .filter((e): e is ScrapedEvent => e !== null);

    // Cursor = newest fetched post's verbatim local-time date string (`?after=`
    // is strictly-after, so the newest post is not refetched). No posts → leave
    // the stored cursor untouched.
    const newest = posts.at(-1)?.date;
    log.info(
        { after, postsSeen: posts.length, eventsExtracted: events.length, nextAfter: newest },
        'mml: scrape complete',
    );

    return {
        events,
        sweepWindowEnd: null, // incremental delta poll — never sweeps (ADR-007)
        ...(newest ? { nextCursor: { after: newest } } : {}),
    };
}
