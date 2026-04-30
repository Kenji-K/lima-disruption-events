# PLAN — Lima Disruption Events v0

Persistent project state. **Read this first** when picking up the project in a new session — it tracks where work left off, what's running locally, and any non-obvious decisions made since the original kickoff brief.

This file is the single source of truth for "what now?". Update it after any commit that advances a milestone, changes local state, or records a decision that diverges from or refines the brief.

---

## Session pickup checklist

When picking up the project in a fresh chat, run through this before doing any new work:

1. **Read this file (`docs/PLAN.md`) and `CLAUDE.md`.** CLAUDE.md is auto-loaded; this file you should re-read in full each session because it changes between sessions.
2. **Confirm git state matches "Current state" below:** read the **Last sync point** in *Current state*; if `git log <sync-sha>..HEAD` is non-empty, work landed after this file was last synced — read those commits before trusting "Next move."
3. **Read the "Next move" section below.** That's the immediate task. If it doesn't make sense given the rest of the file, ask the user before proceeding — PLAN.md may have drifted from reality.

If anything in step 2 looks wrong, surface it to the user before changing code. If the local stack isn't responding when you go to run code, the setup is documented in `CLAUDE.md` and `docker-compose.yml` — don't re-derive it from scratch. The kickoff brief that started this project is **one-shot** (not committed in the repo) — do not expect to find it in conversation history. PLAN.md, CLAUDE.md, [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), and the ADRs in [`docs/adr/`](adr/) are the only authoritative project artifacts.

---

## Milestones

### Week 1 — Backend spine (~22h)

- [x] pnpm workspace scaffold (`apps/{api,web}`, `packages/{db,shared}`)
- [x] Node 24 LTS + pnpm 10.33.2 pinned (`.nvmrc`, `engines`, `packageManager` w/ SHA-512)
- [x] `docker-compose.yml` — Postgres 16 + PostGIS 3.5 (no Redis)
- [x] **ADR-003** — idempotent upsert via `(source_id, external_id)`
- [x] **ADR-001** — BRIN index on `event_start_at` *(pulled forward from Week 2; see "ADR-first ordering" below)*
- [x] **ADR-002** — GiST index on `events.location` geography column *(pulled forward from Week 3)*
- [x] **ADR-004** — co-locating API + DB on Fly's private network *(pulled forward from Week 3)*
- [x] Drizzle schema for `cities` + `events` tables; first migration applied locally
- [ ] One scraper (HTML source, TBD) writing through the idempotent upsert pipeline
- [ ] Idempotent upsert pipeline with retry + structured logs (pino)
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

**Branch:** `main`. Not yet pushed to `origin` (origin still at `Initial commit`). For the authoritative since-Initial commit list, run `git log --oneline 4ae7626..HEAD`.

**Last sync point:** `ef47dda feat(db): initial schema with cities and events tables`. This is HEAD as of the commit immediately before this PLAN.md update. If `git log ef47dda..HEAD` shows commits other than this PLAN.md update itself, work has landed since the last sync — read those commits before trusting "Next move."

**Local stack running:**

- Node **24.15.0** via fnm; pnpm **10.33.2** pinned via `packageManager` + Corepack (with SHA-512 hash).
- Docker Compose stack on `:5432` — Postgres **16.10** + PostGIS **3.5.3** on arm64 (`imresamu/postgis:16-3.5`). Image's init scripts auto-load PostGIS plus the `tiger` and `topology` schemas into the `disruption_intelligence` DB; the migration's `CREATE EXTENSION IF NOT EXISTS postgis` is therefore a no-op locally but kept in the migration so prod / fresh-clone runs work.
- Local DB: name `disruption_intelligence`, user `disruption_intelligence`, password `disruption_intelligence` (dev-only, in `.env.example`). Connection: `postgres://disruption_intelligence:disruption_intelligence@localhost:5432/disruption_intelligence`.
- **Local `.env` required** at the repo root for `pnpm -F @disruption-intelligence/db migrate` / `generate` to run. Gitignored; create with `cp .env.example .env`. Drizzle's config loads it via `process.loadEnvFile('../../.env')` from `packages/db/`.
- Schema applied: `cities` (1 row — Lima at `POINT(-77.0428 -12.0464)`, `America/Lima`) and `events` (empty, awaiting first scraper). Both tables have all the indexes ADRs 001/002/003 specify. Migration `0000_good_jimmy_woo` is recorded in `drizzle.__drizzle_migrations`; re-running `pnpm migrate` is a verified no-op.

**Uncommitted work in tree:** none. Working tree clean as of `ef47dda`.

---

## Next move

