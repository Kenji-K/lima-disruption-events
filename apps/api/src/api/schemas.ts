import { z } from 'zod';
import { locationSchema } from '@disruption-intelligence/shared';

// Canonical event shape served by the API. Dates are serialized ISO-8601 UTC;
// location is the PostGIS point unpacked to {lng, lat} (null when the source
// gave no coordinates).
export const eventResponseSchema = z.object({
    id: z.number().int(),
    sourceId: z.string(),
    externalId: z.string(),
    regionId: z.number().int(),
    title: z.string(),
    category: z.string(),
    state: z.enum(['scheduled', 'cancelled']),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime().nullable(),
    location: locationSchema.nullable(),
    sourceUrl: z.string().nullable(),
});
export type EventResponse = z.infer<typeof eventResponseSchema>;

export const eventsQuerySchema = z.object({
    from: z.iso
        .datetime({ offset: true })
        .optional()
        .describe('Only events starting at or after this instant (ISO-8601 with offset)'),
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
    id: z.coerce.number().int().positive(),
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
