# Plan — Scraper #1: Gran Teatro Nacional

## Context

**What is the change.** Replace the stub scraper at [apps/api/src/ingest/stub-scraper.ts](../../apps/api/src/ingest/stub-scraper.ts) with the project's first real HTML scraper, targeting [granteatronacional.pe/calendario](https://granteatronacional.pe/calendario). This closes the longest-open checkbox in Week 1's "Backend spine" milestone in [docs/PLAN.md](../PLAN.md): _"One scraper (HTML source, TBD) writing through the idempotent upsert pipeline."_ After this lands, only `node-cron` wiring stands between the project and the Week 1 checkpoint.

**Why Gran Teatro Nacional, not Estadio Nacional.** The user's first instinct was Estadio Nacional. The Phase 1 web research found that **the IPD-administered Estadio Nacional has no first-party events calendar** — every viable source is a third-party aggregator (Songkick, Bandsintown, Teleticket), and each has its own legal or technical wall:

- **Songkick** — clean SSR page but [their ToS](https://www.songkick.com/info/terms) explicitly forbids scraping without written consent.
- **Bandsintown** — returns 403; anti-bot defenses.
- **Teleticket** — SSR and unrestricted, but no venue-filter URL parameter; venue-string matching is brittle.

By contrast, Gran Teatro Nacional publishes its own SSR calendar at `/calendario/YYYYMM` with ~150+ upcoming events visible in plain HTML, no auth, no anti-bot. It is the single cleanest "venue calendar" target in Lima available right now. **The user picked this option after the trade-off was surfaced.** Estadio Nacional is parked for later — when we revisit it as Scraper #2 or beyond, we can decide whether to take the Teleticket aggregator route knowingly.

**Intended outcome.** `pnpm -F api ingest` performs real HTTP fetches of the GTN calendar, parses HTML into `ScrapedEvent[]` matching the existing schema contract, and writes through the same `upsertEvents()` pipeline that `stub-scraper.ts` currently feeds. Zero changes to [apps/api/src/ingest/upsert.ts](../../apps/api/src/ingest/upsert.ts) or the shared schemas — the boundary contract holds and proves itself in production-like conditions.

---

## Mentor-mode posture

Per [CLAUDE.md](../../CLAUDE.md) "Mentor mode," this is a learning task. The user will write the scraper module, fixture-driven test, and library-pick decisions. The agent's role:

- Teach concepts before code: HTTP retry strategies, HTML-parsing trade-offs, robots.txt etiquette, ISO-8601 with offset for `America/Lima`, `externalId` stability heuristics.
- Hints before answers; nudge → narrower hint → worked example → full answer.
- Show small focused snippets as illustrations only; user types the real code.
- Review what the user writes and explain _why_.
- The PLAN.md update, ARCHITECTURE.md notes, and the Notion research log are prose — the agent can draft those directly.

---

## Pre-implementation: Notion research log

Before writing code, capture the source-survey research as a sub-page under the existing Disruption Intelligence Notion plan ([34b03c87ab7081498ebdc8ed77cc7311](https://www.notion.so/34b03c87ab7081498ebdc8ed77cc7311)). The user explicitly asked for this; the value is that the next time we pick a source, the prior survey is one click away instead of re-derived.

**Page title (suggested):** _Source survey log — Scraper #1 (Gran Teatro Nacional)_
**Parent:** the existing Disruption Intelligence plan page.
**Contents (one screen):**

- Goal: pick first real data source for the v0 ingest pipeline.
- Candidates evaluated:
  - **Estadio Nacional (via IPD)** — no first-party calendar. Rejected.
  - **Estadio Nacional via Songkick** — ToS forbids scraping. Rejected.
  - **Estadio Nacional via Bandsintown** — 403 / anti-bot. Rejected.
  - **Estadio Nacional via Teleticket** — viable but venue filter only via brittle string match; parked.
  - **Gran Teatro Nacional** — chosen. SSR `/calendario`, ~150+ events, no auth, no anti-bot.
- Decision: GTN as Scraper #1. Estadio Nacional revisit deferred to Scraper #2 conversation.
- Date: 2026-05-04.

Use `mcp__claude_ai_Notion__notion-create-pages` with the parent page ID. Treat this as a low-stakes write — it's a research note, not a strategic update. The agent can draft and post directly per mentor-mode "Prose is fair game."

---

## Library decisions (locked 2026-05-04)

Direct deps to add to `apps/api` ([apps/api/package.json](../../apps/api/package.json) currently has only `drizzle-orm`, `pino`, `zod`). Add via `pnpm -F api add` per pnpm strict-isolation convention recorded in [docs/ARCHITECTURE.md](../ARCHITECTURE.md).

1. **HTTP client = Node 24's built-in `fetch` + hand-rolled retry wrapper.** No `undici` dep. The wrapper is small enough to fully reason about (~30–50 LOC) and the retry mechanics are exactly the kind of thing an interviewer asks about.
2. **HTML parser = Cheerio.** jQuery-compatible API, de-facto Node scraping choice, interview-rehearsable. ~150-event pages aren't a perf concern.

### Retry design (locked)

Two-layer retry, accumulator-based. Phase 1 covers brief blips; phase 2 covers minutes-long upstream wobbles. Total per URL: up to **4 attempts** spread across the run (1 phase-1 initial + 3 phase-1 retries + 1 phase-2 single).

```text
phase 1 — per month-page fetch
  1 initial attempt + up to 3 retries with 250ms / 500ms / 1000ms backoff before each retry
  worst-case wait per phase-1 round-trip = 1.75s
  on success            → parse, collect events
  on 4xx                → log + skip immediately (do NOT push to failedList; not retryable)
  on parse-empty        → throw, abort run (programmer error per CLAUDE.md; GTN HTML changed)
  on 5xx / network /
     timeout, exhausted → push (url, lastError) to failedList, continue with next month

phase 2 — end-of-run retry pass
  for each (url, _) in failedList:
    one attempt          → on success: parse, collect events
                         → on failure: log warn { url, finalError }, drop it
  run completes with whatever was successfully fetched
```

Asymmetry rationale: phase 1 retries cluster within ~2 s (good for a 200 ms TCP reset). Phase 2 fires after minutes of elapsed time — the gap _is_ the recovery window, so a single attempt is enough.

### Error classification (locked)

| Failure                             | Class                      | Behavior                                           |
| ----------------------------------- | -------------------------- | -------------------------------------------------- |
| HTTP 4xx (404, 403, etc.)           | Operational, non-retryable | Log + skip immediately                             |
| HTTP 5xx / network / timeout        | Operational, retryable     | Phase 1 retries; phase 2 retry; finally log + drop |
| HTTP 200 + selector returns 0 nodes | Programmer error           | Throw, abort run                                   |

---

## Implementation steps

### Step 1 — Inspect GTN calendar HTML (DONE 2026-05-04)

Fixture captured at [apps/api/test/ingest/fixtures/gran-teatro-nacional-calendario-202605.html](../../apps/api/test/ingest/fixtures/gran-teatro-nacional-calendario-202605.html). Server is Drupal 8 + Apache + PHP 7.3.33; SSR; no anti-bot. `robots.txt` permits `/calendario/*` (the disallow rules target `/admin/`, `/user/*`, `/node/*`, query-string URLs). Event detail URLs use the clean `/evento/<slug>` form, also not disallowed.

**May 2026 fixture totals:** 25 event-occurrence anchors (21 `future`, 3 `past`, 1 `today`), 3 distinct categories present (`folclore`, `montaje`, `musica`).

### Locked structural decisions (from fixture inspection)

**The repeating unit** is a `<td>` with attributes `id="eventos_calendar1-YYYY-MM-DD-N"`, `date-date="YYYY-MM-DD"`, and class containing `single-day`. Inside each event-cell:

- `<time datetime="YYYY-MM-DDTHH:MM:SSZ">HH am/pm</time>` — start time
- `<span class="cat-FOO"></span>` — sibling of `.title`; category derived from class name
- `<span class="title"><a href="/evento/<slug>">TITLE</a></span>` — title and detail link

**Selector strategy:**

| What                  | Selector                                         | Notes                                                  |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| Each event-occurrence | `td[date-date] a[href^="/evento/"]`              | Unique per occurrence; ignores no-entry day cells      |
| Date                  | `td[date-date]` ancestor's `date-date` attribute | More reliable than parsing the `<time datetime>`       |
| Time                  | The cell's `<time datetime>`                     | Strip `Z`, append `-05:00` (see Timezone gotcha below) |
| Title                 | `.title > a` text content                        | Trim whitespace                                        |
| Slug                  | `.title > a` `href` substring after `/evento/`   | Used in `externalId`                                   |
| Category              | Sibling `<span>`'s class matching `^cat-(.+)$`   | Strip `cat-` prefix; preserve verbatim (no remap)      |

**Timezone gotcha — important.** The `<time datetime>` attribute is published as `T17:00:00Z` (UTC) but the visible label is `05 pm` (= 17:00 in 12h). These are inconsistent: GTN serves Lima local time and incorrectly tags it `Z`. The displayed label is the truth. **Drop the `Z`, append `-05:00`** when emitting `startAt`. (Lima is UTC−5 year-round, no DST.) A one-line `// why` comment in the parser code is warranted; this is exactly the kind of bug whose tests pass against themselves.

**`externalId` strategy:** `<slug>:<YYYY-MM-DDTHH:MM>` — e.g. `aida:2026-05-17T17:00`. Stable across re-runs; immune to same-day multi-show collisions (the trailing `-N` on the cell `id` hints these exist).

**Past/present/future:** ingest all entries unfiltered. The scraper faithfully reproduces what GTN publishes; downstream API/UI handles `start_at >= now()` filtering at query time. Lossless capture.

**Maintenance entries (`montaje`, `desmontaje`, `ensayo`):** keep as first-class events with their natural GTN category. Per the v0's "disruption ingestion" framing, "the venue is occupied" is itself a disruption signal worth indexing. No remapping — GTN already classifies them as `cat-montaje` and we preserve that verbatim.

### Step 2 — Write the scraper

**File:** `apps/api/src/ingest/gran-teatro-nacional-scraper.ts` (new).

Exports one async function with the same shape as [stub-scraper.ts](../../apps/api/src/ingest/stub-scraper.ts):

```ts
export async function granTeatroNacionalScraper(log: pino.Logger): Promise<ScrapedEvent[]>;
```

Pass-through requirements (each is a discussion point with the user, not a fait-accompli):

- **HTTP fetch.** Polite `User-Agent` header identifying the project. Respect `robots.txt` (Step 1's curl is the spot to verify the path is not disallowed). One fetch per month-page; loop a configurable window (default current month + next 2). Retry with exponential backoff via the chosen client.
- **Errors classified per [CLAUDE.md](../../CLAUDE.md):** HTTP 4xx → log + skip month (don't fail the whole run); HTTP 5xx / network → operational, retryable, capped attempts; parse failure (selector returned 0 nodes when the page itself loaded) → programmer error, surface immediately.
- **Parsing.** Pull each event's `title`, `startAt` (ISO 8601 with `-05:00` Lima offset — this is the boundary contract per `scrapedEventSchema`), `category`, and a stable `externalId`. Extract `externalId` from the event-detail URL slug — most stable identifier the source provides. Use the detail URL as `sourceUrl`.
- **Optional fields.** `endAt`, `location`, and `sourcePayload`:
  - `endAt` — calendar view does not expose end times. Leave undefined.
  - `location` — calendar view doesn't expose sala-level coordinates either. Leave undefined for v0; the address is fixed (Av. Javier Prado Este 2225, San Borja) and could be hard-coded later, but doing so flattens 1500-seat-multi-hall granularity to one point — defer.
  - `sourcePayload` — store the original parsed sub-object (date string, raw category label, slug) for debugging. Schema is `z.any()`.
- **Logging.** Receive the `runLog` child logger from `index.ts`. Log: one start line with `sourceId`, one summary line per fetched month (`{ month, eventsParsed, durationMs }`), one final summary across months. No per-event logs at `info` level.

### Step 3 — Wire into the runner

**File:** [apps/api/src/ingest/index.ts](../../apps/api/src/ingest/index.ts) (modify).

Replace the call to `stubScraper()` with `granTeatroNacionalScraper(runLog)`. The Zod validation, upsert call, and `closeDb()` finally-block stay identical — that's the whole point of the boundary schema. Do **not** delete [stub-scraper.ts](../../apps/api/src/ingest/stub-scraper.ts) in this commit; remove it as a follow-up trivial commit so the diff for "first real scraper" is single-purpose.

### Step 4 — Scraper unit test

**File:** `apps/api/test/ingest/gran-teatro-nacional-scraper.test.ts` (new). First scraper-test precedent in the repo.
**Fixture:** `apps/api/test/ingest/fixtures/gran-teatro-nacional-calendario-202605.html` (downloaded in Step 1).

Per [docs/ARCHITECTURE.md](../ARCHITECTURE.md) "Test fixtures live with the test" convention. Test does **not** spin up Postgres — this is the parser's contract test, not the pipeline's. Stub the HTTP fetch (the parsing is what we want to pin); the real-HTTP path is exercised by manually running `pnpm -F api ingest` in Step 5.

Assertions:

- Number of parsed events matches the fixture's known event count.
- First and last event's `title`, `startAt` (ISO with `-05:00` offset), `externalId`, `sourceUrl` match expected values.
- Output passes `scrapedEventSchema.array().parse(...)` — the contract test.
- Each event's `sourceId === 'gran-teatro-nacional'`, `state === 'scheduled'`.

Existing pipeline test [apps/api/test/ingest/upsert.test.ts](../../apps/api/test/ingest/upsert.test.ts) does not need changes — its contract is `ScrapedEvent[] in → DB rows out` and we are not changing that contract.

### Step 5 — Manual verification (the actual proof)

1. `pnpm -F api ingest` against local Postgres. Expect: events parsed, `inserted=N`, `updated=0`, `closeDb()` clean shutdown.
2. `pnpm -F api ingest` again. Expect: `inserted=0`, `updated=N`. ADR-003's idempotency contract holds for the first time against real data.
3. `psql` (or Drizzle Studio) into `disruption_intelligence`: spot-check 3 random rows for sane `start_at`, `category`, `source_url`.
4. `pnpm -F api test`. Expect: existing 8 tests + the new scraper test all green.

### Step 6 — Docs

- **PLAN.md** — tick the "One scraper (HTML source, TBD)" checkbox, advance "Last sync point" per the update protocol in [docs/PLAN.md](../PLAN.md) §"Update protocol", rewrite "Next move" to point at `node-cron` wiring.
- **ARCHITECTURE.md** — add a one-paragraph note under a new section _"Scraper conventions"_ capturing the cross-session decisions made here: error-classification mapping (4xx skip, 5xx retry, parse 0-nodes fatal), HTTP retry library choice, fixture co-location reaffirmation, the `User-Agent` policy. This is the kind of thing that would otherwise drift across scrapers if not written down once.
- **No new ADR.** Library choice (Cheerio + undici) is implementation, not architecture; idempotency is already covered by ADR-003. If during implementation a non-obvious _architectural_ decision surfaces (e.g. a plugin abstraction for scrapers), pause and write the ADR before continuing — per [CLAUDE.md](../../CLAUDE.md) "ADRs precede implementation."

### Step 7 — Commit

Per [CLAUDE.md](../../CLAUDE.md) and [docs/PLAN.md](../PLAN.md) update protocol: this work warrants two commits, not one.

1. `feat(api): real scraper for Gran Teatro Nacional` — covers Steps 2, 3, 4 and the new dependencies. The polish-removal of `stub-scraper.ts` is its own follow-up commit.
2. `docs: record Scraper #1 wrap-up + scraper conventions` — PLAN.md update + the ARCHITECTURE.md additions from Step 6.

The Notion sub-page (Pre-implementation step) is its own ledger and does not commit to git.

---

## Critical files

**Will be modified:**

- [apps/api/src/ingest/index.ts](../../apps/api/src/ingest/index.ts) — swap scraper import.
- [apps/api/package.json](../../apps/api/package.json) — add `cheerio` + `undici` (or chosen alternatives) as direct deps.
- [docs/PLAN.md](../PLAN.md) — milestone tick, sync point bump, "Next move" rewrite.
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — new "Scraper conventions" section.

**Will be created:**

- `apps/api/src/ingest/gran-teatro-nacional-scraper.ts`
- `apps/api/test/ingest/gran-teatro-nacional-scraper.test.ts`
- `apps/api/test/ingest/fixtures/gran-teatro-nacional-calendario-202605.html`
- Notion sub-page (not in git): _Source survey log — Scraper #1 (Gran Teatro Nacional)_

**Will be reused (no changes):**

- [packages/shared/src/scraped-event.ts](../../packages/shared/src/scraped-event.ts) — `scrapedEventSchema` and `ScrapedEvent` boundary type. The whole point of this commit is that this contract holds against real data.
- [packages/shared/src/location.ts](../../packages/shared/src/location.ts) — `Location` type. Not used in v1 of the scraper (location left undefined) but contract is intact.
- [apps/api/src/ingest/upsert.ts](../../apps/api/src/ingest/upsert.ts) — boundary conversions (ISO→Date, `{lng,lat}`→PostGIS WKT) stay where they are. Per the existing convention, the scraper emits ISO strings and `{lng,lat}` objects; the upsert layer converts.
- [apps/api/src/log.ts](../../apps/api/src/log.ts) — pino singleton; child loggers via `runLog = log.child({ runId })` already in use in `index.ts` line 9.
- [apps/api/test/setup.ts](../../apps/api/test/setup.ts) — Testcontainers harness. Not used by the new scraper-only test (parser unit test does not need Postgres), but unchanged for the existing pipeline test.

---

## Out of scope

- **`node-cron` wiring.** Next commit. Closes the Week 1 checkpoint.
- **Removing `stub-scraper.ts`.** Trivial follow-up commit immediately after this one.
- **Sala-level location data.** Calendar view doesn't expose it; deferred. If the event _detail_ pages expose hall info, that's a future enrichment commit.
- **Scraper #2.** Per [docs/PLAN.md](../PLAN.md) Week 2: pick a contrasting source (road-closure, news, or Teleticket aggregator that gives us Estadio Nacional events via venue-string match).
- **An ADR for scraper plugin architecture.** Only one scraper exists; the abstraction is premature. Revisit the moment Scraper #2 starts duplicating boilerplate.

---

## Verification

End-to-end after the commit lands:

```bash
# 1. Real ingest against the live source
pnpm -F api ingest
# expect: inserted=N (>10 typically), updated=0, no errors, clean exit

# 2. Idempotency
pnpm -F api ingest
# expect: inserted=0, updated=N — ingested_at preserved, updated_at advances

# 3. Spot-check the data
psql "$DATABASE_URL" -c "SELECT title, start_at, category, source_url \
  FROM events WHERE source_id = 'gran-teatro-nacional' \
  ORDER BY start_at LIMIT 5;"
# expect: realistic concert/theater titles, future dates, valid URLs

# 4. Tests
pnpm -F api test
# expect: 8 existing pipeline tests + new scraper test all green

# 5. Lint / format hygiene
pnpm -F api lint
```

If any of those fail, do not commit — debug per [CLAUDE.md](../../CLAUDE.md) error-classification convention. The most likely failure modes are: GTN HTML structure differs from the fixture (selectors stale), date parsing collides with timezones (Lima is UTC-5 with no DST — straightforward but easy to get wrong), or `externalId` instability across runs (forcing duplicate inserts on re-run, which would be caught immediately by the idempotency check in step 2).
