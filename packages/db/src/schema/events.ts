import {
    pgTable,
    integer,
    serial,
    timestamp,
    jsonb,
    text,
    pgEnum,
    uniqueIndex,
    index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { regions } from './regions';
import { geographyPoint } from './_types';

export const eventState = pgEnum('event_state', ['scheduled', 'cancelled']);

/** One row per disruption event scraped from a public source.
 *  Idempotent upsert key: (sourceId, externalId) — see ADR-003.
 *  Index choices documented in ADR-001 (BRIN on startAt) and ADR-002 (GiST on location).
 *  `state` is source signal only; time-based status (upcoming, past) is derived from
 *  startAt/endAt at query time, never stored. */
export const events = pgTable(
    'events',
    {
        id: serial().primaryKey(),
        /** Identifier of the scraper that produced this row (e.g. 'gran-teatro-nacional', 'futbolperuano').
         *  Paired with externalId for the idempotent upsert key — see ADR-003. */
        sourceId: text().notNull(),
        /** Source's own stable identifier for this event (URL slug, ticket-system ID, etc.).
         *  Paired with sourceId for the idempotent upsert key — see ADR-003. */
        externalId: text().notNull(),
        /** FK to the most-specific known region (level 1, 2, or 3 per ADR-005's regions hierarchy).
         *  Always non-null — every event lives in a known place. */
        regionId: integer()
            .notNull()
            .references(() => regions.id),
        title: text().notNull(),
        /** Open set of categories ('concert', 'sport', 'road_closure', ...). Canonical list lives
         *  in the API/Zod layer, not the DB — sources reveal new categories over time. */
        category: text().notNull(),
        /** Source signal only — whether the event is still going to happen ('scheduled') or was
         *  called off ('cancelled'). Time-based status (upcoming, past) is derived from
         *  startAt/endAt at query time, never stored. */
        state: eventState().notNull(),
        startAt: timestamp({ withTimezone: true }).notNull(),
        /** Nullable. Many sources publish only a start time; queries that need a duration
         *  treat null as 'unknown' rather than 'instantaneous'. */
        endAt: timestamp({ withTimezone: true }),
        /** Nullable in v0 — not every source provides coordinates, and geocoding can fail on
         *  first scrape. Filter with a NOT NULL guard before passing to ST_* functions. */
        location: geographyPoint(),
        /** Parser intermediate: the structured object the scraper extracted before normalisation
         *  into the canonical Event shape. Not the raw HTTP response — that's not stored at v0.
         *  Useful for debugging when a row ends up looking wrong in the UI. */
        sourcePayload: jsonb().notNull(),
        /** Nullable. Public-facing URL for this event on the source — the venue page,
         *  ticket listing, or announcement. Surfaced to end users when present; not every
         *  source provides one. No index — never used in WHERE clauses, only in SELECTs. */
        sourceUrl: text(),
        ingestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        uniqueIndex('events_source_external_uq').on(t.sourceId, t.externalId),
        index('events_region_state_start_idx')
            .on(t.regionId, t.state, t.startAt)
            .where(sql`${t.state} = 'scheduled'`),
        index('events_region_category_idx')
            .on(t.regionId, t.category)
            .where(sql`${t.state} = 'scheduled'`),
    ],
);
