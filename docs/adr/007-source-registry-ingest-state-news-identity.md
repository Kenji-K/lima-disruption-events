# ADR-007: Source registry stays in code, ingest state lives in Postgres, news events get a fixed identity convention

## Status

Accepted — 2026-06-11. Written ahead of the first news-derived sources (MML WordPress feed, Lima Expresa pressroom) per the ADR-first rule; ADR-003's `(source_id, external_id)` upsert key is unchanged and this ADR builds on it.

## Context

The v0.5/v1 source roadmap takes the platform from 2 scrapers to 8+, and the new sources differ from the first two in a way the current architecture has no answer for: **they are incremental**. The Gran Teatro Nacional and futbolperuano scrapers re-read their entire public window every run and rely on idempotent upserts to make repetition free. The news-shaped sources can't work that way:

- **MML WordPress feed** exposes `?after=<ISO>` — the polite, cheap strategy is to ask only for posts since the last successful poll. That timestamp has to survive process restarts; today there is nowhere to put it.
- **Lima Expresa pressroom** is a listing page plus per-post detail fetches. Most posts never become disruption events (the keyword filter rejects them *after* the detail fetch), so "did an event row land?" can't tell us "have we already processed this post?" — without a seen-set, every run re-fetches every listed detail page, violating the brief's incremental-fetch politeness rule.
- **Tier-1 acceptance requires "data freshness < 24h" and Tier-2 wants per-source freshness/failure visibility.** Today the only record that a source ran is a pino log line. Logs rotate; freshness is a query someone needs to be able to run.

