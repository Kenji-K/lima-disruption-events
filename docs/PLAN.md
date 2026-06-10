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
- [ ] Sentry on API and web
- [ ] Deploy API + Postgres to Fly.io (region `scl`, single Fly app for API, separate Fly Postgres in same region, talking over `6PN`)
- [ ] Deploy frontend to Vercel
- [ ] README rewrite — architecture diagram (Mermaid), screenshots, live URL, "10x scale" section, scope statement
- [ ] `docs/ARCHITECTURE.md` (with "Deferred decisions" section listing BullMQ/Redis, multi-region, read replicas, etc.)
- [ ] `docs/DATABASE.md` (schema rationale, index choices, VACUUM/autovacuum paragraph)
- [ ] 3-minute Loom walkthrough
- [ ] **Checkpoint:** Live URL works, README is shareable, Loom is recorded

---

## Definition of done for v0

- [ ] Live URL reachable on the public internet
- [x] At least 20 real events from at least 2 sources visible _(locally as of 2026-06-10: 90 events, 89 GTN + 1 futbolperuano; live-URL visibility lands with the Tier-1 deploy)_
- [x] Re-running the ingest pipeline produces zero duplicates _(verified 2026-06-10: second run `inserted=0, updated=90` for both sources)_
- [x] All five ADRs (001, 002, 003, 004, 005) written and committed _(005 added 2026-05-06: regions as generic hierarchical dimension)_
- [ ] API and Postgres deployed to the same Fly region; API connects to DB over `6PN` (verifiable in connection string / Fly console)
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

**Last sync point:** `b0ab6f4 chore: lint/format pass — root test script, fixture prettierignore, type cleanups`. This is HEAD as of the commit immediately before this PLAN.md update (the Tier-0 session: fetchWithRetry extraction → futbolperuano scraper → GTN venue point → Fastify API → web frontend → lint pass). If `git log b0ab6f4..HEAD` shows commits other than the Tier-0 wrap-up docs commit, work has landed since the last sync — read those commits before trusting "Next move."

**Local stack running:**

