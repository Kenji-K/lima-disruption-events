import { scrapedEventSchema, type ScrapedEvent } from '@disruption-intelligence/shared';
import { upsertEvents, type SuppressedDuplicate } from './upsert';
import { recordSuccess } from './state';

/** Manual-import path (V1-BRIEF Tier 2 item 4): Ord. 1680 road-interference
 *  authorizations arrive via Ley de Transparencia in whatever shape (likely
 *  PDFs → hand transcription), so the ingest surface is a file: a JSON array
 *  of ScrapedEvents (full fidelity) or a flat CSV (transcription-friendly).
 *  Everything writes through the same Zod boundary + idempotent upsert as the
 *  scrapers — re-importing a corrected file is safe by construction. */

// CSV header → flat columns; location split into lng/lat, payload synthesized
// with provenance. Empty cells mean "absent".
const CSV_COLUMNS = [
    'sourceId',
    'externalId',
    'title',
    'category',
    'state',
    'startAt',
    'endAt',
    'lng',
    'lat',
    'sourceUrl',
] as const;

/** Minimal RFC-4180 parser: comma-separated, double-quoted fields with ""
 *  escapes, LF/CRLF rows. No external dep for a hand-made file format. */
function parseCsv(content: string): string[][] {
    const rows: string[][] = [];
    let field = '';
    let row: string[] = [];
    let inQuotes = false;
    for (let i = 0; i < content.length; i++) {
        const c = content[i]!;
        if (inQuotes) {
            if (c === '"' && content[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') {
                inQuotes = false;
            } else {
                field += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field);
            field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && content[i + 1] === '\n') i++;
            row.push(field);
            field = '';
            if (row.some((f) => f !== '')) rows.push(row);
            row = [];
        } else {
            field += c;
        }
    }
    row.push(field);
    if (row.some((f) => f !== '')) rows.push(row);
    return rows;
}

export function parseImportFile(
    content: string,
    format: 'json' | 'csv',
    filename: string,
): ScrapedEvent[] {
    if (format === 'json') {
        return scrapedEventSchema.array().parse(JSON.parse(content));
    }

    const [header, ...rows] = parseCsv(content);
    if (!header || header.join(',') !== CSV_COLUMNS.join(',')) {
        throw new Error(
            `import: CSV header must be exactly "${CSV_COLUMNS.join(',')}" (got "${header?.join(',') ?? ''}")`,
        );
    }
    const candidates = rows.map((cells) => {
        const get = (col: (typeof CSV_COLUMNS)[number]): string =>
            cells[CSV_COLUMNS.indexOf(col)]?.trim() ?? '';
        const lng = get('lng');
        const lat = get('lat');
        return {
            sourceId: get('sourceId'),
            externalId: get('externalId'),
            title: get('title'),
            category: get('category'),
            state: get('state'),
            startAt: get('startAt'),
            ...(get('endAt') ? { endAt: get('endAt') } : {}),
            ...(lng && lat ? { location: { lng: Number(lng), lat: Number(lat) } } : {}),
            ...(get('sourceUrl') ? { sourceUrl: get('sourceUrl') } : {}),
            sourcePayload: { importedFrom: filename, raw: cells },
        };
    });
    return scrapedEventSchema.array().parse(candidates);
}

export async function importEvents(rows: ScrapedEvent[]): Promise<{
    sourceId: string;
    inserted: number;
    updated: number;
    suppressed: SuppressedDuplicate[];
}> {
    if (rows.length === 0) {
        throw new Error('import: empty batch — nothing to write');
    }
    const sourceIds = new Set(rows.map((r) => r.sourceId));
    if (sourceIds.size > 1) {
        // One import = one source's batch: freshness tracking and any later
        // cleanup ("re-import July's file") are per-source operations.
        throw new Error(
            `import: batch must carry a single sourceId, got ${[...sourceIds].join(', ')}`,
        );
    }
    const sourceId = rows[0]!.sourceId;
    const counts = await upsertEvents(rows);
    await recordSuccess(sourceId, undefined);
    return { sourceId, ...counts };
}
