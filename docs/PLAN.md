# PLAN — Lima Disruption Events

Persistent project state. **Read this first** when picking up the project in a new session — it tracks where work left off, what's running locally, and any non-obvious decisions made since the original kickoff brief.

> **v1 build sprint (2026-06-10 → 2026-06-22).** Mentor mode is retired; the project is in full-speed build mode. The authoritative scope is [`docs/V1-BRIEF.md`](V1-BRIEF.md) (four tiers: close out v0 → deploy + v0.5 sources → v1 sources → stretch). The Week 1–3 milestones below remain valid as Tier-0/Tier-1 detail; the brief governs everything beyond them.

This file is the single source of truth for "what now?". Update it after any commit that advances a milestone, changes local state, or records a decision that diverges from or refines the brief.

---

## Session pickup checklist

When picking up the project in a fresh chat, run through this before doing any new work:

1. **Read this file (`docs/PLAN.md`), `CLAUDE.md`, and [`docs/V1-BRIEF.md`](V1-BRIEF.md).** CLAUDE.md is auto-loaded; this file and the brief you should re-read each session — this file changes between sessions, the brief is the sprint's scope fence.
2. **Confirm git state matches "Current state" below:** read the **Last sync point** in _Current state_; if `git log <sync-sha>..HEAD` is non-empty, work landed after this file was last synced — read those commits before trusting "Next move."
3. **Read the "Next move" section below.** That's the immediate task. If it doesn't make sense given the rest of the file, ask the user before proceeding — PLAN.md may have drifted from reality.

If anything in step 2 looks wrong, surface it to the user before changing code. If the local stack isn't responding when you go to run code, the setup is documented in `CLAUDE.md` and `docker-compose.yml` — don't re-derive it from scratch. The kickoff brief that started this project is **one-shot** (not committed in the repo) — do not expect to find it in conversation history. PLAN.md, CLAUDE.md, [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), and the ADRs in [`docs/adr/`](adr/) are the only authoritative project artifacts.

---

## Milestones

### Week 1 — Backend spine (~22h)

- [x] pnpm workspace scaffold (`apps/{api,web}`, `packages/{db,shared}`)
- [x] Node 24 LTS + pnpm 10.33.2 pinned (`.nvmrc`, `engines`, `packageManager` w/ SHA-512)
- [x] `docker-compose.yml` — Postgres 16 + PostGIS 3.5 (no Redis)
- [x] **ADR-003** — idempotent upsert via `(source_id, external_id)`
- [x] **ADR-001** — BRIN index on `event_start_at` _(pulled forward from Week 2; see "ADR-first ordering" below)_
- [x] **ADR-002** — GiST index on `events.location` geography column _(pulled forward from Week 3)_
- [x] **ADR-004** — co-locating API + DB on Fly's private network _(pulled forward from Week 3)_
- [x] Drizzle schema for `cities` + `events` tables; first migration applied locally
- [x] Idempotent upsert pipeline with structured logs (pino) _(stub-driven; HTTP-fetch retry lands at the scraper layer with the real source)_
- [x] One scraper (HTML source) writing through the idempotent upsert pipeline _(Gran Teatro Nacional — see [`docs/plans/scraper-1-gran-teatro-nacional.md`](plans/scraper-1-gran-teatro-nacional.md))_
- [x] `node-cron` wired in-process; one scheduled job invoking the scraper _(daily 06:00 America/Lima; `pnpm -F api cron`)_
- [x] Integration tests: scraper happy path, idempotent re-run, schema-validation rejection
- [x] **Checkpoint:** `pnpm -F api ingest` runs the scraper on demand, cron runs it on schedule, re-running produces zero duplicates, tests pass _(verified end-to-end: 83 events, idempotent re-run inserted=0/updated=83, 18 tests green)_

### Week 2 — API + frontend scaffold (~22h)

