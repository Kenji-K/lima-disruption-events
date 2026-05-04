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

**Last sync point:** `aca169e chore(api): remove stub-scraper now that real scraper is live`. This is HEAD as of the commit immediately before this PLAN.md update. If `git log aca169e..HEAD` shows commits other than this PLAN.md update itself, work has landed since the last sync — read those commits before trusting "Next move."

**Local stack running:**

- Node **24.15.0** via fnm; pnpm **10.33.2** pinned via `packageManager` + Corepack (with SHA-512 hash).
- Docker Compose stack on `:5432` — Postgres **16.10** + PostGIS **3.5.3** on arm64 (`imresamu/postgis:16-3.5`). Image's init scripts auto-load PostGIS plus the `tiger` and `topology` schemas into the `disruption_intelligence` DB; the migration's `CREATE EXTENSION IF NOT EXISTS postgis` is therefore a no-op locally but kept in the migration so prod / fresh-clone runs work.
- Local DB: name `disruption_intelligence`, user `disruption_intelligence`, password `disruption_intelligence` (dev-only, in `.env.example`). Connection: `postgres://disruption_intelligence:disruption_intelligence@localhost:5432/disruption_intelligence`.
- **Local `.env` required** at the repo root for `pnpm -F @disruption-intelligence/db migrate` / `generate` to run. Gitignored; create with `cp .env.example .env`. Both `drizzle.config.ts` (kit) and `packages/db/src/client.ts` (runtime) load it via `process.loadEnvFile('../../.env')` from `packages/db/`.
- Schema applied: `cities` (1 row — Lima at `POINT(-77.0428 -12.0464)`, `America/Lima`) and `events` (83 real rows from the live Gran Teatro Nacional scraper; May/Jun/Jul 2026 fetched at the last manual ingest). The events column is `start_at` (not `event_start_at` as earlier copies of this file said). Both tables have all the indexes ADRs 001/002/003 specify. Migrations `0000_good_jimmy_woo` and `0001_purple_mystique` (the latter adds `events.source_url`) are recorded in `drizzle.__drizzle_migrations`; re-running `pnpm migrate` is a verified no-op.

**Workspace structure (post-sync):**

- `packages/db` — public surface via `exports: { ".": "./src/index.ts" }`. Top-level barrel re-exports both the schema barrel (`cities`, `events`) and `client.ts` (`db`, `closeDb`). Runtime Drizzle client mirrors drizzle-kit's `casing: 'snake_case'` — see ARCHITECTURE.md "Drizzle runtime client conventions" for why both sides need the option.
- `packages/shared` — public surface, exports `scrapedEventSchema`/`ScrapedEvent` (Zod boundary type for scraper output, now including optional `sourceUrl: z.url()`) and `locationSchema`/`Location`. The `endAt > startAt` cross-field refine compares Date instants to handle mixed offsets safely. No string→Date `.transform()` — that conversion belongs in the upsert layer, not the validation boundary.
- `apps/api` — full ingest pipeline live against a real source:
  - `src/ingest/gran-teatro-nacional-scraper.ts` — Cheerio parser of `granteatronacional.pe/calendario/YYYYMM` over a 3-month window. Two-phase fetch retry (1+3 in-call attempts, then a single end-of-run pass over the failedList). Three GTN-HTML quirks handled in-line with comments: repeat-cell `<time datetime>` carries the first occurrence's date (combine `td.date-date` + `<time>` time-of-day instead); empty `cat-*` class on uncategorized events falls back to `'proximamente'`; `"¡Es gratis!"` overrides popup text on free events but the `cat-*` class is the source of truth.
  - `src/ingest/run.ts` — shared `runIngestOnce(log)` used by both the one-off and the cron worker.
  - `src/ingest/index.ts` — thin shell: `runIngestOnce` wrapped in finally-`closeDb` for `pnpm -F api ingest`.
  - `src/ingest/upsert.ts` — unchanged from the stub era. Bulk insert + `.onConflictDoUpdate` keyed on `(sourceId, externalId)` per ADR-003; boundary conversions (ISO→Date, `{lng,lat}`→PostGIS WKT); inserted-vs-updated count via `RETURNING (xmax = 0)`; `cityId` resolved by single `cities.slug = 'lima'` lookup.
  - `src/cron.ts` — `pnpm -F api cron` standalone scheduler. Daily 06:00 `America/Lima` via node-cron 4.x. `noOverlap: true` skips a tick if the previous one is still running. SIGTERM/SIGINT trigger graceful shutdown (stop task, `closeDb`, exit 0). When Fastify lands in Week 2 the schedule attaches to its lifecycle.
  - Direct deps now include `drizzle-orm`, `cheerio`, `node-cron` (each workspace declares what it directly imports — see CLAUDE.md/ARCHITECTURE.md on pnpm strict isolation).
  - `test/setup.ts` + `test/ingest/upsert.test.ts` + `test/ingest/gran-teatro-nacional-scraper.test.ts` — 18 tests total. The new scraper test runs purely against a co-located fixture (`test/ingest/fixtures/gran-teatro-nacional-calendario-202605.html`) and does not need Postgres; the pipeline test still uses the Testcontainers harness. `pnpm -F api test` runs once; `pnpm -F api test:watch` for iteration. Total wall-clock ~6–10s including container boot.

