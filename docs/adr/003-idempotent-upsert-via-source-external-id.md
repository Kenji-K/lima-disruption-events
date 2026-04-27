# ADR-003: Idempotent ingest via `(source_id, external_id)` unique constraint + `ON CONFLICT DO UPDATE`

## Status

Accepted — 2026-04-27.

## Context

The disruption-events ingest pipeline runs scrapers on a periodic schedule (in-process `node-cron` inside the API; queue infra deferred — see ARCHITECTURE.md). Each scrape pulls the current state of upcoming events from a public source. The pipeline must:

- Be safe to re-run. A scrape executed at 12:00 and again at 12:05 must not create duplicate rows.
- Reflect updates. If an event's start time, venue, or description changes upstream, the local row picks up the change.
- Survive crashes mid-pipeline. A partial scrape leaves the database in a consistent state on retry.
- Preserve raw upstream data so re-parsing is possible if a parser bug is discovered later — we don't want to need to re-scrape just to re-parse, especially for sources with rate limits or that take down old content.

Scrapers are not transactional message producers. They are best-effort HTML or JSON pulls that:

- Return the same event in multiple consecutive scrapes (typical case — event hasn't moved).
- Return an event with updated fields (venue change, time slip, description correction).
- Stop returning an event (cancelled, removed from upstream, or simply rolled off the upcoming-events window).
- Occasionally return the same logical event under a slightly different label or title (treat as in-place update if `external_id` matches).

## Decision

Use a deterministic upsert keyed on `(source_id, external_id)` with `ON CONFLICT (source_id, external_id) DO UPDATE`:

```sql
INSERT INTO events (
  city_id, source_id, external_id, title, category,
  start_at, end_at, location, venue_name, description,
  source_url, raw_payload
)
VALUES (...)
ON CONFLICT (source_id, external_id) DO UPDATE SET
  title       = EXCLUDED.title,
  category    = EXCLUDED.category,
  start_at    = EXCLUDED.start_at,
  end_at      = EXCLUDED.end_at,
  location    = EXCLUDED.location,
  venue_name  = EXCLUDED.venue_name,
  description = EXCLUDED.description,
  source_url  = EXCLUDED.source_url,
  raw_payload = EXCLUDED.raw_payload,
  updated_at  = now();
-- id, ingested_at, state, city_id, source_id, external_id are NOT touched on conflict.
```

Columns deliberately not updated on conflict:

- `id` — primary key, preserved across updates so any future foreign keys remain stable.
- `ingested_at` — first-seen timestamp, immutable after initial insert.
- `state` — managed separately (see below); not blindly overwritten by scrapes.
- `city_id`, `source_id`, `external_id` — identity columns; if these need to change, that is a different operation (a re-classification, not an upsert).

### Why `(source_id, external_id)`, not `(city_id, source_id, external_id)`

A source belongs to exactly one city by construction. The `cities` table is a scope dimension on `events`, but sources don't span cities — a Lima venue calendar's `external_id`s come from Lima only. When a future second city is added, it brings new `source_id`s with their own `external_id` namespace. Cross-city collision is impossible.

Putting `city_id` in the unique key would imply a source can collide with itself across cities, which is meaningless. The smaller key is faster to maintain (less B-tree volume) and matches reality.

### State transitions

`state` is `'active' | 'cancelled' | 'superseded'`. The upsert above does not modify `state`. State changes happen in dedicated paths:

- **`active → cancelled`**: requires a "marker sweep" — when a scrape no longer returns an event that was previously active and was scheduled to occur in the future, mark it cancelled. **Out of scope for v0.** Events that disappear from a scrape are simply not updated, leaving them with a stale `updated_at`. Acceptable.
- **`active → superseded`**: only if the source explicitly indicates a replacement (e.g., a `replaces` field pointing at this row's `external_id`). Reserved; not used in v0.

Deliberate non-decision: **if a scrape returns an event with materially different data (different `start_at`, different `location`), it is treated as an in-place update, not a supersede.** Events do not fork into "old" + "new" rows. This keeps the model simple at the cost of losing "was 8pm before being moved to 9pm" history. Acceptable for v0; a future `event_changes` history table can be added without migrating `events`.

### `raw_payload` preservation

`raw_payload` (jsonb, NOT NULL) stores the verbatim source response that produced this row. It is overwritten on every upsert with the latest scrape's payload. This enables re-parsing without re-scraping: if a parser bug is discovered, we re-run the parser over `raw_payload` rows in-place.

If both old and new payloads ever need to be retained (for diffing or audit), that is a separate `event_payload_history` table — not a schema change to `events`.

## Consequences

**Positive**

- Scrapers are trivially re-runnable. A stuck or partial scrape can simply be retried.
- `ON CONFLICT` is single-statement and atomic per row; no application-level lock contention, no TOCTOU race.
- The unique constraint serves both as idempotency guard and as a query index for "find this event by source identifier."
- A re-scrape from a fresh database produces identical state to incremental scraping. No scrape-order dependency.

**Negative**

- We don't get a history of changes for free. If an event's start time changes three times, only the last value remains. Mitigated by `raw_payload` (last payload preserved) and by a future history table if needed.
- Events that disappear from upstream silently age out — their `updated_at` lags but they remain `active`. v0 accepts this. A "cancel events not seen in N scrapes" sweeper can be added orthogonally without touching this design.
- Sources that reuse an `external_id` for a different real-world event would silently overwrite. This relies on a stability assumption that must be documented per scraper. If a source violates it, the right fix is to derive a more stable identifier (e.g., hash of url + start_at + venue) — not to weaken the upsert.

**Operational**

- The unique index `(source_id, external_id)` is required from the first migration. Without it, `ON CONFLICT` has no target.
- Records that fail validation (Zod schema check on scraper output) are logged and skipped before the upsert. Invalid rows never reach the table.
- A failed scrape must not block the next scheduled run. Each scrape's transactional unit is per-row, not per-scrape — partial progress is preserved across crashes.

## Alternatives considered

**Delete-and-replace per scrape.** `DELETE FROM events WHERE source_id = $1; INSERT ...` for the full scrape. Rejected: destroys row identity (any future FKs become unstable), opens a window where readers see an empty source, generates massive WAL churn for what is usually a no-op scrape, and breaks analytics that depend on `ingested_at`.

**Application-level dedup.** Read existing rows by `(source_id, external_id)`, diff in TypeScript, decide UPDATE vs INSERT. Rejected: introduces a TOCTOU race under concurrent scrapes (low risk in v0 with one scheduler, but an unnecessary footgun); doubles round-trips to the DB; spreads "what is identity" logic across SQL and TS instead of keeping it declarative in the schema.

**Event-sourced log.** Append-only `event_changes` table; current state derived by reduction. Rejected as premature for v0 — the queries we run are all "current state" queries, and the analytics value of a change log does not exist yet (no users, no SLA, no audit requirement). Reconsider when (a) we need to show "this event was moved" history to end users, or (b) compliance requires audit. Adding it later is straightforward: emit a change log alongside the current upsert; no schema migration to `events` needed.

**Per-row optimistic locking via a `version` column.** `WHERE version = $expected`. Rejected: solves a problem we don't have. v0 has one writer per source per cron tick; concurrency on the same row would require misconfiguration. Re-evaluate if multi-instance writers are introduced.
