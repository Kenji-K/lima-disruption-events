import * as Sentry from '@sentry/node';
import { env } from './env';

// Must be imported before any other app module (first import in main.ts) so the
// SDK is initialized before Fastify and the ingest pipeline load. Error capture
// only at v1 — no performance tracing (tracesSampleRate 0 keeps the quota and
// the overhead at zero). Without a DSN this is a no-op and every later
// Sentry.captureException call is too, so dev/test paths need no guards.
if (env.SENTRY_DSN) {
    Sentry.init({
        dsn: env.SENTRY_DSN,
        environment: env.SENTRY_ENVIRONMENT,
        tracesSampleRate: 0,
    });
}
