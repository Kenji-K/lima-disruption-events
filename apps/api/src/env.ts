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
    // Default off — the always-on public URL never serves gated sources.
    EXPOSE_GATED_SOURCES: z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
});

export const env = envSchema.parse(process.env);
