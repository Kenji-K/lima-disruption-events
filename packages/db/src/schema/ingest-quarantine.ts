import { pgTable, bigserial, text, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** Keyword-positive posts rejected by a downstream road gate — ADR-011's
 *  recall-measurement surface. One row per (source, post); re-runs refresh
 *  `lastSeenAt` and the verdict instead of duplicating. Internal audit data:
 *  queried via psql / future tooling, never exposed through the API. Posts
 *  that never matched a trigger are NOT recorded — vocabulary gaps are
 *  measured by the periodic `pnpm -F api audit-gates` replay instead. */
export const ingestQuarantine = pgTable(
    'ingest_quarantine',
    {
        id: bigserial({ mode: 'number' }).primaryKey(),
        /** Matches events.source_id (the SCRAPERS entry name). */
        sourceId: text().notNull(),
        /** The post identity the source would have used for the event (ADR-007). */
        externalId: text().notNull(),
        title: text().notNull(),
        url: text(),
        /** Gate that rejected the post: no-trigger (listing-triggered, body clean) |
         *  no-road-context | no-date | past-event | non-lima. */
        reason: text().notNull(),
        /** Gate evidence: matched keywords, extracted date raw, etc. */
        detail: jsonb(),
        /** The post's publication timestamp as the source states it. */
        postDate: timestamp({ withTimezone: true }),
        firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
        lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex('ingest_quarantine_source_external_uq').on(t.sourceId, t.externalId)],
);