Separately, news-derived events need an **identity convention** before the first one is written, because ADR-003's upsert key is only as good as the `externalId` behind it, and Tier 2's cross-channel dedup problem (the same comunicado published on `munlima.gob.pe` *and* mirrored via gob.pe's `munilima` channel) needs raw material captured now, not retrofitted.

One thing this ADR deliberately does **not** do: move the scraper list itself into the database. At 8 sources, a DB-driven registry (enable flags, schedule config, scraper-type dispatch) is configuration machinery with no consumer — every change to a source is a code change anyway (its parser lives in the repo), so a code-level list keeps registration, implementation, and review in one diff.

## Decision

**1. The registry stays in code.** `SCRAPERS` in `apps/api/src/ingest/run.ts` remains the single authoritative list of sources; a source exists iff it has an entry there. The entry's `name` remains the `sourceId` stamped on event rows and is now also the key into the state table.

**2. New table `ingest_state` — one row per source, owned by the runner.** Schema (Drizzle, snake_case in SQL):

- `sourceId text PRIMARY KEY` — matches `events.source_id`; rows created lazily on a source's first run.
- `cursor jsonb NULL` — opaque, source-defined resume state. MML: `{ "after": "<ISO of newest processed post>" }`. Lima Expresa: `{ "seenUrls": [...] }`, pruned by the scraper to a bounded recent window (the listing only surfaces recent posts, so the set self-limits). Full-window scrapers (GTN, futbolperuano): stays `NULL`.
- `lastRunAt`, `lastSuccessAt`, `lastErrorAt` (`timestamptz NULL`) and `lastError text NULL`, `consecutiveFailures integer NOT NULL DEFAULT 0` — freshness and failure tracking. `lastSuccessAt` is the per-source freshness fact; `consecutiveFailures` is the future alert hook (Tier 2's `/sources` endpoint or healthz reads this table; not built now).

**Cursor lifecycle:** the runner reads the row before invoking a scraper and passes `cursor` in; the scraper returns `nextCursor` alongside its events; the runner persists `nextCursor` **only after the source's events have been validated and upserted successfully**. A thrown scrape/validate/upsert leaves the cursor untouched (the next run re-covers the same ground — idempotent upserts make that safe) and records the failure fields instead. The scraper computes cursor *values* (it knows the source's semantics); the runner owns cursor *persistence* (it knows whether the run actually succeeded). A scraper must never advance its cursor past data it failed to process — e.g. MML's `after` only moves to a post date whose post was actually parsed or deliberately filtered out.

**3. News-source identity convention.** For every news-derived event:

- `externalId` = the source's own stable, immutable identifier for the *post*: the WP numeric post ID for MML (`"12345"`), the URL slug for Lima Expresa pressroom posts. Never derived from title or date text (both get edited upstream). If rule-based extraction ever yields multiple events from one post, they suffix as `"<postId>:1"`, `"<postId>:2"` in document order — the unsuffixed form is reserved for the single-event case.
- `sourceUrl` = the post's canonical public URL (WP `link` field; the pressroom detail URL), always populated for news sources. This is deliberately load-bearing beyond UX: canonical URL is the primary join key for Tier 2's cross-channel dedup (gob.pe's `munilima` channel links back to the same canonical posts), with title+date similarity as the fallback. Capturing it on every news event from day one is what makes that dedup retrofittable without a re-scrape.
- One post → one event by default; the extraction layer picks the post's primary date range. Splitting is the suffix case above, used only when a post unambiguously enumerates separate closures.

**4. Sweep semantics for incremental sources: none.** The cancel-missing sweep (ADR-003) requires a scrape that covered its full forward window; an incremental news poll covers only the delta, so news scrapers always return `sweepWindowEnd: null`. A comunicado dropping out of the recent-posts window is not evidence the closure was called off. Cancellations for news sources, if ever modeled, come from *new* posts announcing them — out of v1 scope.

## Consequences

**Positive**

- MML polls stay O(new posts) and Lima Expresa detail fetches happen once per post — the politeness rules hold structurally, not by luck.
- Per-source freshness becomes a SQL query (`SELECT source_id, last_success_at FROM ingest_state`), which is exactly the shape Tier-1's freshness acceptance check and Tier-2's `/sources` endpoint both want.
- Cursor-after-success ordering means a crashed run costs at most one redundant re-poll, never lost data.
- Identity convention is locked before the first news event row exists — no backfill/re-key migration later, and Tier-2 dedup gets canonical URLs from the start.

**Negative / accepted**

- `cursor jsonb` is opaque to SQL — no cross-source queries over cursor internals. Accepted: cursors are private to their scraper by design; the moment two sources need to share cursor structure, that's a new decision.
- A seen-URL set in a jsonb column is a small lie about set semantics (no concurrent-writer safety). Accepted: writes are serialized by the single-machine cron topology (ADR-006), and each source's row is touched only by its own scraper's run.
- One more table that isn't `events` — the runner now does two writes per source. Negligible at this scale.

**Operational**

- State reads/writes live in `apps/api/src/ingest/state.ts`; `runIngestOnce` wires them around each source with the existing per-source isolation (a state-write failure for one source must not block others, same as scrape failures).
- `ScrapeResult` grows `nextCursor?: unknown`; the scraper signature gains the inbound cursor. Existing scrapers pass `null`/omit and are otherwise untouched.
- Testcontainers integration tests cover: cursor advances on success, cursor frozen on failure, failure fields populated, `consecutiveFailures` resets on success.

## When this would be revisited

- **Sources need independent schedules** (e.g. road alerts every 15 min vs. daily theatre scrapes) — the code registry grows a per-source cadence field; if that turns into operator-editable config, *then* the DB-registry question reopens.
- **Multi-machine ingest** (ADR-006's topology changes) — jsonb cursor read-modify-write needs row locking or a move to dedicated columns.
- **The seen-URL set stops being bounded** (a source lists deep history) — switch that source's cursor to a high-water mark or a dedicated table.
- **Cross-channel dedup lands (Tier 2)** — the canonical-URL convention gets its consumer; expect a successor ADR on the dedup algorithm itself (explicitly out of scope here).

## Alternatives considered

**DB-driven source registry (a `sources` table with enable flags and config).** Rejected for now: every source change is already a code deploy (the parser is code), so a DB registry adds a second place where a source half-exists, plus drift between table rows and `SCRAPERS` entries. The state table deliberately contains *no* configuration — only runtime facts the code can't know.

**Derive incrementality from the `events` table instead of a cursor** (max ingested date per source; existing `externalId`s as the seen-set). Rejected: filtered-out posts never become rows, so the events table systematically under-remembers what was processed — Lima Expresa would re-fetch every non-event post forever, and MML's `after` would stick at the last post that happened to be a disruption.

**Cursor in a file on the API machine's disk.** Rejected: Fly machines are ephemeral (replaced on every deploy); the only durable, already-backed-up store in the topology is Postgres, which is also where the data the cursor protects lives — same transaction boundary, same snapshot story.

**Per-source state as pino logs + log scraping for freshness.** Rejected: logs are an emission, not a queryable store; freshness checks and the Tier-2 endpoint both need point-in-time truth, and log retention on Fly is measured in days.

**URL as `externalId` for news events.** Rejected: URLs change (slug edits, http→https, tracking params) and WP exposes a genuinely immutable post ID one field away. The canonical URL still gets captured — in `sourceUrl`, where mutation is harmless — while identity rides on the immutable ID.
