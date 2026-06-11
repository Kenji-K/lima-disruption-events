import { setTimeout as sleep } from 'node:timers/promises';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import type { Logger } from 'pino';
import { newsDedupKey, type ScrapedEvent } from '@disruption-intelligence/shared';
import { fetchWithRetry } from './fetch';
import {
    extractDateRange,
    normalize,
    parseSpanishDate,
    toEndIso,
    toStartIso,
    type PlainDate,
} from './extract-dates';
import { matchRoadDisruption, ROAD_MENTION_RE } from './road-filter';
import type { ScrapeResult } from './types';

/** gob.pe multi-institution news job (V1-BRIEF Tier 2 item 1).
 *
 *  One scraper, four registry entries: `gob.pe/institucion/{slug}/noticias.json`
 *  serves an identical shape per institution (re-verified by fetch 2026-06-11:
 *  `{title, description, url, image, date}`, ~8-10 items, date as Spanish text).
 *  The `?page=` param is ignored (verified — page 2 repeats page 1), so each run
 *  covers the first page only; the daily cron outruns posting frequency.
 *  robots.txt re-checked 2026-06-11: only /admin/ disallowed.
 *
 *  Two-phase politeness: trigger scan over the listing's title+description
 *  first, detail-page fetch only for the few keyword-positive items; full
 *  road-context gates then run over the detail text (the listing description
 *  is truncated ~150 chars — dates and road context live in the body). */

export const GOB_PE_INSTITUTIONS = ['atu', 'sutran', 'mtc', 'munilima'] as const;
export type GobPeInstitution = (typeof GOB_PE_INSTITUTIONS)[number];

const DETAIL_DELAY_MS = 2000;

// MML's tuned trigger list plus ATU/SUTRAN operational vocabulary: future-tense
// verbs ("desviará su recorrido") and restriction/suspension terms, all common
// in transit-authority announcements and absent from municipal prose.
const GOB_TRIGGER_RE =
    /\b(cierres?|cerrad[oa]s?|cerraran?|cortes?|clausur(?:as?|ad[oa]s?)|desvios?|desviaran?|interferencias?|restriccion(?:es)?|restringid[oa]s?|interrumpid[oa]s?|suspension(?:es)?|suspendid[oa]s?|suspenderan?)\b/g;

// SUTRAN/MTC are national institutions; the product is Lima. A post must name
// Lima Metropolitana context to count. ATU and munilima are Lima by mandate.
const NATIONAL_INSTITUTIONS: ReadonlySet<GobPeInstitution> = new Set(['sutran', 'mtc']);
const LIMA_CONTEXT_RE =
    /\b(lima|callao|metropolitano|panamericana (?:norte|sur)|carretera central|evitamiento|costa verde|javier prado|ramiro priale|cercado)\b/;

// Closure-shaped keywords (matched form, already normalized) → road_closure;
// anything else that survived the gates is announcing works/restrictions.
const CLOSURE_KEYWORD_RE = /^(cierre|cerrad|cerrara|corte|clausur|desvi|interrumpid)/;

const noticiaSchema = z.object({
    title: z.string().min(1),
    description: z.string(),
    url: z.string().min(1),
    image: z.string().nullable().optional(),
    date: z.string().min(1),
});

export type GobPeNewsItem = {
    id: number;
    title: string;
    description: string;
    url: string;
    published: PlainDate;
};

const cursorSchema = z.object({ lastId: z.number().int() });

export function parseNoticiasJson(json: string, institution: GobPeInstitution): GobPeNewsItem[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        // Operational: gob.pe serving an HTML error/maintenance page. Abort the
        // run; the cursor stays frozen and the next scheduled run retries.
        throw new Error(`gob-pe-${institution}: response is not JSON`);
    }
    return z
        .array(noticiaSchema)
        .parse(parsed)
        .map((item) => {
            // The numeric prefix of the URL slug is gob.pe's stable news id —
            // externalId per ADR-007. Its absence is a markup-contract break.
            const idMatch = /\/noticias\/(\d+)-/.exec(item.url);
            if (!idMatch) {
                throw new Error(`gob-pe-${institution}: no news id in url ${item.url}`);
            }
            const published = parseSpanishDate(item.date);
            if (!published) {
                throw new Error(`gob-pe-${institution}: unparseable date "${item.date}"`);
            }
            return {
                id: Number(idMatch[1]),
                title: item.title,
                description: item.description,
                url: item.url,
                published,
            };
        });
}

/** Phase-1 gate: cheap trigger scan over the listing fields, deciding which
 *  items earn a detail fetch. Road context is NOT required here — the
 *  truncated description often cuts it off; the full gates run on the body. */
export function passesPrefilter(item: GobPeNewsItem): boolean {
    return normalize(`${item.title}\n${item.description}`).match(GOB_TRIGGER_RE) !== null;
}

/** Phase-2 extraction over the detail page. Null = not a Lima road disruption.
 *  Exported for fixture-driven tests. */
