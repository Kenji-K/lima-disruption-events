import { describe, it, expect } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, events, ingestState } from '@disruption-intelligence/db';
import { parseImportFile, importEvents } from '../../src/ingest/import-events';

const JSON_ROWS = JSON.stringify([
    {
        sourceId: 'ord-1680',
        externalId: 'exp-2026-0042',
        title: 'Cierre Av. Salaverry por evento autorizado',
        category: 'road_closure',
        state: 'scheduled',
        startAt: '2026-07-10T06:00:00-05:00',
        endAt: '2026-07-10T14:00:00-05:00',
        location: { lng: -77.045, lat: -12.08 },
        sourcePayload: { expediente: 'EXP-2026-0042' },
        sourceUrl: 'https://www.munlima.gob.pe/transparencia/ord-1680',
    },
]);

const CSV_ROWS = [
    'sourceId,externalId,title,category,state,startAt,endAt,lng,lat,sourceUrl',
    'ord-1680,exp-2026-0043,"Cierre jr. Lampa, cuadras 1-5",road_closure,scheduled,2026-07-12T08:00:00-05:00,2026-07-12T18:00:00-05:00,-77.0301,-12.0464,',
    'ord-1680,exp-2026-0044,Interferencia Av. Brasil,road_work,scheduled,2026-07-15T00:00:00-05:00,,,,https://example.com/exp-44',
].join('\n');

describe('parseImportFile', () => {
    it('parses a JSON array of ScrapedEvents', () => {
        const rows = parseImportFile(JSON_ROWS, 'json', 'lote-julio.json');
        expect(rows).toHaveLength(1);
        expect(rows[0]!.externalId).toBe('exp-2026-0042');
        expect(rows[0]!.location).toEqual({ lng: -77.045, lat: -12.08 });
    });

    it('parses CSV with quoted commas, optional fields, and provenance payload', () => {
        const rows = parseImportFile(CSV_ROWS, 'csv', 'lote-julio.csv');
        expect(rows).toHaveLength(2);
        const [lampa, brasil] = rows;
        expect(lampa!.title).toBe('Cierre jr. Lampa, cuadras 1-5');
        expect(lampa!.location).toEqual({ lng: -77.0301, lat: -12.0464 });
        expect(lampa!.sourceUrl).toBeUndefined();
        expect(brasil!.endAt).toBeUndefined();
        expect(brasil!.location).toBeUndefined();
        expect(brasil!.sourceUrl).toBe('https://example.com/exp-44');
        expect(brasil!.sourcePayload).toMatchObject({ importedFrom: 'lote-julio.csv' });
    });

    it('rejects rows that fail the ScrapedEvent boundary schema', () => {
        const bad = JSON.stringify([{ sourceId: 'ord-1680', title: 'sin campos' }]);
        expect(() => parseImportFile(bad, 'json', 'x.json')).toThrow();
    });
});

describe('importEvents — writes through the idempotent upsert', () => {
    it('inserts, is idempotent on re-import, and records freshness', async () => {
        const rows = parseImportFile(CSV_ROWS, 'csv', 'lote-julio.csv');
        const first = await importEvents(rows);
        expect(first.inserted).toBe(2);

        const second = await importEvents(rows);
        expect(second).toMatchObject({ inserted: 0, updated: 2 });

        const [count] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(events)
            .where(eq(events.sourceId, 'ord-1680'));
        expect(count!.n).toBe(2);

        const [state] = await db
            .select({ lastSuccessAt: ingestState.lastSuccessAt })
            .from(ingestState)
            .where(eq(ingestState.sourceId, 'ord-1680'));
        expect(state?.lastSuccessAt).toBeInstanceOf(Date);
    });

    it('rejects a batch mixing sourceIds', async () => {
        const rows = parseImportFile(CSV_ROWS, 'csv', 'x.csv').map((r, i) =>
            i === 0 ? { ...r, sourceId: 'otra-fuente' } : r,
        );
        await expect(importEvents(rows)).rejects.toThrow(/single sourceId/);
    });

    it('rejects an empty batch', async () => {
        await expect(importEvents([])).rejects.toThrow(/empty/);
    });
});
