# ARCHITECTURE — Lima Disruption Events v0

System-level conventions and decisions for Disruption Intelligence v0. This file is the home for project-wide choices that need to persist between sessions but don't warrant the formal weight of an ADR. For per-decision detail with full Status / Context / Decision / Consequences / Alternatives, see [`docs/adr/`](adr/).

This document is intentionally **early/seed** at this stage. The Week 3 milestone in [`docs/PLAN.md`](PLAN.md) expands it with:

- A Mermaid system overview diagram
- A "Deferred decisions" section enumerating things explicitly punted on (BullMQ/Redis, multi-region, read replicas, etc.) with revisit triggers

Until then, the sections below are the canonical record of project conventions previously held in PLAN.md.

---

## Conventions and decisions not in ADRs

### Product positioning — what v0 is and is not

The local v0 builds the **disruption-ingestion tier** of a B2B mobility-intelligence product, not the full customer-facing product. The full product (per the Notion business plan; see [`CLAUDE.md`](../CLAUDE.md) "Architecture references" for the link) layers per-customer route overlays, SLA risk flags, anomaly alerts, and a weekly advisory call on top of the calendar this v0 ingests. None of those are in v0 scope.

Implications:

- **README and any public-facing framing** must lead with this scope statement. The v0 looks superficially like a consumer map app; the business is explicitly B2B. Notion plan Tema 2 positioning anchor: *"Waze le habla a los conductores; nosotros le hablamos a los operadores."* Anchor against that, not against the visual shape of the v0.
- **When showing the v0 to a stakeholder**, lead with the scope statement before the live URL — otherwise expectations form around the visible artifact rather than the actual product. Notion plan Tema 5 Step 22 is explicit on this: lock MVBP scope so future feature requests default to v2+.

**Sequence inversion is deliberate.** The v0 runs ahead of "Etapa 0" prerequisites in the Notion plan (SAC registration, 50-prospect list, 10 customer-discovery interviews, Tesis evidence-gathering). Rationale: tech-stack familiarity with Drizzle / Fastify / PostGIS / MapLibre / Testcontainers; full use of the Claude Code subscription; a concrete portfolio artifact for senior-role interviews; a tangible artifact to ground stakeholder conversations in. The trade-off — premature stakeholder anchoring on the wrong product shape — is mitigated by the two framing rules above.

### Naming — internal identifiers vs. external product names

Internal scope, package, database, file, and code identifiers use `disruption_intelligence` (the long-term company name). Externally-facing product names — repo name, root `package.json` name, the eventual product surface — stay Lima-anchored, since the v0 product *is* Lima-specific even if the platform behind it isn't.

Concrete instances:

- pnpm workspace scope: `@disruption-intelligence/*`
- Local dev database: name / user / password all `disruption_intelligence`
- Repo: `lima-disruption-events` (externally visible)

### Customer-facing language: Spanish (es-PE)

All user-visible UI text is in **Peruvian Spanish**: chrome (buttons, filter chips, drawer headings, toolbar labels), data labels surfaced to humans (category names, empty states), date/time formatting (`Intl` with locale `'es-PE'` and `timeZone: 'America/Lima'`), and any eventual marketing/landing copy. The customers are Lima operators; the *interface* must speak their language even though the *codebase* doesn't.

**In scope (Spanish):** UI strings, button labels, placeholders, category labels rendered to users, relative-time suffixes ("en 3d", "hace 2h"), error messages surfaced in the browser.

**Out of scope (English):** code identifiers, type names, file paths, comments, commit messages, log lines (pino), API field names, database column names, ADR text, internal docs (`PLAN.md`, `ARCHITECTURE.md`, `CLAUDE.md`, this file). Internal artifacts stay in English so the engineering surface stays a single dialect.

### Local dev Postgres image: `imresamu/postgis:16-3.5`

`docker-compose.yml` pulls `imresamu/postgis:16-3.5` rather than the official `postgis/postgis:16-3.5`. Reason: the official image has no arm64 build; `imresamu/postgis` is a multi-arch mirror maintained by long-time PostGIS contributor Imre Samu, mirroring upstream tags 1:1. Local-dev only — Fly Postgres in production runs amd64 on Fly's infrastructure (see [ADR-004](adr/004-co-locating-api-and-db-on-fly-private-network.md)).

### Runtime and package-manager pinning

