import { setTimeout as sleep } from 'node:timers/promises';
import * as cheerio from 'cheerio';
import type { Logger } from 'pino';
import type { ScrapedEvent } from '@disruption-intelligence/shared';

const SOURCE_ID = 'gran-teatro-nacional';
const BASE_URL = 'https://granteatronacional.pe';
// Polite UA identifies the project. Add a contact suffix (public alias or repo URL)
// once the repo is public — never a personal email.
const USER_AGENT = 'disruption-intelligence/0.1';
const REQUEST_TIMEOUT_MS = 10_000;
// 1 initial attempt + N retries; this array's length = N. Phase 1 default → 4 total attempts.
const PHASE_1_RETRY_BACKOFFS_MS = [250, 500, 1000];
const MONTHS_TO_FETCH = 3;

type FetchOutcome =
    | { ok: true; html: string }
    | { ok: false; reason: 'http-4xx'; status: number }
    | { ok: false; reason: 'transient'; status?: number; cause?: unknown };

async function fetchMonthHtml(
    url: string,
    log: Logger,
    retryBackoffsMs: number[] = PHASE_1_RETRY_BACKOFFS_MS,
): Promise<FetchOutcome> {
    let lastTransient: { status?: number; cause?: unknown } = {};
    const totalAttempts = 1 + retryBackoffsMs.length;

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
        if (attempt > 0) {
            await sleep(retryBackoffsMs[attempt - 1]);
        }

        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: { 'User-Agent': USER_AGENT },
            });

            if (res.ok) {
                return { ok: true, html: await res.text() };
            }
            if (res.status >= 400 && res.status < 500) {
                return { ok: false, reason: 'http-4xx', status: res.status };
            }
            // 5xx — operational, retryable.
            lastTransient = { status: res.status };
            log.debug({ url, attempt, status: res.status }, 'http 5xx, will retry');
        } catch (cause) {
            // Network error, abort, timeout — all transient.
            lastTransient = { cause };
            log.debug({ url, attempt, cause }, 'fetch threw, will retry');
        }
    }

    return { ok: false, reason: 'transient', ...lastTransient };
}

export function parseCalendarHtml(html: string): ScrapedEvent[] {
    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];

    $('td[date-date] a[href^="/evento/"]').each((_, anchorEl) => {
        const $a = $(anchorEl);
        const $td = $a.closest('td[date-date]');
        const $cell = $a.closest('.contents');

        // Date comes from the cell, NOT from the cell-level <time> attribute. GTN's HTML
        // carries the first-occurrence's full datetime in every repeat-cell's <time> tag —
        // only the time-of-day portion is reliable across occurrences. See README/scraper-conventions.
        const date = $td.attr('date-date');
        const cellDatetimeAttr = $cell.children('time').attr('datetime'); // "YYYY-MM-DDT17:00:00Z" (date part is GTN-buggy)
        const timeOfDay = cellDatetimeAttr?.slice(11, 19); // "17:00:00"
        const slug = $a.attr('href')?.replace(/^\/evento\//, '');
        const title = $a.text().trim();
        // GTN's free events show "¡Es gratis!" as popup text but keep the real category
        // in the cat-* class — so the class is the source of truth, never the popup text.
        // When the class is missing entirely the event is uncategorized; GTN labels these
        // "Próximamente" in the popup, so we mirror that as the fallback slug.
        const catClass = $cell.find('span[class^="cat-"]').attr('class');
        const category = catClass ? catClass.replace(/^cat-/, '').trim() : 'proximamente';

        if (!date || !timeOfDay || !slug || !title) {
            throw new Error(
                `parseCalendarHtml: missing field — date=${date} timeOfDay=${timeOfDay} slug=${slug} title="${title}". GTN markup likely changed.`,
            );
        }

        // Lima is UTC-5 year-round, no DST. Combine the cell's date with the <time>'s time-of-day.
        const startAt = `${date}T${timeOfDay}-05:00`;
        const externalId = `${slug}:${date}T${timeOfDay.slice(0, 5)}`; // <slug>:YYYY-MM-DDTHH:MM

        events.push({
            sourceId: SOURCE_ID,
            externalId,
            title,
            category,
            state: 'scheduled',
            startAt,
            sourceUrl: `${BASE_URL}/evento/${slug}`,
            sourcePayload: { slug, gtnRawCellDatetime: cellDatetimeAttr, date },
        });
    });

    if (events.length === 0) {
        // HTTP 200 + zero matches = programmer error per ARCHITECTURE.md "Scraper conventions";
        // the scraper is a contract with the upstream HTML and we want loud immediate failure,
        // not silent under-coverage.
        throw new Error('parseCalendarHtml: 0 events parsed — GTN markup likely changed');
    }

    return events;
}

function monthsToFetch(now: Date, count: number): string[] {
    const months: string[] = [];
    for (let i = 0; i < count; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        months.push(`${yyyy}${mm}`);
    }
    return months;
}

export async function granTeatroNacionalScraper(log: Logger): Promise<ScrapedEvent[]> {
    const scraperLog = log.child({ source: SOURCE_ID });
    const months = monthsToFetch(new Date(), MONTHS_TO_FETCH);
    const failedList: { url: string; cause?: unknown; status?: number }[] = [];
    const events: ScrapedEvent[] = [];
    let droppedAfterRetry = 0;

    for (const month of months) {
        const url = `${BASE_URL}/calendario/${month}`;
        const monthStart = Date.now();
        const outcome = await fetchMonthHtml(url, scraperLog);

        if (outcome.ok) {
            const monthEvents = parseCalendarHtml(outcome.html);
            events.push(...monthEvents);
            scraperLog.info(
                { month, eventsParsed: monthEvents.length, durationMs: Date.now() - monthStart },
                'month fetched',
            );
        } else if (outcome.reason === 'http-4xx') {
            scraperLog.warn({ url, status: outcome.status }, '4xx — skipping month');
        } else {
            failedList.push({ url, cause: outcome.cause, status: outcome.status });
            scraperLog.warn(
                { url, status: outcome.status, cause: outcome.cause },
                'transient failure — queued for retry pass',
            );
        }
    }

    if (failedList.length > 0) {
        scraperLog.info({ count: failedList.length }, 'retry pass');
        for (const failed of failedList) {
            const outcome = await fetchMonthHtml(failed.url, scraperLog, []);
            if (outcome.ok) {
                events.push(...parseCalendarHtml(outcome.html));
            } else {
                droppedAfterRetry++;
                scraperLog.warn(
                    { url: failed.url, finalOutcome: outcome },
                    'retry failed — dropping',
                );
            }
        }
    }

    scraperLog.info(
        {
            monthsAttempted: months.length,
            eventsParsed: events.length,
            phase1Failed: failedList.length,
            droppedAfterRetry,
        },
        'scrape complete',
    );
    return events;
}
