# ADR-002: GiST index on `events.location` (geography)

## Status

Accepted — 2026-04-27.

## Context

`events.location` is a PostGIS `geography(Point, 4326)` column — point coordinates in WGS84, with spheroid-aware distance math (great-circle, not planar). The column is mandatory: an event without a location does not get ingested.

The access patterns over `location` that v0 either supports today or will support during the milestone window:

- **Radial queries:** `ST_DWithin(location, $point::geography, 2000)` — "events within 2km of these coordinates," driven by user pin-drops on the MapLibre frontend.
- **Bounding-box queries:** `location && ST_MakeEnvelope(...)::geography` — "events visible in the current map viewport." This is the dominant query during normal map panning/zooming and will be issued on every viewport change with debouncing on the frontend.
- **KNN ordering:** `ORDER BY location <-> $point LIMIT 10` — "ten nearest events to where the user tapped." Needed for the event-detail drawer's tap-targeting behavior planned in Week 3.
- **Polygon containment:** `ST_Within(location, $district::geography)` — "events in this district polygon." Out of API scope at v0 (no district endpoint), but plausibly needed within the milestone window for filter-by-district UI; the index decision needs to anticipate it now because adding the right index later is cheap, but rebuilding the wrong index is not.

All four patterns share the same structural property: they evaluate a spatial predicate against a 2D point, and the only viable acceleration is a spatial index that decomposes the plane into a hierarchy of bounding regions. Without such an index, every query degrades to a sequential scan that calls a `ST_*` function once per row — at v0 row counts that is "fine" in the milliseconds sense, but it's a scan that grows linearly with table size and hits the heap on every query, regardless of how few rows actually match.

The lookup volume is asymmetric: bounding-box viewport queries dominate (one per map pan, debounced); radial and KNN queries fire on user interaction; polygon containment is the rarest. Write volume is small (one scrape every N minutes via [ADR-003](003-idempotent-upsert-via-source-external-id.md) — tens of upserts per scrape, not thousands), so write-side index cost is not a binding constraint.

## Decision

Create a GiST index on `events.location` using PostGIS's geography operator class:

```sql
CREATE INDEX events_location_gist_idx
  ON events
  USING GIST (location);
-- Default operator class for geography(Point, 4326): gist_geography_ops_2d.
-- Default fillfactor (90); revisit only if measured page-split rate becomes a problem.
```

GiST (Generalized Search Tree) is an indexing *framework*, not a fixed structure. It defines a set of seven operator-class hooks (`consistent`, `union`, `compress`, `decompress`, `penalty`, `picksplit`, `same`) and lets extensions provide their own implementations to index arbitrary key types. PostGIS plugs into this framework with operator classes that store a 2D bounding box per row and decompose the plane into a balanced tree of bounding boxes — effectively an R-tree, but with GiST's concurrency and WAL machinery rather than R-tree's traditional weaknesses.

The index supports the operators all four access patterns need:

- `&&` (bounding-box overlap) — used directly by viewport queries; also used internally by `ST_DWithin` as the first-pass filter before the more expensive distance math is applied per candidate row.
- `<->` (KNN distance ordering) — directly accelerated by GiST's ability to prune the tree by minimum-possible-distance to a query point.
- `ST_DWithin`, `ST_Within`, `ST_Intersects`, etc. — internally rewritten by PostGIS to use the bounding-box `&&` filter against the GiST index, then re-checked exactly per matching row.

For a `geography` column the index stores spheroid-aware bounding regions, not planar boxes — that's what `gist_geography_ops_2d` provides. We accept the slightly higher build and query cost of geography over geometry in exchange for correct distance math globally; the alternative is to also maintain a `geometry` column, which doubles storage and risks the two columns drifting.

References: PostGIS docs on spatial indexing, <https://postgis.net/docs/using_postgis_dbmanagement.html#idm9402>; Postgres 16 GiST docs, <https://www.postgresql.org/docs/16/gist-intro.html>.

## Consequences

**Positive**

