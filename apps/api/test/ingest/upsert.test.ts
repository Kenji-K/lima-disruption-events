import { describe, it, expect, beforeAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { scrapedEventSchema } from '@disruption-intelligence/shared';
import type { ScrapedEvent } from '@disruption-intelligence/shared';
import { upsertEvents } from '../../src/ingest/upsert';
import assert from 'node:assert';
import { db, events } from '@disruption-intelligence/db';

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

describe('upsertEvents — happy path', () => {
    let result: Awaited<ReturnType<typeof upsertEvents>>;

    beforeAll(async () => {
        result = await upsertEvents(fixtures);
    });

    it('inserts three events with correct counts', () => {
        expect(result.inserted).toBe(3);
        expect(result.updated).toBe(0);
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

    let firstResult: Awaited<ReturnType<typeof upsertEvents>>;
    let secondResult: Awaited<ReturnType<typeof upsertEvents>>;
    let firstIngestedAt: Date;
    let firstUpdatedAt: Date;
    let secondIngestedAt: Date;
    let secondUpdatedAt: Date;

    beforeAll(async () => {
        firstResult = await upsertEvents(idempotentFixtures);
        const [first] = await db
            .select({ ingestedAt: events.ingestedAt, updatedAt: events.updatedAt })
            .from(events)
            .where(eq(events.externalId, 'idempotent-001'));
        assert(first, 'expected idempotent-001 to exist after first upsert');
        firstIngestedAt = first.ingestedAt;
        firstUpdatedAt = first.updatedAt;

        // Postgres now() is transaction-start at microsecond precision; back-to-back
        // transactions can land in the same μs on fast hardware. Small wait keeps
        // the updated_at strict-greater-than assertion non-flaky.
        await new Promise((resolve) => setTimeout(resolve, 10));

        secondResult = await upsertEvents(idempotentFixtures);
        const [second] = await db
            .select({ ingestedAt: events.ingestedAt, updatedAt: events.updatedAt })
            .from(events)
            .where(eq(events.externalId, 'idempotent-001'));
        assert(second, 'expected idempotent-001 to exist after second upsert');
        secondIngestedAt = second.ingestedAt;
        secondUpdatedAt = second.updatedAt;
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
        expect(() => scrapedEventSchema.array().parse(batch)).toThrow();
    });
});
