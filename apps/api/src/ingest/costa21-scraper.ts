import * as cheerio from 'cheerio';
import type { Logger } from 'pino';
import type { ScrapedEvent } from '@disruption-intelligence/shared';
import { fetchWithRetry } from './fetch';
import type { ScrapeResult } from './types';

/** Costa 21 venue calendar (V1-BRIEF Tier 1 item 5, carried to Tier 2).
 *
 *  First-party "Próximos Shows" cards on the venue homepage (re-verified
 *  2026-06-11; robots.txt: `User-agent: * / Allow: /`). Each card: category,
 *  DD-MM-YYYY date, title, and a Teleticket purchase link whose slug is the
 *  stable externalId. The page ships theme-template leftovers (a card with
 *  href="#" and no date) — cards without both a Teleticket link and a date
 *  are skipped; zero parsed cards is a markup-contract break.
 *
 *  No location pin: the venue ("Costa Verde, altura bajada John Lennon, San
 *  Miguel") is not in OSM and unverifiable coordinates don't enter the
 *  codebase — events surface in the list at date precision (00:00 Lima).
 *
 *  No sweep: shows leave the carousel when sold out, not only when cancelled
 *  — absence is not cancellation evidence (same reasoning as ADR-007 news). */

export const COSTA21_SOURCE_ID = 'costa-21';
const PAGE_URL = 'https://www.costa21.pe/';
const VENUE_ADDRESS = 'Costa Verde, altura bajada John Lennon, San Miguel';

const CATEGORY_MAP: Record<string, string> = { concierto: 'concert', festival: 'festival' };

export function parseCosta21Html(html: string): ScrapedEvent[] {
    const $ = cheerio.load(html);
    const events: ScrapedEvent[] = [];

    $('.news-block').each((_i, el) => {
        const block = $(el);
        const link = block.find('h4 a').first();
        const href = link.attr('href') ?? '';
        const title = link.text().trim();
        const slugMatch = /^https:\/\/teleticket\.com\.pe\/([a-z0-9-]+)$/i.exec(href);
        const info = block
            .find('.post-info li')
            .map((_j, li) => $(li).text().trim())
            .get();
        const dateText = info.find((t) => /^\d{2}-\d{2}-\d{4}$/.test(t));

        // Theme-template filler: no ticket link or no date — not a show card.
        if (!slugMatch || !title) return;
        if (!dateText) {
            throw new Error(`costa-21: show card "${title}" has no parseable date`);
        }
        const [dd, mm, yyyy] = dateText.split('-');
        const probe = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
        if (probe.getUTCMonth() !== Number(mm) - 1 || probe.getUTCDate() !== Number(dd)) {
            throw new Error(`costa-21: invalid date "${dateText}" on card "${title}"`);
        }

        const cardCategory = info.find((t) => !/^\d{2}-\d{2}-\d{4}$/.test(t))?.toLowerCase() ?? '';
        events.push({
            sourceId: COSTA21_SOURCE_ID,
            externalId: slugMatch[1]!,
            title,
            category: CATEGORY_MAP[cardCategory] ?? 'concert',
            state: 'scheduled',
            startAt: `${yyyy}-${mm}-${dd}T00:00:00-05:00`,
            sourcePayload: { venue: 'Costa 21', address: VENUE_ADDRESS, cardCategory },
            sourceUrl: href,
        });
    });

    if (events.length === 0) {
        throw new Error('costa-21: page parsed to zero show cards');
    }
    return events;
}

export async function costa21Scraper(log: Logger, _cursor: unknown): Promise<ScrapeResult> {
    const outcome = await fetchWithRetry(PAGE_URL, log);
    if (!outcome.ok) {
        throw new Error(`costa-21: page fetch failed (${outcome.reason})`);
    }
    const events = parseCosta21Html(outcome.html);
    log.info({ eventsExtracted: events.length }, 'costa-21: scrape complete');
    return { events, sweepWindowEnd: null };
}
