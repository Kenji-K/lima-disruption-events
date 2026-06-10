import { setTimeout as sleep } from 'node:timers/promises';
import * as cheerio from 'cheerio';
import type { Logger } from 'pino';
import type { ScrapedEvent } from '@disruption-intelligence/shared';
import { fetchWithRetry } from './fetch';
import type { ScrapeResult } from './types';

const SOURCE_ID = 'gran-teatro-nacional';
const BASE_URL = 'https://granteatronacional.pe';
const MONTHS_TO_FETCH = 3;
// ≥1–2s between requests per host (V1-BRIEF operating constraints).
const REQUEST_SPACING_MS = 1500;
// Single fixed venue: Gran Teatro Nacional, Av. Javier Prado Este 2225, San Borja.
// OSM way 151308524, verified via Nominatim 2026-06-10.
const VENUE_LOCATION = { lng: -77.003169, lat: -12.0866312 };

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
            location: VENUE_LOCATION,
            sourceUrl: `${BASE_URL}/evento/${slug}`,
            sourcePayload: { slug, gtnRawCellDatetime: cellDatetimeAttr, date },
        });
    });

    if (events.length === 0) {
        // Empty-vs-broken distinction: GTN serves unpublished months as HTTP 200
        // with a fully rendered calendar grid and zero event anchors (verified live
        // against /calendario/202702). Grid present + no anchors = legitimately
        // empty month; no grid at all = markup change, fail loud.
        if ($('td[date-date]').length === 0) {
            throw new Error(
                'parseCalendarHtml: no calendar grid found — GTN markup likely changed',
            );
        }
        return [];
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

export async function granTeatroNacionalScraper(log: Logger): Promise<ScrapeResult> {
    const scraperLog = log.child({ source: SOURCE_ID });
    const now = new Date();
    const months = monthsToFetch(now, MONTHS_TO_FETCH);
    // First instant after the last fetched month — the exclusive sweep boundary.
    const windowEnd = new Date(now.getFullYear(), now.getMonth() + MONTHS_TO_FETCH, 1);
    const failedList: { url: string; cause?: unknown; status?: number }[] = [];
    const events: ScrapedEvent[] = [];
    let skipped4xx = 0;
    let droppedAfterRetry = 0;

    for (const [i, month] of months.entries()) {
        if (i > 0) await sleep(REQUEST_SPACING_MS);
        const url = `${BASE_URL}/calendario/${month}`;
        const monthStart = Date.now();
        const outcome = await fetchWithRetry(url, scraperLog);

        if (outcome.ok) {
            const monthEvents = parseCalendarHtml(outcome.html);
            events.push(...monthEvents);
            if (monthEvents.length === 0) {
                scraperLog.warn(
                    { month },
                    'month grid rendered with no events (unpublished month?)',
                );
            }
            scraperLog.info(
                { month, eventsParsed: monthEvents.length, durationMs: Date.now() - monthStart },
                'month fetched',
            );
        } else if (outcome.reason === 'http-4xx') {
            skipped4xx++;
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
            await sleep(REQUEST_SPACING_MS);
            const outcome = await fetchWithRetry(failed.url, scraperLog, []);
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
            skipped4xx,
            droppedAfterRetry,
        },
        'scrape complete',
    );
    // The cancel-missing sweep only runs on full window coverage: a dropped or
    // 4xx-skipped month means absence from `events` proves nothing.
    const complete = skipped4xx === 0 && droppedAfterRetry === 0;
    return { events, sweepWindowEnd: complete ? windowEnd : null };
}
