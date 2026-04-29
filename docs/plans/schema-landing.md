# Plan — Next implementation step (mentor mode)

## Context

Per `docs/PLAN.md` "Next move", the immediate task is landing the **initial Drizzle schema** in two commits:

- **Commit A** — install TypeScript + Drizzle tooling
- **Commit B** — `cities` + `events` tables, indexes per ADRs 001/002, first migration applied to local Postgres

All four ADRs are already written and accepted (BRIN on `start_at`, GiST on `location`, idempotent upsert via `(source_id, external_id)`, Fly co-location). Local stack is up: Node 24.15.0 / pnpm 10.33.2 / Postgres 16.10 + PostGIS 3.5.3 on `:5432`, no tables yet. Workspace shells exist for `apps/api`, `apps/web`, `packages/db`, `packages/shared` but only contain a stub `package.json` each.

This is your first real encounter in this repo with: Drizzle ORM (schema-as-TS, migration-from-diff), the postgres-js driver, Node 24's built-in `loadEnvFile()`, the harder-to-google bits of strict-mode TS config, and the PostGIS-in-Drizzle gotcha (Drizzle has no first-class `geography` type). The plan is sequenced so each new concept is taught **before** you write the code that depends on it.

Mentor mode is ON: I'll teach the concept and prompt you toward the code; you type it. Hints escalate from nudge → narrower hint → worked example → full answer.

---

## Sequence — concepts before code

### Phase 1 — Commit A: tooling (root tsconfig + `packages/db` deps)

#### Concept 1.1 — Drizzle's mental model

Drizzle is **schema-first in TypeScript**, not migration-first. You write `pgTable(...)` calls; Drizzle Kit diffs your TS schema against a snapshot of the last generated migration and emits a new SQL migration file. You apply the SQL with `drizzle-kit migrate` (or, for production, plain `psql`). Three artifacts to keep clear in your head:

1. `src/schema/*.ts` — the source of truth, edited by you
2. `migrations/*.sql` + `migrations/meta/*.json` — generated, committed, **append-only** (never edit a checked-in migration)
3. The runtime DB — what the SQL actually applied to

Two consequences of "append-only migrations" that bite people: (a) if you make a schema change, fix it by writing the next migration, not editing the previous one; (b) Drizzle Kit's snapshot files in `migrations/meta/` must also be committed, because that's how the next `generate` knows what diff to compute against.

#### Concept 1.2 — postgres-js over `pg`

Drizzle's recommended Postgres binding since 0.30 is the `postgres` package (postgres-js) rather than the older `node-postgres` (`pg`). The reasons that matter:

- Tagged-template-literal API; no callbacks
- Faster on most benchmarks
- First-party Drizzle examples assume it

`pg` still works; we're just picking the path with the most ecosystem momentum. (This is already documented in `docs/ARCHITECTURE.md` — "Drizzle Postgres binding".)

#### Concept 1.3 — Node 24's `process.loadEnvFile()`

Node 24 ships a built-in `.env` loader: `process.loadEnvFile()` (no args = reads `./.env`). It's synchronous, it mutates `process.env`, and it does **not** override variables that are already set in the environment. Result: in `drizzle.config.ts` you don't need `dotenv` at all. This is a small thing but it's a real Node 24 capability worth knowing — it will come up again when we wire the API config later.

#### Concept 1.4 — Two TS strict options worth understanding

`tsconfig.base.json` will turn on strict, plus two extras:

- **`noUncheckedIndexedAccess`** — makes `arr[i]` typed as `T | undefined` instead of `T`. Forces you to handle the "what if the index is out of range" case at the call site. Catches a class of bug that plain `strict` misses.
- **`verbatimModuleSyntax`** — forbids `import` of a thing used only as a type unless you write `import type`. Keeps `tsc` and bundler output aligned, and avoids accidentally pulling a side-effecting module just for its types.

Both will feel pedantic at first; both pay off the moment you have >1 person on the codebase or run with isolatedModules.

#### Your first code task

With those four concepts in hand, produce Commit A as listed in PLAN.md "Commit A":

- Root: `pnpm add -D -w typescript @types/node`, then write `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`.
- `packages/db`: `pnpm -F @disruption-intelligence/db add drizzle-orm postgres` and `pnpm -F @disruption-intelligence/db add -D drizzle-kit tsx`.
- `packages/db/tsconfig.json` extending the base, with `module: ESNext`, `moduleResolution: Bundler`.
- `packages/db/drizzle.config.ts` — `defineConfig({...})`. Use `process.loadEnvFile()` at the top. The config needs a `schema` glob, an `out` dir, `dialect: 'postgresql'`, and a `dbCredentials.url` from `process.env.DATABASE_URL`.
- `packages/db/src/schema/index.ts` — empty barrel for now (just `export {}`).
- `packages/db/package.json` scripts: `generate`, `migrate`, `studio` — all three are thin wrappers around `drizzle-kit ...`.

