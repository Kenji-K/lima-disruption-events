import type { ScrapedEvent } from '@disruption-intelligence/shared';
import { db, events, regions } from '@disruption-intelligence/db';
import { sql, and, eq } from 'drizzle-orm';

export async function upsertEvents(
    rows: ScrapedEvent[],
): Promise<{ inserted: number; updated: number }> {
    if (rows.length === 0) return { inserted: 0, updated: 0 };

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

    const dbEvents = rows.map((r) => ({
        sourceId: r.sourceId,
        externalId: r.externalId,
        regionId: lima.id,
        title: r.title,
        category: r.category,
        state: r.state,
        startAt: new Date(r.startAt),
        endAt: r.endAt ? new Date(r.endAt) : null,
        location: r.location
            ? sql`ST_GeogFromText(${`SRID=4326;POINT(${r.location.lng} ${r.location.lat})`})`
            : null,
        sourcePayload: r.sourcePayload,
        sourceUrl: r.sourceUrl ?? null,
    }));

    const result = await db
        .insert(events)
        .values(dbEvents)
        .onConflictDoUpdate({
            target: [events.sourceId, events.externalId],
            set: {
                title: sql`excluded.title`,
                category: sql`excluded.category`,
                state: sql`excluded.state`,
                startAt: sql`excluded.start_at`,
                endAt: sql`excluded.end_at`,
                location: sql`excluded.location`,
                sourcePayload: sql`excluded.source_payload`,
                sourceUrl: sql`excluded.source_url`,
                updatedAt: sql`now()`,
            },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });

    const inserted = result.filter((r) => r.inserted).length;
    const updated = rows.length - inserted;
    return { inserted, updated };
}
