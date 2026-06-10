import { z } from 'zod';
import { locationSchema } from './location';

// The API's canonical event shape — the cross-boundary contract between
// apps/api (serializes responses against it) and apps/web (validates responses
// with it). Dates are ISO-8601 UTC strings; location is the PostGIS point
// unpacked to {lng, lat}, null when the source gave no coordinates.
export const apiEventSchema = z.object({
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

export type ApiEvent = z.infer<typeof apiEventSchema>;
