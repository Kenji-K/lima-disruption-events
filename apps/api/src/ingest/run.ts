import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { scrapedEventSchema, type ScrapedEvent } from '@disruption-intelligence/shared';
import { granTeatroNacionalScraper } from './gran-teatro-nacional-scraper';
import { futbolperuanoScraper } from './futbolperuano-scraper';
import { upsertEvents } from './upsert';

const SCRAPERS: { name: string; scrape: (log: Logger) => Promise<ScrapedEvent[]> }[] = [
    { name: 'gran-teatro-nacional', scrape: granTeatroNacionalScraper },
    { name: 'futbolperuano', scrape: futbolperuanoScraper },
];

export async function runIngestOnce(log: Logger): Promise<void> {
    const runId = randomUUID();
    const runLog = log.child({ runId });
    const startedAt = Date.now();

    let inserted = 0;
    let updated = 0;
    const failedSources: string[] = [];

    // Per-source isolation: scrape → validate → upsert per scraper, so one source
    // failing (or producing invalid output) never blocks the others' ingest.
    for (const { name, scrape } of SCRAPERS) {
        try {
            const raw = await scrape(runLog);
            const validated = scrapedEventSchema.array().parse(raw);
            const counts = await upsertEvents(validated);
            inserted += counts.inserted;
            updated += counts.updated;
        } catch (err) {
            failedSources.push(name);
            runLog.error(
                { source: name, err },
                'source ingest failed — continuing with remaining sources',
            );
        }
    }

    const durationMs = Date.now() - startedAt;
    runLog.info({ inserted, updated, failedSources, durationMs }, 'ingest run complete');
}
