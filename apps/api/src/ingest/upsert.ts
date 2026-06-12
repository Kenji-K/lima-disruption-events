import type { ScrapedEvent } from '@disruption-intelligence/shared';
import { db, events, regions } from '@disruption-intelligence/db';
import { sql, and, eq, inArray } from 'drizzle-orm';

/** ADR-009: a cross-channel copy dropped at write time. Surfaced to the caller
 *  (the run loop logs it) — the suppressed copy's URL lives nowhere else. */
export type SuppressedDuplicate = {
    dedupKey: string;
    sourceId: string;
    sourceUrl: string | null;
    existingSourceId: string;
    existingSourceUrl: string | null;
};

// ADR-009 date guard: wide enough for cross-channel publication/extraction skew
// (observed ≤5 days), narrow enough to keep recycled annual headlines apart.
const DEDUP_WINDOW_MS = 14 * 86_400_000;

export async function upsertEvents(
    rows: ScrapedEvent[],
): Promise<{ inserted: number; updated: number; suppressed: SuppressedDuplicate[] }> {
    if (rows.length === 0) return { inserted: 0, updated: 0, suppressed: [] };

    // One batch = one INSERT statement; a duplicate (sourceId, externalId) inside
    // it raises 21000 "cannot affect row a second time" and aborts the whole
    // source's ingest (GTN renders adjacent-month spillover cells, so cross-month
    // duplicates are plausible). Last wins — same as ON CONFLICT across batches.
    const inBatchDeduped = [
        ...new Map(rows.map((r) => [`${r.sourceId}:${r.externalId}`, r])).values(),
    ];

    // ADR-009 cross-channel suppression: an incoming news event whose dedupKey
    // already exists under ANOTHER source with a nearby startAt is the same
    // comunicado republished — first channel wins, the copy is dropped here.
    const keys = [...new Set(inBatchDeduped.flatMap((r) => (r.dedupKey ? [r.dedupKey] : [])))];
    const suppressed: SuppressedDuplicate[] = [];
    let deduped = inBatchDeduped;
    if (keys.length > 0) {
        const existing = await db
            .select({
                sourceId: events.sourceId,
                sourceUrl: events.sourceUrl,
                dedupKey: events.dedupKey,
                startAt: events.startAt,
            })
            .from(events)
            .where(inArray(events.dedupKey, keys));

        deduped = inBatchDeduped.filter((r) => {
            if (!r.dedupKey) return true;
            const match = existing.find(
                (e) =>
                    e.dedupKey === r.dedupKey &&
                    e.sourceId !== r.sourceId &&
                    Math.abs(e.startAt.getTime() - new Date(r.startAt).getTime()) <=
                        DEDUP_WINDOW_MS,
            );
            if (!match) return true;
            suppressed.push({
                dedupKey: r.dedupKey,
                sourceId: r.sourceId,
                sourceUrl: r.sourceUrl ?? null,
                existingSourceId: match.sourceId,
                existingSourceUrl: match.sourceUrl,
            });
            return false;
        });
    }
    if (deduped.length === 0) return { inserted: 0, updated: 0, suppressed };

    // Lima level-1 region — the single FK target for v0 scrapers (GTN +
    // futbolperuano's three Lima clubs all resolve here). Per ADR-005,
    // per-scraper resolution strategy is delegated; this is GTN's path.
    const [lima] = await db
        .select({ id: regions.id })
        .from(regions)
        .where(and(eq(regions.slug, 'lima'), eq(regions.countryCode, 'PE'), eq(regions.level, 1)))
        .limit(1);

    if (!lima) {
        throw new Error(
            "region (PE, level=1, slug='lima') is missing from the regions table — run pnpm migrate before ingest",
        );
    }

    const dbEvents = deduped.map((r) => ({
        sourceId: r.sourceId,
        externalId: r.externalId,
        regionId: lima.id,
        title: r.title,
        venueName: r.venueName ?? null,
        category: r.category,
        state: r.state,
        startAt: new Date(r.startAt),
        endAt: r.endAt ? new Date(r.endAt) : null,
        location: r.location
            ? sql`ST_GeogFromText(${`SRID=4326;POINT(${r.location.lng} ${r.location.lat})`})`
            : null,
        sourcePayload: r.sourcePayload,
        sourceUrl: r.sourceUrl ?? null,
        dedupKey: r.dedupKey ?? null,
    }));

    const result = await db
        .insert(events)
        .values(dbEvents)
        .onConflictDoUpdate({
            target: [events.sourceId, events.externalId],
            set: {
                title: sql`excluded.title`,
                venueName: sql`excluded.venue_name`,
                category: sql`excluded.category`,
                state: sql`excluded.state`,
                startAt: sql`excluded.start_at`,
                endAt: sql`excluded.end_at`,
                location: sql`excluded.location`,
                sourcePayload: sql`excluded.source_payload`,
                sourceUrl: sql`excluded.source_url`,
                dedupKey: sql`excluded.dedup_key`,
                updatedAt: sql`now()`,
            },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });

    const inserted = result.filter((r) => r.inserted).length;
    const updated = deduped.length - inserted;
    return { inserted, updated, suppressed };
}
