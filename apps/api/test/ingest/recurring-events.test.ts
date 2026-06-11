import { describe, it, expect } from 'vitest';
import { scrapedEventSchema } from '@disruption-intelligence/shared';
import { recurringEventsScraper, RECURRING_SOURCE_ID } from '../../src/ingest/recurring-events';

describe('recurring-events reference data', () => {
    it('every entry passes the scraper-output boundary schema', async () => {
        const { events, sweepWindowEnd } = await recurringEventsScraper();
        expect(events.length).toBeGreaterThanOrEqual(3);
        expect(sweepWindowEnd).toBeNull();
        for (const event of events) {
            expect(() => scrapedEventSchema.parse(event)).not.toThrow();
            expect(event.sourceId).toBe(RECURRING_SOURCE_ID);
            // Provenance rule: every hardcoded entry carries its public source URL.
            expect(event.sourceUrl).toMatch(/^https:\/\//);
        }
    });

    it('externalIds are unique (idempotent upsert keys)', async () => {
        const { events } = await recurringEventsScraper();
        const ids = events.map((e) => e.externalId);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
