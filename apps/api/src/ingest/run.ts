import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { scrapedEventSchema } from '@disruption-intelligence/shared';
import { granTeatroNacionalScraper } from './gran-teatro-nacional-scraper';
import { upsertEvents } from './upsert';

export async function runIngestOnce(log: Logger): Promise<void> {
    const runId = randomUUID();
    const runLog = log.child({ runId });
    const startedAt = Date.now();
    const raw = await granTeatroNacionalScraper(runLog);
    const validated = scrapedEventSchema.array().parse(raw);
    const { inserted, updated } = await upsertEvents(validated);
    const durationMs = Date.now() - startedAt;
    runLog.info({ inserted, updated, durationMs }, 'ingest run complete');
}
