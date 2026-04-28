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
- [ ] Drizzle schema for `cities` + `events` tables; first migration applied locally
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

---

## Current state

**Branch:** `main`. Not yet pushed to `origin` (origin still at `Initial commit`). For the authoritative since-Initial commit list, run `git log --oneline 4ae7626..HEAD`.

**Last sync point:** `ef233d6 docs(adr): 004 — co-locating API and Postgres on Fly's private network`. This is HEAD as of the commit immediately before this PLAN.md update. If `git log ef233d6..HEAD` shows commits other than this PLAN.md update itself, work has landed since the last sync — read those commits before trusting "Next move."

**Local stack running:**

- Node **24.15.0** via fnm; pnpm **10.33.2** pinned via `packageManager` + Corepack (with SHA-512 hash).
- Docker Compose stack on `:5432` — Postgres **16.10** + PostGIS **3.5.3** on arm64 (`imresamu/postgis:16-3.5`).
- Local DB: name `disruption_intelligence`, user `disruption_intelligence`, password `disruption_intelligence` (dev-only, in `.env.example`). Connection: `postgres://disruption_intelligence:disruption_intelligence@localhost:5432/disruption_intelligence`.
- No tables yet (Drizzle schema is the next step).

---

## Next move

Land the initial Drizzle schema in two commits. All four ADRs (001/002/003/004) are written, so the schema implements decisions that are already documented and defended — the migration file should cite ADRs 001 and 002 by number in SQL comments next to the indexes they justify.

### Commit A — `chore: install TypeScript and Drizzle tooling`

- Root devDeps: `typescript`, `@types/node`
- Root: `tsconfig.base.json` (strict; `noUncheckedIndexedAccess`; `verbatimModuleSyntax`)
- `packages/db` deps: `drizzle-orm`, `drizzle-kit`, `postgres` (the postgres-js driver; recommended over `pg` since Drizzle 0.30)
- `packages/db` devDep: `tsx`
- `packages/db/tsconfig.json` extending base (`module: ESNext`, `moduleResolution: Bundler`)
- `packages/db/drizzle.config.ts` using Node 24's `process.loadEnvFile()` (no `dotenv` dep needed)
- `packages/db/src/schema/index.ts` (empty barrel)
- `packages/db/package.json` scripts: `generate`, `migrate`, `studio`

### Commit B — `feat(db): initial schema with cities and events tables`

- `src/schema/cities.ts` (small reference table; one row at v0 — Lima)
- `src/schema/events.ts` (with all indexes per ADRs 001/002 plus the partial composites)
- `src/schema/index.ts` (re-export barrel)
- Generated migration `migrations/0000_initial_schema.sql`, manually augmented to:
  - Prepend `CREATE EXTENSION IF NOT EXISTS postgis;`
  - Add the BRIN index on `start_at` (Drizzle Kit doesn't generate non-btree types — added by hand). Cite ADR-001 in a comment.
  - Add the GiST index on `location`. Cite ADR-002.
  - Add the partial composite indexes (`(city_id, state, start_at) WHERE state = 'active'`, `(city_id, category) WHERE state = 'active'`)
  - Append the Lima seed `INSERT INTO cities ...` with `ST_GeogFromText('SRID=4326;POINT(-77.0428 -12.0464)')`
- Apply via `pnpm -F db migrate` against the running local DB; verify with `psql \d events` and `\di events*`

**After Commit B:** stub scraper emitting 3 hardcoded fake events (step 6 in the brief), then wire `node-cron` (step 7), then real scrape replaces the fakes.

---

## Open questions / decisions deferred

- **Two data sources** — not yet picked. Recommended profile: one venue calendar (HTML scrape, polite cron, low legal/blocking risk) and one road-closure or news source. Avoid X/Twitter API (paid, ToS hostile). Decision deferred until Week 1's first scraper is working with one real source.
- **Map tile provider** — MapTiler free tier vs OpenFreeMap. Decision deferred to Week 2.
- **shadcn/ui or Tailwind-only** — engineer's call if time permits in Week 3.
- **Postgres machine size on Fly** — start with smallest dev cluster; size up only on observed bottleneck.

---

## Update protocol

After each work session that advances the project, update this file:

1. Tick milestone checkboxes for items completed
2. Refresh **Current state** (bump **Last sync point** to the new HEAD, update what's running if it changed)
3. Rewrite **Next move** to reflect the new pickup point
4. If a non-obvious choice was made that needs cross-session memory, add it to [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) (or write an ADR if it's a major architectural decision)

Don't update for trivial commits (formatting, comment fixes). Do update when a milestone advances or a non-obvious decision is recorded. Keep the file under ~250 lines; if it grows past that, sweep settled decisions into ADRs and stale "open questions" out.
