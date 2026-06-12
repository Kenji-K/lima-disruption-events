/** Gate-audit CLI — recall/precision measurement harness for the news-shaped
 *  road-disruption gates (review 2026-06-11 P2: "recall is structurally
 *  unmeasurable"). Replays the LIVE gate logic over a window of real post
 *  history (MML WP feed + gob.pe HTML listing backfill) WITHOUT touching the
 *  DB or ingest_state, and emits one JSONL row per post with the gate stage
 *  it died at — so a human (or a later session) can label false negatives
 *  and false positives against reality.
 *
 *  Usage: pnpm -F api audit-gates [days=60] [outDir=/tmp/gate-audit]
 *
 *  Politeness: same UA + 2s spacing as the production scrapers; one-off runs
 *  only — this is a tuning tool, not a scheduled job. Detail fetches are
 *  capped per institution (logged when hit).
 *
 *  Each row also carries two candidate signals the gates do NOT use yet, so
 *  guard designs can be evaluated offline before they ship:
 *    - pastHits: completion-shaped verb matches ("recuperamos", "culminó");
 *    - endsBeforePost: the extracted window ends before the post date.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import * as cheerio from 'cheerio';
import { pino } from 'pino';
import { fetchWithRetry } from './fetch';
import { extractDateRange, normalize, rangeEndsBefore, type PlainDate } from './extract-dates';
import { DISRUPTION_TRIGGER_RE, matchRoadDisruption } from './road-filter';
import { parseMmlPostsJson } from './mml-scraper';
import {
    GOB_PE_INSTITUTIONS,
    LIMA_CONTEXT_RE,
    NATIONAL_INSTITUTIONS,
    type GobPeInstitution,
} from './gob-pe-scraper';

const PAGE_DELAY_MS = 2000;
const MML_MAX_PAGES = 20;
const GOB_MAX_SHEETS = 15;
const GOB_MAX_DETAILS = 40;

/** Candidate past-tense/completion guard vocabulary (normalized text: no
 *  diacritics). First-person-plural and third-person preterite forms of
 *  "we did the work" verbs; municipal bragging, not announcements. */
export const PAST_TENSE_RE =
    /\b(recuperamos|rehabilitamos|culminamos|concluimos|finalizamos|ejecutamos|realizamos|entregamos|inauguramos|reabrimos|restablecimos|recupero|rehabilito|culmino|concluyo|finalizo|entrego|inauguro|reabrio|restablecio|recuperaron|rehabilitaron|culminaron|concluyeron|finalizaron|entregaron|inauguraron|reabrieron|restablecieron|se realizo|se ejecuto|se reabrio|fue (?:rehabilitad|recuperad|reabiert|entregad|culminad)[oa]|fueron (?:rehabilitad|recuperad|reabiert|entregad|culminad)[oa]s)\b/g;

type AuditRow = {
    source: string;
    id: number;
    postDate: string;
    url: string;
    title: string;
    stage: string;
    keywords?: string[];
    matchedDate?: string | null;
    pastHits: string[];
    endsBeforePost?: boolean;
    limaHit?: boolean;
    desc?: string;
};

const log = pino({ level: 'warn' });

const plainFromIso = (iso: string): PlainDate => ({
    y: Number(iso.slice(0, 4)),
    m: Number(iso.slice(5, 7)),
    d: Number(iso.slice(8, 10)),
});
async function auditMml(days: number): Promise<AuditRow[]> {
    const after = new Date(Date.now() - days * 86_400_000 - 5 * 3_600_000)
        .toISOString()
        .slice(0, 19);
    const rows: AuditRow[] = [];

    for (let page = 1; page <= MML_MAX_PAGES; page++) {
        if (page > 1) await sleep(PAGE_DELAY_MS);
        const url = `https://www.munlima.gob.pe/wp-json/wp/v2/posts?after=${encodeURIComponent(after)}&orderby=date&order=asc&per_page=50&page=${page}`;
        const outcome = await fetchWithRetry(url, log);
        if (!outcome.ok) throw new Error(`mml audit: listing page ${page} failed`);
        const posts = parseMmlPostsJson(outcome.html);

        for (const post of posts) {
            const title = cheerio.load(post.title.rendered).text().trim();
            const body = cheerio.load(post.content.rendered).text();
            const text = `${title}\n${body}`;
            const norm = normalize(text);
            const postDay = plainFromIso(post.date);
            const pastHits = [...new Set([...norm.matchAll(PAST_TENSE_RE)].map((m) => m[0]))];

            const base = {
                source: 'mml',
                id: post.id,
                postDate: post.date,
                url: post.link,
                title,
                pastHits,
            };
            const gate = matchRoadDisruption(norm);
            if (gate.keywords === null) {
                rows.push({ ...base, stage: gate.reason });
                continue;
            }
            const range = extractDateRange(text, postDay);
            if (!range) {
                rows.push({ ...base, stage: 'no-date', keywords: gate.keywords });
                continue;
            }
            rows.push({
                ...base,
                stage: rangeEndsBefore(range, postDay) ? 'past-event' : 'extracted',
                keywords: gate.keywords,
                matchedDate: range.raw,
                endsBeforePost: rangeEndsBefore(range, postDay),
            });
        }
        if (posts.length < 50) break;
        if (page === MML_MAX_PAGES) console.error('mml audit: page cap hit — window truncated');
    }
    return rows;
}

type ListingItem = { id: number; title: string; desc: string; url: string; datetime: string };

