import { closeDb } from '@disruption-intelligence/db';
import { log } from './log';
import { createIngestTask } from './ingest/schedule';

// Standalone scheduler for dev (`pnpm -F api cron`). The deployed API attaches
// the same task to the Fastify lifecycle in main.ts — one process, one logger.
const task = createIngestTask(log);

async function shutdown(signal: string): Promise<void> {
    log.info({ signal }, 'cron shutting down');
    let exitCode = 0;
    try {
        await task.stop();
        await closeDb();
    } catch (err) {
        log.error({ err }, 'cron shutdown error');
        exitCode = 1;
    } finally {
        process.exit(exitCode);
    }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
