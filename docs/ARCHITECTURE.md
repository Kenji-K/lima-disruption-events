# ARCHITECTURE — Lima Disruption Events v0

System-level conventions and decisions for Disruption Intelligence v0. This file is the home for project-wide choices that need to persist between sessions but don't warrant the formal weight of an ADR. For per-decision detail with full Status / Context / Decision / Consequences / Alternatives, see [`docs/adr/`](adr/).

This document is intentionally **early/seed** at this stage. The Week 3 milestone in [`docs/PLAN.md`](PLAN.md) expands it with:

- A Mermaid system overview diagram
- A "Deferred decisions" section enumerating things explicitly punted on (BullMQ/Redis, multi-region, read replicas, etc.) with revisit triggers

Until then, the sections below are the canonical record of project conventions previously held in PLAN.md.

---

## Conventions and decisions not in ADRs

### Product positioning — what v0 is and is not

The local v0 builds the **disruption-ingestion tier** of a B2B mobility-intelligence product, not the full customer-facing product. The full product (per the Notion business plan; see [`CLAUDE.md`](../CLAUDE.md) "Architecture references" for the link) layers per-customer route overlays, SLA risk flags, anomaly alerts, and a weekly advisory call on top of the calendar this v0 ingests. None of those are in v0 scope.

Implications:

- **README and any public-facing framing** must lead with this scope statement. The v0 looks superficially like a consumer map app; the business is explicitly B2B. Notion plan Tema 2 positioning anchor: *"Waze le habla a los conductores; nosotros le hablamos a los operadores."* Anchor against that, not against the visual shape of the v0.
- **When showing the v0 to a stakeholder**, lead with the scope statement before the live URL — otherwise expectations form around the visible artifact rather than the actual product. Notion plan Tema 5 Step 22 is explicit on this: lock MVBP scope so future feature requests default to v2+.

**Sequence inversion is deliberate.** The v0 runs ahead of "Etapa 0" prerequisites in the Notion plan (SAC registration, 50-prospect list, 10 customer-discovery interviews, Tesis evidence-gathering). Rationale: tech-stack familiarity with Drizzle / Fastify / PostGIS / MapLibre / Testcontainers; full use of the Claude Code subscription; a concrete portfolio artifact for senior-role interviews; a tangible artifact to ground stakeholder conversations in. The trade-off — premature stakeholder anchoring on the wrong product shape — is mitigated by the two framing rules above.

### Naming — internal identifiers vs. external product names

Internal scope, package, database, file, and code identifiers use `disruption_intelligence` (the long-term company name). Externally-facing product names — repo name, root `package.json` name, the eventual product surface — stay Lima-anchored, since the v0 product *is* Lima-specific even if the platform behind it isn't.

Concrete instances:

- pnpm workspace scope: `@disruption-intelligence/*`
- Local dev database: name / user / password all `disruption_intelligence`
- Repo: `lima-disruption-events` (externally visible)

### Customer-facing language: Spanish (es-PE)

All user-visible UI text is in **Peruvian Spanish**: chrome (buttons, filter chips, drawer headings, toolbar labels), data labels surfaced to humans (category names, empty states), date/time formatting (`Intl` with locale `'es-PE'` and `timeZone: 'America/Lima'`), and any eventual marketing/landing copy. The customers are Lima operators; the *interface* must speak their language even though the *codebase* doesn't.

**In scope (Spanish):** UI strings, button labels, placeholders, category labels rendered to users, relative-time suffixes ("en 3d", "hace 2h"), error messages surfaced in the browser.

**Out of scope (English):** code identifiers, type names, file paths, comments, commit messages, log lines (pino), API field names, database column names, ADR text, internal docs (`PLAN.md`, `ARCHITECTURE.md`, `CLAUDE.md`, this file). Internal artifacts stay in English so the engineering surface stays a single dialect.

### Local dev Postgres image: `imresamu/postgis:16-3.5`

`docker-compose.yml` pulls `imresamu/postgis:16-3.5` rather than the official `postgis/postgis:16-3.5`. Reason: the official image has no arm64 build; `imresamu/postgis` is a multi-arch mirror maintained by long-time PostGIS contributor Imre Samu, mirroring upstream tags 1:1. Local-dev only — Fly Postgres in production runs amd64 on Fly's infrastructure (see [ADR-004](adr/004-co-locating-api-and-db-on-fly-private-network.md)).

### Runtime and package-manager pinning

- **Node 24 LTS.** Active LTS; Node 22 dropped to Maintenance status in Oct 2025. Pinned via `.nvmrc` and `engines`. fnm in the dev environment auto-switches on `cd`.
- **pnpm 10.33.2**, pinned in `packageManager` with a SHA-512 integrity hash. Defends against registry compromise and against future Corepack versions that refuse unhashed pins.

### Drizzle Postgres binding: `postgres` (postgres-js) over `pg`

`packages/db` uses the `postgres` package (postgres-js driver) for the Drizzle binding, not the older `pg` package. Drizzle's primary recommendation since 0.30 — faster, simpler API, no callback-style holdover.

### TypeScript configuration

