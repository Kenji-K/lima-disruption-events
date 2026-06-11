import { z } from 'zod';

// Web build config, validated at module load — a bad or missing VITE_API_URL
// fails the first render loudly instead of producing silent fetch errors. The
// localhost default is dev-only: a production build (Vercel) that forgot to set
// the var must fail visibly, not ship a bundle pointing at the viewer's own
// localhost.
const envSchema = z.object({
    VITE_API_URL: import.meta.env.DEV ? z.url().default('http://localhost:3000') : z.url(),
    // Optional everywhere: a missing DSN disables Sentry, it never blocks the app.
    VITE_SENTRY_DSN: z.url().optional(),
});

const parsed = envSchema.parse(import.meta.env);

export const env = {
    apiUrl: parsed.VITE_API_URL,
    sentryDsn: parsed.VITE_SENTRY_DSN,
};
