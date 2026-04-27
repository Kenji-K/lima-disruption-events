# ADR-004: Co-locate the API and Postgres on Fly.io's private network (`6PN`)

## Status

Accepted — 2026-04-27.

## Context

The v0 deployment topology has to land two stateful pieces in production: the Fastify API and PostgreSQL 16 + PostGIS. The frontend is a static Vite build served by Vercel; that decision is independent and not in scope here. The question this ADR settles is **where the API and the database live in relation to each other**, and what trust-and-latency boundary connects them.

The two structural shapes available, both of which would otherwise satisfy the v0 requirements:

1. **Same provider, private network.** Both the API and the Postgres instance run on Fly.io machines in the same region (`scl`, Santiago — Fly's closest region to Lima). They communicate over Fly's `6PN` (IPv6 private network), which is a per-organization mesh: no public IP exposure, no cross-internet TLS, latency dominated by intra-datacenter round-trips (sub-millisecond on the same physical host, low single-digit milliseconds across the region).
2. **Cross-provider managed Postgres.** API on Fly (or anywhere); database on Neon / Supabase / Render / AWS RDS over the public internet, terminated by TLS. Latency dominated by cross-provider round-trip distance, typically 5-50ms within the same continent and 50-150ms cross-continent depending on region pairing.

The deciding pressure is not raw latency on a single round-trip — even 50ms is fine for one query. The pressure is **N+1 amplification**: an API request that issues 5 sequential database round-trips pays the per-RTT cost 5 times before responding. In v0, several handlers will issue more than one query (event detail + nearby events; event list + per-event computed fields; health checks that touch the DB). At 50ms cross-provider latency, a 5-query handler adds 250ms of pure network wait to every response; at sub-1ms intra-Fly latency, the same handler adds <5ms. That is the difference between "feels instant" and "feels sluggish on every interaction," and it shows up before any indexing, query-plan, or business-logic optimization can do anything about it.

There is also a non-latency pressure that matters specifically for this project's portfolio shape: the v0 is meant as a senior-signal artifact in addition to a working product. Owning a topology where the API, the database, the secrets store, the volumes, the deploy pipeline, and the private network are all visible end-to-end in one place is more legible — and more interview-rehearsable — than a hybrid where half the operational surface area is hidden behind a managed-service control plane.

## Decision

Deploy the Fastify API and Postgres 16 + PostGIS as separate Fly applications in region `scl`, both bound to the same organization's `6PN` mesh. The API connects to Postgres via the internal `<app-name>.flycast` hostname over IPv6, with no public IP exposed for the database.

Concretely:

- **API app:** Fly Machines, region `scl`, public TCP/443 ingress. Connection string in app secrets, uses the internal hostname.
- **Postgres app:** Fly Postgres cluster (Fly's "managed orchestration of self-managed PG" product), single primary in `scl`, single Fly Volume attached. No public IP.
- **Network:** All API → DB traffic over `6PN`. The Postgres app's only externally reachable path is `fly proxy` from a developer machine (auth-gated, local-only).
- **Secrets:** `DATABASE_URL` injected via `fly secrets set`, validated at boot by the Zod env schema (per `CLAUDE.md` conventions).
- **Region pinning:** Both apps in `scl`. No multi-region read replicas at v0; no read/write split.

## Consequences

**Positive**

- **N+1 amplification collapses.** Sequential round-trips between API and DB cost sub-millisecond each instead of cross-internet RTTs. A 5-query handler adds <5ms of network wait, not 50-250ms. This is structural; no per-query optimization can replicate it on a cross-provider topology.
- **No public IP on the database.** The DB has no internet-facing surface to defend. Compromise of the API container is still bad, but the attack surface excludes "scan the internet for exposed Postgres instances," which is not nothing in 2026.
- **One control plane.** One CLI (`flyctl`), one secrets store, one billing surface, one observability surface (Fly's metrics + logs, plus pino/Sentry from inside the apps). Onboarding cost is one provider's mental model, not two.
- **Region locality matches the user base.** `scl` (Santiago) is the closest Fly region to Lima — round-trip from a Lima user to `scl` is in the 30-50ms range. The data we serve is Lima-specific; serving it from a Lima-adjacent region is the obvious right answer.
- **Portfolio legibility.** The deployment story for this project is "one provider, one region, private network between API and DB" — easy to draw on a whiteboard, easy to defend in an interview. A hybrid story ("Fly here, Neon there, latency mitigated by X") is harder to defend without sounding like it needed mitigation in the first place.

**Negative — and these are real, not nominal**

- **Fly Postgres is "managed orchestration of self-managed Postgres", not a fully managed product.** Fly provisions the cluster, attaches volumes, and runs the supervisor; we own major-version upgrades, disk monitoring, backup verification, and any extension management beyond what Fly's image bundles. Compared to RDS or Neon, this is more operational responsibility for one solo developer. We accept this in exchange for the latency and topology benefits, and because the operational load is small at v0 scale.
- **Backups need active verification.** Fly's automated daily snapshots exist but are not "verified restore-able" by default. Definition of done for v0 includes the deploy section but not yet a documented restore drill; that is tracked as a v0+1 concern (one written restore test against a scratch app), not deferred indefinitely.
- **Region failure = full outage.** Single primary in `scl`, no standby, no replica. Fly's regional reliability has been good but is not infinite. v0 has no SLA, no paying customers, no on-call rotation — single-region is the right tradeoff for the stage. Mitigation is "failover plan documented, not implemented", which moves to "implemented" the moment there is a customer paying for uptime.
- **Disk monitoring is on us.** Postgres needs free space for WAL, autovacuum, and growth. We rely on Fly's basic volume metrics plus a simple alert threshold; if the alert mechanism itself rots (which is the failure mode for solo-operated alerting), we find out about disk pressure the hard way. To be addressed by the same v0+1 work that adds the restore drill.

**Operational**

- API → DB hostname is `<postgres-app>.flycast` over IPv6. No DNS gymnastics, no `pg_hba.conf` editing — Fly's machinery handles auth via the connection string.
- Connection pooling sits in-process (postgres-js's built-in pool, default size). No PgBouncer at v0; revisit only if the API ever scales horizontally to more than a handful of machines.
- `fly secrets set DATABASE_URL=...` is the canonical write path for the connection string. Secrets are encrypted at rest, injected as env vars at machine start. Zod schema validates at boot; the API refuses to start with a missing or malformed connection string rather than crashing on the first query.
- Migrations run from CI or a developer machine via `fly proxy` to the DB's internal port. Migrations are append-only ([CLAUDE.md](../../CLAUDE.md) "Conventions").

## When this would be revisited

- **Paying customers with stricter RTO/RPO.** The single-region single-primary stance is fine for "portfolio + first business slice with no external commitments." It is not fine when downtime costs revenue or when contractual recovery objectives constrain us. At that point we look at Fly's standby/replica options, multi-region read replicas, or — if Fly's managed-PG ergonomics no longer match the operational maturity we need — migration to a fully managed DB with cross-region replication and verified backups (Neon/Supabase/RDS, evaluated at the time on whatever the current latency-vs-managed-ops tradeoff looks like).
- **Multi-region API.** Fly makes multi-region API trivial; multi-region *Postgres* is harder. If we ever need API machines in multiple regions, we add Fly read replicas and route reads regionally, keeping writes to the primary. That's an additive change to this ADR, not a contradiction of it.
- **Observed disk-monitoring fatigue.** If the solo developer notices that disk monitoring, snapshot restore drills, or version-upgrade rehearsals are getting skipped or generating false alarms, that's the signal that the "managed orchestration of self-managed PG" tradeoff has flipped — at that point the right answer is to move the database to a fully managed service even at the cost of cross-provider latency, because operational neglect kills systems faster than 50ms of RTT does.

## Alternatives considered

**Neon.** Managed Postgres with branching, autoscale, scale-to-zero. Strong product, generous free tier. Rejected for v0 because: the latency to Lima from Neon's nearest region (US-East / US-West) is in the 80-120ms range; N+1 amplification on a 5-query handler is half a second of pure network wait, before any work happens; and the operational simplification it offers (no upgrades, no disk monitoring) is exactly the operational *visibility* we want for the portfolio narrative on this project. A real business with real users in Lima would weigh Neon's managed-ops wins more heavily; v0 specifically wants to see and operate the DB layer up close.

**Supabase.** Managed Postgres plus auth, realtime, storage, edge functions. Rejected for the same latency reason as Neon, plus: we don't need any of Supabase's add-on services at v0 (auth is out of scope per `CLAUDE.md`; realtime, storage, and edge functions are not in the v0 scope at all). Bringing in a multi-product platform we use 10% of is the wrong abstraction shape.

**AWS RDS for PostgreSQL.** The full-managed, full-featured, full-priced option. Rejected for v0 on cost — RDS in `sa-east-1` (São Paulo, the closest region to Lima with PostGIS support) at the smallest instance size is several times the cost of the entire Fly stack, and v0 has no revenue. Also rejected on operational complexity overhead: RDS makes sense when the team and the budget are available to run a proper VPC, security groups, parameter groups, automated backups with cross-region copy, etc. Solo developer + portfolio v0 is the wrong shape for RDS's strengths. Re-evaluate when the business demands what RDS uniquely provides (PIT recovery, automated cross-region snapshot copy, managed read replicas, fine-grained IAM).

**Self-managed Postgres on a generic VPS.** DigitalOcean droplet, Hetzner box, anything similar. Rejected as worst-of-both: we'd own the full operational responsibility (kernel, OS, Postgres install, WAL archiving, backups, monitoring, security patches) without the latency win of being on the same private network as the API. The only world this wins in is "the developer wants the Postgres-administration learning experience as a primary goal," which this project isn't optimizing for — the indexing and schema decisions (ADRs 001/002/003) are where the Postgres learning lives, not in `apt-get install postgresql`.

**Fly API + cross-provider managed PG with a tunnel/proxy.** Tailscale, WireGuard, etc., to make the cross-provider link feel "private." Rejected: this addresses the security-surface objection (no public IP) but does nothing for the latency objection, since the bytes still cross the public internet between Fly and the managed-PG provider. Adding a tunnel is operational complexity that papers over, rather than removes, the cross-provider topology.
