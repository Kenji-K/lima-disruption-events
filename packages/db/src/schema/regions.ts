import {
    pgTable,
    serial,
    text,
    char,
    smallint,
    integer,
    unique,
    check,
    type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { geographyPoint } from './_types';

/** Geographic admin regions, modelled as a generic hierarchy across countries.
 *  See ADR-005 for the full rationale. Top-level country has level=1, with deeper
 *  levels nesting via parent_id. Pre-populated by app-team migrations + the seed
 *  script — scrapers MUST NOT write to this table at runtime.
 *
 *  v0 ships only Peru level-1 rows (24 departamentos + Provincia Constitucional
 *  del Callao = 25 entries, sourced from INEI's canonical UBIGEO classification).
 *  Localized terminology ("Departamento" for Peru level-1, "Estado" for Brazil
 *  level-1, etc.) lives at the application layer, not the schema. */
export const regions = pgTable(
    'regions',
    {
        id: serial().primaryKey(),
        /** ISO 3166-1 alpha-2 country code: 'PE', 'BR', 'AR'. Fixed-width 2 chars. */
        countryCode: char({ length: 2 }).notNull(),
        /** Hierarchy depth: 1 = top (country admin division), 2 = mid, 3 = bottom. */
        level: smallint().notNull(),
        /** FK to the parent region. NULL only for level=1 (enforced by check constraint). */
        parentId: integer().references((): AnyPgColumn => regions.id),
        /** Kebab-case identifier, scoped by (country_code, level). 'lima', 'la-libertad'. */
        slug: text().notNull(),
        /** Human-readable canonical name in the country's language ('Lima', 'La Libertad'). */
        name: text().notNull(),
        /** ISO 3166-2 subdivision code where it exists ('PE-LIM'). Optional —
         *  not every level-2/level-3 unit has an ISO code. */
        isoCode: text(),
        /** For level-1 rows: the capital city's centroid (NOT the region's geographic
         *  centroid — Departamento de Lima's geographic center sits in rural Yauyos
         *  and would be useless for "where to center the map"). For level-2/level-3,
         *  the units are small enough that capital-vs-geographic centroids roughly
         *  coincide. See ADR-005 "Centroid semantics". */
        centroid: geographyPoint().notNull(),
        /** IANA tz string. For Peru rows uniformly 'America/Lima' — Peru is single-timezone. */
        timezone: text().notNull(),
    },
    (t) => [
        unique('regions_country_level_slug_uq').on(t.countryCode, t.level, t.slug),
        check(
            'regions_level_parent_check',
            sql`(${t.level} = 1 AND ${t.parentId} IS NULL) OR (${t.level} > 1 AND ${t.parentId} IS NOT NULL)`,
        ),
    ],
);
