import { z } from 'zod';

// API process config, validated at boot — refuse to start on bad config.
// DATABASE_URL is owned and validated by @disruption-intelligence/db's client
// at first import with the same fail-fast posture.
const envSchema = z.object({
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
});

export const env = envSchema.parse(process.env);
