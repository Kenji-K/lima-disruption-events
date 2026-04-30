# PLAN — Lima Disruption Events v0

Persistent project state. **Read this first** when picking up the project in a new session — it tracks where work left off, what's running locally, and any non-obvious decisions made since the original kickoff brief.

This file is the single source of truth for "what now?". Update it after any commit that advances a milestone, changes local state, or records a decision that diverges from or refines the brief.

---

## Session pickup checklist

When picking up the project in a fresh chat, run through this before doing any new work:

1. **Read this file (`docs/PLAN.md`) and `CLAUDE.md`.** CLAUDE.md is auto-loaded; this file you should re-read in full each session because it changes between sessions.
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
- [ ] One scraper (HTML source, TBD) writing through the idempotent upsert pipeline _(stub-scraper proves the pipeline shape; real HTML source pending)_
- [ ] `node-cron` wired in-process; one scheduled job invoking the scraper
- [ ] Integration tests: scraper happy path, idempotent re-run, schema-validation rejection
- [ ] **Checkpoint:** `pnpm -F api ingest` runs the scraper on demand, cron runs it on schedule, re-running produces zero duplicates, tests pass

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
- [ ] All four ADRs (001, 002, 003, 004) written and committed
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

**Last sync point:** `9d47e5a feat(api): stub scraper through idempotent upsert pipeline`. This is HEAD as of the commit immediately before this PLAN.md update. If `git log 9d47e5a..HEAD` shows commits other than this PLAN.md update itself, work has landed since the last sync — read those commits before trusting "Next move."

**Local stack running:**

- Node **24.15.0** via fnm; pnpm **10.33.2** pinned via `packageManager` + Corepack (with SHA-512 hash).
- Docker Compose stack on `:5432` — Postgres **16.10** + PostGIS **3.5.3** on arm64 (`imresamu/postgis:16-3.5`). Image's init scripts auto-load PostGIS plus the `tiger` and `topology` schemas into the `disruption_intelligence` DB; the migration's `CREATE EXTENSION IF NOT EXISTS postgis` is therefore a no-op locally but kept in the migration so prod / fresh-clone runs work.
- Local DB: name `disruption_intelligence`, user `disruption_intelligence`, password `disruption_intelligence` (dev-only, in `.env.example`). Connection: `postgres://disruption_intelligence:disruption_intelligence@localhost:5432/disruption_intelligence`.
- **Local `.env` required** at the repo root for `pnpm -F @disruption-intelligence/db migrate` / `generate` to run. Gitignored; create with `cp .env.example .env`. Both `drizzle.config.ts` (kit) and `packages/db/src/client.ts` (runtime) load it via `process.loadEnvFile('../../.env')` from `packages/db/`.
- Schema applied: `cities` (1 row — Lima at `POINT(-77.0428 -12.0464)`, `America/Lima`) and `events` (3 stub rows from the working ingest pipeline; `external_id ∈ {stub-001, stub-002, stub-003}`). Both tables have all the indexes ADRs 001/002/003 specify. Migrations `0000_good_jimmy_woo` and `0001_purple_mystique` (the latter adds `events.source_url`) are recorded in `drizzle.__drizzle_migrations`; re-running `pnpm migrate` is a verified no-op.

**Workspace structure (post-sync):**

