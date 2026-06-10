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

- [ ] Fastify HTTP API: `GET /events` (filtered list), `GET /events/:id`, `GET /healthz`
- [ ] OpenAPI spec auto-generated from Zod via `fastify-type-provider-zod`
- [ ] Second scraper plugged into the same pipeline (proves the abstraction)
- [ ] Vite + React + Tailwind app scaffold
- [ ] MapLibre map with event markers, basic event list view, both wired to TanStack Query
- [ ] **Checkpoint:** Frontend at localhost shows real events from the API on a map and a list

### Week 3 — Polish, deploy, document (~22h)

- [ ] Event detail drawer; filters (date range, category)
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
- [ ] At least 20 real events from at least 2 sources visible
- [ ] Re-running the ingest pipeline produces zero duplicates
- [x] All five ADRs (001, 002, 003, 004, 005) written and committed _(005 added 2026-05-06: regions as generic hierarchical dimension)_
- [ ] API and Postgres deployed to the same Fly region; API connects to DB over `6PN` (verifiable in connection string / Fly console)
- [ ] DATABASE.md includes the VACUUM/autovacuum paragraph (interview-rehearsable, concrete not abstract)
- [ ] ARCHITECTURE.md includes a "Deferred decisions" section with revisit triggers
- [ ] README has architecture diagram, live URL, "10x scale" section
- [ ] Integration tests pass against real Postgres
- [ ] OpenAPI spec generated and accurate
- [ ] `CLAUDE.md` reflects the actual current commands and conventions
- [ ] Loom recorded and linked from README
- [ ] **Disruption-density check (T+30 days)** — once both scrapers have been live in production for 30 days, document weekly event count, geographic spread across Lima, and source-mix. This is the cheap evidence for Notion plan Tesis premise #2 (the assumption that public sources are dense enough to assemble a useful Lima calendar; see also Aulet Tema 5 Step 21). Closing this loop is the most useful learning the v0 can produce. Fires after deploy, not as part of the 3-week sprint.

---

## Current state

**Branch:** `main`. Local and `origin/main` are in sync at the sync point below. For the authoritative since-Initial commit list, run `git log --oneline 4ae7626..HEAD`.

**Last sync point:** `c76633b docs: record regions/seed session wrap-up + data conventions`. This is HEAD as of the commit immediately before this PLAN.md update. If `git log c76633b..HEAD` shows commits other than the v1 re-scope commit (this PLAN.md update + V1-BRIEF.md + CLAUDE.md rewrite), work has landed since the last sync — read those commits before trusting "Next move."

**Local stack running:**

