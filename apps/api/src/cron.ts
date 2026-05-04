import { schedule } from 'node-cron';
import { ZodError } from 'zod';
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
            // ZodError = scraper output failed boundary validation, i.e. our code is
            // wrong (programmer error). Anything else = operational (network, DB, GTN
            // markup change). Both log loudly; neither crashes the worker — daily
            // cadence means a missed tick recovers tomorrow.
            const errClass = err instanceof ZodError ? 'programmer' : 'operational';
            tickLog.error({ err, errClass }, 'ingest tick failed');
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
