import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { db, events } from '@disruption-intelligence/db';
import {
    eventResponseSchema,
    eventsQuerySchema,
    eventIdParamsSchema,
    healthzOkSchema,
    healthzDegradedSchema,
    notFoundSchema,
    type EventResponse,
} from './schemas';

const DB_PING_TIMEOUT_MS = 2_000;

// Shared SELECT projection: PostGIS point unpacked to lng/lat at the DB
// (ST_X/ST_Y return null for null locations, so the null-location case flows through).
const eventSelection = {
    id: events.id,
    sourceId: events.sourceId,
    externalId: events.externalId,
    regionId: events.regionId,
    title: events.title,
    category: events.category,
    state: events.state,
    startAt: events.startAt,
    endAt: events.endAt,
    lng: sql<number | null>`ST_X(${events.location}::geometry)`,
    lat: sql<number | null>`ST_Y(${events.location}::geometry)`,
    sourceUrl: events.sourceUrl,
};

type EventRow = {
    id: number;
    sourceId: string;
    externalId: string;
    regionId: number;
    title: string;
    category: string;
    state: 'scheduled' | 'cancelled';
    startAt: Date;
    endAt: Date | null;
    lng: number | null;
    lat: number | null;
    sourceUrl: string | null;
};

function toEventResponse(row: EventRow): EventResponse {
    return {
        id: row.id,
        sourceId: row.sourceId,
        externalId: row.externalId,
        regionId: row.regionId,
        title: row.title,
        category: row.category,
        state: row.state,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt ? row.endAt.toISOString() : null,
        location: row.lng != null && row.lat != null ? { lng: row.lng, lat: row.lat } : null,
        sourceUrl: row.sourceUrl,
    };
}

export function registerRoutes(app: FastifyInstance): void {
    const r = app.withTypeProvider<ZodTypeProvider>();

    r.get(
        '/healthz',
        {
            schema: {
                tags: ['system'],
                summary: 'Liveness + DB ping',
                response: { 200: healthzOkSchema, 503: healthzDegradedSchema },
            },
        },
        async (req, reply) => {
            // postgres.js's default connect timeout (30s) far exceeds any health-check
            // window — race the ping so a down DB yields the designed 503, not a
            // checker-side timeout. The swallowed catch absorbs the losing promise's
            // late rejection so it can't surface as an unhandled rejection.
            try {
                const ping = db.execute(sql`select 1`);
                ping.catch(() => undefined);
                await Promise.race([
                    ping,
                    sleep(DB_PING_TIMEOUT_MS).then(() => {
                        throw new Error(`db ping exceeded ${DB_PING_TIMEOUT_MS}ms`);
                    }),
                ]);
                return { status: 'ok' as const, db: 'ok' as const };
            } catch (err) {
                req.log.error({ err }, 'healthz db ping failed');
                return reply.code(503).send({ status: 'degraded', db: 'unreachable' });
            }
        },
    );

    r.get(
        '/events',
        {
            schema: {
                tags: ['events'],
                summary: 'List disruption events, filterable by time range, category, and source',
                querystring: eventsQuerySchema,
                response: { 200: z.array(eventResponseSchema) },
            },
        },
        async (req) => {
            const { from, to, category, source, limit } = req.query;
            const conditions = [];
            // Overlap semantics: an event matches [from, to] when its own interval
            // [start_at, end_at ?? start_at] intersects the window — a multi-day
            // closure that began before `from` is still in effect. COALESCE (not
            // `end_at IS NULL OR …`) so endAt-less events are instants, keeping
            // past point events out. The `to` bound stays on start_at, which is
            // the half ADR-001's BRIN can serve.
            // Bound as ISO string, not Date: with a raw fragment on the left,
            // Drizzle skips the column's Date mapper and postgres.js can't
            // serialize a bare Date param.
            if (from)
                conditions.push(
                    sql`COALESCE(${events.endAt}, ${events.startAt}) >= ${new Date(from).toISOString()}::timestamptz`,
                );
            if (to) conditions.push(lte(events.startAt, new Date(to)));
            if (category) conditions.push(eq(events.category, category));
            if (source) conditions.push(eq(events.sourceId, source));

            const rows = await db
                .select(eventSelection)
                .from(events)
                .where(conditions.length > 0 ? and(...conditions) : undefined)
                .orderBy(asc(events.startAt), asc(events.id))
                .limit(limit);

            return rows.map(toEventResponse);
        },
    );

    r.get(
        '/events/:id',
        {
            schema: {
                tags: ['events'],
                summary: 'Fetch one event by id',
                params: eventIdParamsSchema,
                response: { 200: eventResponseSchema, 404: notFoundSchema },
            },
        },
        async (req, reply) => {
            const [row] = await db
                .select(eventSelection)
                .from(events)
                .where(eq(events.id, req.params.id))
                .limit(1);

            if (!row) {
                return reply.code(404).send({
                    statusCode: 404,
                    error: 'Not Found',
                    message: `event ${req.params.id} not found`,
                });
            }
            return toEventResponse(row);
        },
    );
}
