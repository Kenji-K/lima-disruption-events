import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import type { Logger } from 'pino';
import { scrapedEventSchema } from '@disruption-intelligence/shared';
import { granTeatroNacionalScraper } from './gran-teatro-nacional-scraper';
import { futbolperuanoScraper } from './futbolperuano-scraper';
import { upsertEvents } from './upsert';
import { cancelMissingEvents } from './sweep';
import type { ScrapeResult } from './types';

// `name` doubles as the sweep's sourceId filter — it must equal the SOURCE_ID
// each scraper stamps on its events.
const SCRAPERS: { name: string; scrape: (log: Logger) => Promise<ScrapeResult> }[] = [
    { name: 'gran-teatro-nacional', scrape: granTeatroNacionalScraper },
    { name: 'futbolperuano', scrape: futbolperuanoScraper },
];

export async function runIngestOnce(log: Logger): Promise<void> {
    const runId = randomUUID();
    const runLog = log.child({ runId });
    const startedAt = Date.now();

    let inserted = 0;
    let updated = 0;
    let cancelled = 0;
    const failedSources: string[] = [];

    // Per-source isolation: scrape → validate → upsert → sweep per scraper, so one
    // source failing (or producing invalid output) never blocks the others.
    for (const { name, scrape } of SCRAPERS) {
        try {
            const { events: raw, sweepWindowEnd } = await scrape(runLog);
            const validated = scrapedEventSchema.array().parse(raw);
            const counts = await upsertEvents(validated);
            inserted += counts.inserted;
            updated += counts.updated;

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
        } catch (err) {
            failedSources.push(name);
            // Cron runs have no request to error against — Sentry is the only
            // push-visibility into failed sources in prod. No-op without a DSN.
            Sentry.captureException(err, { tags: { source: name } });
            runLog.error(
                { source: name, err },
                'source ingest failed — continuing with remaining sources',
            );
        }
    }

    const durationMs = Date.now() - startedAt;
    runLog.info({ inserted, updated, cancelled, failedSources, durationMs }, 'ingest run complete');
}
