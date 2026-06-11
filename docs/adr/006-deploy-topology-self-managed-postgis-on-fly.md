# ADR-006: Deploy topology — self-managed PostGIS image on Fly, single-machine API, `release_command` migrations

## Status

Accepted — 2026-06-11. Amends [ADR-004](004-co-locating-api-and-db-on-fly-private-network.md): the co-location decision (both apps on Fly, region `scl`, private network, no public DB IP) stands in full; this ADR supersedes ADR-004's three implementation specifics that did not survive contact with Fly's 2026 product lineup — the Postgres flavor ("Fly Postgres cluster"), the internal hostname (`.flycast`), and the migration path ("from CI or a developer machine via `fly proxy`").

## Context

ADR-004 chose *where* the API and database live (same Fly org, same region, private network). This ADR settles *what actually runs there*, under three constraints that ADR-004 left open or assumed away:

**1. PostGIS is non-negotiable, and Fly's Postgres lineup splits on it (verified 2026-06-11).**

- **Fly Managed Postgres (MPG)** — Fly's current first-line offering — supports PostGIS as a provision-time checkbox. But it is available in only 12 regions, **`scl` (Santiago) is not one of them**, and the cheapest plan is **$38/mo + storage**. Choosing MPG means either abandoning Lima-adjacent latency (nearest MPG region is São Paulo) or abandoning co-location — and paying roughly 10× the alternative for a dataset that is entirely reconstructible (scraped events + seeded reference data; losing the DB costs a re-ingest, not customer data).
- **Unmanaged Fly Postgres (`fly postgres create`, the `postgres-flex` image)** — what ADR-004 called "Fly's managed orchestration of self-managed PG" — ships a stock image **without PostGIS**. Fly's docs now mark the whole unmanaged product as available-but-unsupported ("we are not able to provide support or guidance for unmanaged Postgres"). PostGIS requires forking `fly-apps/postgres-flex`, baking PostGIS into a custom image, and passing `--image-ref` — at which point we own image maintenance *and* run repmgr/HA machinery that a single-node v1 never exercises, on a product line Fly has explicitly stopped supporting.
- **A plain Fly Machines app running the official `postgis/postgis:16-3.5` image** — Postgres as just another app with a volume. Exactly the engine+extension combination local dev runs (`imresamu/postgis:16-3.5` is the arm64 mirror of this same upstream), available in any Fly region including `scl`, no fork to maintain, ~$3/mo for a small shared-CPU machine plus $0.15/GB/mo volume.

**2. In-process cron constrains the API machine count.** The ingest scheduler is `node-cron` inside the API process (locked stack decision; no BullMQ/Redis). That topology has two failure modes on Fly's defaults: with `auto_stop_machines` on, a stopped machine's cron never fires — the 06:00 ingest silently doesn't happen; with Fly's default HA pair (2 machines), every tick fires twice — idempotent upserts prevent duplicates, but the scrape volume against politeness-constrained sources doubles for nothing.

**3. Migrations must run from the production image, and the dev migration tools aren't in it.** Local migrations run via `drizzle-kit migrate` and seeding via `tsx` — both devDependencies. The production image installs prod deps only. ADR-004's plan (run migrations from a developer machine through `fly proxy`) makes deploys depend on a laptop being present and correctly configured — the wrong shape for a release step that must precede every code rollout.

## Decision

**Postgres: a plain Fly Machines app running the official `postgis/postgis:16-3.5` image.** Single machine, region `scl`, one Fly volume (`PGDATA` pointed at a subdirectory to coexist with `lost+found`), credentials via Fly secrets. No `fly postgres` tooling, no repmgr, no HA — one Postgres, one volume, the same engine/extension pair as local dev.

**Network: 6PN via `<db-app>.internal`, and the DB app defines no services at all.** ADR-004 named `.flycast`, which routes through Fly's proxy and exists to serve apps with `[services]` defined. The DB app deliberately has none — `.internal` is direct machine-to-machine DNS on the private mesh, no proxy hop, and an empty services block means there is no path to the database except 6PN. The API connects to `postgres://…@<db-app>.internal:5432/…` from a `DATABASE_URL` secret, exactly as ADR-004 specified.

**API: exactly one machine, autostop off.** `fly deploy --ha=false`, `auto_stop_machines = 'off'`, `min_machines_running = 1`. This is the direct consequence of in-process cron (constraint 2): the scheduler must always be running, and must be running exactly once. Public HTTPS ingress on shared IPs; Fastify stays on internal port 3000.

**Runtime: `tsx` becomes a production dependency; no build step.** The image is `node:24-slim` + pnpm (via corepack, already pinned in `packageManager`) + a prod-only filtered install (`pnpm install --prod --filter @disruption-intelligence/api...`) + raw TS source. This keeps ARCHITECTURE.md's "no build step on internal workspace packages" decision intact — its own text names "running it via `tsx` in the container" as a sanctioned path. `tsx` moves from devDependencies to dependencies in `apps/api` and `packages/db` (each package that executes TS at production runtime declares its own runner).

**Migrations + seed: a programmatic runner chained through Fly's `release_command`.** A new `packages/db/src/migrate.ts` calls drizzle-orm's own `migrate()` (`drizzle-orm/postgres-js/migrator` — runtime dependency, already in the prod tree) over the committed `packages/db/migrations/` folder, then runs the existing idempotent `seed()`. A thin CLI (`migrate-cli.ts`) wraps both; `release_command` runs it via `tsx` before each deploy gets promoted. `drizzle-kit` stays a devDependency: it generates migrations at development time; it is not needed to *apply* them. This supersedes ADR-004's `fly proxy` migration path — migrations now run inside Fly, from the release image, against the 6PN hostname, on every deploy, with no laptop in the loop. ARCHITECTURE.md's "Migration vs seed split" already anticipated exactly this chaining.