**Commit C — stub scraper through the idempotent upsert pipeline.** Goal of this commit is to prove the *pipeline shape*, not the data quality: a scraper invocation produces normalized event rows, the upsert path inserts them once and updates them on re-run with zero duplicates, and a structured log line records the outcome. Real HTML scraping replaces the stub in a later commit; the stub is intentionally hardcoded so the pipeline can be exercised before any source-specific brittleness enters the picture.

### Suggested shape (mentor mode — confirm before generating files)

1. **Pick a home for the upsert path.** Likely `apps/api/src/ingest/` (a new directory inside the not-yet-scaffolded API workspace). Open question: scaffold `apps/api` minimally now (Fastify can come in Week 2; this commit only needs a runnable script + a tsconfig that imports `@disruption-intelligence/db`), or land the ingest module inside `packages/db` for now and lift it once `apps/api` exists. Recommend: scaffold `apps/api` minimally — it's the natural owner of cron + Fastify in Week 1/2 anyway, and the `pnpm -F api ingest` script in `CLAUDE.md` already implies the module lives there.
2. **Define the boundary type with Zod.** `ScrapedEvent` schema: source-shaped fields the scraper produces (no DB ids, `state` as enum, `location` as `{lng, lat}`, `startAt`/`endAt` as ISO strings or Dates). Validate at the scraper output boundary per the project convention.
3. **Write the upsert.** One function: `upsertEvents(rows: ScrapedEvent[]): Promise<{inserted: number, updated: number}>`. Uses Drizzle's `.onConflictDoUpdate` keyed on the `events_source_external_uq` index — `(source_id, external_id)` per ADR-003. `updated_at` set to `now()` on every conflict update; `ingested_at` left untouched after first insert.
4. **Wire the stub scraper.** A function returning 3 hardcoded `ScrapedEvent`s with stable `(source_id='stub', external_id='stub-001'..'stub-003')`. One concert, one road closure, one sports — so `category` filtering has something to bite on later. Coordinates inside Lima.
5. **`pnpm -F api ingest` script.** Calls scraper → validates → upserts → emits one pino log line per run with `{inserted, updated, durationMs}`.
6. **Manual verification before commit:** run twice; row count stays at 3, second run shows `inserted: 0, updated: 3` and bumped `updated_at`.

Integration tests (Testcontainers) for the upsert + idempotent re-run + Zod-rejection paths come in their own commit immediately after — same source files, separate commit so the diff stays reviewable.

### Open scaffolding questions to settle at the start of the next session

- Does `apps/api` get scaffolded as part of Commit C, or as a separate `chore:` commit immediately preceding it?
- Logger lifecycle: a single shared pino instance exported from `apps/api/src/log.ts`, or instantiated per-entrypoint? Lean: shared.
- The pino request-id middleware (project convention) applies to HTTP requests; for the cron/ingest path, the analogous concept is a per-run `runId` propagated through the log context. Worth setting up now even though there's no Fastify yet.

---

## Open questions / decisions deferred

- **Two data sources** — not yet picked. Recommended profile: one venue calendar (HTML scrape, polite cron, low legal/blocking risk) and one road-closure or news source. Avoid X/Twitter API (paid, ToS hostile). Decision deferred until Week 1's first scraper is working with one real source.
- **Map tile provider** — MapTiler free tier vs OpenFreeMap. Decision deferred to Week 2.
- **shadcn/ui or Tailwind-only** — engineer's call if time permits in Week 3.
- **Postgres machine size on Fly** — start with smallest dev cluster; size up only on observed bottleneck.
- **"Known issues" section** — neither PLAN.md nor ARCHITECTURE.md currently has a slot for tracking bugs, gotchas, or things-that-don't-quite-work. Add the moment there's actual content (likely a section in PLAN.md alongside *Open questions*, or a callout list in ARCHITECTURE.md). Don't add preemptively — borrowed from a Cline Memory Bank pattern review on 2026-04-27 where the slot was identified as a real gap, but with no content to fill it yet.

---

## Update protocol

After each work session that advances the project, update this file:

1. Tick milestone checkboxes for items completed
2. Refresh **Current state** (bump **Last sync point** to the new HEAD, update what's running if it changed)
3. Rewrite **Next move** to reflect the new pickup point
4. If a non-obvious choice was made that needs cross-session memory, add it to [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) (or write an ADR if it's a major architectural decision)

Don't update for trivial commits (formatting, comment fixes). Do update when a milestone advances or a non-obvious decision is recorded. Keep the file under ~250 lines; if it grows past that, sweep settled decisions into ADRs and stale "open questions" out.