**Base (`tsconfig.base.json`)** carries every flag whose absence would silently produce wrong code: `target: ES2024` (the highest stable target Node 24 supports natively, so no downleveling tax), `strict: true`, plus `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `skipLibCheck`, `esModuleInterop`, `forceConsistentCasingInFileNames`, `isolatedModules`. The split rule: *base = correctness/consistency defaults; leaf config = how-this-package-runs.*

**Leaf configs** add only `module`, `moduleResolution`, `include`, and (where relevant) `noEmit`. Per-package: `module: ESNext` + `moduleResolution: Bundler`, even for packages run under `tsx` rather than a true bundler. Reason: `tsx` is esbuild-based and matches Bundler resolution rules; the alternative (`NodeNext`) would force `.js` extensions on every relative TS import for marginal gain.

Capability flags (`resolveJsonModule`, etc.) get added per-package only when something actually needs them. Cost of leaving them off is a clear error message at first use, not silent miscompilation.

### Drizzle config conventions

`packages/db/drizzle.config.ts` sets, beyond the four required fields:

- `casing: 'snake_case'` — TS identifiers stay camelCase; SQL columns are snake_case automatically. Avoids per-column overrides and matches Postgres's unquoted-identifier folding.
- `verbose: true` + `strict: true` — `generate` prints SQL before writing it; `migrate` prompts before destructive operations.
- `schema: './src/schema/*.ts'` (glob, not a barrel path) — drizzle-kit walks every top-level schema file, eliminating the silent "forgot to re-export" failure mode where a new table file would otherwise go unnoticed at migration-generation time. The barrel `index.ts` retains its separate role as the package's runtime entry point.

Config loads `.env` via Node 24's built-in `process.loadEnvFile()` (no `dotenv` dep) and guards `DATABASE_URL` with an explicit throw so misconfiguration fails fast with a clear message rather than deep inside postgres-js.

### Per-workspace `@types/node` and explicit `compilerOptions.types`

`pnpm` strict isolation does **not** hoist `@types/node` (or any `@types/*` package) into leaf workspaces. Every workspace whose code touches Node globals (`process`, `Buffer`, `fs`, etc.) declares `@types/node` as a direct devDep, and its `tsconfig.json` lists `"types": ["node"]` in `compilerOptions`. The explicit `types` array does two jobs: (1) works around TS 6.0 `@types/*` auto-discovery being unreliable in this monorepo layout (observed silently failing even with the package correctly resolved on disk); (2) prevents transitive `@types/*` deps from quietly injecting globals into packages that shouldn't see them — `apps/web` should not have `process` in scope regardless of what some transitive dep brings in.

When `apps/api` and `apps/web` are scaffolded, repeat the pattern: `apps/api` gets `@types/node` + `"types": ["node"]`; `apps/web` likely gets `"types": ["vite/client"]` (or `[]`) and **no** `@types/node`.

### Schema design rule: don't store time-derivable state

Columns whose value is a function of timestamps and `now()` (e.g., "is this event past?") belong in queries, not the schema. The `events.state` column is **source signal only** — values like `'scheduled'` and `'cancelled'`, set by what the source publishes. Time-based status ("upcoming," "past," "happening now") is derived in queries from `start_at` / `end_at`. Storing time-derived state would require a cron to flip rows, create a race-condition surface around the flip, and risk the schema and the clock disagreeing. Generalises beyond `events`: if a value is `f(timestamps, now())`, it's a view, not a fact.

### Deferred decisions

Decisions explicitly punted on for v0 — listed here so they're not re-litigated. Each entry names the trigger that should prompt revisiting. Week 3 will expand this section with the larger structural deferrals (BullMQ/Redis, multi-region, read replicas).

**PK type for high-volume tables.** v0 uses `serial` integer PKs on both `cities` and `events`. Revisit if any of: (1) a second Postgres instance writes into the same logical schema (multi-region with shared dimensions, not the "different cities, different regions" pattern), (2) a stable customer-visible event identifier needs to be exposed to a third-party system we don't control, (3) the sequence becomes a measured write-rate bottleneck. None are realistic for v0; UUID v7 was considered and rejected on YAGNI grounds. Migration path if a trigger fires: add a `public_id uuid unique` column non-destructively rather than retrofitting the PK type.

### Git committer identity

Local git commits use `Kenji Kina <679022+Kenji-K@users.noreply.github.com>` (GitHub's noreply form), not the user's real email. Keeps the user's address out of the public git log if/when the repo opens up.

### Process: ADR-first ordering

ADRs are written *before* the code that implements them, not after. The original brief scheduled ADRs 001/002/004 in Weeks 2-3, after the corresponding code; they were instead landed in Week 1, before the schema migration. Rationale: ADRs written upfront are decisions the implementation defends; ADRs written after the fact are retroactive justification, which weakens the senior-signal value of the artifact. The brief's framing of ADR-003 — *"doing it early forces the data model to be honest"* — generalizes to all data-model and topology ADRs.

If implementation surfaces a wrinkle the ADR didn't anticipate, the standard remedy is a successor ADR with `Status: Supersedes ADR-NNN` rather than editing the accepted ADR in place. (This is also stated as a non-negotiable convention in [`CLAUDE.md`](../CLAUDE.md).)