- Node **24.15.0** via fnm; pnpm **10.33.2** pinned via `packageManager` + Corepack (with SHA-512 hash).
- Docker Compose stack on `:5432` — Postgres **16.10** + PostGIS **3.5.3** on arm64 (`imresamu/postgis:16-3.5`). Image's init scripts auto-load PostGIS plus the `tiger` and `topology` schemas into the `disruption_intelligence` DB; the migration's `CREATE EXTENSION IF NOT EXISTS postgis` is therefore a no-op locally but kept in the migration so prod / fresh-clone runs work.
- Local DB: name `disruption_intelligence`, user `disruption_intelligence`, password `disruption_intelligence` (dev-only, in `.env.example`). Connection: `postgres://disruption_intelligence:disruption_intelligence@localhost:5432/disruption_intelligence`.
- **Local `.env` required** at the repo root for `pnpm -F @disruption-intelligence/db migrate` / `generate` / `seed` to run. Gitignored; create with `cp .env.example .env`. Both `drizzle.config.ts` (kit) and `packages/db/src/client.ts` (runtime) load it via `process.loadEnvFile('../../.env')` from `packages/db/`.
- **Local-stack startup sequence:** `pnpm install` → `docker compose up -d` → `pnpm -F @disruption-intelligence/db migrate` → `pnpm -F @disruption-intelligence/db seed`. The seed is idempotent (`ON CONFLICT DO NOTHING`), so re-running is safe. Coordinate or name corrections for region rows go through a new migration with an explicit `UPDATE`, never via editing `seed.ts`.
- Schema applied: `regions` (renamed from `cities` per ADR-005; 25 Peru level-1 rows — Lima from migration 0000, the other 24 departamentos + Provincia Constitucional del Callao from `pnpm seed`, sourced from INEI's canonical UBIGEO publication) and `events` (90 real rows as of last sync: 89 Gran Teatro Nacional + 1 futbolperuano, all with non-null `location`; FK column is `region_id`). The events column is `start_at` (not `event_start_at` as earlier copies of this file said). Both tables have all the indexes ADRs 001/002/003 specify; ADR-005's regions hierarchy is enforced via `regions_country_level_slug_uq` UNIQUE + `regions_level_parent_check` CHECK + `regions_parent_id_regions_id_fk` self-FK. Migrations `0000_good_jimmy_woo`, `0001_purple_mystique` (adds `events.source_url`), and `0002_rename_cities_to_regions` (the ADR-005 schema work) are recorded in `drizzle.__drizzle_migrations`; re-running `pnpm migrate` is a verified no-op.
- **Dev servers:** `pnpm -F api dev` → Fastify on `:3000` (tsx watch, cron attached); `pnpm -F web dev` → Vite on `:5173` (expects the API at `http://localhost:3000`; override via `VITE_API_URL`).

**Workspace structure (post-sync):**

- `packages/db` — public surface via `exports: { ".": "./src/index.ts", "./seed": "./src/seed.ts" }`. Top-level barrel re-exports both the schema barrel (`regions`, `events`) and `client.ts` (`db`, `closeDb`). The separate `./seed` subpath exports `seed(db)` so the test setup and the `pnpm seed` CLI can pull it without dragging the seed call through the main barrel. Runtime Drizzle client mirrors drizzle-kit's `casing: 'snake_case'` — see ARCHITECTURE.md "Drizzle runtime client conventions" for why both sides need the option.
- `packages/shared` — public surface, exports `scrapedEventSchema`/`ScrapedEvent` (Zod boundary type for scraper output, including optional `sourceUrl: z.url()`), `locationSchema`/`Location`, and `apiEventSchema`/`ApiEvent` (the api↔web response contract — see ARCHITECTURE.md "API event contract"). The `endAt > startAt` cross-field refine compares Date instants to handle mixed offsets safely. No string→Date `.transform()` — that conversion belongs in the upsert layer, not the validation boundary.
- `apps/api` — ingest pipeline (two live sources) + HTTP API:
  - `src/ingest/fetch.ts` — shared `fetchWithRetry` (two-phase retry; extracted from GTN per the scraper-2 plan). Both scrapers consume it.
  - `src/ingest/gran-teatro-nacional-scraper.ts` — Cheerio parser of `granteatronacional.pe/calendario/YYYYMM` over a 3-month window. Three GTN-HTML quirks handled in-line with comments: repeat-cell `<time datetime>` carries the first occurrence's date (combine `td.date-date` + `<time>` time-of-day instead); empty `cat-*` class on uncategorized events falls back to `'proximamente'`; `"¡Es gratis!"` overrides popup text on free events but the `cat-*` class is the source of truth. Every event now pinned to the theatre's fixed venue point (San Borja, OSM-verified).
  - `src/ingest/futbolperuano-scraper.ts` + `futbolperuano-venues.ts` — Liga 1 scraper: listing → home-team filter (URL slug ∈ 3 Lima clubs) → per-match JSON-LD `Review.itemReviewed` SportsEvent; `externalId` = the URL's `m<digits>` suffix; static venue map with OSM-verified stadium coords; venue cross-check / unmapped `eventStatus` / missing Review block all throw as programmer errors; 1.5s spacing between detail fetches.
  - `src/ingest/run.ts` — `runIngestOnce(log)` iterates a `SCRAPERS` list with per-source isolation (scrape → validate → upsert per source; one source failing never blocks the others).
  - `src/ingest/upsert.ts` — Bulk insert + `.onConflictDoUpdate` keyed on `(sourceId, externalId)` per ADR-003; boundary conversions (ISO→Date, `{lng,lat}`→PostGIS WKT); inserted-vs-updated count via `RETURNING (xmax = 0)`; `regionId` resolved by single `regions.slug = 'lima' AND country_code = 'PE' AND level = 1` composite lookup.
  - `src/ingest/schedule.ts` — `createIngestTask(log)`: daily 06:00 `America/Lima`, `noOverlap`, error-classified tick logging. `src/main.ts` (the `pnpm -F api dev`/`start` entrypoint) attaches it to the Fastify lifecycle (onClose stops it + drains the pool); `src/cron.ts` remains a thin standalone dev runner over the same module.
  - `src/server.ts` + `src/api/{routes,schemas}.ts` — Fastify 5 + `fastify-type-provider-zod`; `GET /healthz` (DB ping, 503 when unreachable), `GET /events` (filters `from`/`to`/`category`/`source`/`limit`, ordered by `start_at`), `GET /events/:id` (404 if missing); OpenAPI from the Zod schemas at `/docs` (spec at `/docs/json`); CORS open (public read-only API); `src/env.ts` Zod-validates PORT/HOST at boot.
  - `test/` — 44 tests / 4 files: fixture-driven parser tests for both scrapers (no Postgres), Testcontainers pipeline + API integration tests (each vitest fork gets its own container via `test/setup.ts` top-level await). `pnpm test` at the root runs everything.
- `apps/web` — Vite 8 + React 19 + Tailwind 4 + MapLibre GL + TanStack Query + react-router 7. Filter bar (date range / category / source, held in URL search params), sidebar list, OpenFreeMap map with per-venue grouped markers (count badge + event-picker popup, popup DOM built via `textContent` so scraped titles never reach `innerHTML`), detail drawer at `/eventos/:id` (map eases center under drawer-width padding on open, back on close). UI text es-PE with `America/Lima` Intl formatting. API responses Zod-validated against `apiEventSchema` at the fetch boundary.

**Uncommitted work in tree:** none — tree is clean as of `b0ab6f4`; this PLAN.md/ARCHITECTURE.md update ships as the Tier-0 wrap-up docs commit.

---

## Next move

**Tier 0 is DONE (2026-06-10).** All four items shipped and the acceptance criteria were verified by a fresh-context subagent against the brief: 90 events / 2 sources on the local map+list, 0-duplicate re-ingest (`inserted=0, updated=90`), 44/44 tests green, OpenAPI at `/docs` matches live responses. One flagged caveat: futbolperuano currently contributes a single (past) event — the live listing window had only one target-club home match on scrape day; self-corrects as new matchdays publish.

**Sprint Session 2 = Tier 1 of [`docs/V1-BRIEF.md`](V1-BRIEF.md): deploy + v0.5 sources.** In the brief's order:

1. **Deploy** — Fly.io (API + Postgres over `6PN`, ADR-004; migrations + seed via `release_command`; cron live in prod), Vercel (web), Sentry (both apps). **Gated on the brief's "Human prerequisites"** (Fly/Vercel/Sentry accounts + tokens). If blocked, build everything up to the final deploy command (Dockerfile, fly.toml, Vercel config, prod env schema) and continue with source work.
2. **MML WordPress feed** — `munlima.gob.pe/wp-json/wp/v2/posts` incremental `?after=` polls + Spanish keyword filter; rule-based date/place extraction; region-level fallback (`location = null`). Re-verify the endpoint by fetching before building (brief's drift rule).
3. **Lima Expresa pressroom** — `prensa.limaexpresa.pe` (NOT `www.limaexpresa.pe/feed/` — returns 200 but empty); seen-URL set, deltas.
4. **Hardcoded recurring events** — Peru NT home matches + Maratón Lima 42K etc. as idempotent reference-data entries with provenance URLs.
5. **Venue direct calendars** (Costa 21, Jockey Club, Arena Perú) — lowest priority; drop to Tier 2 if time-pressed.

Tier-1 acceptance (fresh-context verifier again): live public URL serving events from ≥4 sources, cron in prod, 0-dup prod re-ingest, data freshness < 24h, Sentry receiving from both apps.

---

## Known issues / review backlog

Source: 5-lens architectural review, 2026-06-10 (fresh-context subagents + verified findings). The pre-deploy batch landed same day (error sanitization, int4 id cap, rate limit + trustProxy, healthz timeout, GTN empty-month + futbolperuano all-away rules, cancel-missing sweep, in-batch dedupe, sourceUrl http(s) guard, vercel.json, prod-strict `VITE_API_URL`, `pnpm typecheck`). Deliberately deferred, in priority order:

1. **ADR-006 (deploy topology) — write at top of Tier-1 deploy session.** Must cover: verify PostGIS on the chosen Fly Postgres flavor FIRST (stock postgres-flex lacks it); single-machine/no-autostop constraint (in-process cron double-ticks on 2 machines, never fires under autostop); `release_command` migration runner (tsx/drizzle-kit are devDeps — prod image needs a programmatic `drizzle-orm` migrator script); supersedes ADR-004's "migrations via fly proxy" line.
2. **ADR-007 (source registry + ingest state) — write before the MML scraper.** MML needs a persistent `?after=` cursor, Lima Expresa a seen-URL set; nowhere to put them today. Include per-source freshness/failure tracking and the news `externalId`/canonical-URL convention (Tier-2 dedup input).
3. **ADR staleness:** ADR-003 describes columns/state enum that never shipped and says state isn't touched on conflict (it is, correctly); ADR-002 says location is mandatory (nullable by design). Reconcile via amendment ADR. V1-BRIEF "What exists today" is stale since Tier 0 closed.
4. **`/events` from/to filter on `start_at` only** — a multi-day closure starting before `from` is invisible. Wrong for Tier-1/2 road sources; decide overlap semantics (`start_at <= to AND (end_at IS NULL OR end_at >= from)`) before the frontend bakes current behavior in.
5. **Region resolution hard-codes Lima** in `upsertEvents`; `ScrapedEvent` can't express a region, and `regionId` is excluded from the conflict set-list so re-scrapes won't fix stamped rows — needs a backfill plan when the first non-Lima source lands (ADR-first).
6. **Partial indexes** (`regionId, state='scheduled'`) serve no current API query; likely resolution is the API defaulting to `state='scheduled'` + region/bbox filters — revisit with the map query shape.
7. **Demo polish (web):** filter dropdowns derive options from filtered results (one-way trap); no `staleTime`/`keepPreviousData` (list+marker flash on filter change); default view leads with past events; MapLibre control strings are English (es-PE violation — pass `locale` to the Map); easeTo effect re-fires on refetch.
8. **Test debt:** vitest unit/integration split (parser tests boot pointless containers — do when scraper #3 lands); `fetchWithRetry`/orchestration resilience untested (make fetch layer injectable before copying the pattern to 6 sources); no web tests; healthz 503 untested.
9. **Smaller:** futbolperuano conditional GETs (politeness-plan deviation — re-fetches all detail pages each run); robots.txt verification only recorded in a commit message, not the plan doc; `LOG_LEVEL` outside env schema; `@types/node@^25` vs Node 24 pin; stale `@types/node-cron`; `fromDriver` EWKB cast is a typed lie (fix before Tier-2 geospatial reads); `schedule.ts` ZodError classification is dead code (classification belongs in `run.ts`); `ingest/index.ts` is a side-effectful module name; per-source counts in the run summary; no `Cache-Control` on `/events`; 500-row limit ceiling with silent truncation.

## Open questions / decisions deferred

- **Map tile provider** — RESOLVED 2026-06-10 (v1 re-scope): default OpenFreeMap (no key, no account); swap to MapTiler only if the user supplies a key. Recorded in V1-BRIEF Tier 0.
- **shadcn/ui or Tailwind-only** — engineer's call if time permits in Week 3.
- **Postgres machine size on Fly** — start with smallest dev cluster; size up only on observed bottleneck.
- **"Known issues" section** — neither PLAN.md nor ARCHITECTURE.md currently has a slot for tracking bugs, gotchas, or things-that-don't-quite-work. Add the moment there's actual content (likely a section in PLAN.md alongside _Open questions_, or a callout list in ARCHITECTURE.md). Don't add preemptively — borrowed from a Cline Memory Bank pattern review on 2026-04-27 where the slot was identified as a real gap, but with no content to fill it yet.

---

## Update protocol

After each work session that advances the project, update this file:

1. Tick milestone checkboxes for items completed
2. Refresh **Current state** (bump **Last sync point** to the new HEAD, update what's running if it changed)
3. Rewrite **Next move** to reflect the new pickup point
4. If a non-obvious choice was made that needs cross-session memory, add it to [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) (or write an ADR if it's a major architectural decision)
5. **Ship the wrap-up as one commit.** Stage this PLAN.md update plus any ARCHITECTURE.md or ADR additions made during the session and commit them together as a single `docs: record [unit] wrap-up + [non-obvious decisions]` commit (e.g. `docs: record Commit C wrap-up + Drizzle runtime client conventions`). The `Last sync point` field above stays pointing at the commit _before_ the wrap-up — the wrap-up itself is expected to appear in the next session's `git log <sync>..HEAD` diff (that's how Current state stays synchronized with the recorded SHA). Small same-session follow-ups (a meta-doc fix, a typo, a forgotten dep bump) that land after the wrap-up just show up in the same diff and get read together; sync point doesn't need to be re-bumped per follow-up. The agent does not auto-fire this; the user pulls the trigger.

Don't update for trivial commits (formatting, comment fixes). Do update when a milestone advances or a non-obvious decision is recorded. Keep the file under ~250 lines; if it grows past that, sweep settled decisions into ADRs and stale "open questions" out.
