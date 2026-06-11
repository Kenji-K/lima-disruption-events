# ADR-008: Region `gru` (São Paulo) — Fly retired `scl`

## Status

Accepted — 2026-06-11. Amends [ADR-004](004-co-locating-api-and-db-on-fly-private-network.md) and [ADR-006](006-deploy-topology-self-managed-postgis-on-fly.md) on one fact only: the deployment region. Everything else in both ADRs stands unchanged.

## Context

ADR-004 pinned both apps to `scl` (Santiago) as "Fly's closest region to Lima," and ADR-006 carried that pin into the concrete deploy configs. At deploy time (2026-06-11, this same day), `fly volumes create --region scl` failed with `region scl not found`: Fly has consolidated its region list, and the **only remaining South American region is `gru` (São Paulo)** — Santiago, Bogotá, Rio, and Buenos Aires no longer appear in `fly platform regions`.

## Decision

Both apps (`disruption-intelligence-api`, `disruption-intelligence-db`) deploy to **`gru`**. It is the only Lima-adjacent option on the locked provider; the realistic alternatives are all North American and strictly farther. Co-location is unaffected — API↔DB stays sub-millisecond inside one region over 6PN, which was ADR-004's actual load-bearing argument.

## Consequences

- Lima-user → API round-trips land in roughly the 70–90 ms band (São Paulo) instead of ADR-004's projected 30–50 ms (Santiago). Acceptable: the N+1 argument was about API↔DB hops, which don't change; client-facing latency of this magnitude is imperceptible on a map UI.
- ADR-004's "region locality matches the user base" point is weakened but not inverted — `gru` remains the closest available region.
- If Fly ever reopens a closer region (or the latency becomes a demo problem), moving is mechanical: volume snapshot restore + redeploy with a new `primary_region`.
