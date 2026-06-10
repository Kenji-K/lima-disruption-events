import { and, eq, gt, lt, notInArray, sql } from 'drizzle-orm';
import { db, events } from '@disruption-intelligence/db';

// Marker sweep per ADR-003: a FUTURE event that a complete scrape no longer
// returns was removed or rescheduled upstream — reflect it as cancelled so ghost
// rows don't accumulate on the customer-facing map. Past rows are never touched
// (history stays factual). Callers only invoke this after a scrape that covered
// its full window (ScrapeResult.sweepWindowEnd non-null).
export async function cancelMissingEvents(opts: {
    sourceId: string;
    windowEnd: Date;
    seenExternalIds: string[];
}): Promise<number> {
    const conditions = [
        eq(events.sourceId, opts.sourceId),
        eq(events.state, 'scheduled'),
        gt(events.startAt, sql`now()`),
        lt(events.startAt, opts.windowEnd),
    ];
    // Empty seen-list (a complete scrape that returned nothing) is the caller's
    // call to gate; here it would mean "cancel everything future in window", so
    // the notInArray is simply omitted rather than emitting invalid `NOT IN ()`.
    if (opts.seenExternalIds.length > 0) {
        conditions.push(notInArray(events.externalId, opts.seenExternalIds));
    }

    const flipped = await db
        .update(events)
        .set({ state: 'cancelled', updatedAt: sql`now()` })
        .where(and(...conditions))
        .returning({ id: events.id });
    return flipped.length;
}
