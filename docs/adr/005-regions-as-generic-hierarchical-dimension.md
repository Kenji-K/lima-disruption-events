# ADR-005: Geographic regions as a generic, hierarchical, app-team-owned dimension

## Status

Accepted — 2026-05-06.

## Context

Scraper #1 (Gran Teatro Nacional) writes events that all belong to a single Lima venue. The `cities` table holds one row (Lima), and the upsert layer resolves the FK with a hardcoded `cities.slug = 'lima'` lookup. This works because GTN by construction can only ever produce Lima events.

Scraper #2 (`futbolperuano.com` Liga 1, scoped to Universitario / Alianza Lima / Sporting Cristal home matches per the source-survey log [Bitácora de fuentes — Scraper #2](https://www.notion.so/35803c87ab7081f4960fde3c9753c6c5)) does not by itself break the single-region assumption — all three target stadiums sit in Departamento de Lima. But Scraper #2 sits next to a long list of probable Scraper #3+ candidates (Selección Mayores fixtures at multiple national venues, news-derived disruptions across Peru, Liga 1's full 18-team fixture if scope expands, road-closure feeds in other cities) — every one of which writes events whose region is not Lima. Designing the v0 schema as if Lima were permanently the only known region locks us in *exactly* when the next source we add forces a rename. Two structural questions surface together:

