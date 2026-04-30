import type { ScrapedEvent } from '@disruption-intelligence/shared';
import { db, events, cities } from '@disruption-intelligence/db';
import { sql, eq } from 'drizzle-orm';

export async function upsertEvents(
    rows: ScrapedEvent[],
): Promise<{ inserted: number; updated: number }> {
    if (rows.length === 0) return { inserted: 0, updated: 0 };

    const [lima] = await db
        .select({ id: cities.id })
        .from(cities)
        .where(eq(cities.slug, 'lima'))
        .limit(1);

    if (!lima) {
        throw new Error(
            "city 'lima' is missing from the cities table — seed it before running the ingest pipeline",
        );
    }

    const dbEvents = rows.map((r) => ({
        sourceId: r.sourceId,
        externalId: r.externalId,
        cityId: lima.id,
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
