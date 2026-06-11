import { pgTable, text, jsonb, timestamp, integer } from 'drizzle-orm/pg-core';

/** One row per source: runtime ingest state owned by the ingest runner — see ADR-007.
 *  The source registry itself stays in code (the SCRAPERS list); this table holds only
 *  runtime facts code can't know. Rows are created lazily on a source's first run.
 *  `cursor` is opaque, source-defined resume state (e.g. MML's `?after=` timestamp,
 *  Lima Expresa's seen-URL set); NULL for full-window scrapers. The runner persists a
 *  new cursor only after the source's events were validated and upserted successfully.
 *  `lastSuccessAt` is the per-source freshness fact; `consecutiveFailures` the future
 *  alerting hook. */
export const ingestState = pgTable('ingest_state', {
    /** Matches events.source_id (the SCRAPERS entry name). */
    sourceId: text().primaryKey(),
    cursor: jsonb(),
    lastRunAt: timestamp({ withTimezone: true }),
    lastSuccessAt: timestamp({ withTimezone: true }),
    lastErrorAt: timestamp({ withTimezone: true }),
    /** Message of the most recent failure; cleared on the next success. */
    lastError: text(),
    consecutiveFailures: integer().notNull().default(0),
});
