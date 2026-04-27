# ADR-001: BRIN index on `events.start_at`

## Status

Accepted — 2026-04-27.

## Context

The dominant access pattern on `events` is a forward-looking time-range scan filtered by city and (sometimes) category:

```sql
SELECT ...
FROM events
WHERE city_id = $1
  AND state = 'active'
  AND start_at >= now()
  AND start_at <  now() + interval '7 days'
ORDER BY start_at;
```

Variants: "next 30 days", "tomorrow", "this weekend", "next month". Every variant is a contiguous range over `start_at` with a near-`now()` lower bound. Lookups by an arbitrary historical date, full text search, or queries that ignore time entirely are not supported in v0.

Two structural facts about how `events` is populated make the column suitable for a block-range index:

1. **Append-mostly heap.** Rows are inserted by the ingest pipeline (ADR-003) in scrape-tick order, not deleted. Updates touch existing rows in place via `ON CONFLICT DO UPDATE`; physical row layout is dominated by the order in which rows were first ingested.
2. **Approximate `ingested_at`/`start_at` correlation.** Public sources publish events on a rolling forward window (a venue calendar typically lists 4-12 weeks ahead). As wall-clock time advances, newly-ingested rows carry `start_at` values that trend forward in lockstep. Within any given scrape the returned `start_at` values are scattered across that window, so correlation is positive but not perfect — block ranges will have visible min/max spreads, but those spreads remain bounded by the source's lookahead window rather than growing with table size.

Together these mean: heap order is approximately sorted by `start_at`, the working set for a "next N days" query lives in a small contiguous tail of the heap, and the rest of the table can be skipped without examining individual rows.

## Decision

Create a BRIN index on `events.start_at` with the default `pages_per_range = 128`:

```sql
CREATE INDEX events_start_at_brin_idx
  ON events
  USING BRIN (start_at);
-- pages_per_range left at default (128); revisit if we ever load >>10M rows.
```

BRIN stores a summary tuple (min, max, has-nulls) for each contiguous group of `pages_per_range` heap pages. A range scan over `start_at` reads the summary, identifies the block ranges whose summarized interval overlaps the query predicate, and only touches the heap pages in those ranges. For the queries above, that means touching the tail of the heap (recent inserts, which contain near-future `start_at` values) and skipping the rest.

The non-time access paths are served by separate partial composite B-trees on `(city_id, state, start_at) WHERE state = 'active'` and `(city_id, category) WHERE state = 'active'` — defined alongside this index in the initial migration. This ADR is specifically about the time dimension; the partial B-trees handle the city/state/category dimensions and compose well with BRIN at query planning time.

Reference: Postgres 16 BRIN documentation, https://www.postgresql.org/docs/16/brin-intro.html.

## Consequences

**Positive**

- **Index size is two to three orders of magnitude smaller than the equivalent B-tree.** A B-tree on `start_at` stores one entry per row plus internal pages; BRIN stores one summary per 128 heap pages. At 1M rows (~50MB heap on a typical events row), B-tree is ~25MB, BRIN is single-digit kilobytes. The size delta translates directly to buffer cache pressure: a hot BRIN summary stays resident essentially for free.
- **Insert cost is negligible.** A new row that falls inside an existing block range's min/max requires no summary update at all. A row that extends the range updates one summary tuple. There is no rebalancing, no page splits, no WAL volume comparable to a B-tree's per-row index entry.
- **Composes with the partial composite B-trees.** The planner can bitmap-AND a BRIN scan on `start_at` with a B-tree scan on `(city_id, state, start_at) WHERE state = 'active'` when the predicate covers both. We are not choosing one or the other.

**Negative**

