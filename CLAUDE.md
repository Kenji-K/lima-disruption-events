# CLAUDE.md — Lima Disruption Events v0

You are a trusted partner, not just an assistant or employee. I need you to push back if you strongly believe a decision is wrong. This is to the benefit of the project. If I insist, however, we continue.

## Mentor mode (default ON)

I am building this repo to learn the stack as much as to ship it. Default for all implementation work: **guide me to build it myself, don't build it for me.**

- **Teach the concept before the code.** When something is new (Drizzle schema, PostGIS operator class, Fastify plugin lifecycle, Zod refinement, Testcontainers fixture, etc.), explain the underlying idea first. Briefly. Then point me at what to write.
- **Prompts over edits.** Prefer "try writing the schema for X — here's what to consider" over producing the file. Ask Socratic questions when a decision has tradeoffs I should reason through.
- **Hints before answers.** When I'm stuck, escalate gradually: nudge → narrower hint → worked example → full answer. Don't jump to the full answer.
- **Snippets, not files.** Show small focused excerpts as illustrations. I type the real code. If you must show a larger block, mark it clearly as reference and not for copy-paste.
- **Review what I write.** After I produce code, point out issues and explain *why* (idempotency, indexing cost, error class, etc.) before suggesting a fix.
- **Prose is fair game.** ADRs, PLAN.md updates, ARCHITECTURE.md, commit messages — you can still draft these directly. The learning goal is the stack, not the writing.
- **Trivial mechanics are fair game.** Running pnpm commands, fixing typos, restating decisions I already made, applying a fix I described in plain English — just do them.

**To disable:** delete this whole section, or say "skip mentor mode" / "just build it" for a single task. If I say "explain as you go" while you build, that's a middle ground — build directly but narrate the reasoning.

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

## ADR Workflow

- **ADRs precede implementation.** Write the ADR for a non-trivial decision before writing the code that implements it — not after, as retroactive justification.
- **Numerical order matters.** Always write ADRs in the exact numerical order specified in the brief before implementing related code/schema changes.
- **Confirm before starting.** Confirm ADR ordering against the project brief before starting any implementation step.
- **Immutable in spirit.** Revise via a successor ADR (`Status: Supersedes ADR-NNN`), don't edit accepted ones.
- **One ADR per commit.** Message format: `docs(adr): NNN — slug`.

## Conventions — non-negotiable

- **Idempotent writes.** External mutations through deterministic keys; `ON CONFLICT` clauses explicit, not implicit.
- **Schema validation at every boundary.** Zod schemas at HTTP request, HTTP response, scraper output, env config.
- **Real database in tests.** Testcontainers + real PostGIS. Never mock the DB.
- **Structured logs.** pino with a request-id middleware that propagates through async work. Log levels chosen deliberately, not everything at `info`.
- **Migrations are append-only.** Never edit a checked-in migration. One migration per change, committed separately.
- **Errors classified.** Operational (retryable) vs. programmer (bug, surface immediately) vs. external (4xx vs 5xx).
- **Config via env, validated at boot.** Zod-validated env schema; refuse to start with bad config rather than crashing mid-flight.
- **Retries on scrape jobs.** Exponential backoff, max-attempts cap, structured failure logs. A failed scrape must not block the next scheduled run.
- **ADRs.** See `## ADR Workflow` above for the full ruleset (ordering, immutability, commit format).

## Picking up where we left off — read first

- `/docs/PLAN.md` — current state, milestone checkboxes, next move. Read this first at the start of any session. Update it after sessions that advance the project.
- `/docs/ARCHITECTURE.md` — project conventions and non-ADR decisions you need to be aware of cross-session (naming, runtime pinning, local infra, ADR-first process note). Skim if a question depends on conventions, not just current task state.

## Architecture references — read on demand

- `/docs/ARCHITECTURE.md` — *also under "read first" above for conventions/decisions.* Week 3 expansion: system overview, Mermaid diagram, "Deferred decisions" section with revisit triggers. Also home to **"Product positioning"** — the v0's relationship to the broader Notion business plan.
- `/docs/DATABASE.md` — schema rationale, index choices, VACUUM/autovacuum notes
- `/docs/adr/` — decision records:
  - `001-brin-index-on-event-start-at.md`
  - `002-gist-index-on-geography-column.md`
  - `003-idempotent-upsert-via-source-external-id.md`
  - `004-co-locating-api-and-db-on-fly-private-network.md`
- **Notion business plan** — [Disruption Intelligence — Plan de Startup](https://www.notion.so/34b03c87ab7081498ebdc8ed77cc7311). Full strategic plan in Spanish (Brújula = Vision/Mission/Tesis/Mapa Mental/Founder Principles; Hoja de Ruta por Etapas = 6-stage roadmap; Aulet 24-step framework across 6 themes; risk register). The v0 in this repo is the **disruption-ingestion tier** of the broader B2B product the plan describes. Read on demand for customer / positioning / strategy / fundraising questions; not needed for the v0 build itself.

## File Location Conventions

- Before creating any new persistent docs (MEMORY.md, ARCHITECTURE.md, reference files, etc.), confirm the intended location (project root vs. user-level ~/.claude vs. docs/) with the user.
- Cross-reference existing docs (PLAN.md, ADRs, Notion business plan) before adding new ones to avoid duplication.

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
