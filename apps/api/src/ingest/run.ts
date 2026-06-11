import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import type { Logger } from 'pino';
import { scrapedEventSchema } from '@disruption-intelligence/shared';
import { granTeatroNacionalScraper } from './gran-teatro-nacional-scraper';
import { futbolperuanoScraper } from './futbolperuano-scraper';
import { mmlScraper, MML_SOURCE_ID } from './mml-scraper';
import { limaExpresaScraper, LIMA_EXPRESA_SOURCE_ID } from './lima-expresa-scraper';
import { recurringEventsScraper, RECURRING_SOURCE_ID } from './recurring-events';
import { createGobPeScraper, GOB_PE_INSTITUTIONS } from './gob-pe-scraper';
import { joinnusScraper, JOINNUS_SOURCE_ID } from './joinnus-scraper';
import { costa21Scraper, COSTA21_SOURCE_ID } from './costa21-scraper';
import { upsertEvents } from './upsert';
import { runRoadAlertSyncOnce } from './sutran-alerts';
import { cancelMissingEvents } from './sweep';
import { getCursor, recordFailure, recordSuccess } from './state';
import type { Scraper } from './types';

// `name` doubles as the sweep's sourceId filter — it must equal the SOURCE_ID
// each scraper stamps on its events. This list IS the source registry (ADR-007).
const SCRAPERS: Scraper[] = [
    { name: 'gran-teatro-nacional', scrape: granTeatroNacionalScraper },
    { name: 'futbolperuano', scrape: futbolperuanoScraper },
    // mml runs BEFORE the gob.pe channels: ADR-009's first-channel-wins makes
    // the richer WP copy own any cross-channel comunicado in steady state.
    { name: MML_SOURCE_ID, scrape: mmlScraper },
    { name: LIMA_EXPRESA_SOURCE_ID, scrape: limaExpresaScraper },
    { name: RECURRING_SOURCE_ID, scrape: recurringEventsScraper },
    ...GOB_PE_INSTITUTIONS.map((inst) => ({
        name: `gob-pe-${inst}`,
        scrape: createGobPeScraper(inst),
    })),
    { name: JOINNUS_SOURCE_ID, scrape: joinnusScraper },
    { name: COSTA21_SOURCE_ID, scrape: costa21Scraper },
];

// `scrapers` is injectable for orchestration tests only; production callers
// never pass it.
export async function runIngestOnce(log: Logger, scrapers: Scraper[] = SCRAPERS): Promise<void> {
    const runId = randomUUID();
    const runLog = log.child({ runId });
    const startedAt = Date.now();

    let inserted = 0;
    let updated = 0;
    let cancelled = 0;
    let suppressed = 0;
    const failedSources: string[] = [];

    // Per-source isolation: scrape → validate → upsert → sweep per scraper, so one
    // source failing (or producing invalid output) never blocks the others.
    for (const { name, scrape } of scrapers) {
        try {
            const cursor = await getCursor(name);
            const { events: raw, sweepWindowEnd, nextCursor } = await scrape(runLog, cursor);
            const validated = scrapedEventSchema.array().parse(raw);
            const counts = await upsertEvents(validated);
            inserted += counts.inserted;
            updated += counts.updated;
            suppressed += counts.suppressed.length;
            // The suppressed copy's URL exists nowhere but this log line (ADR-009).
            for (const dup of counts.suppressed) {
                runLog.info({ source: name, ...dup }, 'cross-channel duplicate suppressed');
            }

            // Marker sweep (ADR-003): events the source no longer lists were removed
            // or rescheduled upstream. Gated on full window coverage AND a non-empty
            // scrape — the latter guards against mass-cancel if upstream ever serves
            // a degenerate-but-parseable page for the whole window.
            if (sweepWindowEnd && validated.length > 0) {
                const flipped = await cancelMissingEvents({
                    sourceId: name,
                    windowEnd: sweepWindowEnd,
                    seenExternalIds: validated.map((e) => e.externalId),
                });
                cancelled += flipped;
                if (flipped > 0) {
                    runLog.warn(
                        { source: name, cancelled: flipped },
                        'cancel-missing sweep flipped upstream-removed events',
                    );
                }
            }

            // Cursor persists only after validate+upsert succeeded (ADR-007); a
            // throw above leaves the stored cursor frozen for the next run.
            await recordSuccess(name, nextCursor);
        } catch (err) {
            failedSources.push(name);
            // Cron runs have no request to error against — Sentry is the only
            // push-visibility into failed sources in prod. No-op without a DSN.
            Sentry.captureException(err, { tags: { source: name } });
            runLog.error(
                { source: name, err },
                'source ingest failed — continuing with remaining sources',
            );
            // State write failure must not break per-source isolation.
            await recordFailure(name, err).catch((stateErr: unknown) => {
                runLog.error({ source: name, err: stateErr }, 'ingest_state write failed');
            });
        }
    }

    // Road-alert snapshot rides the daily run too (ADR-010) — covers manual
    // `pnpm ingest` refreshes; the 2-hourly task owns steady-state freshness.
    // Never throws; failures land in ingest_state under 'sutran-alerts'.
    await runRoadAlertSyncOnce(runLog);

    const durationMs = Date.now() - startedAt;
    runLog.info(
        { inserted, updated, cancelled, suppressed, failedSources, durationMs },
        'ingest run complete',
    );
}