- **All four access patterns become tractable.** Bounding-box and `ST_DWithin` queries narrow to the small subset of rows whose bounding boxes overlap the query region, and only those rows pay the per-row recheck cost. KNN queries prune the tree by distance bound, returning the nearest N rows without scanning the rest.
- **The index handles every spatial operator we'll need from one structure.** We do not need separate indexes for radial queries, bounding-box queries, KNN, and polygon containment — a single GiST index serves all of them, because all the operators decompose to bounding-box overlap as their index-supported first pass.
- **Write cost is low at v0 volume.** Tens of upserts per scrape, none of which move existing points (events don't change location after ingest in any source we plan to use). The index sees mostly inserts of new leaf entries, not rebalancing of existing branches.

**Negative**

- **Index size can exceed the indexed column for points.** Each leaf entry stores a bounding box (two `geography` points) plus tree overhead, while the indexed column itself is a single point. For our row count this is bytes, but the ratio is worth understanding so it doesn't surprise anyone reading `\di+` output later.
- **Per-row recheck on every spatial query.** GiST returns the set of rows whose bounding boxes overlap the query region; the actual `ST_DWithin`/`ST_Within`/etc. predicate is re-evaluated exactly per candidate. This is intrinsic to spatial indexing, not a defect — the alternative is "scan every row," which is what we are trying to avoid. Recheck cost is bounded by the selectivity of the bounding-box pre-filter.
- **Update on `location` invalidates the entry.** If a future source ever updates `location` in place via the upsert pipeline, the old leaf is marked dead and a new leaf inserted, contributing to GiST bloat over time. v0 doesn't update locations (events don't move), so this is theoretical; if it stops being theoretical, the mitigation is `REINDEX events_location_gist_idx CONCURRENTLY` on a maintenance cadence, or autovacuum tuning to recover dead entries faster.
- **Build time on a populated table is non-trivial.** Initial migration creates the index on an empty table, so this is a non-issue at v0. Reindexing a populated table at scale would want `CREATE INDEX CONCURRENTLY` to avoid an exclusive lock; the migration tooling should default to concurrent for any future GiST index added to a live table.

**Operational**

- The index is created in the initial migration ([docs/PLAN.md:188-194](../PLAN.md#L188-L194)), alongside `CREATE EXTENSION IF NOT EXISTS postgis;` which must precede it. The migration cites this ADR by number in a SQL comment so the reasoning is one click away from the schema.
- No fillfactor tuning at v0. The default 90 is appropriate for an append-mostly table whose indexed column is rarely updated. Tune downward only if `pg_stat_user_indexes` shows excessive page splits on this index — not anticipated.

## When this would change

- **Highly skewed point distribution at very high write rates.** SP-GiST partitions the plane into disjoint regions and can outperform GiST for heavily clustered point data because each query walks a single partition rather than overlapping bounding boxes. v0 events do cluster around districts (Miraflores, San Isidro, Centro, etc.), but the write rate is low enough that GiST's overlap-recheck cost is invisible. Revisit if write throughput climbs by orders of magnitude *and* a measured plan shows GiST recheck overhead dominating.
- **Mixed point + polygon column.** v0's `location` is point-only. If we ever store mixed geometries (event venues represented as polygons for large festivals, points for small events), GiST remains the right answer but the operator class changes; nothing else in this ADR's reasoning shifts.
- **Multi-region, multi-million row scale.** Partition `events` by month (per ADR-001's note on partitioning) and each partition gets its own GiST. No redesign — the per-partition index is the same shape. Geography of New York or Tokyo doesn't change the indexing strategy; only the absolute row count does.

## Alternatives considered

**No index.** Rejected. Every spatial query becomes a sequential scan with per-row `ST_*` evaluation. At v0 scale this is "milliseconds per query" — at 10x scale it's "tens of milliseconds with no headroom"; at 100x it's a queue of API requests piling up behind the heap scan. Adding the index later is straightforward, but the cost of *not* having it is that every spatial query path written before the index lands has to be re-validated after. We'd rather front-load the structural decision and write API code against the steady-state shape of the system.

**B-tree on `(ST_X(location), ST_Y(location))`.** A classic "I don't want to learn GiST" mistake. Rejected: B-tree orders by lexicographic key, so a B-tree on `(x, y)` accelerates `WHERE x = $1 AND y = $2` and `WHERE x BETWEEN ...` reasonably, but it cannot accelerate `&&` (bounding box overlap), `ST_DWithin` (radial), or `<->` (KNN) — those are not ordered predicates over a single key. The planner would never use this index for the queries we actually run. It would be pure cost.

**SP-GiST on `location`.** SP-GiST (Space-Partitioned GiST) supports point indexing via the `quad_point_ops` and `kd_point_ops` operator classes for `geometry`, and like GiST it supports `&&`, `ST_DWithin`, and KNN. Its advantage over GiST is non-overlapping space partitioning, which can be faster for highly skewed point clouds. Rejected for v0 because: (a) PostGIS support for `geography` (vs `geometry`) on SP-GiST is more limited than GiST, and we are committed to `geography` for correct spheroid distance math; (b) GiST is the canonical choice in PostGIS documentation and tooling, and the operational ecosystem (REINDEX patterns, monitoring queries, blog-post tuning advice) overwhelmingly assumes GiST; (c) the workload-shape argument for SP-GiST (extreme write rate, extreme skew) does not apply at v0. Re-evaluate only if a measured GiST plan shows recheck overhead dominating *and* the data distribution is severely clustered.

**BRIN with `bbox_inclusion_ops`.** Postgres 14+ supports BRIN over geometries via the `bbox_inclusion_ops` operator class — block-range summaries of bounding boxes. Rejected because BRIN's correlation requirement (heap order matches indexed-column order) is the opposite of true for spatial data: geographically adjacent events are inserted in scrape order, not in any spatial order. BRIN block summaries on `location` would have wide bounding boxes covering essentially the whole map per range, making the index useless. BRIN is the right answer for `start_at` (ADR-001) precisely because of correlation; its absence rules it out for `location`.
