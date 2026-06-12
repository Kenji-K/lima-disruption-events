import { z } from 'zod';

/** Per-source ingest freshness (ADR-007's ingest_state) — the api↔web contract
 *  for GET /sources, consumed by the web freshness chip. Deliberately EXCLUDES
 *  lastError text: the API is public (no auth in v1) and raw error strings can
 *  leak internals; timestamps + failure counts carry the freshness signal,
 *  full detail lives in logs/Sentry/DB. */
export const apiSourceStatusSchema = z.object({
    sourceId: z.string(),
    lastRunAt: z.iso.datetime().nullable(),
    lastSuccessAt: z.iso.datetime().nullable(),
    lastErrorAt: z.iso.datetime().nullable(),
    consecutiveFailures: z.number().int(),
});

export type ApiSourceStatus = z.infer<typeof apiSourceStatusSchema>;