**1. How do we represent geography across granularity?** Future product needs (per the Notion business plan) include per-province operator dashboards and per-district impact filters. A flat single-table `cities` model collapses these into one bag and loses join-ability between levels (a query for "all events in Departamento de Lima" can't be answered without recursive string matching). A column-per-level approach (`departamento_id`, `provincia_id`, `distrito_id`) hardcodes Peru's specific 3-level admin hierarchy into the events table.

**2. How do we represent geography across countries?** The Notion plan's expansion path goes Peru → other LATAM markets. Other countries' admin hierarchies don't match Peru's:

- Brazil: Estado → Município (2 levels)
- Mexico: Estado → Municipio (2 levels)
- Colombia: Departamento → Municipio (2 levels — `provincia` is not an admin unit)
- Argentina: Provincia → Departamento → Municipio (3 levels, but `provincia` is at the *top*, opposite of Peru's positioning)
- Chile: Región → Provincia → Comuna (3 levels)

Naming tables `departamentos` / `provincias` / `distritos` would force every non-Peru country into Peru-shaped columns where the names lie, and would require schema renames the moment we cross the border.

The right shape needs to: (a) handle hierarchy without baking a fixed depth into the schema, (b) handle multiple countries without per-country tables, (c) keep scraper concerns delegated (each scraper knows how to resolve geography for *its* source) while keeping the dimension app-owned (no scraper writes to the geography table at runtime).

## Decision

Model geography as a single generic `regions` table with country code, hierarchy level, and parent reference. Localized naming (e.g. "Departamento" for Peru, "Estado" for Brazil) lives at the application layer, not the schema.

```sql
CREATE TABLE regions (
  id            serial PRIMARY KEY,
  country_code  char(2) NOT NULL,                   -- ISO 3166-1 alpha-2: 'PE', 'BR', 'AR'
  level         smallint NOT NULL,                  -- 1 = top, 2 = mid, 3 = bottom
  parent_id     integer REFERENCES regions(id),     -- NULL only for level = 1
  slug          text NOT NULL,                      -- 'lima', 'la-libertad', 'callao'
  name          text NOT NULL,                      -- 'Lima', 'La Libertad', 'Callao'
  iso_code      text,                               -- ISO 3166-2 where it exists ('PE-LIM')
  centroid      geography(Point, 4326) NOT NULL,
  timezone      text NOT NULL,                      -- IANA tz; for Peru uniformly 'America/Lima'
  UNIQUE (country_code, level, slug),
  CHECK ((level = 1 AND parent_id IS NULL) OR (level > 1 AND parent_id IS NOT NULL))
);

-- events FK to the most-specific region we know about
ALTER TABLE events
  RENAME COLUMN city_id TO region_id;
-- region_id stays NOT NULL; FK target moves from cities (renamed/replaced) to regions
```

`cities` is renamed to `regions`, restructured to add `country_code`, `level`, `parent_id`, `iso_code`, and the existing `Lima` row migrates in-place to `(country_code='PE', level=1, slug='lima')`. The 83 existing GTN events keep the same FK target via the column rename.

### Rules that hold across the hierarchy

1. **`regions` is pre-populated via migrations.** Scrapers never `INSERT` or `UPDATE` rows in `regions` at runtime. New geographies (a new INEI-recognized distrito after a 2027 re-classification, a new country) are added by writing a migration. This rules out fuzzy-match drift across sources, race conditions on concurrent scraper inserts, and runtime geocoding-service dependencies.

2. **Scrapers resolve `region_id` before insert.** `events.region_id` is `NOT NULL`. Per-scraper resolution strategy is delegated to the scraper:
   - Hardcoded slug lookup `regions.slug = 'lima' AND country_code = 'PE' AND level = 1` (GTN — single venue; futbolperuano.com Scraper #2 — three Lima clubs, all stadiums in Departamento de Lima for v0 scope).
   - Static venue→region map keyed on the source's canonical home-team or venue identifier (small bounded universe, e.g. Universitario→lima, Alianza Lima→lima, Sporting Cristal→lima for Scraper #2; would generalize to multiple level-1 regions when Liga 1 scope expands beyond the 3 target Lima clubs).
   - PostGIS spatial join `ST_Intersects(events.location, regions.geom)` once polygon geometry is loaded for higher levels (future road-closure scraper — segment-based geography).
   - OSM/INEI reverse geocoding (future concert-promoter scraper — unbounded venue universe).

3. **Single FK on events, pointing at the most-specific region known.** A scraper that can only resolve to level-1 stores `region_id` of a level-1 row; a scraper that resolves to level-3 stores `region_id` of a level-3 row. The level is recoverable by joining to `regions` and reading `level`. **No `events.region_level_1_id` / `events.region_level_2_id` / `events.region_level_3_id` columns** — the hierarchy is in `regions`, not in `events`.

4. **Reconstruction commitment via `events.location`.** Scrapers that *can* capture venue coordinates SHOULD populate `events.location`. This makes finer admin granularity backfillable later via spatial join against future polygon geometry — no re-scrape required. Scrapers that cannot capture coordinates are accepted at coarser granularity; they would have lost sub-region information regardless.

5. **Localized naming lives at the app layer.** The schema does not encode "Departamento" or "Estado" as table or column names. The application layer translates `(country_code, level)` to the locally-correct singular/plural label. For v0's es-PE UI: level-1 PE rows render as "Departamento"; level-2 PE rows (when they arrive) render as "Provincia"; level-3 PE rows render as "Distrito." Brazil rows would render as "Estado" / "Município" using the same lookup keyed on `(country_code='BR', level=1|2)`.

### v0 implementation

One Drizzle migration ships with this ADR:

- Replace the `cities` table with `regions`, including the new `country_code`, `level`, `parent_id`, `iso_code`, and `CHECK` constraint columns. Existing `slug` / `name` / `centroid` / `timezone` carry over.
- Rename `events.city_id` → `events.region_id`; rename matching indexes (`events_city_*` → `events_region_*`).
- Seed 25 Peru level-1 rows: 24 departamentos + Provincia Constitucional del Callao. `slug` (kebab-case lowercase, e.g. `'lima'`, `'la-libertad'`); `name` (Spanish-canonical, e.g. `'Lima'`, `'La Libertad'`); `iso_code` (ISO 3166-2, e.g. `'PE-LIM'`); `centroid` (departmental capital city coordinates — see "Centroid semantics" below); `timezone` uniformly `'America/Lima'` (Peru is single-timezone).
- The existing `Lima` row migrates in-place; the existing 83 GTN events keep their FK target via the column rename.

Levels 2 and 3 (provincias, distritos) are deferred. Adding them is a clean adder under the generic schema: write a seed migration with `level=2` rows pointing at their level-1 parents, and a separate one for `level=3`. No schema change to `regions` or `events` required.

### Centroid semantics

`regions.centroid` is the **departmental capital city's centroid** for level-1 Peru rows, not the geographic centroid of the region's area. A region like Departamento de Lima covers ~32,000 km² — its true geographic centroid sits in rural Yauyos, ~120 km from Lima Metropolitana, useless for "where to center the map for this region." The capital-city centroid is the operationally interesting point.

This is documented in a one-line schema comment on the column. When level-2 and level-3 rows land later, the capital-vs-geographic distinction matters less (smaller areas; the two roughly coincide). For other countries' level-1 rows (e.g. Brazil's Estados), the same convention applies: capital-city centroid.

## Consequences

**Positive**

- Single source of truth for geography across countries and levels. No spelling drift, no accent inconsistency, no race conditions.
- Adding a new country is data-only: new rows with a new `country_code`, no schema change. The localized-label lookup at the app layer handles country-specific terminology.
- Adding deeper hierarchy (level 2, level 3) is also data-only. Existing events stay valid; new events written by scrapers that can resolve deeper get more specific `region_id` values.
- Per-scraper resolution flexibility. A road-closure scraper using PostGIS spatial joins coexists peacefully with a static-venue-map scraper — neither paints the other into a corner.
- The `events.location` capture commitment lets us upgrade existing event rows to finer granularity via spatial join — no re-scrape.

**Negative**

- "What level is this event located at?" requires joining `events` to `regions` and reading `level`, vs the explicit `departamento_id` / `provincia_id` / `distrito_id` columns approach where the level is encoded in the column name. For v0's query workload (small, single-country, simple) the join cost is negligible.
- "All events in Departamento de Lima" requires either a recursive CTE walking `parent_id` from level-1 down through descendants, or — if performance demands later — an `ltree` `path` column for indexed prefix matching (`WHERE region.path <@ 'PE.lima'`). For v0 with only level-1 rows this is moot: the query is `WHERE events.region_id = X`. Revisit ltree only when a query plan demands it.
- New geographies still require app-team migrations. Scrapers cannot self-heal. Acceptable: INEI re-classifications happen on the order of years.
- Localized-label lookups become an app-layer responsibility from day 1 (even though v0 only ever needs es-PE for level-1 PE rows). Cost is a single hardcoded lookup table or i18n entry; revisit when expansion makes it heavier.

**Operational**

- The Drizzle migration that creates `regions` and renames `events.city_id` → `events.region_id` must be run before Scraper #2 lands. Even though Scraper #2's three target stadiums all resolve to Lima, the schema rename closes the gap so that Scraper #3+ (national-scope sources) can land without a second rename.
- The existing GTN scraper's `cities.slug = 'lima'` lookup updates to `regions.slug = 'lima' AND country_code = 'PE' AND level = 1` — same query shape, same result row.
- A scraper that fails to resolve a venue (e.g. futbolperuano.com returns a Liga 1 fixture whose home team isn't in the static map, or a future broadened scope returns a stadium outside Lima we haven't seeded) MUST throw, not silently insert a row with a wrong or nullable FK. Mirrors the existing "scrape returned 0 events = programmer error" rule in `ARCHITECTURE.md` "Scraper conventions."
- When level-2 and level-3 rows are loaded later, the seed data comes from INEI's canonical CSV/shapefile distributions, not from web scraping. The seed migration's source URL and INEI publication date are recorded in the migration filename's accompanying ADR or commit message.

## Alternatives considered

**Per-country tables (`peru_departamentos`, `argentina_provincias`, ...).** Rejected: denormalizes the geography concept; requires the events table to FK either to a polymorphic geography or to know about every country-table; queries spanning countries become unions; new countries require schema migrations rather than data inserts.

**Column-per-level on a Peru-specific schema (`events.departamento_id`, `events.provincia_id`, `events.distrito_id`).** Rejected for the multi-country reason — Peru's level naming and depth don't generalize. Also locks the events table shape to a fixed admin depth: a Brazilian event would need either a NULL provincia_id (forever) or a column rename; a Chilean event would need a fourth level.

**Flat `places` table with a `kind` column distinguishing departamento / provincia / distrito / venue.** Rejected: collapses the hierarchy into a string column; queries for "all events in Departamento de Lima" require recursive string matching on `kind`; the parent-child relationship is implicit and unenforced; mixing venues with admin units in the same table re-introduces the granularity-collision problem at the row level instead of the table level.

**Use ltree from day 1 with a `path` column instead of `parent_id`.** Rejected as premature for v0: ltree is the right answer at scale (indexed prefix matching for "all descendants of X"), but for v0 with one country and one level loaded, `parent_id` is enough and ltree's setup cost (extension, index, path-normalization rules, slug-clash handling across levels) is unjustified. Adding ltree later is straightforward — add a `path` column, populate it from the existing parent_id chain, add the GiST index, switch hot queries to use `<@`. Existing parent_id stays as a sanity-check cross-reference.

**Runtime auto-discovery of regions from scraper output.** Scrapers `INSERT ... ON CONFLICT DO NOTHING` into `regions` whenever they encounter an unknown geography string, optionally followed by a geocoding call to fill in `centroid`. Rejected: introduces fuzzy-matching debt (the same place arrives under multiple spellings from different sources); requires an external geocoding service dependency or a fallback "unknown location" placeholder; concurrent scrapers race on inserts; debugging "why does this event have wrong coordinates" becomes archaeology across scraper runs. Saves ~2 hours of seed-list work and trades them for a class of bugs we don't want to own.

**Embed Peru-specific names in table or column names (`departamentos` / `provincias` / `distritos`) and rename when expanding.** Rejected: cost of getting it wrong scales with consumers (scrapers, API routes, frontend code, tests); the rename is cheap *now* (1 row, 0 API consumers) but expensive in 6 months. The generic `regions` shape costs nothing extra today and avoids the rename forever.

**Add level-2 and level-3 polygon geometry now (even with empty seed data).** Rejected as premature for v0: no scraper or query needs sub-level-1 granularity yet, and the polygon shapefile load (~50-200MB for Peruvian distritos) is not free. Adding levels later is a clean adder under this schema — events stay valid, new region rows just appear with their parent_id pointing at existing level-1 rows. YAGNI says wait for the first concrete need.
