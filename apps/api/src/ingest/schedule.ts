import { schedule, type ScheduledTask } from 'node-cron';
import { ZodError } from 'zod';
import type { Logger } from 'pino';
import { runIngestOnce } from './run';

// Daily at 06:00 Lima local — calendar data doesn't churn intra-day; one fresh
// pull per morning is honest and polite to the sources. Adjust if a faster
// freshness expectation lands.
export const INGEST_CRON_SCHEDULE = '0 6 * * *';
export const INGEST_CRON_TIMEZONE = 'America/Lima';

export function createIngestTask(log: Logger): ScheduledTask {
    const task = schedule(
        INGEST_CRON_SCHEDULE,
        async (ctx) => {
            const tickLog = log.child({ tickAt: ctx.triggeredAt.toISOString() });
            try {
                await runIngestOnce(tickLog);
            } catch (err) {
                // ZodError = scraper output failed boundary validation, i.e. our code is
                // wrong (programmer error). Anything else = operational (DB, network).
                // Both log loudly; neither crashes the process — daily cadence means a
                // missed tick recovers tomorrow.
                const errClass = err instanceof ZodError ? 'programmer' : 'operational';
                tickLog.error({ err, errClass }, 'ingest tick failed');
            }
        },
        {
            name: 'ingest-daily',
            timezone: INGEST_CRON_TIMEZONE,
            // Skip a tick if the previous one is still running. Daily cadence makes
            // overlap implausible, but the guarantee is free.
            noOverlap: true,
        },
    );
    log.info(
        { schedule: INGEST_CRON_SCHEDULE, timezone: INGEST_CRON_TIMEZONE, name: task.name },
        'ingest cron scheduled',
    );
    return task;
}
