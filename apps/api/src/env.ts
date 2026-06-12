import { z } from 'zod';

// API process config, validated at boot — refuse to start on bad config.
// DATABASE_URL is owned and validated by @disruption-intelligence/db's client
// at first import with the same fail-fast posture.
const envSchema = z.object({
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    // Optional: absent locally (and in tests) — Sentry stays disabled rather
    // than blocking boot. Set via Fly secrets in production.
    SENTRY_DSN: z.url().optional(),
    SENTRY_ENVIRONMENT: z.string().min(1).default('development'),
    // Demo fence (PLAN 2026-06-11 workshop): 'true' lifts the public-visibility
    // gate on ticketer/futbolperuano data for a controlled-audience demo.
    // The bare boolean is for localhost demos only — on the prod app use
    // EXPOSE_GATED_SOURCES_UNTIL instead.
    EXPOSE_GATED_SOURCES: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    // Prod demo flip (owner decision 2026-06-12): lifts the gate until the
    // given instant, then relatches BY ITSELF — no second deploy, nothing to
    // remember after the meeting (the failure mode review A4 flagged). Set it
    // to ~the meeting's end, e.g. 2026-06-15T16:00:00-05:00.
    EXPOSE_GATED_SOURCES_UNTIL: z.iso.datetime({ offset: true }).optional(),
});

export const env = envSchema.parse(process.env);