- **Node 24 LTS.** Active LTS; Node 22 dropped to Maintenance status in Oct 2025. Pinned via `.nvmrc` and `engines`. fnm in the dev environment auto-switches on `cd`.
- **pnpm 10.33.2**, pinned in `packageManager` with a SHA-512 integrity hash. Defends against registry compromise and against future Corepack versions that refuse unhashed pins.

### Drizzle Postgres binding: `postgres` (postgres-js) over `pg`

`packages/db` uses the `postgres` package (postgres-js driver) for the Drizzle binding, not the older `pg` package. Drizzle's primary recommendation since 0.30 — faster, simpler API, no callback-style holdover.

### TypeScript configuration

**Base (`tsconfig.base.json`)** carries every flag whose absence would silently produce wrong code: `target: ES2024` (the highest stable target Node 24 supports natively, so no downleveling tax), `strict: true`, plus `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `skipLibCheck`, `esModuleInterop`, `forceConsistentCasingInFileNames`, `isolatedModules`. The split rule: *base = correctness/consistency defaults; leaf config = how-this-package-runs.*

**Leaf configs** add only `module`, `moduleResolution`, `include`, and (where relevant) `noEmit`. Per-package: `module: ESNext` + `moduleResolution: Bundler`, even for packages run under `tsx` rather than a true bundler. Reason: `tsx` is esbuild-based and matches Bundler resolution rules; the alternative (`NodeNext`) would force `.js` extensions on every relative TS import for marginal gain.

Capability flags (`resolveJsonModule`, etc.) get added per-package only when something actually needs them. Cost of leaving them off is a clear error message at first use, not silent miscompilation.

### Drizzle config conventions

`packages/db/drizzle.config.ts` sets, beyond the four required fields:

- `casing: 'snake_case'` — TS identifiers stay camelCase; SQL columns are snake_case automatically. Avoids per-column overrides and matches Postgres's unquoted-identifier folding.
- `verbose: true` + `strict: true` — `generate` prints SQL before writing it; `migrate` prompts before destructive operations.
- `schema: './src/schema/*.ts'` (glob, not a barrel path) — drizzle-kit walks every top-level schema file, eliminating the silent "forgot to re-export" failure mode where a new table file would otherwise go unnoticed at migration-generation time. The schema barrel `src/schema/index.ts` retains its separate role as the schema-only re-export consumed by the package's top-level barrel `src/index.ts`, which is what `package.json`'s `exports` field points at and what consumers import via `@disruption-intelligence/db`.

Config loads `.env` via Node 24's built-in `process.loadEnvFile('../../.env')` (no `dotenv` dep) and guards `DATABASE_URL` with an explicit throw so misconfiguration fails fast with a clear message rather than deep inside postgres-js. The repo uses a **single root `.env`** (gitignored; copy from `.env.example`) rather than per-workspace env files — one source of truth for shared secrets like `DATABASE_URL`. Other workspaces (e.g. `apps/api` once scaffolded) should load the same root file.

### Drizzle runtime client conventions

`packages/db/src/client.ts` exports `db = drizzle(client, { schema, casing: 'snake_case' })`. The `casing` option is configured **twice** — once in `drizzle.config.ts` (where it tells drizzle-kit how to emit migration column names) and once on the runtime `drizzle()` call (where it tells the running app how to translate TS field names to SQL column names on inserts/selects). The two settings configure independent stages and **must agree**: a missing `casing` on the runtime side leaves Drizzle quoting TS field names literally (`"sourceId"`) in generated SQL, which fails against snake_case columns with `42703 column "sourceId" does not exist`. Any future runtime client (test fixtures, scratch scripts) must mirror the same option.

The same module exports `closeDb()` so short-lived CLI scripts (e.g. `pnpm -F api ingest`) can drain the postgres-js pool and let the event loop exit cleanly. Long-lived processes (the eventual Fastify API) leave the connection open for their lifetime.

The runtime client uses the same root-`.env` loading pattern as `drizzle.config.ts` (`process.loadEnvFile('../../.env')` wrapped in try/catch — the file is absent in production where env vars come from Fly secrets) and the same explicit `DATABASE_URL` throw, so dev and prod fail-modes are identical at boot.

### Vitest test harness — top-level await in setup files, not `beforeAll`

Test files statically import `upsertEvents` → `upsert.ts` → `@disruption-intelligence/db` → `client.ts`. That chain runs when the test *module loads*, and `client.ts` reads `DATABASE_URL` at that moment to construct the postgres-js pool. If `DATABASE_URL` isn't set to the test container's URI by then, the singleton binds to whatever the dev `.env` says — and every test silently runs against the dev DB regardless of what `beforeAll` does later.

`apps/api/test/setup.ts` therefore does container start, env mutation, db dynamic-import, and `migrate()` at **top level** (not inside `beforeAll`). Vitest awaits setup-file evaluation before loading test files, so top-level await blocks at exactly the right point. `afterAll` is still safe for teardown — the trap is only on the downhill side. The detection signature for the trap firing is "schema 'drizzle' already exists" NOTICEs from Postgres on what should be a fresh container, plus tests that pass for the wrong reason because data from prior runs is still in the dev DB.

Implication: any future singleton bound to env at module-load time (a logger, a Sentry client, a feature-flag evaluator) needs the same top-level treatment in setup files. If a setup file's body isn't where the env is set, you've already lost.

### Test fixtures live with the test, not in production code

Tests build their own `ScrapedEvent` arrays inline rather than importing `stub-scraper.ts`. The stub is scheduled for replacement when the real HTML scraper lands; coupling tests to a transient artifact would force an unrelated rewrite at swap time and create the temptation to keep the stub around as a "test fixture in production code" pretender. The general rule: a test for `f(input)` depends on `input`'s schema (here `scrapedEventSchema`), not on whoever happens to produce valid `input` in production. Same principle scales to mocked external APIs and seed data.

### Drizzle Kit gotcha: parameterized customType column SQL is quoted

Drizzle Kit emits a column's type by wrapping the string returned from `customType.dataType()` in double quotes. For unparameterized types (`'geography'`) this is harmless because the bare and quoted forms both resolve to the same type. For **parameterized** types like `'geography(Point, 4326)'` it's broken: Postgres parses the quoted form as an identifier (a type *named* `geography(Point, 4326)`), not as `geography` with typmod `(Point, 4326)`, and migration apply fails with `type "geography(Point, 4326)" does not exist`.

Remedy for v0: leave `customType.dataType()` returning the parameterized string (so the column-level SRID constraint stays explicit in the schema source), and **strip the surrounding quotes from the generated SQL** as part of the post-`pnpm generate` hand-edit pass — same workflow that already adds `CREATE EXTENSION postgis`, BRIN, and GiST. Any future migration that emits a `geography(...)` column from scratch will need the same edit; the existing tables don't get re-emitted by Drizzle Kit's diff output, so this is a one-time hit per new geography column. If the hand-edit becomes recurring enough to be annoying, the next move is to switch `dataType()` to plain `'geography'` and enforce SRID via an `ALTER COLUMN ... TYPE` post-edit or a `CHECK (ST_SRID(...) = 4326)` constraint — defer until the pain is real.

### Per-workspace `@types/node` and explicit `compilerOptions.types`

`pnpm` strict isolation does **not** hoist `@types/node` (or any `@types/*` package) into leaf workspaces. Every workspace whose code touches Node globals (`process`, `Buffer`, `fs`, etc.) declares `@types/node` as a direct devDep, and its `tsconfig.json` lists `"types": ["node"]` in `compilerOptions`. The explicit `types` array does two jobs: (1) works around TS 6.0 `@types/*` auto-discovery being unreliable in this monorepo layout (observed silently failing even with the package correctly resolved on disk); (2) prevents transitive `@types/*` deps from quietly injecting globals into packages that shouldn't see them — `apps/web` should not have `process` in scope regardless of what some transitive dep brings in.

When `apps/api` and `apps/web` are scaffolded, repeat the pattern: `apps/api` gets `@types/node` + `"types": ["node"]`; `apps/web` likely gets `"types": ["vite/client"]` (or `[]`) and **no** `@types/node`.

### Schema design rule: don't store time-derivable state

Columns whose value is a function of timestamps and `now()` (e.g., "is this event past?") belong in queries, not the schema. The `events.state` column is **source signal only** — values like `'scheduled'` and `'cancelled'`, set by what the source publishes. Time-based status ("upcoming," "past," "happening now") is derived in queries from `start_at` / `end_at`. Storing time-derived state would require a cron to flip rows, create a race-condition surface around the flip, and risk the schema and the clock disagreeing. Generalises beyond `events`: if a value is `f(timestamps, now())`, it's a view, not a fact.

### Scraper conventions

Lessons codified after the first real HTML scraper (Gran Teatro Nacional, [`docs/plans/scraper-1-gran-teatro-nacional.md`](plans/scraper-1-gran-teatro-nacional.md)). All apply uniformly to future scrapers.

**Error classification at the scraper layer.** Three categories, each with a fixed response — never invent a fourth. **HTTP 4xx** is operational and non-retryable: log a warn line with the URL and status and skip the page (re-fetching a 404 won't change the outcome, and accumulating it for an end-of-run retry pass would just dilute the signal of *real* transient failures). **HTTP 5xx, network errors, timeouts, aborts** are operational and retryable: handle in the retry loop and, if exhausted, accumulate to a `failedList` for one more shot at the end of the run. **HTTP 200 + parser found 0 nodes** is a programmer error: throw, abort the run. The scraper is a contract with the upstream HTML; if the contract's broken we want loud immediate failure, not silent under-coverage.

**Two-layer retry, accumulator-based.** Per-page: 1 initial attempt + N retries with exponential backoff (defaults `[250, 500, 1000]ms`). Then after every page in the window has been attempted, a single end-of-run pass over the accumulator (`fetchMonthHtml(url, log, [])`). The asymmetry is the point: phase 1 retries cluster within ~2s and recover from sub-second blips; phase 2 fires after the rest of the run has elapsed and acts as a "wait it out" pass for upstream wobbles that lasted minutes. Anything still failing after phase 2 is logged warn and dropped; the run completes with whatever was successfully fetched. Implementation lives in `gran-teatro-nacional-scraper.ts`'s `fetchMonthHtml`; extract to a shared helper when scraper #2 starts duplicating it.

**HTTP client = Node's built-in `fetch` + a hand-rolled retry wrapper.** No `undici`/`got`/`axios`. Node 24's `fetch` only throws on network errors; HTTP-status errors return a normal `Response` whose `res.ok` is `false` and whose `res.status` you read directly. Timeout via `AbortSignal.timeout(ms)`. Sleep via `import { setTimeout as sleep } from 'node:timers/promises'`. The wrapper is small enough (~30–50 LOC) to fully reason about and review in one screen.

**Polite User-Agent — never personal.** Identify the project (e.g. `'disruption-intelligence/0.1'`) so operators reading their access logs see who's pulling. Add a contact suffix only once a public alias exists (a project URL or a project mailbox); **never a personal email**, which is hard to scrub from a public repo's history once leaked. Pre-public-repo state is the wrong moment for any default involving real contact PII.

**Validate the parser against a real fixture before locking selectors.** CSS selectors that look right against an excerpt break against the live page in ways that are easy to miss in code review. The Gran Teatro Nacional implementation surfaced three GTN-side quirks that *only* the live-fixture parser run revealed (repeat-cell `<time datetime>` carrying the first occurrence's date; uncategorized events with empty `cat-*` class; "¡Es gratis!" overriding popup category text on free events). All three would have shipped wrong without the run. Convention: download a representative response to `apps/api/test/ingest/fixtures/<source>-<key>.html` and write a fixture-driven `test/ingest/<source>-scraper.test.ts` *before* declaring the parser done. The parser test does not need Postgres — keep it pure.

**Fixtures are committed to the repo.** Each `apps/api/test/ingest/fixtures/<source>-<key>.html|json` ships in git alongside the test that consumes it. Three reasons: (1) network-independent CI — tests pass without the live source being reachable; (2) deterministic regression — a parser change produces the same `ScrapedEvent[]` from the frozen input, or it doesn't (no "passed because upstream was lenient today"); (3) diff-reviewable upstream changes — when we refresh a fixture, the PR diff shows exactly what shifted in the source's markup. The Notion source-survey logs' "no verbatim redistribution" rule is about the *product* (we transform raw HTML/JSON-LD into disruption-event records before surfacing to customers); it does not constrain internal QA fixtures. Re-evaluate if the repo opens up — at that point, refresh fixtures and verify nothing sensitive sits in them, but don't delete the test infrastructure.

**Verify the scraped URL pattern is allowed by `robots.txt`.** Drupal sites often disallow `/node/*` (numeric URLs) while allowing the clean URL form (e.g. `/calendario/YYYYMM`). Check the actual URL pattern you're going to call, not the domain. Document the verification in the implementation plan; if the policy changes later, the plan tells you what was historically true.

**Structured logs only — no per-event info logs.** Log lines: one `info` per fetched month with `{ month, eventsParsed, durationMs }`, one `info` final summary `{ monthsAttempted, eventsParsed, phase1Failed, droppedAfterRetry }`, `warn` for skipped 4xx and dropped phase-2 retries. `debug` is fine for "will retry" lines. Per-event logging at info level pollutes the run output and is a smell that something unusual is happening per-event (in which case it belongs in `sourcePayload`, not in logs).

### Migration vs seed split

**Schema migrations** handle DDL plus any data backfill required to keep existing rows consistent with the new schema (one-shot, append-only, never re-edited). **Seed scripts** handle forward-looking reference data — idempotent via `ON CONFLICT DO NOTHING`, re-runnable, additive over time.

The first concrete instance is the `cities` → `regions` rename in [`migrations/0002_rename_cities_to_regions.sql`](../packages/db/migrations/0002_rename_cities_to_regions.sql) (per [ADR-005](adr/005-regions-as-generic-hierarchical-dimension.md)): the migration handles the schema work + backfills the existing Lima row's new columns (DEFAULT-then-DROP for the two NOT NULLs, an explicit UPDATE for nullable `iso_code`); the 24 NEW Peru level-1 region rows ship via `pnpm -F @disruption-intelligence/db seed` (entry: [`packages/db/src/seed-cli.ts`](../packages/db/src/seed-cli.ts), function: [`packages/db/src/seed.ts`](../packages/db/src/seed.ts)). Both are required for a fresh DB to reach the v0 working state — local stack startup is `pnpm install` → `docker compose up -d` → `pnpm migrate` → `pnpm seed`. Test setup runs migrate then seed at top level (mirroring local-dev shape so tests don't drift). Eventual production deploy will chain them via Fly's `release_command`.

Coordinate or name corrections do NOT happen by editing `seed.ts` at runtime — they go through a new migration with an explicit `UPDATE regions SET ... WHERE slug = ...` statement. The audit trail lives in migration history; the seed is a place for additive new rows, not the source of truth for what's-currently-in-prod. (If admin-edit paths ever land in v0.5+, revisit.) Generalises beyond `regions`: any future reference-data table follows the same split.

### Hand-authored migrations when Drizzle Kit can't infer a rename

`drizzle-kit generate`'s diff has no rename heuristic by default — when it sees `cities` gone and `regions` new, it prompts (interactively, requires TTY) to ask if this is a rename. In headless / agent contexts the prompt fails and the alternative — `DROP TABLE cities; CREATE TABLE regions` — destroys data.

Pattern adopted (first used for `0002_rename_cities_to_regions`): hand-author both the SQL migration **and** the post-migration snapshot JSON in [`migrations/meta/<idx>_snapshot.json`](../packages/db/migrations/meta/). The snapshot must accurately reflect what the migration produces, so future `pnpm generate` runs diff against the correct baseline. One-time tax per rename; for purely additive schema changes, `pnpm generate` is still the right tool. Plus the existing post-`generate` hand-edit pass already covered in "Drizzle Kit gotcha" above for `geography(...)`, BRIN, GiST, `CREATE EXTENSION` quoting fixes — both editing patterns coexist.

### Reference-data provenance — official Peruvian government sources only

For Peru-specific reference data (`regions` table's level-1 entries today; future level-2 provincias and level-3 distritos), the canonical authority is **INEI** ([Instituto Nacional de Estadística e Informática](https://www.inei.gob.pe/)). Specifically:

- **UBIGEO codes + names**: INEI's open-data UBIGEO publication ([`inei.gob.pe/media/DATOS_ABIERTOS/UBIGEOS/`](https://www.inei.gob.pe/media/DATOS_ABIERTOS/UBIGEOS/UBIGEOS_2022_1891_distritos.zip) — the 2022 release at time of v0).
- **Capital / distrito centroids**: INEI's [Directorio Nacional de Centros Poblados](https://www.inei.gob.pe/media/MenuRecursivo/publicaciones_digitales/Est/Lib1541/index.htm) (Lib1541, 2017 Census), cross-validated against [IGN](https://www.ign.gob.pe/)'s official cartographic data.
- **ISO 3166-2 codes**: international standard ([ISO 3166-2:PE](https://www.iso.org/obp/ui/#iso:code:3166:PE)) with INEI cross-reference.

Each row in [`packages/db/src/seed.ts`](../packages/db/src/seed.ts) documents its source URL inline. Wikipedia, OpenStreetMap, commercial aggregators, and hand-typed values are NOT authoritative for these fields. If a row's source URL goes 404 (INEI re-publishes periodically), update the link to the new canonical version and verify the value didn't change.

### Deferred decisions

Decisions explicitly punted on for v0 — listed here so they're not re-litigated. Each entry names the trigger that should prompt revisiting. Week 3 will expand this section with the larger structural deferrals (BullMQ/Redis, multi-region, read replicas).

**PK type for high-volume tables.** v0 uses `serial` integer PKs on both `regions` (post-ADR-005 rename) and `events`. Revisit if any of: (1) a second Postgres instance writes into the same logical schema (multi-region with shared dimensions, not the "different cities, different regions" pattern), (2) a stable customer-visible event identifier needs to be exposed to a third-party system we don't control, (3) the sequence becomes a measured write-rate bottleneck. None are realistic for v0; UUID v7 was considered and rejected on YAGNI grounds. Migration path if a trigger fires: add a `public_id uuid unique` column non-destructively rather than retrofitting the PK type.

**BRIN vs B-tree on `events.start_at`.** v0 ships ADR-001's BRIN as written. The ADR itself acknowledges the index is functionally inert at <100k rows (the entire table fits inside one or zero `pages_per_range = 128` ranges); separately, the load-bearing correlation assumption (heap order ≈ `start_at` order, because ingest is append-mostly with a rolling forward window) can't be evaluated against an empty table. Revisit once both scrapers have been writing into the production `events` table for roughly 30 days: run `EXPLAIN (ANALYZE, BUFFERS)` on the canonical "next 7 days" query and check whether the planner is choosing BRIN and whether the BRIN summary intervals are actually narrow enough to be selective (i.e. the per-block min/max of `start_at` doesn't span the entire forward window). Plausible outcome at Lima-scale event volume: btree wins, or it's a wash and BRIN's footprint advantage is moot — in which case replace via a successor ADR. The check pairs naturally with the "Disruption-density check (T+30 days)" gate already in PLAN.md's Definition of done.

**No build step on internal workspace packages.** `packages/{db,shared}` ship raw `.ts` source via `exports: { ".": "./src/index.ts" }`. All current consumers (`tsx` for `apps/api`, Vite for `apps/web` once scaffolded, Vitest, `tsc --noEmit`, the editor's TS language server) are TS-aware, so no compile step is needed and no `dist/` exists. Revisit if any of: (1) the Week 3 Fly deploy lands on a strategy that ships raw `node_modules/` to a stock `node` runtime — both safe defaults (bundling `apps/api` with esbuild/tsup, or running it via `tsx`/`node --experimental-strip-types` in the container) keep this decision intact, so this only fires if we explicitly opt into per-package `dist/` shipping; (2) any `@disruption-intelligence/*` package gets published externally — out of v0 scope and a major strategic shift; (3) we adopt a tool that resolves modules without TS awareness (e.g. a coverage tool or legacy ESLint plugin doing its own resolution) and per-tool config can't fix it. Migration if triggered is mechanical: add `tsc -p tsconfig.build.json` (or `tsup`) emitting `dist/index.js` + `dist/index.d.ts`, flip `exports` to conditional `import`/`types` pointing at `dist/`, wire into the install/CI step. Roughly 30 minutes per package, no migration debt accrues by deferring.

### Git committer identity

Local git commits use `Kenji Kina <679022+Kenji-K@users.noreply.github.com>` (GitHub's noreply form), not the user's real email. Keeps the user's address out of the public git log if/when the repo opens up.

### Process: ADR-first ordering

ADRs are written *before* the code that implements them, not after. The original brief scheduled ADRs 001/002/004 in Weeks 2-3, after the corresponding code; they were instead landed in Week 1, before the schema migration. Rationale: ADRs written upfront are decisions the implementation defends; ADRs written after the fact are retroactive justification, which weakens the senior-signal value of the artifact. The brief's framing of ADR-003 — *"doing it early forces the data model to be honest"* — generalizes to all data-model and topology ADRs.

If implementation surfaces a wrinkle the ADR didn't anticipate, the standard remedy is a successor ADR with `Status: Supersedes ADR-NNN` rather than editing the accepted ADR in place. (This is also stated as a non-negotiable convention in [`CLAUDE.md`](../CLAUDE.md).)
