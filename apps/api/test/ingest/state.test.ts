import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import type { ScrapedEvent } from '@disruption-intelligence/shared';
import { db, ingestState } from '@disruption-intelligence/db';
import { runIngestOnce } from '../../src/ingest/run';
import { getCursor, recordFailure, recordSuccess } from '../../src/ingest/state';
import type { Scraper } from '../../src/ingest/types';

const silentLog = pino({ level: 'silent' });

const validEvent = (sourceId: string, externalId: string): ScrapedEvent => ({
    sourceId,
    externalId,
    title: 'Cierre de la Av. Abancay por obras',
    category: 'road_closure',
    state: 'scheduled',
    startAt: '2026-07-01T08:00:00-05:00',
    sourcePayload: { kind: 'state-test fixture' },
});

const stateRow = async (sourceId: string) => {
    const rows = await db.select().from(ingestState).where(eq(ingestState.sourceId, sourceId));
    return rows[0];
};

describe('ingest_state helpers (ADR-007)', () => {
    it('getCursor returns null for a source that has never run', async () => {
        expect(await getCursor('helper-unknown')).toBeNull();
    });

    it('recordSuccess creates the row, stamps freshness, and writes a defined cursor', async () => {
        await recordSuccess('helper-success', { after: '2026-06-01T00:00:00Z' });
        const row = await stateRow('helper-success');
        expect(row?.cursor).toEqual({ after: '2026-06-01T00:00:00Z' });
        expect(row?.lastSuccessAt).toBeInstanceOf(Date);
        expect(row?.lastRunAt).toBeInstanceOf(Date);
        expect(row?.consecutiveFailures).toBe(0);
        expect(await getCursor('helper-success')).toEqual({ after: '2026-06-01T00:00:00Z' });
    });

    it('recordSuccess with undefined cursor leaves the stored cursor untouched', async () => {
        await recordSuccess('helper-keep', { seenUrls: ['a'] });
        await recordSuccess('helper-keep', undefined);
        expect(await getCursor('helper-keep')).toEqual({ seenUrls: ['a'] });
    });

    it('recordFailure accumulates, preserves the cursor, and the next success resets', async () => {
        await recordSuccess('helper-fail', { after: 'X' });
        await recordFailure('helper-fail', new Error('upstream 503'));
        await recordFailure('helper-fail', new Error('upstream 503 again'));

        let row = await stateRow('helper-fail');
        expect(row?.consecutiveFailures).toBe(2);
        expect(row?.lastError).toBe('upstream 503 again');
        expect(row?.lastErrorAt).toBeInstanceOf(Date);
        // A failed run must never move the resume point (ADR-007).
        expect(row?.cursor).toEqual({ after: 'X' });

        await recordSuccess('helper-fail', undefined);
        row = await stateRow('helper-fail');
        expect(row?.consecutiveFailures).toBe(0);
        expect(row?.lastError).toBeNull();
        expect(row?.cursor).toEqual({ after: 'X' });
    });
});

describe('runIngestOnce cursor wiring (ADR-007)', () => {
    it('passes the stored cursor in and persists nextCursor only after success', async () => {
        const seenCursors: unknown[] = [];
        const scraper: Scraper = {
            name: 'wire-ok',
            scrape: (_log, cursor) => {
                seenCursors.push(cursor);
                return Promise.resolve({
                    events: [validEvent('wire-ok', `e-${seenCursors.length}`)],
                    sweepWindowEnd: null,
                    nextCursor: { run: seenCursors.length },
                });
            },
        };

        await runIngestOnce(silentLog, [scraper]);
        await runIngestOnce(silentLog, [scraper]);

        expect(seenCursors).toEqual([null, { run: 1 }]);
        expect(await getCursor('wire-ok')).toEqual({ run: 2 });
        expect((await stateRow('wire-ok'))?.consecutiveFailures).toBe(0);
    });

    it('freezes the cursor and records the failure when the scraper throws', async () => {
        await recordSuccess('wire-throw', { after: 'frozen' });
        const scraper: Scraper = {
            name: 'wire-throw',
            scrape: () => Promise.reject(new Error('listing markup changed')),
        };

        await runIngestOnce(silentLog, [scraper]);

        const row = await stateRow('wire-throw');
        expect(row?.cursor).toEqual({ after: 'frozen' });
        expect(row?.consecutiveFailures).toBe(1);
        expect(row?.lastError).toBe('listing markup changed');
    });

    it('freezes the cursor when scraper output fails schema validation', async () => {
        const scraper: Scraper = {
            name: 'wire-invalid',
            scrape: () =>
                Promise.resolve({
                    // startAt is not an ISO datetime — must fail the Zod boundary.
                    events: [{ ...validEvent('wire-invalid', 'bad'), startAt: 'mañana temprano' }],
                    sweepWindowEnd: null,
                    nextCursor: { after: 'must-not-persist' },
                }),
        };

        await runIngestOnce(silentLog, [scraper]);

        const row = await stateRow('wire-invalid');
        expect(row?.cursor).toBeNull();
        expect(row?.consecutiveFailures).toBe(1);
    });

    it('one failing source does not block state writes for the next one', async () => {
        const failing: Scraper = {
            name: 'wire-pair-fail',
            scrape: () => Promise.reject(new Error('boom')),
        };
        const ok: Scraper = {
            name: 'wire-pair-ok',
            scrape: () =>
                Promise.resolve({
                    events: [validEvent('wire-pair-ok', 'e-1')],
                    sweepWindowEnd: null,
                    nextCursor: { after: 'ok' },
                }),
        };

        await runIngestOnce(silentLog, [failing, ok]);

        expect((await stateRow('wire-pair-fail'))?.consecutiveFailures).toBe(1);
        expect(await getCursor('wire-pair-ok')).toEqual({ after: 'ok' });
    });
});
