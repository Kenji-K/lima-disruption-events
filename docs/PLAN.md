# PLAN — Lima Disruption Events v0

Persistent project state. **Read this first** when picking up the project in a new session — it tracks where work left off, what's running locally, and any non-obvious decisions made since the original kickoff brief.

This file is the single source of truth for "what now?". Update it after any commit that advances a milestone, changes local state, or records a decision that diverges from or refines the brief.

---

## Scope (one paragraph)

Lima Disruption Events v0 is the first deployable slice of Disruption Intelligence (B2B mobility intelligence, Lima-anchored, solo founder). It ingests upcoming disruption events for Lima from two public sources, indexes them by time and geography in PostgreSQL+PostGIS, exposes a small REST API, and renders them on a React map + filterable list with a per-event detail drawer. The v0 has two simultaneous purposes: a senior-level portfolio piece (especially around Postgres internals — BRIN, GiST, VACUUM) and the first reusable technical slice of the real business. Out of scope: auth, multi-tenant, predictive impact modeling, multiple cities, ML/LLM. Stack is locked: TypeScript, Fastify, Drizzle, Postgres 16 + PostGIS, `node-cron` in-process (no Redis/BullMQ for v0), Vite + React + MapLibre, Vitest + Testcontainers, Fly.io for API + DB, Vercel for web.

Full scope, conventions, and "ask the user before" rules live in `CLAUDE.md`.

---

## Milestones

### Week 1 — Backend spine (~22h)

- [x] pnpm workspace scaffold (`apps/{api,web}`, `packages/{db,shared}`)
- [x] Node 24 LTS + pnpm 10.33.2 pinned (`.nvmrc`, `engines`, `packageManager` w/ SHA-512)
- [x] `docker-compose.yml` — Postgres 16 + PostGIS 3.5 (no Redis)
- [x] **ADR-003** — idempotent upsert via `(source_id, external_id)`
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
- [ ] **ADR-001** — BRIN index on `event_start_at`
- [ ] **Checkpoint:** Frontend at localhost shows real events from the API on a map and a list

### Week 3 — Polish, deploy, document (~22h)

- [ ] Event detail drawer; filters (date range, category)
- [ ] Sentry on API and web
- [ ] Deploy API + Postgres to Fly.io (region `scl`, single Fly app for API, separate Fly Postgres in same region, talking over `6PN`)
- [ ] Deploy frontend to Vercel
- [ ] README rewrite — architecture diagram (Mermaid), screenshots, live URL, "10x scale" section, scope statement
- [ ] `docs/ARCHITECTURE.md` (with "Deferred decisions" section listing BullMQ/Redis, multi-region, read replicas, etc.)
- [ ] `docs/DATABASE.md` (schema rationale, index choices, VACUUM/autovacuum paragraph)
- [ ] **ADR-002** — GiST on `location` geography column
- [ ] **ADR-004** — co-locating API + DB on Fly's private network
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

**Branch:** `main`, ahead of `origin/main` by 7 commits (not pushed).

**Local stack running:**

- Node **24.15.0** via fnm; pnpm **10.33.2** pinned via `packageManager` + Corepack (with SHA-512 hash).
- Docker Compose stack on `:5432` — Postgres **16.10** + PostGIS **3.5.3** on arm64 (`imresamu/postgis:16-3.5`).
- Local DB: name `disruption_intelligence`, user `disruption_intelligence`, password `disruption_intelligence` (dev-only, in `.env.example`). Connection: `postgres://disruption_intelligence:disruption_intelligence@localhost:5432/disruption_intelligence`.
- No tables yet (Drizzle schema is the next step).

**Recent commits (most recent last):**

1. `chore: add CLAUDE.md`
2. `chore: initialize pnpm workspace`
3. `chore: rename workspace scope to @disruption-intelligence`
4. `chore: pin pnpm integrity hash in packageManager`
5. `chore: add docker compose stack for local Postgres 16 + PostGIS 3.5`
6. `docs(adr): 003 — idempotent upsert via (source_id, external_id)`
7. `docs: add PLAN.md and reference from CLAUDE.md` — *this commit, after writing this file*

---

## Next move

**Step 5 of "First-day moves" in the kickoff brief:** Drizzle schema for `cities` and `events`, generate and apply the first migration. Plan in two commits:

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
- `src/schema/events.ts` (with all indexes from the brief)
- `src/schema/index.ts` (re-export barrel)
- Generated migration `migrations/0000_initial_schema.sql`, manually augmented to:
  - Prepend `CREATE EXTENSION IF NOT EXISTS postgis;`
  - Add the BRIN index on `start_at` (Drizzle Kit doesn't generate non-btree types — added by hand)
  - Add the GiST index on `location`
  - Add the partial composite indexes (`(city_id, state, start_at) WHERE state = 'active'`, `(city_id, category) WHERE state = 'active'`)
  - Append the Lima seed `INSERT`
- One-line per non-btree index: forward-reference its future ADR (ADR-001 BRIN, ADR-002 GiST)
- Apply via `pnpm -F db migrate` against the running local DB; verify with `psql \d events` and `\di`

**After step 5:** stub scraper emitting 3 hardcoded fake events (step 6 in the brief), then wire `node-cron` (step 7), then real scrape replaces the fakes.

---

## Decisions made since the brief that aren't yet captured in ADRs

These are deliberate choices made during kickoff that diverge from or refine the brief. They should eventually be captured in code, ADRs, or `ARCHITECTURE.md`. Until then, this file is their record.

- **Internal scope name `@disruption-intelligence/*`** instead of `@lima/*`. Rationale: align internal identifiers with the long-term company name. Repo name and root `package.json` name stay Lima-anchored (those are externally-facing product names; internal identifiers track the company).
- **Local dev DB named `disruption_intelligence`** (not `lima_dev`). Same rationale — internal identifiers track the company.
- **Local Postgres image: `imresamu/postgis:16-3.5`** instead of official `postgis/postgis:16-3.5`. Rationale: official image lacks arm64 builds; `imresamu/postgis` is a multi-arch mirror by long-time PostGIS contributor Imre Samu, mirroring upstream tags 1:1. Local-dev only; Fly Postgres in production runs amd64 anyway.
- **pnpm pinned to 10.33.2 with SHA-512 integrity hash** in `packageManager`. Defends against registry compromise and future stricter Corepack versions.
- **Node 24 LTS** (not 22). Active LTS as of Oct 2025; 22 is now Maintenance.
- **Fly region: `scl` (Santiago)**. Closest Fly region to Lima.
- **Postgres-js (`postgres` package) over `pg`** for the Drizzle binding. Drizzle's primary recommendation since 0.30; faster, simpler API. *Pending — applied in Commit A above.*
- **Git committer identity:** `Kenji Kina <679022+Kenji-K@users.noreply.github.com>` (GitHub noreply form). Set globally to keep the user's real address out of the public git log if/when the repo opens up.

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
2. Refresh **Current state** (commit list, what's running)
3. Rewrite **Next move** to reflect the new pickup point
4. Add to **Decisions made since the brief** if any non-obvious choice was made

Don't update for trivial commits (formatting, comment fixes). Do update when a milestone advances or a non-obvious decision is recorded. Keep the file under ~250 lines; if it grows past that, sweep settled decisions into ADRs and stale "open questions" out.
