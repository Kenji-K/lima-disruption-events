import { randomUUID } from 'node:crypto';
import { log } from '../log';
import { scrapedEventSchema } from '@disruption-intelligence/shared';
import { stubScraper } from './stub-scraper';
import { upsertEvents } from './upsert';
import { closeDb } from '@disruption-intelligence/db';

const runId = randomUUID();
const runLog = log.child({ runId });

const startedAt = Date.now();
try {
    const raw = await stubScraper();
    const validated = scrapedEventSchema.array().parse(raw);
    const { inserted, updated } = await upsertEvents(validated);
    const durationMs = Date.now() - startedAt;
    runLog.info({ inserted, updated, durationMs }, 'ingest run complete');
} finally {
    await closeDb();
}
