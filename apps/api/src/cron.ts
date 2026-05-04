import { schedule } from 'node-cron';
import { closeDb } from '@disruption-intelligence/db';
import { log } from './log';
import { runIngestOnce } from './ingest/run';

// Daily at 06:00 Lima local — calendar data doesn't churn intra-day; one fresh
// pull per morning is honest and polite to the source. Adjust if a faster
// freshness expectation lands.
const SCHEDULE = '0 6 * * *';
const TIMEZONE = 'America/Lima';

const task = schedule(
    SCHEDULE,
    async (ctx) => {
        const tickLog = log.child({ tickAt: ctx.triggeredAt.toISOString() });
        try {
            await runIngestOnce(tickLog);
        } catch (err) {
            // Operational error reaching here = scrape pipeline failure that wasn't
            // caught in the per-month classifier. Log loudly; do not crash the worker.
            tickLog.error({ err }, 'ingest tick failed');
        }
    },
    {
        name: 'ingest-gran-teatro-nacional',
        timezone: TIMEZONE,
        // Skip a tick if the previous one is still running. Daily cadence makes overlap
        // implausible, but the guarantee is free.
        noOverlap: true,
    },
);

log.info({ schedule: SCHEDULE, timezone: TIMEZONE, name: task.name }, 'cron started');

async function shutdown(signal: string): Promise<void> {
    log.info({ signal }, 'cron shutting down');
    await task.stop();
    await closeDb();
    process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
