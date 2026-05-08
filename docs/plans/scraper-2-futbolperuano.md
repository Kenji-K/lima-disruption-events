# Plan — Scraper #2: futbolperuano.com (Liga 1, three Lima clubs)

## Context

**What is the change.** Add the second real scraper to the v0 ingest pipeline, targeting [`https://www.futbolperuano.com/liga-1/`](https://www.futbolperuano.com/liga-1/). Scope is intentionally narrow: only matches where the **home team** is Universitario de Deportes, Alianza Lima, or Sporting Cristal — the three Lima-based Liga 1 clubs whose stadium attendance and location generate city-scale traffic disruption (Monumental ~80K in Ate; Alejandro Villanueva / Matute ~35K in La Victoria; Alberto Gallardo ~18K in San Martín de Porres). After this lands, the v0 has two sources writing through one boundary contract — exactly the proof-point the Definition of Done in [`docs/PLAN.md`](../PLAN.md) calls for ("≥20 real events from ≥2 sources"), with the second source carrying real disruption-intelligence value (Notion plan Tema 5 Supuesto Clave #2 — public sources can assemble a useful Lima disruption calendar at acceptable cost and precision).

**Why not FPF, Sofascore, Transfermarkt, liga1.pe, or per-club sites.** These were all evaluated in the source-survey log for this scraper at [Bitácora de fuentes — Scraper #2 (futbolperuano.com Liga 1)](https://www.notion.so/35803c87ab7081f4960fde3c9753c6c5) (Notion). One-line summaries: FPF API only has 2024 historical data (2025 is registered but empty; 2026 isn't registered at all); Sofascore and Transfermarkt have hostile robots.txt and ToS; liga1.pe is a WordPress shell embedding Sofascore iframes; per-club sites have asymmetric coverage (Cristal HIGH, Universitario MEDIUM via JS-rendered tabs, Alianza Lima LOW behind an SPA) and three different scraper shapes for a v0 sprint is too much. **Teleticket** is rejected globally for ToS reasons (forbids automated ingestion); recorded in [Bitácora de fuentes — Scraper #1](https://www.notion.so/35603c87ab7081a5a839cbd954048450) alongside Songkick/Bandsintown.

**Intended outcome.** `pnpm -F api ingest` runs both GTN and futbolperuano scrapers in sequence through the same `upsertEvents()` pipeline. Re-running produces zero duplicates (ADR-003 holds for the second source). The first time a non-GTN row lands in `events`, ADR-005's regions table (via the migration shipped alongside this scraper) is exercised against real data — even though all three target stadiums map to the same Lima level-1 row, the rename + the venue-resolver pattern is now in place for Scraper #3+.

---

## Mentor-mode posture

Per [CLAUDE.md](../../CLAUDE.md) "Mentor mode," this is a learning task. The user writes the scraper module, the venue/region map, the migration, the test, and the integration glue. The agent's role: teach concepts before code (JSON-LD parsing patterns; schema.org `Review.itemReviewed` indirection; ADR-005's region resolution pattern; Drizzle migration for the rename + seed in one go), hints before answers, review what the user writes and explain why. The plan, the ADR, the PLAN.md / ARCHITECTURE.md updates, and the Notion writes are prose — those the agent can draft directly.

---

## Pre-implementation: source-survey already captured

The Notion source-survey log [Bitácora de fuentes — Scraper #2](https://www.notion.so/35803c87ab7081f4960fde3c9753c6c5) is the canonical record of:

- Candidates evaluated and rejected (FPF, Sofascore, Transfermarkt, liga1.pe, per-club sites, news-fixture pages).
- Empirical validation already performed (2026-05-06): 13 sequential requests at 1–2s intervals, all HTTP 200, latency 246–2094ms (avg 558ms), no Cloudflare / no rate-limit headers / no anti-bot.
- ToS analysis: Interlatin Corp's Clause 1(f) prohibits content reproduction; v0 is internal-pipeline-only so within risk; v0.5+ customer-facing requires a partnership conversation with Interlatin (parallel to the eventual Joinnus / Teleticket pattern).
- Politeness rules: descriptive User-Agent, ≥1-2s interval between requests, aggressive cache (re-fetch only when matchday changes), no verbatim HTML/JSON-LD redistribution downstream.
- Risk register entry **R9** ([Registro de Riesgos](https://www.notion.so/34b03c87ab708104bc2ed4ee6c2fa04d)): single-source dependence on a third-party aggregator. Mitigations: news-fixture-page snapshots (Infobae, TV Perú) as terciary fallback; per-club site scraping if futbolperuano shape changes; Interlatin partnership at v0.5+.

This plan does not duplicate that work; it implements against it.

---

## Library decisions (locked 2026-05-06)

No new direct deps. The scraper reuses `apps/api`'s existing toolkit:

- Node 24 built-in `fetch` + the same hand-rolled retry wrapper used by GTN. **Action item:** extract the retry wrapper out of `gran-teatro-nacional-scraper.ts` into `apps/api/src/ingest/fetch.ts` as `fetchWithRetry(url, log, retryBackoffsMs?)` so both scrapers share it. ARCHITECTURE.md's "Scraper conventions" section already flagged this: "extract to a shared helper when scraper #2 starts duplicating it." Time to deliver.
- `cheerio` (already in `apps/api`) for the listing-page parse. JSON-LD blocks come out via a regex over the raw HTML — `cheerio.load(...).html('script[type="application/ld+json"]')` round-trips cleanly enough but a regex is simpler and avoids a needless DOM walk for what is a single text node.

No JSON-LD-specific library. Manual `JSON.parse` is fine for our shape.

---

## Source mechanics

Two-stage scrape:

1. **Listing page.** `GET https://www.futbolperuano.com/liga-1/` returns ~233KB of HTML containing every match in the current visible window (recently played + upcoming matchdays). Each match is linked via an anchor whose `href` matches `^/liga-1/<home-slug>-vs-<away-slug>-<dd>-<month-name>-<yyyy>-liga-1-peru---torneo-<phase>-m<id>$`. Filter to anchors where the URL slug starts with one of the three target home-team slugs (`alianza-lima`, `sporting-cristal`, `universitario-de-deportes`). The trailing `m<digits>` suffix is the source's stable match identifier — this becomes our `externalId`.

2. **Per-match detail page.** For each filtered URL, `GET` it (~250KB HTML) and extract the `<script type="application/ld+json">` block whose decoded JSON has `@type === 'Review'`. The match data lives in `Review.itemReviewed` with `@type === 'SportsEvent'`. Fields used:

   | JSON-LD path | Maps to `ScrapedEvent` field |
   |---|---|
   | `description` (`"Alianza Lima vs Moquegua"`) | `title` |
   | `startDate` (ISO 8601 with `-05:00` offset, e.g. `"2026-05-02T20:00:00-05:00"`) | `startAt` |
   | `endDate` (ISO 8601, source's two-hour rule of thumb) | `endAt` |
   | `competitor[0].name`, `competitor[1].name` | also captured into `sourcePayload` |
   | `location` (e.g. `"Estadio Alejandro Villanueva  - Perú"` — note the double space, normalize) | drives venue resolution |
   | `eventStatus` (`"EventScheduled"` / cancelled / postponed) | maps to `state` (`'scheduled'` / `'cancelled'`) |
   | `name` (`"Liga 1 Perú - Torneo Apertura - 2026 - Fase Regular"`) | `category` is `'futbol'` (stable string, not the noisy phase label) |

   The schema.org `eventAttendanceMode` field is buggy on this source (returns `OnlineEventAttendanceMode` for in-person matches); ignored.

**Politeness in code.**

- User-Agent: `'disruption-intelligence/0.1 (+contact: TBD)'` — same convention as GTN; contact suffix gets a real value once the repo is public (per ARCHITECTURE.md "Polite User-Agent — never personal").
- Sequencing: 1.5s sleep between detail-page fetches (centred on the Notion bitácora's "1–2s" range). Listing fetch is unsleeped (one request).
- The retry wrapper (`fetchWithRetry`) handles 5xx / network / timeout per scraper conventions. 4xx is logged and skipped per match; the pipeline does not abort just because one detail page 404s.

---

## Region + venue resolution (per ADR-005)

A static map at `apps/api/src/ingest/futbolperuano-venues.ts`:

```ts
type ClubKey = 'universitario-de-deportes' | 'alianza-lima' | 'sporting-cristal';

export const VENUES: Record<ClubKey, {
  stadiumName: string;
  // exact 'location' string we expect from the JSON-LD payload (with double-space quirk preserved)
  jsonLdLocationContains: string;
  regionSlug: 'lima';
  regionCountryCode: 'PE';
  regionLevel: 1;
  // PostGIS point for events.location — captured from public sources, see comments in the file
  lng: number;
  lat: number;
}> = {
  'universitario-de-deportes': { /* Estadio Monumental, Ate */ ... },
  'alianza-lima':              { /* Estadio Alejandro Villanueva, La Victoria */ ... },
  'sporting-cristal':           { /* Estadio Alberto Gallardo, San Martín de Porres */ ... },
};
```

**Resolution at scrape time:**

1. From the URL slug, extract the home-team key.
2. If not in `VENUES`, **skip** the match (this is how the home-team filter is implemented — fall through is "not a target club").
3. Otherwise, resolve the region via a single `regions.slug = 'lima' AND country_code = 'PE' AND level = 1` lookup at upsert time (cached for the run; the same lookup GTN uses). Set `events.location` to the venue's `(lng, lat)` PostGIS point.
4. Defensive cross-check: if the JSON-LD `location` string doesn't `.includes(VENUES[key].jsonLdLocationContains)`, throw — this catches Liga 1 venue swaps (e.g. a club temporarily relocating). Per scraper conventions, that's a programmer error: stop, alert, update the map.

**No runtime region or venue inserts.** ADR-005 rule 1: scrapers never write to the `regions` table.

---

## ExternalId derivation

Take the `m<digits>` suffix from the URL slug. e.g. for `/liga-1/alianza-lima-vs-deportivo-moquegua-2-mayo-2026-liga-1-peru---torneo-apertura-m3230710`, the externalId is `m3230710`. This is the source's own stable match identifier. No derivation from team-IDs + date is needed (unlike the rejected FPF path), because futbolperuano *does* expose a stable id per match and embeds it in the URL.

`sourceId = 'futbolperuano'`. `(sourceId, externalId)` pair is unique per ADR-003.

---

## Error classification (apply existing scraper conventions verbatim)

Per ARCHITECTURE.md "Scraper conventions":

| Failure | Class | Behavior |
|---|---|---|
| Listing page HTTP 5xx / network / timeout | Operational, retryable | `fetchWithRetry` — phase-1 retries, then phase-2 single retry, then **abort the run** (no listing = no work) |
| Listing page HTTP 4xx | Operational, non-retryable | Throw (this is the entry point — a 4xx means the URL changed) |
| Listing parser found 0 target-club matches | **Programmer error if listing was non-empty** | Throw — futbolperuano's HTML structure changed. **Acceptable if listing was empty** (off-season): log a warn and complete with zero events. |
| Detail page HTTP 5xx / network / timeout | Operational, retryable | `fetchWithRetry` per match. If exhausted, log warn + skip the match — don't fail the whole scrape. |
| Detail page HTTP 4xx | Operational, non-retryable | Log warn + skip the match. |
| Detail page has no `Review`-typed JSON-LD block | Programmer error | Throw — futbolperuano structure changed. |
| JSON-LD `Review.itemReviewed.@type !== 'SportsEvent'` | Programmer error | Throw — same as above. |
| Venue defensive cross-check failed (`location` string mismatch with map) | Programmer error | Throw — venue moved or renamed. |
| `eventStatus` is a value we haven't seen before | Programmer error | Throw — schema.org ambiguity, surface and decide. |

The "0 target-club matches in a non-empty listing" case is a real failure mode (e.g. all three Lima clubs are away simultaneously). The implementation distinguishes "0 matches in a populated listing" (programmer error) from "0 matches in an empty listing" (info log, complete cleanly).

---

## Schema migration (regions + rename, ships with this commit)

Per ADR-005, one Drizzle migration runs *before* this scraper writes anything:

1. `ALTER TABLE cities RENAME TO regions;`
2. `ALTER TABLE regions ADD COLUMN country_code char(2) NOT NULL DEFAULT 'PE';` then drop the default once the existing Lima row is updated.
3. `ALTER TABLE regions ADD COLUMN level smallint NOT NULL DEFAULT 1;` — drop default after.
4. `ALTER TABLE regions ADD COLUMN parent_id integer REFERENCES regions(id);` — nullable; CHECK enforces level=1 ⇔ parent_id IS NULL.
5. `ALTER TABLE regions ADD COLUMN iso_code text;`
6. `ALTER TABLE regions ADD CONSTRAINT regions_level_parent_check CHECK ((level = 1 AND parent_id IS NULL) OR (level > 1 AND parent_id IS NOT NULL));`
7. `ALTER TABLE regions ADD CONSTRAINT regions_country_level_slug_uq UNIQUE (country_code, level, slug);`
8. `ALTER TABLE events RENAME COLUMN city_id TO region_id;` plus rename of the matching indexes (`events_city_*` → `events_region_*`).
9. UPDATE the existing `Lima` row: set `country_code='PE'`, `level=1`, `iso_code='PE-LIM'`.
10. INSERT the remaining 24 Peru level-1 rows: 23 departamentos + Provincia Constitucional del Callao. Slug, name, iso_code (ISO 3166-2), capital-city centroid, timezone (`'America/Lima'` for all).
11. Drizzle schema files: rename `packages/db/src/schema/cities.ts` → `regions.ts`, update `events.ts` FK, update `packages/db/src/schema/index.ts` exports.

GTN's existing 83 events keep their FK target via the column rename. The upsert layer's lookup string updates to `regions.slug = 'lima' AND country_code = 'PE' AND level = 1` — same query, same result row.

---

## Implementation steps

### Step 1 — Drizzle migration + schema rename (regions table) and seed script

Split into two commits per the migration-vs-seed plan ([`~/.claude/plans/drizzle-schema-migration-should-greedy-bee.md`](../../../../.claude/plans/drizzle-schema-migration-should-greedy-bee.md)):

- **1a.** Hand-author the migration (per ARCHITECTURE.md "Migrations are append-only" and "Drizzle Kit gotcha"); update Drizzle schema; verify against the local Postgres via `pnpm -F @disruption-intelligence/db migrate`. The existing GTN events must still be visible afterward. After this commit, `regions` has exactly one row (Lima, fully populated).
- **1b.** Author `packages/db/src/seed.ts` + `seed-cli.ts` + the `pnpm seed` script + `./seed` exports entry + the `apps/api/test/setup.ts` integration. Source the 24 new region rows from INEI's canonical UBIGEO publication (official Peruvian government source); document provenance per row. Idempotent via `ON CONFLICT DO NOTHING`. After this commit, fresh setup produces 25 region rows.

**No scraper changes in either step** — both land before the scraper so the diff for each is reviewable independently.

### Step 2 — Extract `fetchWithRetry` to `apps/api/src/ingest/fetch.ts`

Lift the `fetchMonthHtml` logic out of GTN, generalize the URL parameter, keep the same two-phase retry semantics. Update GTN to import the shared helper. Tests (existing GTN scraper test) should still pass without changes.

### Step 3 — Write `apps/api/src/ingest/futbolperuano-scraper.ts`

Exports one async function with the same shape as GTN:

```ts
export async function futbolperuanoScraper(log: pino.Logger): Promise<ScrapedEvent[]>;
```

Internally: list → filter → fetch each detail page (1.5s spacing) → JSON-LD extract → assemble `ScrapedEvent[]`. Reuses `fetchWithRetry`. Logs one start line, one summary per detail-page batch, one final summary line.

### Step 4 — Write `apps/api/src/ingest/futbolperuano-venues.ts`

Static `VENUES` map for the three target clubs with stadium name, expected JSON-LD location substring, region tuple, and lng/lat. Coordinates pulled from public sources (OSM / Wikipedia); commit message records the source URL per stadium.

### Step 5 — Wire into the runner

`apps/api/src/ingest/run.ts` (`runIngestOnce`) gains a second scraper invocation. Both scrapers' results flow into `upsertEvents()` — the boundary contract holds. If one scraper throws and the other doesn't, the throwing scraper's run is logged and the run continues with the other scraper's output (per the "scrape A failure must not block scrape B" extension of the existing "failed scrape must not block next scheduled run" rule).

### Step 6 — Tests

- `apps/api/test/ingest/futbolperuano-scraper.test.ts` — pure parser test. Does **not** spin up Postgres. Two fixtures already saved at `apps/api/test/ingest/fixtures/`:
  - `futbolperuano-liga-1-listing.html` — the `/liga-1/` index. Asserts: number of target-club matches matches the fixture's known count; the URL extraction yields valid `m<digits>` external-IDs.
  - `futbolperuano-match-alianza-lima-vs-moquegua-m3230710.html` — one detail page. Asserts: JSON-LD extraction returns the expected `Review.itemReviewed` block; `ScrapedEvent` fields (title, startAt, endAt, externalId, sourceUrl) match expected values; schema parse passes; `sourceId === 'futbolperuano'`; `state === 'scheduled'`.
- A second detail-page fixture (Cristal home match, `m3230727` was visible in current listing) added at first opportunity for venue-map coverage. Not blocking the first commit.
- `apps/api/test/ingest/upsert.test.ts` — unchanged. Boundary contract holds.
- The existing pipeline test (Testcontainers) needs one targeted update: the seed of `cities` becomes seed of `regions`, and the test row's `region_id` lookup uses `slug='lima'` instead of `cities.slug='lima'`. No new test cases added at this step.

### Step 7 — Manual verification (the actual proof)

1. `pnpm -F api ingest` against local Postgres. Expect: GTN's 83 events still ingest correctly; futbolperuano writes ~5–15 new rows for the current matchday; `inserted=N`, `updated=83+`, `closeDb()` clean shutdown.
2. `pnpm -F api ingest` again. Expect: `inserted=0`, `updated=83+N`. ADR-003 idempotency holds for both scrapers.
3. `psql $DATABASE_URL -c "SELECT title, start_at, source_id FROM events ORDER BY start_at LIMIT 10;"` — spot-check rows from both sources.
4. `pnpm -F api test`. Expect: existing 18 tests + new scraper test all green.

### Step 8 — Docs

- **PLAN.md** — tick the "Second scraper plugged into the same pipeline" checkbox in Week 2; advance "Last sync point"; rewrite "Next move" toward Fastify.
- **ARCHITECTURE.md** — append a one-paragraph note under "Scraper conventions": "fetchWithRetry now lives in `apps/api/src/ingest/fetch.ts` as the shared helper; futures scrapers consume it." If the venue-resolver pattern feels worth crystallising (it does — every new scraper after GTN will need its own resolver), a short bullet under ADR-005's banner cross-referencing the static-map shape used for futbolperuano.
- **No new ADR.** ADR-005 already covers the regions decision. The static-venue-map pattern is explicitly delegated by ADR-005 to per-scraper choice — no architectural ADR is warranted for it. If during implementation a non-obvious cross-cutting decision surfaces, pause and write the ADR before continuing.

### Step 9 — Commits

Per [CLAUDE.md](../../CLAUDE.md), [PLAN.md](../PLAN.md) update protocol, and the migration-vs-seed split ([`~/.claude/plans/drizzle-schema-migration-should-greedy-bee.md`](../../../../.claude/plans/drizzle-schema-migration-should-greedy-bee.md)), this work warrants four commits.

1. `feat(db): rename cities → regions, add hierarchy columns (ADR-005)` — Step 1a. Migration + schema rename + GTN scraper's lookup-string update. After this commit, regions has only the Lima row.
2. `feat(db): add seed script + 24 Peru level-1 regions` — Step 1b. seed.ts + seed-cli.ts + package.json scripts + test setup integration + PLAN.md local-stack update. After this commit, fresh DB setup produces 25 region rows.
3. `refactor(api): extract fetchWithRetry to shared helper` — Step 2. The lift-out of GTN's retry logic.
4. `feat(api): real scraper for futbolperuano.com Liga 1 (Universitario, Alianza Lima, Sporting Cristal)` — Steps 3–6. Scraper module + venue map + integration glue + tests + fixtures.

PLAN.md / ARCHITECTURE.md wrap-up updates ride a fifth commit (`docs: record Scraper #2 wrap-up`) per the standard wrap-up convention.

ADR-005 itself lands as its own commit (`docs(adr): 005 — regions as generic hierarchical dimension`) per CLAUDE.md "One ADR per commit," ahead of any of the implementation commits above.

---

## Critical files

**Will be created:**

- `apps/api/src/ingest/futbolperuano-scraper.ts`
- `apps/api/src/ingest/futbolperuano-venues.ts`
- `apps/api/src/ingest/fetch.ts` — shared `fetchWithRetry` helper.
- `apps/api/test/ingest/futbolperuano-scraper.test.ts`
- `apps/api/test/ingest/fixtures/futbolperuano-liga-1-listing.html` *(already saved during recon)*
- `apps/api/test/ingest/fixtures/futbolperuano-match-alianza-lima-vs-moquegua-m3230710.html` *(already saved during recon)*
- `packages/db/src/schema/regions.ts` (renamed from `cities.ts`).
- A new Drizzle migration under `packages/db/drizzle/` covering the rename + seed.
- `docs/adr/005-regions-as-generic-hierarchical-dimension.md` *(already drafted alongside this plan)*.

**Will be modified:**

- `apps/api/src/ingest/gran-teatro-nacional-scraper.ts` — switch to importing `fetchWithRetry` from the shared helper.
- `apps/api/src/ingest/run.ts` — add the second scraper invocation.
- `apps/api/src/ingest/upsert.ts` — region lookup string updates from `cities.slug = 'lima'` to `regions.slug = 'lima' AND country_code = 'PE' AND level = 1`.
- `apps/api/test/setup.ts` — pipeline-test seed: `cities` → `regions`, with the new columns populated.
- `packages/db/src/schema/events.ts` — FK column rename `cityId` → `regionId`; index renames.
- `packages/db/src/schema/index.ts` — export rename.
- `docs/PLAN.md` — milestone tick + sync-point bump + Next-move rewrite.
- `docs/ARCHITECTURE.md` — small additions to "Scraper conventions" (shared fetchWithRetry, per-scraper venue resolver pattern reference).

**Will be reused unchanged:**

- `packages/shared/src/scraped-event.ts` — `scrapedEventSchema` and `ScrapedEvent`. The whole point of this commit is that the contract holds across a second source with a completely different shape (HTML calendar vs JSON-LD detail pages).
- `apps/api/src/ingest/upsert.ts` boundary conversions (ISO→Date, `{lng,lat}`→PostGIS WKT).
- `apps/api/src/log.ts` — pino singleton.
- `apps/api/src/cron.ts` — cron schedule attaches to the unchanged `runIngestOnce`; no cron-level changes.

---

## Out of scope

- **Liga 2 and Liga Femenina.** futbolperuano covers them on `/liga-2/` and `/liga-femenina/` (or similar paths) with the same JSON-LD shape, but Lima venues there don't generate the same disruption signal as the Liga 1 big-3. Defer.
- **Selección Mayores fixtures.** Future Scraper #3+ candidate. Different data source (FIFA / CONMEBOL Eliminatorias have multi-year forward-looking calendars from federation sources independent of FPF's API).
- **Liga 1 visiting matches at the three target stadiums when away clubs travel to Lima.** Already captured — when, e.g., Alianza Lima hosts a non-Lima club, the home-team-is-Alianza filter catches it. The "away" perspective (e.g. Universitario visiting Cusco) is intentionally NOT ingested for v0 — the disruption is felt in Cusco, not Lima.
- **Match status changes (postponed → rescheduled, suspended).** Source's `eventStatus` field maps to our `state` directly. Re-runs of the scraper update `state` via the `(sourceId, externalId)` upsert per ADR-003. No special handling.
- **Pulling team logos / player rosters.** Not events; ignore.
- **Sala-level / district-level region resolution.** ADR-005 explicitly defers level-2 (provincias) and level-3 (distritos). All three target stadiums map to level-1 Lima. When level-2/3 lands, the resolver upgrades to spatial-join via `events.location` against the new polygon tables — no scraper change.

---

## Verification

End-to-end after the three feat/refactor commits land:

```bash
# 1. Schema rename worked
pnpm -F @disruption-intelligence/db migrate
# expect: idempotent — no work if already applied
psql "$DATABASE_URL" -c "SELECT count(*), count(*) FILTER (WHERE level=1) AS top FROM regions;"
# expect: 25 / 25

# 2. Real ingest against both live sources
pnpm -F api ingest
# expect: GTN inserted=0/updated=83 (idempotent re-run); futbolperuano inserted=N (5-15 typical), updated=0; clean exit

# 3. Idempotency on the second source
pnpm -F api ingest
# expect: GTN inserted=0/updated=83; futbolperuano inserted=0/updated=N

# 4. Spot-check the data
psql "$DATABASE_URL" -c "SELECT source_id, count(*) FROM events GROUP BY source_id;"
# expect: gran-teatro-nacional | 83; futbolperuano | N

psql "$DATABASE_URL" -c "
  SELECT title, start_at, source_id, source_url
  FROM events WHERE source_id = 'futbolperuano'
  ORDER BY start_at LIMIT 5;
"
# expect: titles like 'Alianza Lima vs Moquegua', startAt with -05:00 offset, valid futbolperuano.com URLs

# 5. Tests
pnpm -F api test
# expect: 18 existing tests + new scraper test (~5 cases) all green
```

If any of those fail: do not commit; debug per CLAUDE.md error-classification convention. The most likely failure modes are the Drizzle Kit `geography(Point, 4326)` quoting gotcha re-emerging on the new region rows' centroid column (per ARCHITECTURE.md), the venue defensive cross-check tripping on a `location` string variation we haven't seen, or `eventStatus` returning a value the parser doesn't recognize (suspended / postponed Liga 1 matches — surface and add to the parser's status map before continuing).