export function extractGobPeEvent(
    item: GobPeNewsItem,
    detailHtml: string,
    institution: GobPeInstitution,
    log?: Logger,
): ScrapedEvent | null {
    const $ = cheerio.load(detailHtml);
    const main = $('main');
    if (main.length === 0) {
        // gob.pe detail pages render the article inside <main> (verified
        // 2026-06-11); its absence means the page contract changed.
        throw new Error(`gob-pe-${institution}: detail page has no <main> (news ${item.id})`);
    }
    // Title first: when the headline carries the date ("... desde el lunes 15
    // de setiembre"), it must win over the publication-date line in the body.
    const text = `${item.title}\n${main.text()}`;
    const norm = normalize(text);

    const gate = matchRoadDisruption(norm, GOB_TRIGGER_RE);
    if (gate.keywords === null) {
        if (gate.reason === 'no-road-context') {
            log?.debug(
                { institution, newsId: item.id },
                'gob-pe: trigger without nearby road context',
            );
        }
        return null;
    }

    if (NATIONAL_INSTITUTIONS.has(institution) && !LIMA_CONTEXT_RE.test(norm)) {
        log?.debug({ institution, newsId: item.id }, 'gob-pe: disruption outside Lima — skipped');
        return null;
    }

    // Announced window when the text has one, else the publication date — the
    // announcement describes conditions in effect around publication.
    const range = extractDateRange(text, item.published);
    const startAt = range ? toStartIso(range.start) : toStartIso(item.published);
    const endAt = range?.end ? toEndIso(range.end) : undefined;

    const roadMentions = [...new Set([...text.matchAll(ROAD_MENTION_RE)].map((m) => m[0].trim()))];

    return {
        sourceId: `gob-pe-${institution}`,
        externalId: String(item.id),
        title: item.title,
        category: gate.keywords.some((k) => CLOSURE_KEYWORD_RE.test(k))
            ? 'road_closure'
            : 'road_work',
        state: 'scheduled',
        startAt,
        ...(endAt ? { endAt } : {}),
        // No coordinates: rule-based extraction yields road NAMES, not points.
        sourcePayload: {
            institution,
            newsId: item.id,
            publishedDate: item.published,
            matchedKeywords: gate.keywords,
            matchedDate: range?.raw ?? null,
            roadMentions: roadMentions.slice(0, 5),
        },
        sourceUrl: item.url,
        // ADR-009: munilima mirrors munlima.gob.pe WP posts; comunicados
        // replicate across channels.
        ...(newsDedupKey(item.title) ? { dedupKey: newsDedupKey(item.title) } : {}),
    };
}

export function createGobPeScraper(institution: GobPeInstitution) {
    const listingUrl = `https://www.gob.pe/institucion/${institution}/noticias.json`;

    return async function gobPeScraper(log: Logger, cursor: unknown): Promise<ScrapeResult> {
        const parsedCursor = cursorSchema.safeParse(cursor);
        if (cursor !== null && !parsedCursor.success) {
            log.warn({ institution, cursor }, 'gob-pe: unreadable cursor — full first page');
        }
        const lastId = parsedCursor.success ? parsedCursor.data.lastId : 0;

        const outcome = await fetchWithRetry(listingUrl, log);
        if (!outcome.ok) {
            throw new Error(`gob-pe-${institution}: listing fetch failed (${outcome.reason})`);
        }
        const items = parseNoticiasJson(outcome.html, institution);

        // The listing is NOT strictly newest-first (institutions pin items), so
        // new-item selection and the cursor both work off the numeric id.
        const fresh = items.filter((i) => i.id > lastId);
        const candidates = fresh.filter(passesPrefilter);

        const events: ScrapedEvent[] = [];
        for (const item of candidates) {
            // Any detail failure aborts the source run — the cursor stays
            // frozen and the next run re-covers the same ids (upserts are
            // idempotent). Partial cursor advance would skip the failed item
            // forever.
            await sleep(DETAIL_DELAY_MS);
            const detail = await fetchWithRetry(item.url, log);
            if (!detail.ok) {
                throw new Error(
                    `gob-pe-${institution}: detail fetch failed for news ${item.id} (${detail.reason})`,
                );
            }
            const event = extractGobPeEvent(item, detail.html, institution, log);
            if (event) events.push(event);
        }

        const maxId = items.reduce((acc, i) => Math.max(acc, i.id), lastId);
        log.info(
            {
                institution,
                itemsSeen: items.length,
                newItems: fresh.length,
                detailFetches: candidates.length,
                eventsExtracted: events.length,
                nextLastId: maxId,
            },
            'gob-pe: scrape complete',
        );

        return {
            events,
            sweepWindowEnd: null, // incremental news poll — never sweeps (ADR-007)
            ...(maxId > lastId || !parsedCursor.success ? { nextCursor: { lastId: maxId } } : {}),
        };
    };
}