**Uncommitted work in tree:** this PLAN.md update + the ARCHITECTURE.md "Scraper conventions" addition + a column-name nit fix in `docs/plans/scraper-1-gran-teatro-nacional.md`. All staged for the session-wrap commit. Otherwise tree is clean as of `aca169e`.

---

## Next move

**Week 1 is closed. Open Week 2: Fastify HTTP API.** The scraper is live (Gran Teatro Nacional, 83 events for May/Jun/Jul) and the cron is wired (daily 06:00 Lima). The next gate is exposing the data via a Zod-validated HTTP API.

### Scope of the next commit

1. **Fastify scaffold inside `apps/api`** — Fastify ^5 with `fastify-type-provider-zod` so request/response schemas are Zod-defined and the OpenAPI spec is generated, not hand-written. Decision deferred to implementation: keep the cron as a separate `pnpm -F api cron` entry, or attach it to the Fastify lifecycle now? Cleanest answer is to attach now (one process, one logger); revisit only if the cron and the API ever need to scale independently.
2. **Three endpoints** to start: `GET /healthz` (returns `{ ok: true }` plus a DB ping), `GET /events` (filtered list — at minimum a `?from=&to=&category=&limit=` shape), `GET /events/:id` (single event, 404 if missing). The list filter should at least cover the time-range BRIN-friendly query so ADR-001 gets exercised against real data.
3. **OpenAPI exposed at `/docs`** via `@scalar/fastify-api-reference` (or the simpler swagger-ui plugin). The spec is the artifact most worth showing in interviews; auto-generated from the Zod schemas means it can never drift from the implementation.
4. **No frontend yet.** That's the second half of Week 2; landing it in a separate commit keeps the diffs scannable and lets the API be exercised via curl/HTTPie before the React app is in the loop.

### Open question to resolve before starting Week 2

**Scraper #2 timing.** Originally Week 2 scheduled "Second scraper plugged into the same pipeline." Two viable choices to surface in a discussion:

- **Land Scraper #2 immediately** (before Fastify) so the pipeline-abstraction claim has two sources behind it before the API ships. Candidate: Teleticket aggregator (covers Estadio Nacional via venue-string match — see [`docs/plans/scraper-1-gran-teatro-nacional.md`](plans/scraper-1-gran-teatro-nacional.md) source-survey conclusions).
- **Defer Scraper #2 to mid-Week-2** (after Fastify) so the API ships against real data sooner. Risk: the abstraction stays single-call and only gets stress-tested late.

This needs to be picked before code starts. v0's Definition of done says "≥20 real events from ≥2 sources" — so #2 ships by Week 3 either way; only the order is open.

---

## Open questions / decisions deferred

- **Scraper #2 source + timing** — see "Next move" above. Source-survey work in [`docs/plans/scraper-1-gran-teatro-nacional.md`](plans/scraper-1-gran-teatro-nacional.md) parked Teleticket (would cover Estadio Nacional via venue-string match) as the leading candidate. Timing: before vs after Fastify.
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
5. **Ship the wrap-up as one commit.** Stage this PLAN.md update plus any ARCHITECTURE.md or ADR additions made during the session and commit them together as a single `docs: record [unit] wrap-up + [non-obvious decisions]` commit (e.g. `docs: record Commit C wrap-up + Drizzle runtime client conventions`). The `Last sync point` field above stays pointing at the commit _before_ the wrap-up — the wrap-up itself is expected to appear in the next session's `git log <sync>..HEAD` diff (that's how Current state stays synchronized with the recorded SHA). Small same-session follow-ups (a meta-doc fix, a typo, a forgotten dep bump) that land after the wrap-up just show up in the same diff and get read together; sync point doesn't need to be re-bumped per follow-up. The agent does not auto-fire this; the user pulls the trigger.

Don't update for trivial commits (formatting, comment fixes). Do update when a milestone advances or a non-obvious decision is recorded. Keep the file under ~250 lines; if it grows past that, sweep settled decisions into ADRs and stale "open questions" out.
