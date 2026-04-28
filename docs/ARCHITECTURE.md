# ARCHITECTURE — Lima Disruption Events v0

System-level conventions and decisions for Disruption Intelligence v0. This file is the home for project-wide choices that need to persist between sessions but don't warrant the formal weight of an ADR. For per-decision detail with full Status / Context / Decision / Consequences / Alternatives, see [`docs/adr/`](adr/).

This document is intentionally **early/seed** at this stage. The Week 3 milestone in [`docs/PLAN.md`](PLAN.md) expands it with:

- A Mermaid system overview diagram
- A "Deferred decisions" section enumerating things explicitly punted on (BullMQ/Redis, multi-region, read replicas, etc.) with revisit triggers

Until then, the sections below are the canonical record of project conventions previously held in PLAN.md.

---

## Conventions and decisions not in ADRs

### Naming — internal identifiers vs. external product names

Internal scope, package, database, file, and code identifiers use `disruption_intelligence` (the long-term company name). Externally-facing product names — repo name, root `package.json` name, the eventual product surface — stay Lima-anchored, since the v0 product *is* Lima-specific even if the platform behind it isn't.

Concrete instances:
- pnpm workspace scope: `@disruption-intelligence/*`
- Local dev database: name / user / password all `disruption_intelligence`
- Repo: `lima-disruption-events` (externally visible)

### Local dev Postgres image: `imresamu/postgis:16-3.5`

`docker-compose.yml` pulls `imresamu/postgis:16-3.5` rather than the official `postgis/postgis:16-3.5`. Reason: the official image has no arm64 build; `imresamu/postgis` is a multi-arch mirror maintained by long-time PostGIS contributor Imre Samu, mirroring upstream tags 1:1. Local-dev only — Fly Postgres in production runs amd64 on Fly's infrastructure (see [ADR-004](adr/004-co-locating-api-and-db-on-fly-private-network.md)).

### Runtime and package-manager pinning

- **Node 24 LTS.** Active LTS; Node 22 dropped to Maintenance status in Oct 2025. Pinned via `.nvmrc` and `engines`. fnm in the dev environment auto-switches on `cd`.
- **pnpm 10.33.2**, pinned in `packageManager` with a SHA-512 integrity hash. Defends against registry compromise and against future Corepack versions that refuse unhashed pins.

### Drizzle Postgres binding: `postgres` (postgres-js) over `pg`

`packages/db` uses the `postgres` package (postgres-js driver) for the Drizzle binding, not the older `pg` package. Drizzle's primary recommendation since 0.30 — faster, simpler API, no callback-style holdover.

### Git committer identity

Local git commits use `Kenji Kina <679022+Kenji-K@users.noreply.github.com>` (GitHub's noreply form), not the user's real email. Keeps the user's address out of the public git log if/when the repo opens up.

### Process: ADR-first ordering

ADRs are written *before* the code that implements them, not after. The original brief scheduled ADRs 001/002/004 in Weeks 2-3, after the corresponding code; they were instead landed in Week 1, before the schema migration. Rationale: ADRs written upfront are decisions the implementation defends; ADRs written after the fact are retroactive justification, which weakens the senior-signal value of the artifact. The brief's framing of ADR-003 — *"doing it early forces the data model to be honest"* — generalizes to all data-model and topology ADRs.

If implementation surfaces a wrinkle the ADR didn't anticipate, the standard remedy is a successor ADR with `Status: Supersedes ADR-NNN` rather than editing the accepted ADR in place. (This is also stated as a non-negotiable convention in [`CLAUDE.md`](../CLAUDE.md).)