## Consequences

**Positive**

- **PostGIS parity with local dev.** Same Postgres major (16), same PostGIS minor (3.5), same upstream image lineage. The migration's `CREATE EXTENSION IF NOT EXISTS postgis` behaves identically in both environments.
- **Co-location survives.** ADR-004's actual decision — sub-millisecond API→DB round-trips in `scl`, no public DB exposure — is preserved; MPG would have forced a region or topology retreat.
- **~$7/mo total** (two small shared-CPU machines + a 1GB volume) vs. $38/mo+ for MPG's smallest plan. For a pre-revenue v1 whose data is reconstructible, the managed-service premium buys recovery guarantees the project doesn't yet need.
- **Migrations are a deploy-pipeline fact, not a runbook step.** Every `fly deploy` applies pending migrations and re-runs the idempotent seed before new code serves traffic; a failed release command aborts the deploy and the old code keeps running.
- **Cron correctness by construction.** One always-on machine means the 06:00 tick fires exactly once. No distributed-lock machinery needed.

**Negative — real, and accepted**

- **We are the DBA, even more than ADR-004 admitted.** No `fly pg` helpers (`attach`/`connect`/built-in health checks), no managed failover, no support path. Mitigations sized to the stakes: Fly's automatic daily volume snapshots (5-day retention) as the backup floor, the dataset's reconstructibility as the real recovery story, and ADR-004's "restore drill at v0+1" commitment carries forward unchanged.
- **Single point of failure twice over.** One API machine (a crash interrupts cron until Fly restarts it — acceptable for a daily tick), one DB machine. Same single-region stance ADR-004 already accepted; the machine count just makes it explicit.
- **Postgres major upgrades are manual** (`pg_dump`/restore to a new volume, or in-place `pg_upgrade` by hand). At this dataset size, dump/restore is minutes — and re-ingest is the fallback.
- **Deploy-window overlap.** A rolling deploy of the API briefly runs old and new machines side by side; a cron tick landing inside that window could double-fire. The 06:00 América/Lima tick vs. deploys initiated by a developer is a coincidence we accept rather than engineer around (idempotent upserts make the cost a few redundant fetches, with politeness delays intact per scraper).

**Operational specifics**

- DB app: `postgis/postgis:16-3.5`, volume mounted at `/data` with `PGDATA=/data/pgdata`, `POSTGRES_PASSWORD` via Fly secret, DB/user names per the `disruption_intelligence` internal-naming convention. An exec health check on `pg_isready`.
- API app: `[deploy] release_command` → migrate+seed; `[http_service]` with `force_https`, `auto_stop_machines = 'off'`, `min_machines_running = 1`; deployed `--ha=false`.
- Postgres listens on `*` (the official image's default), which includes the 6PN IPv6 interface; the image's default `pg_hba` `host all all all scram-sha-256` rule covers IPv6 peers. No image customization required.

## When this would be revisited

- **MPG arrives in `scl` at a defensible price** — the managed-vs-self-managed trade re-runs with co-location no longer forfeit. The migration is a `pg_dump | pg_restore` plus a `DATABASE_URL` secret rotation.
- **The data stops being reconstructible** — the first customer-entered or otherwise unscrapeable row flips the backup calculus from "snapshots + re-ingest" to "verified restores, possibly managed PG." This is the sharpest trigger; watch for it when Ord. 1680 manual-import data (Tier 2) lands.
- **Cron outgrows the single machine** — if ingest cadence or source count makes the in-process scheduler contend with API traffic, the standing answer remains the deferred BullMQ/Redis decision (ARCHITECTURE.md), not a second cron machine.
- **Fly retires plain-Machines Postgres patterns or the volume snapshot default changes** — re-verify the backup floor.

## Alternatives considered

**Fly Managed Postgres.** Rejected for v1 on the region × cost intersection: PostGIS support is real and the operational story (backups, failover, support) is strictly better, but `scl` is unavailable — breaking ADR-004's co-location in the region closest to the user base — and the $38/mo floor is 10× the chosen topology for a reconstructible dataset. First candidate to revisit; see above.

**Forked `postgres-flex` with PostGIS (`fly pg create --image-ref …`).** Rejected: custom image maintenance (rebuild on every upstream Postgres/PostGIS patch) for a product line Fly has stopped supporting, carrying HA/repmgr machinery a single node never uses. The `fly pg` CLI conveniences don't outweigh owning a fork.

**Bundle the API with esbuild instead of shipping `tsx`.** Rejected for v1: it reopens the no-build-step decision ARCHITECTURE.md deliberately deferred, adds a bundler config with known sharp edges (pino worker-thread transports, dynamic imports) and saves only image size and cold-start milliseconds that don't matter at one always-on machine. The trigger list in ARCHITECTURE.md's "No build step" entry already covers when to flip.

**`node --experimental-strip-types` instead of `tsx`.** Rejected: the codebase uses extensionless relative imports under `moduleResolution: Bundler`; Node's native type-stripping does no path resolution and would require extension rewrites across every workspace file. `tsx` matches the dev runtime exactly.

**Run migrations from CI / developer machine via `fly proxy` (ADR-004's original plan).** Rejected: couples schema state to an out-of-band manual step, breaks the "deploy = code + schema move together" invariant that `release_command` gives for free, and leaves the deploy green-lit even when migrations were never run.
