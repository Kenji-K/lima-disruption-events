import './instrument';
import * as Sentry from '@sentry/node';
import { closeDb } from '@disruption-intelligence/db';
import { buildServer } from './server';
import { env } from './env';
import { log } from './log';
import { createIngestTask, createRoadAlertTask } from './ingest/schedule';

const app = await buildServer(log);

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
