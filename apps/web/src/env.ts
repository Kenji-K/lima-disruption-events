import { z } from 'zod';

// Web build config, validated at module load — a bad VITE_API_URL fails the
// first render loudly instead of producing silent fetch errors.
const envSchema = z.object({
    VITE_API_URL: z.url().default('http://localhost:3000'),
});

export const env = {
    apiUrl: envSchema.parse(import.meta.env).VITE_API_URL,
};
