# CLAUDE.md — Lima Disruption Events v0

## Project
Backend + React frontend that ingests upcoming disruption events for Lima (concerts, road closures, sporting events) from public sources, indexes them by time and geography, and renders them on a map and filterable list. v0 of a system called Disruption Intelligence. Solo developer. Treat as production-quality code, not throwaway demo. Repo is private at start; no customer names or business-sensitive specifics in code or commits.

## Stack
- TypeScript everywhere; pnpm workspaces (`apps/api`, `apps/web`, `packages/db`, `packages/shared`)
- Backend: Fastify + Drizzle ORM + PostgreSQL 16 + PostGIS
- Job scheduling: `node-cron` in-process inside the API. **No BullMQ, no Redis** — see `/docs/adr/` and ARCHITECTURE.md "Deferred decisions".
- Frontend: Vite + React + Tailwind + MapLibre GL + TanStack Query + react-router
- Tests: Vitest + Testcontainers (real Postgres, no DB mocks)
- Validation: Zod at every network boundary (HTTP req/res, scraper output, env config)
- Logging: pino with request IDs
- Errors: Sentry on both API and web
- Hosting: API + Postgres co-located on Fly.io (private `6PN` network, single region); frontend on Vercel.

## Commands
```bash
pnpm install                 # install all workspaces
docker compose up -d         # start local Postgres + PostGIS
pnpm -F api dev              # run API in watch mode
pnpm -F web dev              # run frontend in watch mode
pnpm -F api ingest           # run scrapers once on demand
pnpm -F db generate          # generate Drizzle migration from schema diff
pnpm -F db migrate           # apply migrations to local DB
pnpm test                    # run all tests (including Testcontainers integration tests)
```

## Conventions — non-negotiable
- **Idempotent writes.** External mutations through deterministic keys; `ON CONFLICT` clauses explicit, not implicit.
- **Schema validation at every boundary.** Zod schemas at HTTP request, HTTP response, scraper output, env config.
- **Real database in tests.** Testcontainers + real PostGIS. Never mock the DB.
- **Structured logs.** pino with a request-id middleware that propagates through async work. Log levels chosen deliberately, not everything at `info`.
- **Migrations are append-only.** Never edit a checked-in migration. One migration per change, committed separately.
- **Errors classified.** Operational (retryable) vs. programmer (bug, surface immediately) vs. external (4xx vs 5xx).
- **Config via env, validated at boot.** Zod-validated env schema; refuse to start with bad config rather than crashing mid-flight.
- **Retries on scrape jobs.** Exponential backoff, max-attempts cap, structured failure logs. A failed scrape must not block the next scheduled run.

## Architecture references — read on demand
- `/docs/ARCHITECTURE.md` — system overview, Mermaid diagram, "Deferred decisions" section
- `/docs/DATABASE.md` — schema rationale, index choices, VACUUM/autovacuum notes
- `/docs/adr/` — decision records:
  - `001-brin-index-on-event-start-at.md`
  - `002-gist-index-on-geography-column.md`
  - `003-idempotent-upsert-via-source-external-id.md`
  - `004-co-locating-api-and-db-on-fly-private-network.md`

## Out of scope for v0 — do not build
Authentication, user accounts, multi-tenant, predictive impact modeling, route-impact analysis, anomaly detection, SLA alerts, email digests, customer-facing briefs, admin UI, payments, multiple cities, ML/LLM features. If any of these start feeling necessary, surface to the user before writing code.

## Ask the user before
- Deviating from the locked stack
- Adding any feature in the "out of scope" list
- Skipping or postponing one of the four ADRs
- Pushing the deploy past week 3
- Picking a third data source
- Editing a checked-in migration

## Session hygiene
Use `/clear` between major task units (backend → frontend, finishing a feature, starting a new ADR). Keep this file under ~150 lines; if it grows, that's a signal something belongs in ARCHITECTURE.md or an ADR instead.