- `packages/db` — public surface via `exports: { ".": "./src/index.ts" }`. Top-level barrel re-exports both the schema barrel (`cities`, `events`) and `client.ts` (`db`, `closeDb`). Runtime Drizzle client mirrors drizzle-kit's `casing: 'snake_case'` — see ARCHITECTURE.md "Drizzle runtime client conventions" for why both sides need the option.
- `packages/shared` — public surface, exports `scrapedEventSchema`/`ScrapedEvent` (Zod boundary type for scraper output, now including optional `sourceUrl: z.url()`) and `locationSchema`/`Location`. The `endAt > startAt` cross-field refine compares Date instants to handle mixed offsets safely. No string→Date `.transform()` — that conversion belongs in the upsert layer, not the validation boundary.
- `apps/api` — full ingest pipeline working end-to-end:
  - `src/ingest/stub-scraper.ts` — three stable-id `ScrapedEvent`s; `stub-003` exercises the null-`endAt` and null-`location` mapper branches.
  - `src/ingest/upsert.ts` — bulk insert + `.onConflictDoUpdate` keyed on `(sourceId, externalId)` per ADR-003; boundary conversions (ISO→Date, `{lng,lat}`→PostGIS WKT) live here; inserted-vs-updated count via `RETURNING (xmax = 0)`; `cityId` resolved by single `cities.slug = 'lima'` lookup.
  - `src/ingest/index.ts` — runId-bound child logger, `scrapedEventSchema.array().parse()` (crash on malformed scraper output), single summary log line, `closeDb()` in `finally`.
  - `pnpm -F api ingest` script wired. Verified two-pass: first run `inserted=3`, second run `inserted=0 updated=3`; `ingested_at` preserved across runs, `updated_at` rolls forward.
  - Direct deps now include `drizzle-orm` (each workspace declares what it directly imports — see CLAUDE.md/ARCHITECTURE.md on pnpm strict isolation).

**Uncommitted work in tree:** this PLAN.md update + the parallel ARCHITECTURE.md addition (Drizzle runtime client conventions). Both staged for the session-wrap commit. Otherwise tree is clean as of `9d47e5a`.

---

## Next move

**Commit D — integration tests for the ingest pipeline.** Same source files as Commit C; separate commit per the explicit "diff stays reviewable" split. Real Postgres + PostGIS via Testcontainers, no DB mocks (CLAUDE.md non-negotiable: "Real database in tests").

### Scope of Commit D

1. **Vitest + Testcontainers wiring.** `apps/api/vitest.config.ts`; `apps/api/test/setup.ts` that boots a single ephemeral Postgres+PostGIS container per test file, runs migrations against it, and seeds the Lima city row. Container teardown after the file. Use `imresamu/postgis:16-3.5` to match the dev image and avoid arm64 pulls of the official image.
2. **Three test cases** (one file, e.g. `apps/api/test/ingest/upsert.test.ts`):
   - **Happy path** — seed 3 valid `ScrapedEvent`s through `upsertEvents`, assert `inserted: 3, updated: 0`, row count = 3, key fields round-trip correctly (especially the PostGIS WKT — verify lng/lat survive via `ST_X(location::geometry)`/`ST_Y(...)`).
   - **Idempotent re-run** — call `upsertEvents` twice with the same input, assert second call reports `inserted: 0, updated: 3`, `ingested_at` preserved across runs (compare timestamps), `updated_at` strictly greater on second run.
   - **Zod rejection** — feed a malformed event (e.g. `endAt < startAt`, or missing required field) through `scrapedEventSchema.array().parse()` and assert it throws. This tests the validation contract, not the upsert itself.
3. **`"scripts": { "test": "vitest run" }`** in `apps/api/package.json`.

### Open question for Commit D

How to share the Testcontainer across test files: one container per file (simple, ~5s startup tax per file), or one shared container per test run with per-test schema reset (faster but more wiring). Default to per-file for v0 — only three test cases, the simplicity wins. Revisit when test count grows past ~10 files.

### After Commit D

Real HTML scraper (replacing stub) and `node-cron` wiring close out Week 1. The two open questions in PLAN.md ("Two data sources" — pick the first source) gate the real-scraper commit.

---

## Open questions / decisions deferred

- **Two data sources** — not yet picked. Recommended profile: one venue calendar (HTML scrape, polite cron, low legal/blocking risk) and one road-closure or news source. Avoid X/Twitter API (paid, ToS hostile). Decision deferred until Week 1's first scraper is working with one real source.
- **Map tile provider** — MapTiler free tier vs OpenFreeMap. Decision deferred to Week 2.
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

Don't update for trivial commits (formatting, comment fixes). Do update when a milestone advances or a non-obvious decision is recorded. Keep the file under ~250 lines; if it grows past that, sweep settled decisions into ADRs and stale "open questions" out.
