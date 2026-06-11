import { schedule, type ScheduledTask } from 'node-cron';
import { ZodError } from 'zod';
import type { Logger } from 'pino';
import { runIngestOnce } from './run';
import { runRoadAlertSyncOnce } from './sutran-alerts';

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

// Road alerts mirror CURRENT network state — a daily cadence would show a
// resolved closure as red for up to 24h. Upstream refreshes ~hourly; 2-hourly
// is ADR-010's freshness/politeness balance (one request per tick).
export const ALERTS_CRON_SCHEDULE = '15 */2 * * *';

export function createRoadAlertTask(log: Logger): ScheduledTask {
    const task = schedule(
        ALERTS_CRON_SCHEDULE,
        async (ctx) => {
            // runRoadAlertSyncOnce never throws (ADR-010 degrade-gracefully);
            // the wrapper is a belt against programmer error in that promise.
            await runRoadAlertSyncOnce(log.child({ tickAt: ctx.triggeredAt.toISOString() }));
        },
        {
            name: 'road-alerts-2h',
            timezone: INGEST_CRON_TIMEZONE,
            noOverlap: true,
        },
    );
    log.info(
        { schedule: ALERTS_CRON_SCHEDULE, timezone: INGEST_CRON_TIMEZONE, name: task.name },
        'road-alert cron scheduled',
    );
    return task;
}
