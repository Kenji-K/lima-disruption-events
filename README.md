# lima-disruption-events

Lima disruption-events platform — concerts, football matches, road closures, and recurring city events ingested from public sources, indexed by time and geography, served over an HTTP API and a map UI.

**Live:**

- Web (map + list): <https://lima-disruption-events.vercel.app>
- API: <https://disruption-intelligence-api.fly.dev> — [`/events`](https://disruption-intelligence-api.fly.dev/events), [`/healthz`](https://disruption-intelligence-api.fly.dev/healthz), OpenAPI UI at [`/docs`](https://disruption-intelligence-api.fly.dev/docs)

This is the ingestion tier of a B2B mobility-intelligence product for fleet operators ("Waze le habla a los conductores; nosotros le hablamos a los operadores"), not a consumer map app — see `docs/ARCHITECTURE.md` for the positioning notes.

## Stack

TypeScript end to end. pnpm workspaces: `apps/api` (Fastify 5 + Drizzle + node-cron ingest), `apps/web` (Vite + React + MapLibre GL + TanStack Query), `packages/db` (Drizzle schema + migrations), `packages/shared` (Zod boundary schemas). PostgreSQL 16 + PostGIS. Tests with Vitest + Testcontainers (real Postgres, no mocks). Sentry on both apps.

**Data sources (11 live):** Gran Teatro Nacional, futbolperuano.com (Liga 1 home matches), Municipalidad de Lima WordPress feed, Lima Expresa pressroom, hardcoded recurring events (races, Fiestas Patrias parade), gob.pe institutional news (ATU, SUTRAN, MTC, munilima — cross-channel dedup per ADR-009), Joinnus ticketer (Lima concerts/sports), Costa 21 venue calendar. Plus the **SUTRAN road-alert layer** (ADR-010): a 2-hourly snapshot mirror of the national road-state viewer, served at `/road-alerts` and rendered as a toggleable map layer. Per-source incremental cursors and freshness tracking live in the `ingest_state` table (ADR-007), exposed at `GET /sources`.

## Local development

```bash
pnpm install
docker compose up -d                                  # Postgres 16 + PostGIS 3.5 on :5432
cp .env.example .env
pnpm -F @disruption-intelligence/db migrate           # apply migrations
pnpm -F @disruption-intelligence/db seed              # idempotent reference data
pnpm -F api dev                                       # Fastify on :3000 (cron attached)
pnpm -F web dev                                       # Vite on :5173
pnpm -F api ingest                                    # run all scrapers once
pnpm -F api import-events <file.json|file.csv>        # manual import (Ord. 1680 path)
pnpm test                                             # full suite (Testcontainers)
pnpm typecheck && pnpm lint
```

## Production topology

Decided in ADR-004/006/008 (`docs/adr/`): two Fly.io apps in region `gru` (São Paulo — the only South American Fly region since `scl` was retired), talking over Fly's private 6PN network; frontend on Vercel.

| Piece              | Where                                   | Notes                                                                                                                                         |
| ------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| API                | Fly app `disruption-intelligence-api`   | one always-on machine (in-process cron must tick exactly once); runs raw TS via tsx                                                           |
| Postgres + PostGIS | Fly app `disruption-intelligence-db`    | official `postgis/postgis:16-3.5` image, 1GB volume, **no public IP** — only reachable over 6PN at `disruption-intelligence-db.internal:5432` |
| Web                | Vercel project `lima-disruption-events` | static Vite build, SPA rewrites via `apps/web/vercel.json`                                                                                    |
| Migrations + seed  | Fly `release_command`                   | programmatic drizzle-orm migrator (`packages/db/src/release-cli.ts`) runs before every deploy is promoted                                     |

### Deploying

```bash
# API (builds apps/api/Dockerfile, runs migrate+seed release step, promotes):
fly deploy --ha=false

# DB app (image-only; rarely needed after first deploy):
fly deploy -c fly.db.toml --ha=false

# Web (local build against linked Vercel project, then upload output):
cd apps/web
npx vercel pull --yes --environment production   # refresh env + settings
npx vercel build --prod --yes
npx vercel deploy --prebuilt --prod --yes
```

The web build needs the monorepo, so it builds **locally** (`vercel build`) and ships the output — a plain `vercel deploy` from the cloud fails on `workspace:*` deps.

### Secrets and env

- API (Fly secrets): `DATABASE_URL` (6PN connection string), `SENTRY_DSN`. Set with `fly secrets set KEY=value -a disruption-intelligence-api`.
- DB (Fly secrets): `POSTGRES_PASSWORD`. Fly secrets are write-only — if the password is lost, rotate it: set a new value on the DB app **and** update the API's `DATABASE_URL` to match, then restart both.
- Web (Vercel env, production): `VITE_API_URL`, `VITE_SENTRY_DSN` — **must** be added `--no-sensitive` (`npx vercel env add NAME production --no-sensitive --value '…'`); sensitive values can't be pulled into the local `vercel build`, and they're baked into public JS anyway.
- **Demoing gated sources (futbolperuano, Joinnus) on the prod app uses the timed flip, never the bare boolean.** Just before the meeting, set the gate to lift until ~the meeting's end; it relatches **by itself** at that instant — no second deploy, nothing to remember afterwards:

  ```bash
  fly secrets set EXPOSE_GATED_SOURCES_UNTIL=2026-06-15T16:00:00-05:00 -a disruption-intelligence-api
  fly secrets unset EXPOSE_GATED_SOURCES_UNTIL -a disruption-intelligence-api   # whenever convenient; a past instant is inert
  ```

  While the window is open the gated data is visible to anyone hitting the public URL, not just the demo audience — keep the window tight. `EXPOSE_GATED_SOURCES=true` (no expiry) is for localhost demos only: `EXPOSE_GATED_SOURCES=true pnpm -F api dev`.

### Operating the prod API

```bash
fly logs -a disruption-intelligence-api                  # live logs (pino JSON)
fly ssh console -a disruption-intelligence-api \
  -C "/app/apps/api/node_modules/.bin/tsx /app/apps/api/src/ingest/index.ts"   # manual ingest run
```

The daily ingest cron fires at 06:00 América/Lima inside the API process. Per-source freshness: `SELECT source_id, last_success_at, consecutive_failures FROM ingest_state;`.

### Accessing the prod DB from a laptop

The DB has no public address; `fly proxy` tunnels your authenticated laptop onto the private network:

```bash
fly proxy 15432:5432 -a disruption-intelligence-db   # leave running; binds localhost:15432
```

Then, in another terminal, connect with any Postgres client using the `POSTGRES_PASSWORD` secret value:

```bash
psql "postgres://disruption_intelligence:<password>@localhost:15432/disruption_intelligence"

# no local psql? use the dev container's client:
docker exec -it lima-disruption-events-postgres-1 \
  psql "postgres://disruption_intelligence:<password>@host.docker.internal:15432/disruption_intelligence"
```

GUI clients (TablePlus, DBeaver, …) work the same way: host `localhost`, port `15432`, while the proxy is running.

## Docs

- `docs/PLAN.md` — current state + next move (single source of truth)
- `docs/V1-BRIEF.md` — the v1 sprint scope
- `docs/ARCHITECTURE.md` — cross-session conventions
- `docs/adr/` — decision records (001–008)