- [x] Fastify HTTP API: `GET /events` (filtered list), `GET /events/:id`, `GET /healthz` _(Fastify 5 + fastify-type-provider-zod; filters `from`/`to`/`category`/`source`/`limit`; cron attached to the Fastify lifecycle in `main.ts`)_
- [x] OpenAPI spec auto-generated from Zod via `fastify-type-provider-zod` _(served at `/docs`, spec at `/docs/json`; accuracy spot-checked by test + verifier)_
- [x] Second scraper plugged into the same pipeline (proves the abstraction) _(futbolperuano.com Liga 1 — JSON-LD `Review.itemReviewed` extraction, static venue map, home-team filter; see scraper-2 plan)_
- [x] Vite + React + Tailwind app scaffold _(Vite 8 + React 19 + Tailwind 4; es-PE UI per ARCHITECTURE.md)_
- [x] MapLibre map with event markers, basic event list view, both wired to TanStack Query _(markers grouped per venue with count badge + event-picker popup; OpenFreeMap tiles)_
- [x] **Checkpoint:** Frontend at localhost shows real events from the API on a map and a list _(verified in-browser 2026-06-10: 90 events / 2 sources)_

### Week 3 — Polish, deploy, document (~22h)

- [x] Event detail drawer; filters (date range, category) _(landed in Tier 0 alongside the scaffold; also a source filter; drawer routes at `/eventos/:id`, map re-centers under drawer padding)_
- [x] Sentry on API and web _(2026-06-11: error-capture only, DSNs via Fly secret / Vercel env; delivery verified from both apps)_
- [x] Deploy API + Postgres to Fly.io _(2026-06-11: region `gru` per ADR-008 — Fly retired `scl`; plain Machines app with official postgis image per ADR-006; API ↔ DB over `6PN`; migrations+seed via `release_command`)_
- [x] Deploy frontend to Vercel _(2026-06-11: <https://lima-disruption-events.vercel.app>, local-prebuilt deploys — see README "Deploying" + ARCHITECTURE.md Vercel notes)_
- [ ] README rewrite — architecture diagram (Mermaid), screenshots, live URL, "10x scale" section, scope statement _(operational README landed 2026-06-11: live URLs, deploy runbook, prod-DB access; diagram/screenshots/10x treatment still open)_
- [ ] `docs/ARCHITECTURE.md` (with "Deferred decisions" section listing BullMQ/Redis, multi-region, read replicas, etc.)
- [ ] `docs/DATABASE.md` (schema rationale, index choices, VACUUM/autovacuum paragraph)
- [ ] 3-minute Loom walkthrough
- [ ] **Checkpoint:** Live URL works, README is shareable, Loom is recorded

---

## Definition of done for v0

- [x] Live URL reachable on the public internet _(2026-06-11: <https://lima-disruption-events.vercel.app> + <https://disruption-intelligence-api.fly.dev>)_
- [x] At least 20 real events from at least 2 sources visible _(live 2026-06-11: 95 events from 5 sources on the public URL)_
- [x] Re-running the ingest pipeline produces zero duplicates _(verified 2026-06-10: second run `inserted=0, updated=90` for both sources)_
- [x] All five ADRs (001, 002, 003, 004, 005) written and committed _(005 added 2026-05-06: regions as generic hierarchical dimension)_
- [x] API and Postgres deployed to the same Fly region; API connects to DB over `6PN` _(2026-06-11: both in `gru`, `DATABASE_URL` → `disruption-intelligence-db.internal:5432`, DB app has no public IP)_
- [ ] DATABASE.md includes the VACUUM/autovacuum paragraph (interview-rehearsable, concrete not abstract)
- [ ] ARCHITECTURE.md includes a "Deferred decisions" section with revisit triggers
- [ ] README has architecture diagram, live URL, "10x scale" section
- [x] Integration tests pass against real Postgres _(44 tests / 4 files on Testcontainers PostGIS as of 2026-06-10)_
- [x] OpenAPI spec generated and accurate _(fresh-context verifier matched spec fields against live responses 2026-06-10)_
- [ ] `CLAUDE.md` reflects the actual current commands and conventions
- [ ] Loom recorded and linked from README
- [ ] **Disruption-density check (T+30 days)** — once both scrapers have been live in production for 30 days, document weekly event count, geographic spread across Lima, and source-mix. This is the cheap evidence for Notion plan Tesis premise #2 (the assumption that public sources are dense enough to assemble a useful Lima calendar; see also Aulet Tema 5 Step 21). Closing this loop is the most useful learning the v0 can produce. Fires after deploy, not as part of the 3-week sprint.

---

## Current state

**Branch:** `main`. Local and `origin/main` are in sync at the sync point below. For the authoritative since-Initial commit list, run `git log --oneline 4ae7626..HEAD`.

**Last sync point:** `2f25f34 chore: ignore .vercel CLI artifacts (git + prettier)`. HEAD as of this update; covers the Tier-1 session of 2026-06-11: ADRs 006/007/008 (`c824bd1`, `c61bff6`, `36f5a98`), deploy artifacts (`6add076` db release runner + Sentry on both apps, `8e325d5` Dockerfile + fly configs, `94eae01` region gru), ingest_state implementation (`8959993`), sources #3–#5 (`74015c3` MML, `60a3979` Lima Expresa, `1649efb` recurring events), README runbook (`b3ac842`). 87/87 tests, typecheck/lint/format clean, **deployed and live**. If `git log 2f25f34..HEAD` shows commits beyond this sync-bump, read them before trusting "Next move."

**Production (live since 2026-06-11):** web <https://lima-disruption-events.vercel.app> · API <https://disruption-intelligence-api.fly.dev> (`/events`, `/healthz`, `/docs`). Fly apps `disruption-intelligence-api` (one always-on machine, cron 06:00 América/Lima in-process) and `disruption-intelligence-db` (postgis/postgis:16-3.5, volume `pg_data`, 6PN-only), both region `gru` (ADR-008 — Fly retired `scl`). Migrations+seed run via `release_command` on every API deploy. 95 events / 5 sources served at deploy time; prod re-ingest verified `inserted=0`; Sentry delivery verified from both apps. Deploy/operations runbook + prod-DB access (fly proxy): README. Vercel CLI traps (agent non-interactive mode, sensitive-by-default env): ARCHITECTURE.md.

**Local stack running:**

- Node **24.15.0** via fnm; pnpm **10.33.2** pinned via `packageManager` + Corepack (with SHA-512 hash).
- Docker Compose stack on `:5432` — Postgres **16.10** + PostGIS **3.5.3** on arm64 (`imresamu/postgis:16-3.5`). Image's init scripts auto-load PostGIS plus the `tiger` and `topology` schemas into the `disruption_intelligence` DB; the migration's `CREATE EXTENSION IF NOT EXISTS postgis` is therefore a no-op locally but kept in the migration so prod / fresh-clone runs work.
- Local DB: name `disruption_intelligence`, user `disruption_intelligence`, password `disruption_intelligence` (dev-only, in `.env.example`). Connection: `postgres://disruption_intelligence:disruption_intelligence@localhost:5432/disruption_intelligence`.
- **Local `.env` required** at the repo root for `pnpm -F @disruption-intelligence/db migrate` / `generate` / `seed` to run. Gitignored; create with `cp .env.example .env`. Both `drizzle.config.ts` (kit) and `packages/db/src/client.ts` (runtime) load it via `process.loadEnvFile('../../.env')` from `packages/db/`.
- **Local-stack startup sequence:** `pnpm install` → `docker compose up -d` → `pnpm -F @disruption-intelligence/db migrate` → `pnpm -F @disruption-intelligence/db seed`. The seed is idempotent (`ON CONFLICT DO NOTHING`), so re-running is safe. Coordinate or name corrections for region rows go through a new migration with an explicit `UPDATE`, never via editing `seed.ts`.
- Schema applied: `regions` (renamed from `cities` per ADR-005; 25 Peru level-1 rows — Lima from migration 0000, the other 24 departamentos + Provincia Constitucional del Callao from `pnpm seed`, sourced from INEI's canonical UBIGEO publication), `events` (95 rows local and prod as of this sync: 89 GTN + 1 futbolperuano + 1 mml + 1 lima-expresa + 3 recurring; FK column is `region_id`), and `ingest_state` (ADR-007: per-source cursor jsonb + freshness/failure fields, migration `0003_keen_virginia_dare`). The events column is `start_at` (not `event_start_at` as earlier copies of this file said). Indexes per ADRs 001/002/003; ADR-005's regions hierarchy enforced via UNIQUE + CHECK + self-FK. Migrations 0000–0003 recorded in `drizzle.__drizzle_migrations`; re-running `pnpm migrate` is a verified no-op.
- **Dev servers:** `pnpm -F api dev` → Fastify on `:3000` (tsx watch, cron attached); `pnpm -F web dev` → Vite on `:5173` (expects the API at `http://localhost:3000`; override via `VITE_API_URL`).

**Workspace structure (post-sync):**

- `packages/db` — public surface via `exports: { ".": "./src/index.ts", "./seed": "./src/seed.ts" }`. Top-level barrel re-exports both the schema barrel (`regions`, `events`) and `client.ts` (`db`, `closeDb`). The separate `./seed` subpath exports `seed(db)` so the test setup and the `pnpm seed` CLI can pull it without dragging the seed call through the main barrel. Runtime Drizzle client mirrors drizzle-kit's `casing: 'snake_case'` — see ARCHITECTURE.md "Drizzle runtime client conventions" for why both sides need the option.
- `packages/shared` — public surface, exports `scrapedEventSchema`/`ScrapedEvent` (Zod boundary type for scraper output, including optional `sourceUrl: z.url()`), `locationSchema`/`Location`, and `apiEventSchema`/`ApiEvent` (the api↔web response contract — see ARCHITECTURE.md "API event contract"). The `endAt > startAt` cross-field refine compares Date instants to handle mixed offsets safely. No string→Date `.transform()` — that conversion belongs in the upsert layer, not the validation boundary.
- `apps/api` — ingest pipeline (five live sources) + HTTP API:
  - `src/ingest/fetch.ts` — shared `fetchWithRetry` (two-phase retry; extracted from GTN per the scraper-2 plan). All scrapers consume it. Imports `ca.ts`, which appends the Sectigo OV R36 intermediate to the process CA set (munlima.gob.pe serves an incomplete TLS chain — see ca.ts comments).
  - `src/ingest/gran-teatro-nacional-scraper.ts` — Cheerio parser of `granteatronacional.pe/calendario/YYYYMM` over a 3-month window. Three GTN-HTML quirks handled in-line with comments: repeat-cell `<time datetime>` carries the first occurrence's date (combine `td.date-date` + `<time>` time-of-day instead); empty `cat-*` class on uncategorized events falls back to `'proximamente'`; `"¡Es gratis!"` overrides popup text on free events but the `cat-*` class is the source of truth. Every event now pinned to the theatre's fixed venue point (San Borja, OSM-verified).
  - `src/ingest/futbolperuano-scraper.ts` + `futbolperuano-venues.ts` — Liga 1 scraper: listing → home-team filter (URL slug ∈ 3 Lima clubs) → per-match JSON-LD `Review.itemReviewed` SportsEvent; `externalId` = the URL's `m<digits>` suffix; static venue map with OSM-verified stadium coords; venue cross-check / unmapped `eventStatus` / missing Review block all throw as programmer errors; 1.5s spacing between detail fetches.
  - `src/ingest/mml-scraper.ts` — source #3 (MML WordPress feed): incremental `?after=` poll (ADR-007 cursor), full-object fetches (the WAF blocks `_fields=…content` — see in-file comments), trigger+road-context+proximity keyword filter (the brief's bare list measured ~80% FP on live fixtures), rule-based dates via `extract-dates.ts`, `location=null`.
  - `src/ingest/lima-expresa-scraper.ts` — source #4 (pressroom): listing → `/news/{slug}.html` details, seen-URL cursor (failed details retry next run), JSON-LD NewsArticle headline/datePublished, announced-window dates with publication fallback, trigger-only filter (road context implicit).
  - `src/ingest/recurring-events.ts` — source #5: hardcoded reference entries (Lima 42K 2026, 117° Media Maratón 2026-08-23, Gran Parada Militar 07-29) with inline provenance URLs + OSM-verified coords; no Peru NT home fixtures existed to include as of 2026-06-11 (documented in-file).
  - `src/ingest/extract-dates.ts` — shared rule-based Spanish date extraction (ranges, "a partir del", bare dates, year inference with rollover).
  - `src/ingest/state.ts` + `run.ts` — ADR-007 plumbing: `runIngestOnce(log, scrapers?)` reads each source's cursor, persists `nextCursor` only after validate+upsert succeeds, records failures (`consecutiveFailures`, `lastError`) without breaking per-source isolation; `ingest_state.last_success_at` is the per-source freshness fact.
  - `src/ingest/upsert.ts` — Bulk insert + `.onConflictDoUpdate` keyed on `(sourceId, externalId)` per ADR-003; boundary conversions (ISO→Date, `{lng,lat}`→PostGIS WKT); inserted-vs-updated count via `RETURNING (xmax = 0)`; `regionId` resolved by single `regions.slug = 'lima' AND country_code = 'PE' AND level = 1` composite lookup.
  - `src/ingest/schedule.ts` — `createIngestTask(log)`: daily 06:00 `America/Lima`, `noOverlap`, error-classified tick logging. `src/main.ts` (the `pnpm -F api dev`/`start` entrypoint) attaches it to the Fastify lifecycle (onClose stops it + drains the pool); `src/cron.ts` remains a thin standalone dev runner over the same module.
  - `src/server.ts` + `src/api/{routes,schemas}.ts` — Fastify 5 + `fastify-type-provider-zod`; `GET /healthz` (DB ping, 503 when unreachable), `GET /events` (filters `from`/`to`/`category`/`source`/`limit`, ordered by `start_at`), `GET /events/:id` (404 if missing); OpenAPI from the Zod schemas at `/docs` (spec at `/docs/json`); CORS open (public read-only API); `src/env.ts` Zod-validates PORT/HOST at boot.
  - `test/` — 87 tests / 8 files: fixture-driven parser tests for all four scraped sources + recurring-data validation (no Postgres), Testcontainers pipeline/API/ingest-state integration tests (each vitest fork gets its own container via `test/setup.ts` top-level await). `pnpm test` at the root runs everything.
- `apps/web` — Vite 8 + React 19 + Tailwind 4 + MapLibre GL + TanStack Query + react-router 7. Filter bar (date range / category / source, held in URL search params), sidebar list, OpenFreeMap map with per-venue grouped markers (count badge + event-picker popup, popup DOM built via `textContent` so scraped titles never reach `innerHTML`), detail drawer at `/eventos/:id` (map eases center under drawer-width padding on open, back on close). UI text es-PE with `America/Lima` Intl formatting. API responses Zod-validated against `apiEventSchema` at the fetch boundary.

**Uncommitted work in tree:** none — tree is clean as of the sync point above.

---

## Next move

**Tier 0 DONE (2026-06-10). Tier 1 DONE (2026-06-11)** — deploy live (see _Production_ above) and four v0.5 sources shipped (MML, Lima Expresa, recurring events; venue calendars deliberately dropped to Tier 2 per the brief's time-pressure rule). Acceptance checked by a fresh-context verifier subagent against the brief: 95 events / 5 sources on the public URL, prod re-ingest `inserted=0`, freshness < 24h via `ingest_state`, Sentry delivery verified from both apps, 87/87 tests. The first scheduled cron tick fired on time (2026-06-11 11:00:00.109Z = 06:00 Lima): all sources ran off their cursors, `inserted=0, failedSources=[]`.

**Sprint Session 3 = Tier 2 of [`docs/V1-BRIEF.md`](V1-BRIEF.md): v1 sources.** In the brief's order:

1. **gob.pe multi-institution news job** — `gob.pe/institucion/{atu,sutran,mtc,munilima}/noticias.json`; same keyword+extraction approach as MML. **Design the cross-channel news dedup first** (munilima mirrors munlima.gob.pe WP posts) — ADR-worthy; the canonical-URL raw material is already captured per ADR-007.
2. **SUTRAN/MTC geospatial alert layer** — MTC GeoServer WMS/WFS; the only native-geospatial source; degrade gracefully (port-8080 infra). Separate-table-vs-events decision is ADR-worthy.
3. **Teleticket / Joinnus** — re-verify robots.txt/ToS at build time; internal+demo constraints apply.
4. **Ord. 1680 manual-import path** — CSV/JSON import command through the same upsert (data blocked on the Ley de Transparencia request).
5. **Venue direct calendars** (Costa 21, Jockey Club, Arena Perú) — carried over from Tier 1.

Also queued from Tier 1: the `/events` from/to overlap-semantics fix (backlog #2 below) should land **before** the frontend bakes in current behavior — road events now have real date ranges in prod.

Tier-2 acceptance (fresh-context verifier): all programmatic v1 sources ingesting on schedule, road-alert layer rendering as a toggleable map layer, per-source freshness visible, cross-channel dedup demonstrably working.

---

## Known issues / review backlog

Source: 5-lens architectural review, 2026-06-10 (fresh-context subagents + verified findings); pre-deploy fix batch landed 2026-06-10, ADR-006/007 items closed by the Tier-1 session 2026-06-11. Deliberately deferred, in priority order:

1. **`/events` from/to filter on `start_at` only** — a multi-day closure starting before `from` is invisible. Now urgent: prod has road events with real date ranges. Decide overlap semantics (`start_at <= to AND (end_at IS NULL OR end_at >= from)`) before the frontend bakes current behavior in — queued at the top of the Tier-2 session.
2. **ADR staleness:** ADR-003 describes columns/state enum that never shipped and says state isn't touched on conflict (it is, correctly); ADR-002 says location is mandatory (nullable by design). Reconcile via amendment ADR. V1-BRIEF "What exists today" is stale since Tier 0 closed (and now Tier 1).
3. **Region resolution hard-codes Lima** in `upsertEvents`; `ScrapedEvent` can't express a region, and `regionId` is excluded from the conflict set-list so re-scrapes won't fix stamped rows — needs a backfill plan when the first non-Lima source lands (ADR-first).
4. **Partial indexes** (`regionId, state='scheduled'`) serve no current API query; likely resolution is the API defaulting to `state='scheduled'` + region/bbox filters — revisit with the map query shape.
5. **Demo polish (web):** filter dropdowns derive options from filtered results (one-way trap); no `staleTime`/`keepPreviousData` (list+marker flash on filter change); default view leads with past events; MapLibre control strings are English (es-PE violation — pass `locale` to the Map); easeTo effect re-fires on refetch.
6. **Test debt:** vitest unit/integration split (parser tests boot pointless containers — now overdue, scrapers #3–#5 have landed); `fetchWithRetry`/orchestration resilience untested (fetch layer still not injectable and the pattern is now in 4 scrapers); no web tests; healthz 503 untested.
7. **MML keyword filter is precision-tuned, recall-unknown:** the trigger+road-context+proximity gate kills the ~80% FP rate but nobody has measured what it misses — revisit once a few weeks of prod data exist (pairs with the T+30 disruption-density check).
8. **Smaller:** futbolperuano conditional GETs (politeness-plan deviation — re-fetches all detail pages each run); robots.txt verification only recorded in a commit message, not the plan doc; `LOG_LEVEL` outside env schema; `@types/node@^25` vs Node 24 pin; stale `@types/node-cron`; `fromDriver` EWKB cast is a typed lie (fix before Tier-2 geospatial reads); `schedule.ts` ZodError classification is dead code (classification belongs in `run.ts`); `ingest/index.ts` is a side-effectful module name; per-source counts in the run summary; no `Cache-Control` on `/events`; 500-row limit ceiling with silent truncation; `pnpm lint:md` fails on pre-existing V1-BRIEF table style (MD060) — fix or configure; recurring-events entries need manual refresh as editions publish (Parada Militar 2026 operational plan ~mid-July; Media Maratón route/start time).

## Open questions / decisions deferred

Decision workshop 2026-06-11 closed every standing item; owners noted per item. Queued for the **Tier-2 session**: futbolperuano visibility gate + `GET /sources`. Queued for **docs day (after Tier 3 closes — shipped or auto-cut)**: ADR-002/003 amendment, V1-BRIEF "What exists today" refresh, promote the demo-fence definition below into the brief/ARCHITECTURE.md.

- **futbolperuano data on the public URL** — RESOLVED 2026-06-11: **gate it.** Per-source public-visibility flag; public `/events` excludes gated sources; env flag re-enables them for demos. Same mechanism serves Teleticket/Joinnus at Tier 2 — build once. Owner: Tier-2 session. **Demo-fence definition (all gated sources):** "internal + demo use only" = controlled-audience rule — gated data may appear only where the user controls the audience (localhost; live demos with the flag flipped for the meeting; unlisted materials sent directly to a prospect); never on the always-on public URL, README assets, or anything indexable.
- **Tier 3 (route-awareness stretch)** — RESOLVED 2026-06-11: **gated go-after-Tier-2.** Authorized as a thin slice only (1–2 seeded demo routes, `ST_DWithin` proximity endpoint, route overlay + nearby-disruptions list; no route-input UI). Gate: Tier-2 acceptance verifier-passed by EOD 2026-06-17; time-box 1.5 days; auto-cut without renegotiation if the gate fails.
- **Demo-cut plan (through 06-22)** — RESOLVED 2026-06-11: after Tier-2 acceptance, sequence = (1) web demo polish ≤1 day (backlog #5; must-have lands before the stretch), (2) Tier 3 thin slice (gate permitting), (3) docs day — entered once Tier 3 closes (shipped or auto-cut), i.e. once the demo surface is final, since it captures screenshots/diagram/README claims (README rewrite w/ Mermaid + screenshots + 10x section, DATABASE.md incl. VACUUM paragraph, ARCHITECTURE.md deferred-decisions expansion, CLAUDE.md command sync, ADR-002/003 amendment), (4) Loom recorded last, after docs day, + final wrap (sprint closes 06-22 — the external demo deadline, the one date that stays a date). Cut order if squeezed: venue calendars → Tier 3 (auto-gate) → DATABASE.md depth → README 10x trim. Never cut: web polish, README core, Loom.
- **shadcn/ui or Tailwind-only** — RESOLVED 2026-06-11: **adopt shadcn/ui for new components** — production basis the product grows from. Existing Tailwind UI stays (no retrofit sprint); applies from the next new component after this date (in-flight Tier-2 layer work is not reworked); one-time init absorbed by whichever session builds that first component.
- **Per-source freshness visibility** — RESOLVED 2026-06-11: ship a tiny read-only **`GET /sources`** over `ingest_state` (source, lastSuccessAt, consecutiveFailures); `/healthz` stays pure liveness — a stale source must not read as an outage. Owner: Tier-2 session.
- **ADR-002/003 staleness (backlog #2)** — RESOLVED 2026-06-11 (timing): **one** amendment ADR covering both errata (002: nullable location is by design; 003: as-shipped columns + deliberate state update on conflict), written on docs day to avoid ADR-number collisions with the live Tier-2 session. Owner: docs-day session.
- **MML Ley de Transparencia letter** — SENT 2026-06-11 (Mesa de Partes Virtual). Response window 7–30 business days ≈ 2026-06-22 → 2026-07-23; the Ord. 1680 import path proceeds against sample data meanwhile. Tick the brief's human-prereq checkbox at next docs touch.
- **Discovery-conversation cadence (Notion Supuesto #1)** — consciously PAUSED 2026-06-11 until after the sprint (resumes post-06-22). Caveat: demo-audience outreach for the 06-22 demo still happens during the sprint despite the pause.
- **Map tile provider** — RESOLVED 2026-06-10 (v1 re-scope): default OpenFreeMap (no key, no account); swap to MapTiler only if the user supplies a key. Recorded in V1-BRIEF Tier 0.
- **Postgres machine size on Fly** — RESOLVED 2026-06-11: shared-cpu-1x / 512MB per app (ADR-006); size up only on observed bottleneck.
- **"Known issues" section** — RESOLVED 2026-06-11: self-resolved — the "Known issues / review backlog" section above exists with real content; slot question closed.
- **v2 candidates — LLM-assisted extraction** — parked 2026-06-11; gate AMENDED at the 2026-06-11 workshop: **milestone-based, not date-based**. Unparks the moment Tier 2 + gated Tier 3 + the demo-cut list (polish, docs, Loom) are all complete, even if before 06-22 — explicit user amendment to the brief's LLM fence; first step then is eval prep (hand-label ~12 real MML posts as regression fixtures). Use cases ranked: (1) _parser-failure diagnosis_ — one call per incident attaching a fix hypothesis to the Sentry event; advisory-only, zero data risk; (2) _news-post extraction_ (MML/gob.pe) — LLM as just-another-parser behind `scrapedEventSchema`: keyword filter stays as cost firewall, `externalId` stays deterministic (WP post id per ADR-007), content-hash caching, grounding check (extracted date/place strings must appear in source text), confidence fallback to region-level, model never emits coordinates (place names resolve via gazetteer); (3) _cross-channel dedup judge_ for pairs the canonical-URL/title+date rules can't decide (cached verdicts); (4) _Ord. 1680 PDF transcription_ into the manual-import path, human-reviewed. Rejected: runtime LLM fallback for broken parsers (masks drift, defeats loud-failure design; quarantine-table variant only if ever needed). **Cost is a non-factor at our volume** (~10 keyword-positive posts/day ≈ 600k in / 90k out tokens/mo): Groq Llama 8B ≈ $0.04/mo, Llama 4 Scout ≈ $0.10, OpenAI gpt-5.4-nano ≈ $0.23, Claude Haiku 4.5 ≈ $1.05 — all with ~50% batch discounts (daily cron is batch-shaped), all rounding errors vs Fly hosting (prices checked 2026-06-11). **Decide by eval, not price:** build the call site provider-agnostic (text in → Zod-validated JSON out), hand-label ~12 real MML posts as regression fixtures, run them across Groq/Haiku/gpt-nano and promote the winner; weight extraction fidelity (esp. Spanish dates/times — wrong-hour errors are the worst failure for fleet ops; consider an "estimado" UI flag) over the irrelevant cost delta. Diagnosis use case wants a stronger model (Haiku/Sonnet tier) — still pennies per incident. Real budget line = eval-set hours, not API dollars; log tokens-per-run in ingest_state from day one.

---

## Update protocol

After each work session that advances the project, update this file:

1. Tick milestone checkboxes for items completed
2. Refresh **Current state** (bump **Last sync point** to the new HEAD, update what's running if it changed)
3. Rewrite **Next move** to reflect the new pickup point
4. If a non-obvious choice was made that needs cross-session memory, add it to [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) (or write an ADR if it's a major architectural decision)
5. **Ship the wrap-up as one commit.** Stage this PLAN.md update plus any ARCHITECTURE.md or ADR additions made during the session and commit them together as a single `docs: record [unit] wrap-up + [non-obvious decisions]` commit (e.g. `docs: record Commit C wrap-up + Drizzle runtime client conventions`). The `Last sync point` field above stays pointing at the commit _before_ the wrap-up — the wrap-up itself is expected to appear in the next session's `git log <sync>..HEAD` diff (that's how Current state stays synchronized with the recorded SHA). Small same-session follow-ups (a meta-doc fix, a typo, a forgotten dep bump) that land after the wrap-up just show up in the same diff and get read together; sync point doesn't need to be re-bumped per follow-up. The agent does not auto-fire this; the user pulls the trigger.

Don't update for trivial commits (formatting, comment fixes). Do update when a milestone advances or a non-obvious decision is recorded. Keep the file under ~250 lines; if it grows past that, sweep settled decisions into ADRs and stale "open questions" out.
