import { describe, it, expect, beforeAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { scrapedEventSchema } from '@disruption-intelligence/shared';
import type { ScrapedEvent } from '@disruption-intelligence/shared';
import { upsertEvents } from '../../src/ingest/upsert';
import { cancelMissingEvents } from '../../src/ingest/sweep';
import assert from 'node:assert';
import { setTimeout as sleep } from 'node:timers/promises';
import { db, events } from '@disruption-intelligence/db';

describe('upsertEvents — happy path', () => {
    const fixtures: ScrapedEvent[] = [
        {
            sourceId: 'test',
            externalId: 'test-001',
            title: 'Bad Bunny en el Estadio Nacional',
            category: 'concert',
            state: 'scheduled',
            startAt: '2026-06-12T21:00:00-05:00',
            endAt: '2026-06-13T00:00:00-05:00',
            location: { lng: -77.0339, lat: -12.0683 },
            sourcePayload: { venue: 'Estadio Nacional' },
        },
        {
            sourceId: 'test',
            externalId: 'test-002',
            title: 'Partido Alianza Lima vs Universitario de Deportes',
            category: 'sport',
            state: 'scheduled',
            startAt: '2026-06-19T18:00:00-05:00',
            endAt: '2026-06-19T21:00:00-05:00',
            location: { lng: -77.0441496, lat: -12.0484395 },
            sourcePayload: { venue: 'Estadio Monumental' },
        },
        {
            sourceId: 'test',
            externalId: 'test-003',
            title: 'Mantenimiento de Av. La Mar',
            category: 'road_closure',
            state: 'scheduled',
            startAt: '2026-06-10T21:00:00-05:00',
            sourcePayload: { affected: 'Av. La Mar, Pueblo Libre' },
        },
    ];

    let result: Awaited<ReturnType<typeof upsertEvents>>;

    beforeAll(async () => {
        result = await upsertEvents(fixtures);
    });

    it('inserts three events with correct counts', async () => {
        expect(result).toEqual({ inserted: 3, updated: 0 });

        const [countRow] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(events)
            .where(eq(events.sourceId, 'test'));
        assert(countRow);
        expect(countRow.count).toBe(3);
    });

    it('round-trips PostGIS coordinates through geography column', async () => {
        const [row] = await db
            .select({
                lng: sql<number>`ST_X(${events.location}::geometry)`,
                lat: sql<number>`ST_Y(${events.location}::geometry)`,
            })
            .from(events)
            .where(eq(events.externalId, 'test-001'));

        assert(row, 'expected event test-001 to exist');

        expect(row.lng).toBeCloseTo(-77.0339, 4);
        expect(row.lat).toBeCloseTo(-12.0683, 4);
    });
});

describe('upsertEvents — idempotent re-run', () => {
    const idempotentFixtures: ScrapedEvent[] = [
        {
            sourceId: 'idempotent',
            externalId: 'idempotent-001',
            title: 'Concierto repetido',
            category: 'concert',
            state: 'scheduled',
            startAt: '2026-07-01T20:00:00-05:00',
            endAt: '2026-07-01T23:00:00-05:00',
            location: { lng: -77.0339, lat: -12.0683 },
            sourcePayload: { venue: 'Estadio Nacional' },
        },
        {
            sourceId: 'idempotent',
            externalId: 'idempotent-002',
            title: 'Partido repetido',
            category: 'sport',
            state: 'scheduled',
            startAt: '2026-07-08T18:00:00-05:00',
            endAt: '2026-07-08T21:00:00-05:00',
            location: { lng: -77.0441496, lat: -12.0484395 },
            sourcePayload: { venue: 'Estadio Monumental' },
        },
        {
            sourceId: 'idempotent',
            externalId: 'idempotent-003',
            title: 'Cierre repetido',
            category: 'road_closure',
            state: 'scheduled',
            startAt: '2026-07-15T21:00:00-05:00',
            sourcePayload: { affected: 'Av. Larco' },
        },
    ];

    async function timestampsFor(externalId: string) {
        const [row] = await db
            .select({ ingestedAt: events.ingestedAt, updatedAt: events.updatedAt })
            .from(events)
            .where(eq(events.externalId, externalId));
        assert(row, `expected ${externalId} to exist`);
        return row;
    }

    let firstResult: Awaited<ReturnType<typeof upsertEvents>>;
    let secondResult: Awaited<ReturnType<typeof upsertEvents>>;
    let firstIngestedAt: Date;
    let firstUpdatedAt: Date;
    let secondIngestedAt: Date;
    let secondUpdatedAt: Date;

    beforeAll(async () => {
        firstResult = await upsertEvents(idempotentFixtures);
        ({ ingestedAt: firstIngestedAt, updatedAt: firstUpdatedAt } =
            await timestampsFor('idempotent-001'));

        // Postgres now() is transaction-start at microsecond precision; back-to-back
        // transactions can land in the same μs on fast hardware. Small wait keeps
        // the updated_at strict-greater-than assertion non-flaky.
        await sleep(10);

        secondResult = await upsertEvents(idempotentFixtures);
        ({ ingestedAt: secondIngestedAt, updatedAt: secondUpdatedAt } =
            await timestampsFor('idempotent-001'));
    });

    it('reports inserts on first call and updates on second call', () => {
        expect(firstResult).toEqual({ inserted: 3, updated: 0 });
        expect(secondResult).toEqual({ inserted: 0, updated: 3 });
    });

    it('preserves ingested_at across re-runs', () => {
        expect(secondIngestedAt.getTime()).toBe(firstIngestedAt.getTime());
    });

    it('advances updated_at on re-run', () => {
        expect(secondUpdatedAt.getTime()).toBeGreaterThan(firstUpdatedAt.getTime());
    });
});

describe('upsertEvents — field propagation on conflict', () => {
    it('propagates every changed field through ON CONFLICT (set-list regression guard)', async () => {
        const base: ScrapedEvent = {
            sourceId: 'propagation',
            externalId: 'prop-001',
            title: 'Original',
            category: 'concert',
            state: 'scheduled',
            startAt: '2026-08-01T20:00:00-05:00',
            sourcePayload: { v: 1 },
        };
        await upsertEvents([base]);

        const changed: ScrapedEvent = {
            ...base,
            title: 'Renamed',
            category: 'futbol',
            state: 'cancelled',
            startAt: '2026-08-02T21:00:00-05:00',
            endAt: '2026-08-02T23:00:00-05:00',
            location: { lng: -77.01, lat: -12.05 },
            sourcePayload: { v: 2 },
            sourceUrl: 'https://example.com/prop',
        };
        const result = await upsertEvents([changed]);
        expect(result).toEqual({ inserted: 0, updated: 1 });

        const [row] = await db
            .select({
                title: events.title,
                category: events.category,
                state: events.state,
                startAt: events.startAt,
                endAt: events.endAt,
                lng: sql<number | null>`ST_X(${events.location}::geometry)`,
                lat: sql<number | null>`ST_Y(${events.location}::geometry)`,
                sourcePayload: events.sourcePayload,
                sourceUrl: events.sourceUrl,
            })
            .from(events)
            .where(eq(events.externalId, 'prop-001'));
        assert(row, 'expected prop-001 to exist');

        expect(row.title).toBe('Renamed');
        expect(row.category).toBe('futbol');
        expect(row.state).toBe('cancelled');
        expect(row.startAt.toISOString()).toBe('2026-08-03T02:00:00.000Z');
        expect(row.endAt?.toISOString()).toBe('2026-08-03T04:00:00.000Z');
        expect(row.lng).toBeCloseTo(-77.01, 4);
        expect(row.lat).toBeCloseTo(-12.05, 4);
        expect(row.sourcePayload).toEqual({ v: 2 });
        expect(row.sourceUrl).toBe('https://example.com/prop');
    });
});

describe('upsertEvents — in-batch duplicate keys', () => {
    it('dedupes duplicates within one batch instead of aborting the statement (last wins)', async () => {
        const first: ScrapedEvent = {
            sourceId: 'dup',
            externalId: 'dup-001',
            title: 'First occurrence',
            category: 'concert',
            state: 'scheduled',
            startAt: '2026-09-01T20:00:00-05:00',
            sourcePayload: {},
        };
        const second: ScrapedEvent = { ...first, title: 'Second occurrence' };

        const result = await upsertEvents([first, second]);
        expect(result).toEqual({ inserted: 1, updated: 0 });

        const [row] = await db
            .select({ title: events.title })
            .from(events)
            .where(eq(events.externalId, 'dup-001'));
        assert(row);
        expect(row.title).toBe('Second occurrence');
    });
});

describe('cancelMissingEvents — marker sweep', () => {
    // Today is fixed by the DB's now(); these fixtures straddle it: one past row
    // (never swept), three future rows inside the window, one beyond the window.
    const sweepFixtures: ScrapedEvent[] = [
        {
            sourceId: 'sweep',
            externalId: 'sweep-past',
            title: 'Ya ocurrió',
            category: 'concert',
            state: 'scheduled',
            startAt: '2020-01-01T20:00:00-05:00',
            sourcePayload: {},
        },
        {
            sourceId: 'sweep',
            externalId: 'sweep-seen',
            title: 'Sigue programado',
            category: 'concert',
            state: 'scheduled',
            startAt: '2027-01-10T20:00:00-05:00',
            sourcePayload: {},
        },
        {
            sourceId: 'sweep',
            externalId: 'sweep-missing',
            title: 'Retirado por la fuente',
            category: 'concert',
            state: 'scheduled',
            startAt: '2027-01-15T20:00:00-05:00',
            sourcePayload: {},
        },
        {
            sourceId: 'sweep',
            externalId: 'sweep-beyond-window',
            title: 'Fuera de ventana',
            category: 'concert',
            state: 'scheduled',
            startAt: '2028-01-01T20:00:00-05:00',
            sourcePayload: {},
        },
        {
            sourceId: 'sweep-other-source',
            externalId: 'other-001',
            title: 'Otra fuente',
            category: 'concert',
            state: 'scheduled',
            startAt: '2027-01-15T20:00:00-05:00',
            sourcePayload: {},
        },
    ];

    async function stateOf(externalId: string): Promise<string> {
        const [row] = await db
            .select({ state: events.state })
            .from(events)
            .where(eq(events.externalId, externalId));
        assert(row, `expected ${externalId} to exist`);
        return row.state;
    }

    beforeAll(async () => {
        await upsertEvents(sweepFixtures);
    });

    it('cancels only future, in-window, unseen rows of the swept source', async () => {
        const flipped = await cancelMissingEvents({
            sourceId: 'sweep',
            windowEnd: new Date('2027-06-01T00:00:00Z'),
            seenExternalIds: ['sweep-seen'],
        });
        expect(flipped).toBe(1);
        expect(await stateOf('sweep-missing')).toBe('cancelled');
        expect(await stateOf('sweep-seen')).toBe('scheduled');
        expect(await stateOf('sweep-past')).toBe('scheduled');
        expect(await stateOf('sweep-beyond-window')).toBe('scheduled');
        expect(await stateOf('other-001')).toBe('scheduled');
    });

    it('is idempotent — a second sweep flips nothing new', async () => {
        const flipped = await cancelMissingEvents({
            sourceId: 'sweep',
            windowEnd: new Date('2027-06-01T00:00:00Z'),
            seenExternalIds: ['sweep-seen'],
        });
        expect(flipped).toBe(0);
    });
});

describe('scrapedEventSchema — rejection', () => {
    const validBase: ScrapedEvent = {
        sourceId: 'valid',
        externalId: 'valid-001',
        title: 'Valid event',
        category: 'concert',
        state: 'scheduled',
        startAt: '2026-06-12T21:00:00-05:00',
        sourcePayload: {},
    };

    it('rejects events where endAt is not strictly after startAt', () => {
        const malformed = { ...validBase, endAt: '2026-06-12T20:00:00-05:00' };
        expect(() => scrapedEventSchema.parse(malformed)).toThrow(/endAt must be after startAt/);
    });

    it('rejects events missing a required field', () => {
        const { title: _title, ...incomplete } = validBase;
        expect(() => scrapedEventSchema.parse(incomplete)).toThrow(/title/);
    });

    it('rejects an array containing any invalid element', () => {
        const batch: unknown[] = [validBase, { ...validBase, state: 'pending' }];
        expect(() => scrapedEventSchema.array().parse(batch)).toThrow(/state|enum/i);
    });

    it('rejects non-http(s) sourceUrl schemes (stored-XSS guard)', () => {
        const malicious = { ...validBase, sourceUrl: 'javascript:alert(1)' };
        expect(() => scrapedEventSchema.parse(malicious)).toThrow(/url|protocol/i);
        const ftp = { ...validBase, sourceUrl: 'ftp://example.com/x' };
        expect(() => scrapedEventSchema.parse(ftp)).toThrow(/url|protocol/i);
    });
});