Stop after this commit. We'll talk about geography before you touch the schema.

---

### Phase 2 — Commit B: schema + first migration

#### Concept 2.1 — PostGIS `geography` vs `geometry`, and SRID 4326

You're storing points on Earth. Two PostGIS types could hold them:

- **`geometry`** — Cartesian; computations are fast but distance-on-a-plane lies once your data spans more than a city block.
- **`geography`** — spheroidal Earth model; distance/contains/etc. compute great-circle results. Slower per op, correct everywhere.

For a Lima-only v0, `geometry` would technically suffice — but `geography` is the right default for "points on a map" because it removes a class of subtle bugs the moment scope expands. The ADR-002 decision is `geography(Point, 4326)`. **4326** is the SRID for WGS84 (the lat/lon you get from any GPS or web map). Always tag your geography column with its SRID; mixing SRIDs silently and getting wrong results is the most common PostGIS pitfall.

#### Concept 2.2 — The Drizzle-PostGIS gotcha

Drizzle has no built-in `geography` column type. This is the bit that trips people up: you have to define it yourself with `customType`. The shape:

```ts
// Reference snippet — illustrative, not copy-paste:
import { customType } from 'drizzle-orm/pg-core';

const geographyPoint = customType<{ data: { lng: number; lat: number } }>({
  dataType() { return 'geography(Point, 4326)'; },
  // toDriver / fromDriver: convert between { lng, lat } and the WKT or hex EWKB the driver sees
});
```

Two design choices to reason through before you write yours:

