import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pino } from 'pino';
import type { FastifyInstance } from 'fastify';
import {
    scrapedEventSchema,
    type ApiEvent,
    type ScrapedEvent,
} from '@disruption-intelligence/shared';
import { upsertEvents } from '../../src/ingest/upsert';
import { buildServer } from '../../src/server';

// Slice of the OpenAPI document the spec test asserts against.
type OpenApiSpecSlice = {
    paths: Record<
        string,
        {
            get?: {
                parameters: { name: string }[];
                responses: Record<
                    string,
                    { content: Record<string, { schema: { type: string } } | undefined> }
                >;
            };
        }
    >;
};

// Each vitest fork gets its own Testcontainers DB (see test/setup.ts), so these
// fixtures are the only events present.
const fixtures: ScrapedEvent[] = [
    {
        sourceId: 'api-test',
        externalId: 'e1',
        title: 'Concierto A',
        category: 'concert',
        state: 'scheduled',
        startAt: '2026-07-01T20:00:00-05:00',
        endAt: '2026-07-01T23:00:00-05:00',
        location: { lng: -77.0339, lat: -12.0683 },
        sourcePayload: { fixture: true },
        sourceUrl: 'https://example.com/e1',
    },
    {
        sourceId: 'api-test',
        externalId: 'e2',
        title: 'Partido B',
        category: 'futbol',
        state: 'scheduled',
        startAt: '2026-07-05T18:00:00-05:00',
        sourcePayload: { fixture: true },
    },
    {
        sourceId: 'api-test-2',
        externalId: 'e3',
        title: 'Cierre C',
        category: 'road_closure',
        state: 'cancelled',
        startAt: '2026-07-10T08:00:00-05:00',
        sourcePayload: { fixture: true },
    },
];

let app: FastifyInstance;

beforeAll(async () => {
    await upsertEvents(scrapedEventSchema.array().parse(fixtures));
    app = await buildServer(pino({ level: 'silent' }));
    await app.ready();
});

afterAll(async () => {
    await app.close();
});

describe('GET /healthz', () => {
    it('returns 200 with a live DB ping', async () => {
        const res = await app.inject({ method: 'GET', url: '/healthz' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
    });
});

describe('GET /events', () => {
    it('returns all events ordered by startAt ascending', async () => {
        const res = await app.inject({ method: 'GET', url: '/events' });
        expect(res.statusCode).toBe(200);
        const body = res.json<ApiEvent[]>();
        expect(body).toHaveLength(3);
        expect(body.map((e) => e.title)).toEqual(['Concierto A', 'Partido B', 'Cierre C']);
    });

    it('serializes location to {lng, lat} and missing endAt/location to null', async () => {
        const res = await app.inject({ method: 'GET', url: '/events' });
        const [concierto, partido] = res.json<ApiEvent[]>();
        if (!concierto || !partido) throw new Error('expected at least two events');
        expect(concierto.location?.lng).toBeCloseTo(-77.0339, 4);
        expect(concierto.location?.lat).toBeCloseTo(-12.0683, 4);
        expect(concierto.startAt).toBe('2026-07-02T01:00:00.000Z');
        expect(concierto.endAt).toBe('2026-07-02T04:00:00.000Z');
        expect(concierto.sourceUrl).toBe('https://example.com/e1');
        expect(partido.location).toBeNull();
        expect(partido.endAt).toBeNull();
        expect(partido.sourceUrl).toBeNull();
    });

    it('filters by time range on startAt (from/to)', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/events',
            query: { from: '2026-07-04T00:00:00-05:00', to: '2026-07-06T00:00:00-05:00' },
        });
        const body = res.json<ApiEvent[]>();
        expect(body).toHaveLength(1);
        expect(body[0]?.title).toBe('Partido B');
    });

    it('filters by category', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/events',
            query: { category: 'concert' },
        });
        expect(res.json<ApiEvent[]>().map((e) => e.externalId)).toEqual(['e1']);
    });

    it('filters by source', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/events',
            query: { source: 'api-test-2' },
        });
        expect(res.json<ApiEvent[]>().map((e) => e.externalId)).toEqual(['e3']);
    });

    it('respects limit', async () => {
        const res = await app.inject({ method: 'GET', url: '/events', query: { limit: '1' } });
        expect(res.json()).toHaveLength(1);
    });

    it('rejects an invalid from with 400', async () => {
        const res = await app.inject({
            method: 'GET',
            url: '/events',
            query: { from: 'not-a-date' },
        });
        expect(res.statusCode).toBe(400);
    });

    it('rejects an out-of-range limit with 400', async () => {
        const res = await app.inject({ method: 'GET', url: '/events', query: { limit: '0' } });
        expect(res.statusCode).toBe(400);
    });
});

describe('GET /events/:id', () => {
    it('returns one event by id', async () => {
        const list = await app.inject({
            method: 'GET',
            url: '/events',
            query: { source: 'api-test' },
        });
        const id = list.json<ApiEvent[]>()[0]?.id;
        if (id === undefined) throw new Error('expected at least one api-test event');
        const res = await app.inject({ method: 'GET', url: `/events/${id}` });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ id, title: 'Concierto A', state: 'scheduled' });
    });

    it('404s on a missing id', async () => {
        const res = await app.inject({ method: 'GET', url: '/events/999999' });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });
    });

    it('400s on a non-numeric id', async () => {
        const res = await app.inject({ method: 'GET', url: '/events/abc' });
        expect(res.statusCode).toBe(400);
    });
});

describe('OpenAPI at /docs', () => {
    it('serves the generated spec with all three routes', async () => {
        const res = await app.inject({ method: 'GET', url: '/docs/json' });
        expect(res.statusCode).toBe(200);
        const spec = res.json<OpenApiSpecSlice>();
        expect(Object.keys(spec.paths)).toEqual(
            expect.arrayContaining(['/healthz', '/events', '/events/{id}']),
        );
        // Spot-check the spec reflects the Zod schemas: /events 200 is an array
        // and the querystring filters are documented.
        const eventsGet = spec.paths['/events']?.get;
        if (!eventsGet) throw new Error('expected GET /events in the OpenAPI spec');
        expect(eventsGet.parameters.map((p) => p.name)).toEqual(
            expect.arrayContaining(['from', 'to', 'category', 'source', 'limit']),
        );
        expect(eventsGet.responses['200']?.content['application/json']?.schema.type).toBe('array');
    });

    it('serves the swagger UI page', async () => {
        const res = await app.inject({ method: 'GET', url: '/docs' });
        expect([200, 302]).toContain(res.statusCode);
    });
});
