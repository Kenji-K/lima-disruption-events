import { z } from 'zod';
import { apiEventSchema, apiRoadAlertSchema, type ApiEvent } from '@disruption-intelligence/shared';

// Canonical event shape served by the API — lives in @disruption-intelligence/shared
// as the cross-boundary contract with apps/web. Re-exported here so route schemas
// and the OpenAPI spec stay anchored to the same object.
export const eventResponseSchema = apiEventSchema;
export type EventResponse = ApiEvent;
export const roadAlertResponseSchema = apiRoadAlertSchema;

export const eventsQuerySchema = z.object({
    from: z.iso
        .datetime({ offset: true })
        .optional()
        .describe(
            'Only events still in effect at or after this instant — an event matches if it ends (or starts, when it has no end) at/after it (ISO-8601 with offset)',
        ),
    to: z.iso
        .datetime({ offset: true })
        .optional()
        .describe('Only events starting at or before this instant (ISO-8601 with offset)'),
    category: z
        .string()
        .min(1)
        .optional()
        .describe("Exact category match (e.g. 'futbol', 'musica')"),
    source: z
        .string()
        .min(1)
        .optional()
        .describe("Exact source match (e.g. 'gran-teatro-nacional')"),
    limit: z.coerce.number().int().min(1).max(500).default(100).describe('Max rows returned'),
});

export const eventIdParamsSchema = z.object({
    // Capped at int4 max: the column is serial, and an over-range bind parameter
    // is a Postgres error (a leaky 500), not a clean 404.
    id: z.coerce.number().int().positive().max(2_147_483_647),
});

/** Per-source ingest freshness (ADR-007's ingest_state, Tier-2 visibility).
 *  Ops-facing — not part of the web contract in @disruption-intelligence/shared.
 *  Deliberately EXCLUDES lastError text: the API is public (no auth in v1) and
 *  raw error strings can leak internals; timestamps + failure counts carry the
 *  freshness signal, full detail lives in logs/Sentry/DB. */
export const sourceStatusSchema = z.object({
    sourceId: z.string(),
    lastRunAt: z.iso.datetime().nullable(),
    lastSuccessAt: z.iso.datetime().nullable(),
    lastErrorAt: z.iso.datetime().nullable(),
    consecutiveFailures: z.number().int(),
});

export const healthzOkSchema = z.object({
    status: z.literal('ok'),
    db: z.literal('ok'),
});

export const healthzDegradedSchema = z.object({
    status: z.literal('degraded'),
    db: z.literal('unreachable'),
});

export const notFoundSchema = z.object({
    statusCode: z.literal(404),
    error: z.literal('Not Found'),
    message: z.string(),
});