- **BRIN is lossy.** A bitmap heap scan over BRIN's selected block ranges will read pages that contain rows outside the query predicate; those rows are filtered with a per-row recheck. For the "next 7 days" query against a multi-month heap, the recheck cost is small relative to the pages skipped. For a query whose result set covers most of the heap (e.g., "all events ever"), BRIN devolves to a sequential scan plus overhead and the planner will pick a real seq scan instead. That's the planner doing the right thing, not a defect.
- **Correlation is the load-bearing assumption.** If the heap layout becomes scrambled with respect to `start_at`, BRIN's summary intervals widen and the index loses selectivity. v0 specifically does not run heavy backfill jobs that would insert old `start_at` values into the tail of the heap; if that ever changes, the table may need `CLUSTER events USING events_start_at_brin_idx` (rare, and locks the table) or simply a switch to a B-tree.
- **Default `pages_per_range = 128` is conservative for our row count.** At <100k rows the table is smaller than 128 pages and the entire BRIN index summarizes into one or zero ranges, making it functionally useless until the table grows. We accept this — the index is in place from migration zero so behavior is identical at small and large scale, and the cost of a useless BRIN at small scale is bytes, not milliseconds. Tune `pages_per_range` (down to 32 or 16) only if a measured plan shows BRIN being skipped in favor of a seq scan at a row count where it should be helping.

**Operational**

- Autovacuum's `brin_summarize_new_values` runs the summarization for new heap pages. We rely on default autovacuum thresholds; no separate tuning is needed at v0 scale. To be revisited if `pg_stat_user_tables` shows the events table going long stretches between autovacuum runs.
- A bulk reload (e.g., importing a year of historical data into an established table) would insert old `start_at` values into the tail of the heap and damage correlation. v0 has no such workflow. If one is added, it should be followed by `CLUSTER` on the BRIN index, or the load should target a separate table that's then swapped in.

## When this would change

- **Heavy in-place updates that move `start_at` to wildly different values** (rare for real events — time slips are typically same-day; cancellations don't move `start_at`). If a source emerges that frequently re-times events across weeks, BRIN's per-block min/max widens and selectivity collapses; reach for a B-tree.
- **Bulk DELETEs that fragment the heap.** v0 doesn't delete; cancellations are a state transition. If garbage-collecting old past events ever becomes a thing (it shouldn't, but if), partition by month and drop partitions instead of deleting rows — that preserves correlation in the live partitions.
- **Random-order inserts.** Out-of-order backfills, parallel writers ingesting different time windows simultaneously, etc. v0 has one scheduler, one writer, append-only ingest order — none of these apply.

At 10x scale (Lima saturated with sources, low six figures of rows), this index gets *better*: the relative size advantage over B-tree widens, and the working set for "next N days" remains a small constant in absolute terms. At 100x scale (multi-city, multi-year horizon), the same logic holds for the time dimension; what changes at 100x is that we'd want to partition `events` by month or quarter, at which point each partition gets its own BRIN — not a redesign, an additive change.

## Alternatives considered

**B-tree on `start_at`.** The default and the obvious choice. Rejected: pays per-row index storage and write amplification for a query workload that BRIN serves correctly with a fraction of the storage. The argument for B-tree would be "we sometimes need point lookups by `start_at`," which we do not — point lookups are by `id` or by `(source_id, external_id)`, both already indexed.

**No index.** Rejected. A "next 7 days" query against a sequentially scanned `events` table grows linearly with table size and becomes unacceptable well before the v0 row count. The cost of having a useless BRIN at 100 rows is bytes; the cost of having no index at 100k rows is full seq scans on every API request.

**Partial B-tree on `start_at WHERE state = 'active' AND start_at >= now()`.** Tempting because it shrinks the index to just the live forward-looking slice of the table. Rejected for two reasons: (1) `now()` is not immutable, so `WHERE start_at >= now()` cannot literally appear in a partial index predicate — it would need to be a static cutoff (e.g., `>= '2026-01-01'`) that requires periodic recreation, which is operational friction we're avoiding at v0; (2) the partial composite B-trees on `(city_id, state, start_at) WHERE state = 'active'` already cover the "active + city + time" path. Adding a partial B-tree solely on `start_at` would duplicate that work for a planner edge case that hasn't been observed.

**SP-GiST or GiST on `start_at`.** Both supported by Postgres but unmotivated here. SP-GiST shines on non-uniformly distributed point data with hard partitions; GiST shines on multi-dimensional or non-orderable data. A monotonic timestamp on an append-mostly heap is exactly the textbook case for BRIN.