/** Parses one gob.pe HTML listing sheet (the noticias.json backfill surface). */
export function parseGobPeListingHtml(html: string, institution: string): ListingItem[] {
    const $ = cheerio.load(html);
    const items: ListingItem[] = [];
    $(`h3 a[href*="/institucion/${institution}/noticias/"]`).each((_, el) => {
        const a = $(el);
        const href = a.attr('href') ?? '';
        const idMatch = /\/noticias\/(\d+)-/.exec(href);
        if (!idMatch) return;
        const card = a.closest('div.p-6');
        items.push({
            id: Number(idMatch[1]),
            title: a.text().trim(),
            desc: card.find('[id$="-description"]').text().trim(),
            url: href.startsWith('http') ? href : `https://www.gob.pe${href}`,
            datetime: card.find('time[datetime]').attr('datetime') ?? '',
        });
    });
    return items;
}

async function auditGobPe(institution: GobPeInstitution, days: number): Promise<AuditRow[]> {
    const cutoff = Date.now() - days * 86_400_000;
    const seen = new Set<number>();
    const items: ListingItem[] = [];

    for (let sheet = 1; sheet <= GOB_MAX_SHEETS; sheet++) {
        if (sheet > 1) await sleep(PAGE_DELAY_MS);
        const url = `https://www.gob.pe/institucion/${institution}/noticias?sheet=${sheet}&sort_by=recent`;
        const outcome = await fetchWithRetry(url, log);
        if (!outcome.ok) throw new Error(`${institution} audit: sheet ${sheet} failed`);
        const sheetItems = parseGobPeListingHtml(outcome.html, institution);
        const fresh = sheetItems.filter((i) => !seen.has(i.id));
        if (fresh.length === 0) break; // only pinned repeats left
        fresh.forEach((i) => seen.add(i.id));
        items.push(...fresh.filter((i) => new Date(i.datetime + 'Z').getTime() >= cutoff));
        // Non-pinned items are recent-sorted: once the newest unseen item on a
        // sheet is older than the cutoff, deeper sheets are older still.
        const newestFresh = Math.max(...fresh.map((i) => new Date(i.datetime + 'Z').getTime()));
        if (newestFresh < cutoff) break;
        if (sheet === GOB_MAX_SHEETS)
            console.error(`${institution} audit: sheet cap hit — window truncated`);
    }

    const rows: AuditRow[] = [];
    let details = 0;
    for (const item of items) {
        const postDay = plainFromIso(item.datetime);
        const normListing = normalize(`${item.title}\n${item.desc}`);
        const base = {
            source: `gob-pe-${institution}`,
            id: item.id,
            postDate: item.datetime,
            url: item.url,
            title: item.title,
            desc: item.desc,
        };
        if (normListing.match(DISRUPTION_TRIGGER_RE) === null) {
            rows.push({ ...base, stage: 'no-trigger-listing', pastHits: [] });
            continue;
        }
        if (details >= GOB_MAX_DETAILS) {
            rows.push({ ...base, stage: 'detail-cap-skipped', pastHits: [] });
            continue;
        }
        details++;
        await sleep(PAGE_DELAY_MS);
        const detail = await fetchWithRetry(item.url, log);
        if (!detail.ok) {
            rows.push({ ...base, stage: `detail-fetch-failed-${detail.reason}`, pastHits: [] });
            continue;
        }
        const $ = cheerio.load(detail.html);
        const text = `${item.title}\n${$('main').text()}`;
        const norm = normalize(text);
        const pastHits = [...new Set([...norm.matchAll(PAST_TENSE_RE)].map((m) => m[0]))];

        const gate = matchRoadDisruption(norm);
        if (gate.keywords === null) {
            rows.push({ ...base, stage: gate.reason, pastHits });
            continue;
        }
        const limaHit = LIMA_CONTEXT_RE.test(norm);
        if (NATIONAL_INSTITUTIONS.has(institution) && !limaHit) {
            rows.push({ ...base, stage: 'non-lima', keywords: gate.keywords, pastHits, limaHit });
            continue;
        }
        const range = extractDateRange(text, postDay);
        const past = range ? rangeEndsBefore(range, postDay) : false;
        rows.push({
            ...base,
            stage: past ? 'past-event' : 'extracted',
            keywords: gate.keywords,
            matchedDate: range?.raw ?? null,
            pastHits,
            limaHit,
            endsBeforePost: past,
        });
    }
    return rows;
}

function summarize(rows: AuditRow[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.stage] = (counts[r.stage] ?? 0) + 1;
    return counts;
}

async function main(): Promise<void> {
    const days = Number(process.argv[2] ?? 60);
    const outDir = process.argv[3] ?? '/tmp/gate-audit';
    mkdirSync(outDir, { recursive: true });

    const mmlRows = await auditMml(days);
    writeFileSync(
        join(outDir, 'mml.jsonl'),
        mmlRows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    console.log('mml', JSON.stringify({ total: mmlRows.length, ...summarize(mmlRows) }));

    for (const inst of GOB_PE_INSTITUTIONS) {
        await sleep(PAGE_DELAY_MS);
        const rows = await auditGobPe(inst, days);
        writeFileSync(
            join(outDir, `gob-pe-${inst}.jsonl`),
            rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
        );
        console.log(`gob-pe-${inst}`, JSON.stringify({ total: rows.length, ...summarize(rows) }));
    }
    console.log(`rows written to ${outDir}`);
}

// tsx runs this file directly; no import.meta.main in Node 24.
void main();