1. **What does `data` look like in TS?** A tuple `[lng, lat]`? An object `{ lng, lat }`? A GeoJSON `Point`? The frontend will eventually feed these into MapLibre, which prefers `[lng, lat]` arrays. Pick one and document it in a comment.
2. **What does the driver see on write?** Easiest is to send `ST_GeogFromText('SRID=4326;POINT(lng lat)')` via raw SQL; postgres-js doesn't know about EWKB. You'll likely return a string from `toDriver` and parse the hex-EWKB back in `fromDriver`. (Hint: `ST_AsText` in queries gives you human-readable WKT for free if you'd rather avoid the EWKB parse path on read.)

Don't try to be clever here — the simplest working version is fine. We can refactor when the API actually starts reading these.

#### Concept 2.3 — Why Drizzle Kit doesn't emit BRIN or GiST

Drizzle Kit's index DSL only generates **B-tree** indexes. BRIN, GiST, GIN, hash, SP-GiST — all unsupported. The standard workflow:

1. Run `drizzle-kit generate` to produce the migration with the B-tree indexes Drizzle does understand
2. Open the generated `.sql` and **hand-edit** it to add the non-B-tree indexes
3. Add a SQL comment citing the ADR right above each hand-added index
4. Drizzle Kit's snapshot in `migrations/meta/` doesn't track these hand edits — that's fine; the next `generate` won't try to drop them because they aren't represented in your TS schema. Just don't try to express them in TS and expect it to work.

Same logic for `CREATE EXTENSION postgis` — Drizzle doesn't know about extensions; you prepend the `CREATE EXTENSION IF NOT EXISTS postgis;` line to the migration by hand.

This split — Drizzle for the typed parts, raw SQL for the Postgres-specific parts — is the deliberate design. Don't fight it.

#### Concept 2.4 — Partial composite indexes

The two non-time access paths are served by:

```sql
CREATE INDEX events_city_state_start_idx
  ON events (city_id, state, start_at)
  WHERE state = 'active';

CREATE INDEX events_city_category_idx
  ON events (city_id, category)
  WHERE state = 'active';
```

Two ideas at work: **composite** (column order matters — `city_id` first because every API query has it; `state` second to filter early; `start_at` last for ordered range scans), and **partial** (the `WHERE state = 'active'` clause means cancelled/past-state rows don't bloat the index). These compose with the BRIN at planning time — Postgres will bitmap-AND a BRIN range scan with a B-tree city/state scan when the predicate covers both. ADR-001 spells this out.

Drizzle Kit *does* support composite indexes and partial indexes via `index().on(...).where(sql\`...\`)`. So these you can write in TS — only the BRIN and GiST need hand-editing.

#### Concept 2.5 — Idempotent upsert key (ADR-003)

`events` has a `UNIQUE (source_id, external_id)` constraint. That's the deterministic key the ingest pipeline uses for `INSERT ... ON CONFLICT (source_id, external_id) DO UPDATE`. You don't write the upsert SQL yet — but the schema needs to declare the unique constraint now so the ingest code in a later commit just works. (The ADR explains why this pair specifically, and not e.g. a hash of the event payload.)

#### Your second code task

With 2.1–2.5 in hand, produce Commit B as listed in PLAN.md "Commit B":

- `src/schema/cities.ts` — small reference table; columns at minimum: `id`, `slug` (unique, e.g. `'lima'`), `name`, `centroid` (your `geographyPoint` custom type), `timezone` (text, e.g. `'America/Lima'`).
- `src/schema/events.ts` — columns per the ADRs and the ingest pipeline's needs: `id`, `source_id`, `external_id`, `city_id` (FK), `title`, `category`, `state` (enum or text — your call, justify it), `start_at`, `end_at` (nullable), `location` (`geographyPoint`), `raw` (`jsonb`, the original payload for debugging), `ingested_at`, `updated_at`. Add the unique on `(source_id, external_id)` and the two partial composites in TS.
- `src/schema/index.ts` — re-export the tables.
- Run `pnpm -F db generate`. Then **hand-edit** the produced `migrations/0000_*.sql` to:
  - Prepend `CREATE EXTENSION IF NOT EXISTS postgis;`
  - Add `CREATE INDEX events_start_at_brin_idx ON events USING BRIN (start_at); -- ADR-001`
  - Add `CREATE INDEX events_location_gix ON events USING GIST (location); -- ADR-002`
  - Append the Lima seed: `INSERT INTO cities (slug, name, centroid, timezone) VALUES ('lima', 'Lima', ST_GeogFromText('SRID=4326;POINT(-77.0428 -12.0464)'), 'America/Lima') ON CONFLICT (slug) DO NOTHING;`
- Apply with `pnpm -F db migrate`.
- Verify with `psql $DATABASE_URL -c '\d events'` and `psql $DATABASE_URL -c '\di events*'` — confirm BRIN, GiST, and both partial composites are present.

---

## Critical files to be modified

- `tsconfig.base.json` (new, repo root)
- `packages/db/package.json` (add deps + scripts)
- `packages/db/tsconfig.json` (new)
- `packages/db/drizzle.config.ts` (new)
- `packages/db/src/schema/{index,cities,events}.ts` (new)
- `packages/db/migrations/0000_*.sql` (generated, then hand-augmented)
- `packages/db/migrations/meta/*` (generated, committed)

No edits to `apps/api`, `apps/web`, `packages/shared`, or any of the ADR/architecture docs in this step.

## Existing utilities / references to reuse

- ADRs already define every non-trivial decision: cite them in SQL comments above the BRIN (ADR-001), GiST (ADR-002), and unique-on-`(source_id, external_id)` (ADR-003).
- `.env.example` already has the local `DATABASE_URL` shape — copy to `.env` for `drizzle-kit` to read via `process.loadEnvFile()`.
- `docker-compose.yml` is already running Postgres 16 + PostGIS 3.5 — no infra changes needed.

## Verification

After Commit A:

```bash
pnpm -F @disruption-intelligence/db exec drizzle-kit --version   # should print a version, no error
node -e 'process.loadEnvFile(); console.log(!!process.env.DATABASE_URL)'   # should print true
pnpm -r exec tsc --noEmit                                                  # type-check everything
```

After Commit B:

```bash
pnpm -F db generate                  # produces migrations/0000_*.sql
# hand-edit the SQL per the steps above
pnpm -F db migrate                   # applies to local Postgres
psql $DATABASE_URL -c '\dx'          # confirms postgis extension installed
psql $DATABASE_URL -c '\d events'    # confirms columns
psql $DATABASE_URL -c '\di events*'  # confirms BRIN, GiST, two partial composites
psql $DATABASE_URL -c "SELECT slug, ST_AsText(centroid::geometry), timezone FROM cities;"
# expected: lima | POINT(-77.0428 -12.0464) | America/Lima
```

Re-run `pnpm -F db migrate` — it should be a no-op (`No migrations to apply`). That proves migration tracking is working.

## After this step

Per PLAN.md, the next move after Commit B is the stub scraper emitting 3 hardcoded fake events through the idempotent upsert pipeline, then `node-cron`, then a real scrape. We'll plan that separately.
