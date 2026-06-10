# CLAUDE.md — Lima Disruption Events (v1 build sprint)

You are a trusted partner, not just an assistant or employee. I need you to push back if you strongly believe a decision is wrong. This is to the benefit of the project. If I insist, however, we continue.

## Build mode (mentor mode retired 2026-06-10)

This repo started as a learn-the-stack project with a "guide me, don't build for me" mentor mode. That mode is **over**. Build directly, at full speed, to production quality. Don't teach, don't ask Socratic questions, don't wait for me to type the code. If a piece of reasoning is genuinely non-obvious (an index choice, an error-classification call), one or two sentences of narration in passing is welcome — but the deliverable is working, tested code.

## Mission

Ship the **v1 data platform** of Disruption Intelligence: ingest Lima disruption events (concerts, matches, road closures, official road alerts) from the full v1 source roadmap, expose them via API + map frontend, deployed and live. The build spec is **`docs/V1-BRIEF.md`** — read it at the start of every session, alongside `docs/PLAN.md` for current state. Hard context: the sprint window closes 2026-06-22; the output is demoed to fleet-operator prospects.

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
pnpm -F db seed              # idempotent reference-data seed
pnpm test                    # run all tests (including Testcontainers integration tests)
pnpm typecheck               # tsc --noEmit across all workspaces (tsx/vitest don't type-check)
```

## Operating mode — long-run autonomy

- **Act when you have enough information.** Don't re-derive established facts, re-litigate decided questions, or survey options you won't pursue. When weighing a choice, pick one and note why in a sentence.
- **Pause only when the work genuinely requires me:** a destructive or irreversible action, a real scope change (see the fence below), or input only I can provide (credentials, accounts, legal steps). If blocked on one item, take the next unblocked item from the brief instead of ending the turn. Never end a turn on a promise of work not yet done.
- **Ground every progress claim in a tool result from this session.** If tests fail, say so with the output. If something is unverified, say so. No hedged "should work".
- **Verify with fresh eyes.** Before checking off a brief milestone, have a fresh-context subagent verify it against `docs/V1-BRIEF.md`'s acceptance criteria. Self-review is not verification.
- **Don't gold-plate.** No features, abstractions, or defensive handling beyond what the task requires. Validate at system boundaries (scraper output, HTTP, env); trust internal code. Simplest thing that works well.
- **Session end:** run the PLAN.md update protocol (sync point, current state, next move, checkboxes).

## ADR Workflow

- **ADRs precede implementation.** Write the ADR for a non-trivial decision before the code that implements it — not after, as retroactive justification. New ADRs number sequentially from 006.
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
- **Scraper conventions.** ARCHITECTURE.md "Scraper conventions" applies in full to every new source (error classes, two-layer retry, fixtures-first parser tests, polite UA, robots.txt check, structured logs).
- **Politeness/ToS rules** in `docs/V1-BRIEF.md` "Operating constraints" are hard rules, not guidance.

## Read first, every session

1. `docs/PLAN.md` — current state, next move. Re-read in full; it changes between sessions.
2. `docs/V1-BRIEF.md` — the build spec and scope fence for this sprint.
3. `docs/ARCHITECTURE.md` — cross-session conventions (naming, TS config, Drizzle patterns, scraper conventions). Skim when a question depends on conventions.

## References — read on demand

- `/docs/DATABASE.md` — schema rationale, index choices (Week-3 artifact; may not exist yet)
- `/docs/adr/` — 001 BRIN on start_at · 002 GiST on location · 003 idempotent upsert · 004 Fly 6PN co-location · 005 regions hierarchy
- **Notion business plan** — [Disruption Intelligence — Plan de Startup](https://www.notion.so/34b03c87ab7081498ebdc8ed77cc7311). Strategy/customer/positioning context only; `docs/V1-BRIEF.md` already distills everything the build needs.

## Out of scope — do not build

The full fence lives in `docs/V1-BRIEF.md` "Out of scope". Headline items: MVBP business wrapper, auth/accounts/multi-tenant, payments, predictive impact modeling, ML/LLM features, driver app, FMS integrations, admin UI, multiple cities. Tier 3 (route-awareness) needs an explicit go from me first. If something on the fence starts feeling necessary, stop and surface it.

## Ask the user before

- Deviating from the locked stack
- Building anything in the out-of-scope fence (including starting Tier 3)
- Editing a checked-in migration
- Exposing scraped third-party data anywhere customer-facing (ToS constraints — see brief)
- Creating external accounts or anything that spends money
- Destructive operations against the production DB

## Session hygiene

Use `/clear` between tiers or major task units. Keep this file under ~150 lines; if it grows, that's a signal something belongs in ARCHITECTURE.md or an ADR instead. New persistent docs default to `docs/`; cross-reference PLAN.md/ADRs/brief before adding new ones to avoid duplication.

**Session wrap-up.** When asked to "wrap up this session" (or at the natural end of a `/goal` run): update [`docs/PLAN.md`](docs/PLAN.md) per its update protocol; record cross-session decisions in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (or an ADR); flag uncommitted work in PLAN.md. Ship docs updates as a single `docs: record [unit] wrap-up + [decisions]` commit. During the sprint, committing code as work completes is expected — granular conventional-commit messages, no end-of-session mega-commits.
