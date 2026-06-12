import './instrument';
import * as Sentry from '@sentry/node';
import { closeDb } from '@disruption-intelligence/db';
import { buildServer } from './server';
import { env } from './env';
import { log } from './log';
import { createIngestTask, createRoadAlertTask } from './ingest/schedule';
import { runFirstRunCatchUp } from './ingest/run';
import { runRoadAlertSyncOnce } from './ingest/sutran-alerts';

const gateUntil = env.EXPOSE_GATED_SOURCES_UNTIL
    ? new Date(env.EXPOSE_GATED_SOURCES_UNTIL)
    : undefined;
const app = await buildServer(log, {
    exposeGatedSources: env.EXPOSE_GATED_SOURCES,
    exposeGatedSourcesUntil: gateUntil,
});
if (env.EXPOSE_GATED_SOURCES) {
    log.warn('EXPOSE_GATED_SOURCES is ON — gated sources are publicly visible (demo mode)');
}
if (gateUntil) {
    if (gateUntil.getTime() > Date.now()) {
        log.warn(
            { until: gateUntil.toISOString() },
            'EXPOSE_GATED_SOURCES_UNTIL active — gated sources publicly visible until then (timed demo flip)',
        );
    } else {
        log.info(
            { until: gateUntil.toISOString() },
            'EXPOSE_GATED_SOURCES_UNTIL is in the past — gate closed (stale secret, safe to unset)',
        );
    }
}

// 5xx responses reach Sentry via an onError hook; the sanitized error handler
// in server.ts still controls what the client sees. No-op without a DSN.
Sentry.setupFastifyErrorHandler(app);

// Cron rides the Fastify lifecycle (V1-BRIEF Tier 0 decision: one process, one
// logger). app.close() stops the schedules and drains the DB pool.
const ingestTask = createIngestTask(log);
const roadAlertTask = createRoadAlertTask(log);
app.addHook('onClose', async () => {
    await ingestTask.stop();
    await roadAlertTask.stop();
    await closeDb();
});

await app.listen({ port: env.PORT, host: env.HOST });

// Warm the road-alert mirror at boot: deploys replace the machine and can
// straddle the 2-hourly tick, leaving the snapshot empty/stale until the next
// one (observed on 2026-06-11). Fire-and-forget; never throws (ADR-010).
void runRoadAlertSyncOnce(log);
// First-run catch-up: sources introduced by this deploy ingest now instead of
// waiting for the next daily tick (one extra alert re-sync on such boots —
// runIngestOnce ends with one; harmless, idempotent).
runFirstRunCatchUp(log).catch((err: unknown) => {
    log.error({ err }, 'boot first-run catch-up failed — next daily tick covers it');
});

async function shutdown(signal: string): Promise<void> {
    log.info({ signal }, 'api shutting down');
    try {
        await app.close();
        process.exit(0);
    } catch (err) {
        log.error({ err }, 'shutdown error');
        process.exit(1);
    }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