- Node **24.15.0** via fnm; pnpm **10.33.2** pinned via `packageManager` + Corepack (with SHA-512 hash).
- Docker Compose stack on `:5432` — Postgres **16.10** + PostGIS **3.5.3** on arm64 (`imresamu/postgis:16-3.5`). Image's init scripts auto-load PostGIS plus the `tiger` and `topology` schemas into the `disruption_intelligence` DB; the migration's `CREATE EXTENSION IF NOT EXISTS postgis` is therefore a no-op locally but kept in the migration so prod / fresh-clone runs work.
- Local DB: name `disruption_intelligence`, user `disruption_intelligence`, password `disruption_intelligence` (dev-only, in `.env.example`). Connection: `postgres://disruption_intelligence:disruption_intelligence@localhost:5432/disruption_intelligence`.
- **Local `.env` required** at the repo root for `pnpm -F @disruption-intelligence/db migrate` / `generate` / `seed` to run. Gitignored; create with `cp .env.example .env`. Both `drizzle.config.ts` (kit) and `packages/db/src/client.ts` (runtime) load it via `process.loadEnvFile('../../.env')` from `packages/db/`.
- **Local-stack startup sequence:** `pnpm install` → `docker compose up -d` → `pnpm -F @disruption-intelligence/db migrate` → `pnpm -F @disruption-intelligence/db seed`. The seed is idempotent (`ON CONFLICT DO NOTHING`), so re-running is safe. Coordinate or name corrections for region rows go through a new migration with an explicit `UPDATE`, never via editing `seed.ts`.
- Schema applied: `regions` (renamed from `cities` per ADR-005; 25 Peru level-1 rows — Lima from migration 0000, the other 24 departamentos + Provincia Constitucional del Callao from `pnpm seed`, sourced from INEI's canonical UBIGEO publication) and `events` (89 real rows from the live Gran Teatro Nacional scraper as of last sync; FK column is `region_id`). The events column is `start_at` (not `event_start_at` as earlier copies of this file said). Both tables have all the indexes ADRs 001/002/003 specify; ADR-005's regions hierarchy is enforced via `regions_country_level_slug_uq` UNIQUE + `regions_level_parent_check` CHECK + `regions_parent_id_regions_id_fk` self-FK. Migrations `0000_good_jimmy_woo`, `0001_purple_mystique` (adds `events.source_url`), and `0002_rename_cities_to_regions` (the ADR-005 schema work) are recorded in `drizzle.__drizzle_migrations`; re-running `pnpm migrate` is a verified no-op.

**Workspace structure (post-sync):**

- `packages/db` — public surface via `exports: { ".": "./src/index.ts", "./seed": "./src/seed.ts" }`. Top-level barrel re-exports both the schema barrel (`regions`, `events`) and `client.ts` (`db`, `closeDb`). The separate `./seed` subpath exports `seed(db)` so the test setup and the `pnpm seed` CLI can pull it without dragging the seed call through the main barrel. Runtime Drizzle client mirrors drizzle-kit's `casing: 'snake_case'` — see ARCHITECTURE.md "Drizzle runtime client conventions" for why both sides need the option.
- `packages/shared` — public surface, exports `scrapedEventSchema`/`ScrapedEvent` (Zod boundary type for scraper output, including optional `sourceUrl: z.url()`) and `locationSchema`/`Location`. The `endAt > startAt` cross-field refine compares Date instants to handle mixed offsets safely. No string→Date `.transform()` — that conversion belongs in the upsert layer, not the validation boundary.
- `apps/api` — full ingest pipeline live against a real source:
  - `src/ingest/gran-teatro-nacional-scraper.ts` — Cheerio parser of `granteatronacional.pe/calendario/YYYYMM` over a 3-month window. Two-phase fetch retry (1+3 in-call attempts, then a single end-of-run pass over the failedList). Three GTN-HTML quirks handled in-line with comments: repeat-cell `<time datetime>` carries the first occurrence's date (combine `td.date-date` + `<time>` time-of-day instead); empty `cat-*` class on uncategorized events falls back to `'proximamente'`; `"¡Es gratis!"` overrides popup text on free events but the `cat-*` class is the source of truth.
  - `src/ingest/run.ts` — shared `runIngestOnce(log)` used by both the one-off and the cron worker.
  - `src/ingest/index.ts` — thin shell: `runIngestOnce` wrapped in finally-`closeDb` for `pnpm -F api ingest`.
  - `src/ingest/upsert.ts` — Bulk insert + `.onConflictDoUpdate` keyed on `(sourceId, externalId)` per ADR-003; boundary conversions (ISO→Date, `{lng,lat}`→PostGIS WKT); inserted-vs-updated count via `RETURNING (xmax = 0)`; `regionId` resolved by single `regions.slug = 'lima' AND country_code = 'PE' AND level = 1` composite lookup (per ADR-005, was `cities.slug = 'lima'` pre-rename).
  - `src/cron.ts` — `pnpm -F api cron` standalone scheduler. Daily 06:00 `America/Lima` via node-cron 4.x. `noOverlap: true` skips a tick if the previous one is still running. SIGTERM/SIGINT trigger graceful shutdown (stop task, `closeDb`, exit 0). When Fastify lands in Week 2 the schedule attaches to its lifecycle.
  - Direct deps now include `drizzle-orm`, `cheerio`, `node-cron` (each workspace declares what it directly imports — see CLAUDE.md/ARCHITECTURE.md on pnpm strict isolation).
  - `test/setup.ts` — top-level await on `migrate()` then `seed()` so test files load against a Testcontainers DB pre-populated with all 25 regions. `test/ingest/upsert.test.ts` + `test/ingest/gran-teatro-nacional-scraper.test.ts` — 18 tests total. The scraper test runs purely against a co-located fixture and does not need Postgres; the pipeline test uses the Testcontainers harness. `pnpm -F api test` runs once; `pnpm -F api test:watch` for iteration. Total wall-clock ~6–10s including container boot.

**Uncommitted work in tree:** the v1 re-scope set — this PLAN.md update, the new [`docs/V1-BRIEF.md`](V1-BRIEF.md), and the CLAUDE.md build-mode rewrite — shipped as a single re-scope commit. Two test fixtures untracked at `apps/api/test/ingest/fixtures/futbolperuano-*.html` — they belong with the Scraper #2 implementation commit (#4 in the scraper-2 plan), so deliberately not in any wrap-up commit. Otherwise tree is clean as of `c76633b`.

---

## Next move

**Sprint Session 1 = Tier 0 of [`docs/V1-BRIEF.md`](V1-BRIEF.md): close out v0 locally.** Four items, in order:

1. **`refactor(api): extract fetchWithRetry to shared helper`** — lift the two-phase retry wrapper out of `gran-teatro-nacional-scraper.ts` into `apps/api/src/ingest/fetch.ts`. ARCHITECTURE.md "Scraper conventions" already flagged this for when scraper #2 lands. GTN imports the shared helper; existing GTN scraper test should pass without changes.
2. **`feat(api): real scraper for futbolperuano.com Liga 1 (Universitario, Alianza Lima, Sporting Cristal)`** — per [`docs/plans/scraper-2-futbolperuano.md`](plans/scraper-2-futbolperuano.md): `futbolperuano-scraper.ts` + `futbolperuano-venues.ts` + integration glue in `run.ts` + a fixture-driven parser test. JSON-LD extraction from each match's detail page (the SportsEvent block lives inside `Review.itemReviewed`); home-team filter via URL slug; static venue→region fallback map (all three target stadiums resolve to Lima level-1). Two test fixtures already saved untracked at `apps/api/test/ingest/fixtures/futbolperuano-*.html`.
3. **Fastify API** — scaffold + `GET /healthz`, `GET /events` (filtered list), `GET /events/:id`; OpenAPI auto-generated from Zod at `/docs`; cron attached to the Fastify lifecycle (decision: attach now — one process, one logger; revisit only if cron and API need to scale independently).
4. **Frontend** — Vite + React + Tailwind + MapLibre + TanStack Query + react-router; map with markers + filterable list + event detail drawer; UI text in es-PE; OpenFreeMap tiles by default.

Tier-0 acceptance (verify with a fresh-context subagent before calling the session done): ≥20 real events from 2 sources on the local map, 0-duplicate re-ingest, all tests green, OpenAPI accurate at `/docs`. Then Tier 1 (deploy + v0.5 sources) — note the brief's "Human prerequisites" checklist gates the deploy step.

---

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
