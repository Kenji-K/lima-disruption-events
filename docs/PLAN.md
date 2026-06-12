# PLAN — Lima Disruption Events

Persistent project state. **Read this first** when picking up the project in a new session — it tracks where work left off, what's running locally, and any non-obvious decisions made since the original kickoff brief.

> **v1 build sprint (2026-06-10 → 2026-06-22).** Mentor mode is retired; the project is in full-speed build mode. The authoritative scope is [`docs/V1-BRIEF.md`](V1-BRIEF.md) (four tiers: close out v0 → deploy + v0.5 sources → v1 sources → stretch). The Week 1–3 milestones below remain valid as Tier-0/Tier-1 detail; the brief governs everything beyond them.

This file is the single source of truth for "what now?". Update it after any commit that advances a milestone, changes local state, or records a decision that diverges from or refines the brief.

---

## Session pickup checklist

When picking up the project in a fresh chat, run through this before doing any new work:

1. **Read this file (`docs/PLAN.md`), `CLAUDE.md`, and [`docs/V1-BRIEF.md`](V1-BRIEF.md).** CLAUDE.md is auto-loaded; this file and the brief you should re-read each session — this file changes between sessions, the brief is the sprint's scope fence.
2. **Confirm git state matches "Current state" below:** read the **Last sync point** in _Current state_; if `git log <sync-sha>..HEAD` is non-empty, work landed after this file was last synced — read those commits before trusting "Next move."
3. **Read the "Next move" section below.** That's the immediate task. If it doesn't make sense given the rest of the file, ask the user before proceeding — PLAN.md may have drifted from reality.

If anything in step 2 looks wrong, surface it to the user before changing code. If the local stack isn't responding when you go to run code, the setup is documented in `CLAUDE.md` and `docker-compose.yml` — don't re-derive it from scratch. The kickoff brief that started this project is **one-shot** (not committed in the repo) — do not expect to find it in conversation history. PLAN.md, CLAUDE.md, [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), and the ADRs in [`docs/adr/`](adr/) are the only authoritative project artifacts.

---

## Milestones

### Week 1 — Backend spine (~22h)

- [x] pnpm workspace scaffold (`apps/{api,web}`, `packages/{db,shared}`)
- [x] Node 24 LTS + pnpm 10.33.2 pinned (`.nvmrc`, `engines`, `packageManager` w/ SHA-512)
- [x] `docker-compose.yml` — Postgres 16 + PostGIS 3.5 (no Redis)
- [x] **ADR-003** — idempotent upsert via `(source_id, external_id)`
- [x] **ADR-001** — BRIN index on `event_start_at` _(pulled forward from Week 2; see "ADR-first ordering" below)_
- [x] **ADR-002** — GiST index on `events.location` geography column _(pulled forward from Week 3)_
- [x] **ADR-004** — co-locating API + DB on Fly's private network _(pulled forward from Week 3)_
- [x] Drizzle schema for `cities` + `events` tables; first migration applied locally
- [x] Idempotent upsert pipeline with structured logs (pino) _(stub-driven; HTTP-fetch retry lands at the scraper layer with the real source)_
- [x] One scraper (HTML source) writing through the idempotent upsert pipeline _(Gran Teatro Nacional — see [`docs/plans/scraper-1-gran-teatro-nacional.md`](plans/scraper-1-gran-teatro-nacional.md))_
- [x] `node-cron` wired in-process; one scheduled job invoking the scraper _(daily 06:00 America/Lima; `pnpm -F api cron`)_
- [x] Integration tests: scraper happy path, idempotent re-run, schema-validation rejection
- [x] **Checkpoint:** `pnpm -F api ingest` runs the scraper on demand, cron runs it on schedule, re-running produces zero duplicates, tests pass _(verified end-to-end: 83 events, idempotent re-run inserted=0/updated=83, 18 tests green)_

### Week 2 — API + frontend scaffold (~22h)

- [x] Fastify HTTP API: `GET /events` (filtered list), `GET /events/:id`, `GET /healthz` _(Fastify 5 + fastify-type-provider-zod; filters `from`/`to`/`category`/`source`/`limit`; cron attached to the Fastify lifecycle in `main.ts`)_
- [x] OpenAPI spec auto-generated from Zod via `fastify-type-provider-zod` _(served at `/docs`, spec at `/docs/json`; accuracy spot-checked by test + verifier)_
- [x] Second scraper plugged into the same pipeline (proves the abstraction) _(futbolperuano.com Liga 1 — JSON-LD `Review.itemReviewed` extraction, static venue map, home-team filter; see scraper-2 plan)_
- [x] Vite + React + Tailwind app scaffold _(Vite 8 + React 19 + Tailwind 4; es-PE UI per ARCHITECTURE.md)_
- [x] MapLibre map with event markers, basic event list view, both wired to TanStack Query _(markers grouped per venue with count badge + event-picker popup; OpenFreeMap tiles)_
- [x] **Checkpoint:** Frontend at localhost shows real events from the API on a map and a list _(verified in-browser 2026-06-10: 90 events / 2 sources)_

### Week 3 — Polish, deploy, document (~22h)

- [x] Event detail drawer; filters (date range, category) _(landed in Tier 0 alongside the scaffold; also a source filter; drawer routes at `/eventos/:id`, map re-centers under drawer padding)_
- [x] Sentry on API and web _(2026-06-11: error-capture only, DSNs via Fly secret / Vercel env; delivery verified from both apps)_
- [x] Deploy API + Postgres to Fly.io _(2026-06-11: region `gru` per ADR-008 — Fly retired `scl`; plain Machines app with official postgis image per ADR-006; API ↔ DB over `6PN`; migrations+seed via `release_command`)_
- [x] Deploy frontend to Vercel _(2026-06-11: <https://lima-disruption-events.vercel.app>, local-prebuilt deploys — see README "Deploying" + ARCHITECTURE.md Vercel notes)_
- [ ] README rewrite — architecture diagram (Mermaid), screenshots, live URL, "10x scale" section, scope statement _(operational README landed 2026-06-11: live URLs, deploy runbook, prod-DB access; diagram/screenshots/10x treatment still open)_
- [ ] `docs/ARCHITECTURE.md` (with "Deferred decisions" section listing BullMQ/Redis, multi-region, read replicas, etc.)
- [ ] `docs/DATABASE.md` (schema rationale, index choices, VACUUM/autovacuum paragraph)
- [ ] 3-minute Loom walkthrough
- [ ] **Checkpoint:** Live URL works, README is shareable, Loom is recorded

---

## Definition of done for v0

- [x] Live URL reachable on the public internet _(2026-06-11: <https://lima-disruption-events.vercel.app> + <https://disruption-intelligence-api.fly.dev>)_
- [x] At least 20 real events from at least 2 sources visible _(live 2026-06-11: 95 events from 5 sources on the public URL)_
- [x] Re-running the ingest pipeline produces zero duplicates _(verified 2026-06-10: second run `inserted=0, updated=90` for both sources)_
- [x] All five ADRs (001, 002, 003, 004, 005) written and committed _(005 added 2026-05-06: regions as generic hierarchical dimension)_
- [x] API and Postgres deployed to the same Fly region; API connects to DB over `6PN` _(2026-06-11: both in `gru`, `DATABASE_URL` → `disruption-intelligence-db.internal:5432`, DB app has no public IP)_
- [ ] DATABASE.md includes the VACUUM/autovacuum paragraph (interview-rehearsable, concrete not abstract)
- [ ] ARCHITECTURE.md includes a "Deferred decisions" section with revisit triggers
- [ ] README has architecture diagram, live URL, "10x scale" section
- [x] Integration tests pass against real Postgres _(44 tests / 4 files on Testcontainers PostGIS as of 2026-06-10)_
- [x] OpenAPI spec generated and accurate _(fresh-context verifier matched spec fields against live responses 2026-06-10)_
- [ ] `CLAUDE.md` reflects the actual current commands and conventions
- [ ] Loom recorded and linked from README
- [ ] **Disruption-density check (T+30 days)** — once both scrapers have been live in production for 30 days, document weekly event count, geographic spread across Lima, and source-mix. This is the cheap evidence for Notion plan Tesis premise #2 (the assumption that public sources are dense enough to assemble a useful Lima calendar; see also Aulet Tema 5 Step 21). Closing this loop is the most useful learning the v0 can produce. Fires after deploy, not as part of the 3-week sprint.

---

## Current state

**Branch:** `main`. Local and `origin/main` are in sync at the sync point below. For the authoritative since-Initial commit list, run `git log --oneline 4ae7626..HEAD`.

**Last sync point:** `93661bc docs: persist 2026-06-12 road-source survey`. HEAD as of this update; covers the feasibility+usefulness session of 2026-06-12 (overnight, `/goal`-driven): ADR-011 + recall-measurable gates (`94f67de`, `f7a1ab8` migration 0006, `d3714c3`), demo-week web batch + venue names (`f7a…/d7e6920`, migration 0007), correctness batch (`1290ac8`), timed demo flip (`cba32dc`), curated import batch (`…`), source survey (`93661bc`). 162/162 tests, typecheck/lint clean, **API (×2) + web redeployed to prod**, curated rows imported into prod, montaje/descanso + bad-MML rows purged from prod. If `git log 93661bc..HEAD` shows commits beyond this sync-bump, read them before trusting "Next move."

**Production (live since 2026-06-11; redeployed 2026-06-12 ~01:30 and ~02:40 Lima):** web <https://lima-disruption-events.vercel.app> · API <https://disruption-intelligence-api.fly.dev> (`/events`, `/road-alerts`, `/sources`, `/healthz`, `/docs`). Fly apps `disruption-intelligence-api` (one always-on machine; crons in-process: daily ingest 06:00 América/Lima + road-alert sync `15 */2 * * *`) and `disruption-intelligence-db` (postgis image, volume `pg_data`, 6PN-only), both region `gru` (ADR-008). Migrations 0000–0007 run via `release_command`. **Prod data state:** all 12 scraper sources + `manual-curated` fresh in `/sources`; 6 curated road disruptions live (3 visible in the default hoy→+30d window); GTN montaje/descanso filler (19 rows) and the bad MML row purged. **Demo flip:** `EXPOSE_GATED_SOURCES_UNTIL=<ISO>` Fly secret lifts the gate until that instant, self-relatching (owner decision 2026-06-12; README runbook). **Incident note 2026-06-11 ~21:21:** the DB machine was suspended by an account-side action (event log `source: user`) and restarted by the owner ~01:13; the API self-recovered — config needs no change (no autostop path exists). Deploy runbook + prod-DB access: README. Vercel CLI traps: ARCHITECTURE.md.

**Local stack running:**

- Node **24.15.0** via fnm; pnpm **10.33.2** pinned via `packageManager` + Corepack (with SHA-512 hash).
- Docker Compose stack on `:5432` — Postgres **16.10** + PostGIS **3.5.3** on arm64 (`imresamu/postgis:16-3.5`). Image's init scripts auto-load PostGIS plus the `tiger` and `topology` schemas into the `disruption_intelligence` DB; the migration's `CREATE EXTENSION IF NOT EXISTS postgis` is therefore a no-op locally but kept in the migration so prod / fresh-clone runs work.
- Local DB: name `disruption_intelligence`, user `disruption_intelligence`, password `disruption_intelligence` (dev-only, in `.env.example`). Connection: `postgres://disruption_intelligence:disruption_intelligence@localhost:5432/disruption_intelligence`.
- **Local `.env` required** at the repo root for `pnpm -F @disruption-intelligence/db migrate` / `generate` / `seed` to run. Gitignored; create with `cp .env.example .env`. Both `drizzle.config.ts` (kit) and `packages/db/src/client.ts` (runtime) load it via `process.loadEnvFile('../../.env')` from `packages/db/`.
- **Local-stack startup sequence:** `pnpm install` → `docker compose up -d` → `pnpm -F @disruption-intelligence/db migrate` → `pnpm -F @disruption-intelligence/db seed`. The seed is idempotent (`ON CONFLICT DO NOTHING`), so re-running is safe. Coordinate or name corrections for region rows go through a new migration with an explicit `UPDATE`, never via editing `seed.ts`.
- Schema applied: `regions` (ADR-005; 25 Peru level-1 rows), `events` (ADR-009 `dedup_key` + partial index, migration 0004; `venue_name` + per-source backfill, migration 0007), `ingest_state` (ADR-007), `ingest_quarantine` (ADR-011 recall surface, migration 0006), and `road_alerts` (ADR-010 snapshot mirror, migration 0005). Local events as of this sync: ~180 (70 GTN after the montaje/descanso drop + Liga 1 + news + 3 recurring + 80 joinnus + 20 costa-21 + 6 manual-curated). Indexes per ADRs 001/002/003; migrations 0000–0007 in `drizzle.__drizzle_migrations`.
- **Dev servers:** `pnpm -F api dev` → Fastify on `:3000` (tsx watch, cron attached); `pnpm -F web dev` → Vite on `:5173` (expects the API at `http://localhost:3000`; override via `VITE_API_URL`).

**Workspace structure (post-sync):**

- `packages/db` — public surface via `exports: { ".": "./src/index.ts", "./seed": "./src/seed.ts" }`. Top-level barrel re-exports both the schema barrel (`regions`, `events`) and `client.ts` (`db`, `closeDb`). The separate `./seed` subpath exports `seed(db)` so the test setup and the `pnpm seed` CLI can pull it without dragging the seed call through the main barrel. Runtime Drizzle client mirrors drizzle-kit's `casing: 'snake_case'` — see ARCHITECTURE.md "Drizzle runtime client conventions" for why both sides need the option.
- `packages/shared` — public surface, exports `scrapedEventSchema`/`ScrapedEvent` (Zod boundary type for scraper output; optional `sourceUrl` and ADR-009 `dedupKey`), `locationSchema`/`Location`, `apiEventSchema`/`ApiEvent` and `apiRoadAlertSchema`/`ApiRoadAlert` (the api↔web response contracts), and `newsDedupKey()` (ADR-009 headline slugifier). The `endAt > startAt` cross-field refine compares Date instants to handle mixed offsets safely. No string→Date `.transform()` — that conversion belongs in the upsert layer, not the validation boundary.
- `apps/api` — ingest pipeline (11 live sources + road-alert mirror) + HTTP API:
  - `src/ingest/fetch.ts` — shared `fetchWithRetry` (two-phase retry; extracted from GTN per the scraper-2 plan). All scrapers consume it. Imports `ca.ts`, which appends the Sectigo OV R36 intermediate to the process CA set (munlima.gob.pe serves an incomplete TLS chain — see ca.ts comments).
  - `src/ingest/gran-teatro-nacional-scraper.ts` — Cheerio parser of `granteatronacional.pe/calendario/YYYYMM` over a 3-month window. Three GTN-HTML quirks handled in-line with comments: repeat-cell `<time datetime>` carries the first occurrence's date (combine `td.date-date` + `<time>` time-of-day instead); empty `cat-*` class on uncategorized events falls back to `'proximamente'`; `"¡Es gratis!"` overrides popup text on free events but the `cat-*` class is the source of truth. Every event now pinned to the theatre's fixed venue point (San Borja, OSM-verified).
  - `src/ingest/futbolperuano-scraper.ts` + `futbolperuano-venues.ts` — Liga 1 scraper: listing → home-team filter (URL slug ∈ 3 Lima clubs) → per-match JSON-LD `Review.itemReviewed` SportsEvent; `externalId` = the URL's `m<digits>` suffix; static venue map with OSM-verified stadium coords; venue cross-check / unmapped `eventStatus` / missing Review block all throw as programmer errors; 1.5s spacing between detail fetches.
  - `src/ingest/mml-scraper.ts` — source #3 (MML WordPress feed): incremental `?after=` poll (ADR-007 cursor), full-object fetches (the WAF blocks `_fields=…content` — see in-file comments), ADR-011 gates (shared trigger vocabulary + road-context/proximity + date-past guard), rule-based dates via `extract-dates.ts`, `location=null`. Extraction returns an outcome union: event | quarantined | skipped.
  - `src/ingest/quarantine.ts` + `ingest_quarantine` table — ADR-011 recall surface: every keyword-positive post a gate rejects is persisted with its reason (idempotent on source+post); the runner writes them, write failures never fail a source run.
  - `src/ingest/gate-audit-cli.ts` (`pnpm -F api audit-gates [days]`) — replays the live gates over real MML + gob.pe post history (HTML listing backfill) without touching the DB; the 60-day 2026-06-12 run measured the old gates at ~42% precision and found the "cierran" recall miss that drove ADR-011.
  - `src/ingest/lima-expresa-scraper.ts` — source #4 (pressroom): listing → `/news/{slug}.html` details, seen-URL cursor (failed details retry next run), JSON-LD NewsArticle headline/datePublished, announced-window dates with publication fallback, trigger-only filter (road context implicit).
  - `src/ingest/recurring-events.ts` — source #5: hardcoded reference entries (Lima 42K 2026, 117° Media Maratón 2026-08-23, Gran Parada Militar 07-29) with inline provenance URLs + OSM-verified coords; no Peru NT home fixtures existed to include as of 2026-06-11 (documented in-file).
  - `src/ingest/extract-dates.ts` — shared rule-based Spanish date extraction (ranges, "a partir del", bare dates, year inference with rollover; `parseSpanishDate` for full text dates).
  - `src/ingest/road-filter.ts` — the shared road gates (ADR-011): ONE trigger vocabulary for MML + gob.pe (no `clausura` — 4/4 premises-enforcement FPs; with third-person present forms — their absence cost a real Vía Expresa closure), road-context terms incl. multiword arteries, proximity window, closure-keyword classifier.
  - `src/ingest/gob-pe-scraper.ts` — Tier-2 sources #6–#9 (one factory, four registry entries `gob-pe-{atu,sutran,mtc,munilima}`): `noticias.json` listing (`?page=` ignored upstream — first page only), trigger prefilter on truncated title+description, detail-page `<main>` fetch for keyword-positive items only (4xx = warn+skip per C2; transient still freezes the cursor), ADR-011 gates incl. the rebuilt positive Lima-Metropolitana vocabulary for national institutions (review A1 — bare `lima`/national-road names are out), cursor = max numeric news id. Events carry ADR-009 dedupKeys; rejects are quarantined.
  - `src/ingest/joinnus-scraper.ts` + `joinnus-venues.ts` — source #10: sitemap-driven (politest crawl surface), `/events/{concerts,sports,futbol}/lima-*` filter, JSON-LD Event extraction, seen-id cursor. **TIME TRAP:** Joinnus labels Lima wall-clock as UTC (page shows 9:00p where JSON-LD says 21:00Z) — timestamps re-anchored to -05:00, pinned by test. Static OSM-verified venue map (Estadio Nacional, Arena Perú). Teleticket DROPPED at build time (image-based microsites + robots-disallowed listings); Jockey/Arena Perú venue sites unreachable — their events arrive via ticketers.
  - `src/ingest/costa21-scraper.ts` — source #11: first-party "Próximos Shows" cards, Teleticket slug as externalId, DD-MM-YYYY at date precision, template-junk cards skipped, no sweep (sold-out shows leave the carousel — absence ≠ cancellation), no pin (venue not in OSM).
  - `src/ingest/sutran-alerts.ts` — ADR-010 road-alert snapshot mirror: the SUTRAN viewer's own HTTPS bootstrap (`carga_xlsx.php?tipo=MAPA`; the brief's MTC GeoServer is dead — verified), Zod-validated three-level payload, transactional full replace into `road_alerts`, freshness under `ingest_state` `sutran-alerts`, never throws into the run loop. 2-hourly cron (`15 */2 * * *`) + membership in the daily run.
  - `src/ingest/import-events.ts` + `import-cli.ts` — Ord. 1680 manual-import path: `pnpm -F api import-events <file.json|csv>` through the same Zod boundary + upsert (named `import-events`; pnpm shadows `import`). Batch sourceIds colliding with the scraper registry are rejected (A9). `data/imports/2026-06-12-manual-curated.json` is the committed curated batch (6 verified road disruptions; dedupKey pinned to each OFFICIAL headline so a future scraper re-extraction suppresses per ADR-009 instead of duplicating; the file ships in the Docker image so it can be re-imported on the prod host via `fly ssh console`).
  - `src/ingest/state.ts` + `run.ts` — ADR-007 plumbing: `runIngestOnce(log, scrapers?)` reads each source's cursor, persists `nextCursor` only after validate+upsert succeeds, records failures (`consecutiveFailures`, `lastError`) without breaking per-source isolation; `ingest_state.last_success_at` is the per-source freshness fact.
  - `src/ingest/upsert.ts` — Bulk insert + `.onConflictDoUpdate` keyed on `(sourceId, externalId)` per ADR-003; boundary conversions (ISO→Date, `{lng,lat}`→PostGIS WKT); inserted-vs-updated count via `RETURNING (xmax = 0)`; `regionId` resolved by single `regions.slug = 'lima' AND country_code = 'PE' AND level = 1` composite lookup. **ADR-009 cross-channel suppression lives here:** an incoming news event whose `dedupKey` exists under another source with `start_at` within ±14d is dropped (first channel wins; scraper order puts mml before gob.pe), suppressions returned to the caller and logged.
  - `src/ingest/schedule.ts` — `createIngestTask(log)`: daily 06:00 `America/Lima`, `noOverlap`, error-classified tick logging. `src/main.ts` (the `pnpm -F api dev`/`start` entrypoint) attaches it to the Fastify lifecycle (onClose stops it + drains the pool); `src/cron.ts` remains a thin standalone dev runner over the same module.
  - `src/server.ts` + `src/api/{routes,schemas}.ts` — Fastify 5 + `fastify-type-provider-zod`; `GET /healthz` (DB ping, 503 when unreachable), `GET /events` (filters `from`/`to`/`category`/`source`/`limit`; **from/to are overlap semantics** — `start_at <= to AND COALESCE(end_at, start_at) >= from`, fixed this session), `GET /events/:id`, `GET /road-alerts` (current snapshot, worst-first), `GET /sources` (per-source freshness; deliberately no `lastError` text — public endpoint); OpenAPI at `/docs`; CORS open; `src/env.ts` Zod-validates PORT/HOST at boot.
  - `test/` — 162 tests / 16 files: fixture-driven parser tests for every scraped source (incl. the two live MML false positives as ADR-011 regression fixtures and the recovered "cierran" Vía Expresa closure), dedup-key + suppression tests, quarantine-wiring integration test, registry-invariant test (A5: gated ⊆ registry), road-alert/import/visibility-gate (incl. the timed flip relatching mid-process) and Testcontainers pipeline/API/ingest-state integration tests. `pnpm test` at the root runs everything.
- `apps/web` — Vite 8 + React 19 + Tailwind 4 + MapLibre GL + TanStack Query + react-router 7, **plus shadcn/ui since 2026-06-12** (init absorbed by the FreshnessChip per the workshop decision: `@/` alias, components.json, Geist font, `components/ui/`). Default view window **hoy→+30d** (`dates.ts`; FilterBar shows the effective dates), filter bar in URL params, sidebar list (venue names, date-only rendering for whole-day events, sin-ubicación notices), grouped markers with capped header popups, drawer with `Lugar` (venueName → coords → "sin ubicación"), nav control bottom-left + es-PE MapLibre locale, freshness chip from `/sources`, and the SUTRAN road-alert layer (only `restringido`/`interrumpido` get markers + a 2-chip legend; toggle carries the incident count; `?alertas=0` persists). Events query has staleTime + keepPreviousData. UI text es-PE with `America/Lima` Intl formatting. API responses Zod-validated at the fetch boundary.

**Uncommitted work in tree:** none — tree is clean as of the sync point above.

---

## Next move

**Tier 0 DONE (06-10) · Tier 1 DONE (06-11) · Tier 2 DONE (06-11) · Feasibility+usefulness directive DONE (2026-06-12 overnight session)** — every item of the owner's post-review `/goal` shipped and is live:

1. **Feasibility:** ADR-011 recall-measurable gates (quarantine table + date-past guard + unified vocabulary + A1 Lima-gate rebuild), measured against a 60-day replay (old gates ~42% precision; new config kills 7/7 FPs, keeps 6/6 TPs incl. one recovered miss); both bad MML rows gone (prod + local; kept as regression fixtures); **6 verified road disruptions imported to prod** (`manual-curated`, each with official provenance, 3 visible in the default window — review G1's "zero forward-looking road disruptions" is answered); source survey persisted at [`docs/research/2026-06-12-road-source-survey.md`](research/2026-06-12-road-source-survey.md) (Rutas de Lima DEAD — liquidated 2025-12-03; EMAPE = config-only high-density find; open-data portals conclusively useless).
2. **Usefulness:** the full demo-week web batch (default window, venue names end-to-end, freshness chip — first shadcn/ui component, date-only rendering, alert legend + normal-hiding, montaje/descanso dropped + purged, cluster-popup cap, sin-ubicación notices, U1 zoom fix, es-PE locale) — deployed and verified in-browser on the live URL.
3. **Correctness batch:** all eight review-§3 items closed (A1 via ADR-011, C2, A2, A5, A6, A9, C3, A4-as-amended).
4. **Owner amendment (2026-06-12):** prod demos use `EXPOSE_GATED_SOURCES_UNTIL` — a self-relatching timed flip (per-request evaluation, pinned by test); the bare boolean is localhost-only.

**Queued follow-ups (next session picks up here):**

0. **Owner strategy discussion pending** on the session's verdict — findings memo: [`docs/research/2026-06-12-feasibility-usefulness-verdict.md`](research/2026-06-12-feasibility-usefulness-verdict.md) (platform feasible; programmatic-only road supply validated insufficient; lever menu incl. X8 + EMAPE decisions inside). Expect direction changes from that discussion before assuming the plan below holds.
1. **Observe the first post-ADR-011 06:00 tick** (2026-06-12): `ingest_quarantine` should gain its first prod rows — MML post 79872 (INDULTOS) must land as `past-event`, NOT in `events`; check tick duration and `/sources`.
2. **Decide the source-survey shortlist** (owner go/no-go, then ~config-only): EMAPE registry entry + district slug pack (`munisanjuandelurigancho`, `muniate`, `munilamolina`, `munilavictoria`, `munisantiagodesurco`) on the existing gob.pe scraper; metrolima2.com + Miraflores RSS are real (small) builds, post-sprint.
3. **Open-ended windows bite now** (X2): 3 of the 6 curated rows have no stated end and drop out of `from=`-windowed views (served by the API, invisible in the default demo window). The lifecycle/`openEnded` fix is the post-sprint X2 item — pull it forward if the demo needs those rows on the map.
4. Then the workshop demo-cut plan resumes: **Tier 3 thin slice** (gate verifier-passed 2026-06-11, deadline 06-17, time-box 1.5d) → docs day (X5/X6 disruption-entity+authority ADR **before Ord. 1680 data arrives**, A8 mechanism records incl. the visibility gate + timed flip, ADR-002/003 errata, V1-BRIEF refresh) → Loom.

---

## Known issues / review backlog

Two five-lens reviews feed this list: 2026-06-10 (pre-deploy) and **2026-06-11 post-Tier-2 — full findings with evidence and IDs (A/C/G/X/U) in [`docs/reviews/2026-06-11-tier2-review.md`](reviews/2026-06-11-tier2-review.md)**; the three priority batches from it live in Next move above. Items below are the carried tracker; review-doc IDs in parentheses where they overlap:

1. ~~`/events` from/to filter on `start_at` only~~ — CLOSED 2026-06-11 (`bb2966b`): overlap semantics, `COALESCE(end_at, start_at) >= from` (not the sketched `end_at IS NULL OR…`, which would have matched past point events).
2. **ADR staleness:** ADR-003/002 errata — one amendment ADR on docs day (workshop decision). V1-BRIEF "What exists today" stale since Tier 0.
3. **Region resolution hard-codes Lima** in `upsertEvents`; needs ADR-first backfill plan when the first non-Lima source lands. The A1 leak feeding it is CLOSED 2026-06-12 (ADR-011 positive Lima-metro vocabulary; Nazca/Rioja regression fixtures) — but the stamp itself remains a single hard-coded lookup.
4. **Demo polish (web):** mostly CLOSED 2026-06-12 (staleTime/keepPreviousData, es-PE MapLibre locale, easeTo dep fix, default window). Remaining: filter dropdowns derive options from filtered results (one-way trap); native date inputs follow browser locale (U17 — demo from an es-PE browser).
5. **Partial indexes** (`regionId, state='scheduled'`) serve no current API query — revisit with the map query shape.
6. **Test debt:** vitest unit/integration split (parser tests boot pointless containers — now 14 files, several pure); fetch layer still not injectable (orchestration untested across 7 network scrapers); no web tests (the alert-layer toggle was browser-verified manually); healthz 503 untested.
7. ~~Keyword-filter recall unknown~~ — CLOSED 2026-06-12 (ADR-011): measured against 60 days of history, continuously measurable via `ingest_quarantine`, periodically re-measurable via `pnpm -F api audit-gates`. Standing watch: review quarantine rows for systematic `non-lima`/`past-event` misjudgments.
8. **Carried operational notes:** gob.pe `?page=` ignored upstream (first-page-only — fine at daily cadence); Joinnus ~3–4 min inside a full tick (observed at boot catch-up 2026-06-11); road-alert history discarded by design (ADR-010); Costa 21 venue has no OSM entry (events unpinned + now labeled "Sin ubicación"); `dedupKey` not auto-generated by the import path (the curated batch sets it explicitly to the official headline's key).
9. **Smaller (carried):** futbolperuano conditional GETs; `LOG_LEVEL` outside env schema; `@types/node@^25` vs Node 24 pin; stale `@types/node-cron`; `fromDriver` EWKB cast is a typed lie (road-alert reads sidestep it via ST_X/ST_Y); `schedule.ts` ZodError classification is dead code; `ingest/index.ts` side-effectful module name; per-source counts in the run summary; no `Cache-Control` on `/events`; 500-row limit silent truncation; `pnpm lint:md` MD060 on V1-BRIEF; recurring-events manual refresh (Parada Militar plan ~mid-July).

## Open questions / decisions deferred

Decision workshop 2026-06-11 closed every standing item; owners noted per item. Queued for the **Tier-2 session**: futbolperuano visibility gate + `GET /sources`. Queued for **docs day (after Tier 3 closes — shipped or auto-cut)**: ADR-002/003 amendment, V1-BRIEF "What exists today" refresh, promote the demo-fence definition below into the brief/ARCHITECTURE.md.

- **NEW (06-11, founder directive) — parallel research: another country as an alternative starting point.** A hedge against Lima's thin programmatic road-source density (review P1), not a beachhead change: desk-research whether a LatAm metro with richer official open data (first candidates: Santiago, Bogotá, CDMX, São Paulo) would demonstrate feasibility faster. Tracked as **Registro de Brechas #29** in Notion (strategy work, not build work — the v1 single-city fence is unchanged; ADR-005's regions hierarchy already accommodates `country_code` conceptually).
- **NEW (06-11 review, X8) — derived "venue congestion" datum from gated sources:** a stripped derivation (venue + window + "evento masivo", no fixture/teams/prices) from joinnus/futbolperuano data would put Estadio Nacional matchdays on the PUBLIC map. Plausibly transformation rather than redistribution-as-fixture-data, but it is the user's ToS/legal judgment to make — do not build without an explicit go.

- **futbolperuano data on the public URL** — RESOLVED 2026-06-11: **gate it.** BUILT same day (`ec92bd9`): `GATED_SOURCE_IDS = ['futbolperuano', 'joinnus']` excluded from public `/events` + `/events/:id`; `EXPOSE_GATED_SOURCES=true` lifts it for demos. Per-source public-visibility flag; public `/events` excludes gated sources; env flag re-enables them for demos. Same mechanism serves Teleticket/Joinnus at Tier 2 — build once. Owner: Tier-2 session. **Demo-fence definition (all gated sources):** "internal + demo use only" = controlled-audience rule — gated data may appear only where the user controls the audience (localhost; live demos with the flag flipped for the meeting; unlisted materials sent directly to a prospect); never on the always-on public URL, README assets, or anything indexable. **AMENDED 2026-06-12 (owner):** prod-app meeting flips are explicitly in-policy via the self-relatching `EXPOSE_GATED_SOURCES_UNTIL` secret (review A4's forget-to-unset hazard is engineered away; the bounded open-internet exposure during the window is the owner's accepted ToS judgment).
- **Tier 3 (route-awareness stretch)** — RESOLVED 2026-06-11: **gated go-after-Tier-2.** Authorized as a thin slice only (1–2 seeded demo routes, `ST_DWithin` proximity endpoint, route overlay + nearby-disruptions list; no route-input UI). Gate: Tier-2 acceptance verifier-passed by EOD 2026-06-17; time-box 1.5 days; auto-cut without renegotiation if the gate fails.
- **Demo-cut plan (through 06-22)** — RESOLVED 2026-06-11: after Tier-2 acceptance, sequence = (1) web demo polish ≤1 day (backlog #5; must-have lands before the stretch), (2) Tier 3 thin slice (gate permitting), (3) docs day — entered once Tier 3 closes (shipped or auto-cut), i.e. once the demo surface is final, since it captures screenshots/diagram/README claims (README rewrite w/ Mermaid + screenshots + 10x section, DATABASE.md incl. VACUUM paragraph, ARCHITECTURE.md deferred-decisions expansion, CLAUDE.md command sync, ADR-002/003 amendment), (4) Loom recorded last, after docs day, + final wrap (sprint closes 06-22 — the external demo deadline, the one date that stays a date). Cut order if squeezed: venue calendars → Tier 3 (auto-gate) → DATABASE.md depth → README 10x trim. Never cut: web polish, README core, Loom.
- **shadcn/ui or Tailwind-only** — RESOLVED 2026-06-11: **adopt shadcn/ui for new components** — production basis the product grows from. Existing Tailwind UI stays (no retrofit sprint); applies from the next new component after this date (in-flight Tier-2 layer work is not reworked); one-time init absorbed by whichever session builds that first component.
- **Per-source freshness visibility** — RESOLVED 2026-06-11: ship a tiny read-only **`GET /sources`** over `ingest_state`; `/healthz` stays pure liveness. SHIPPED same day (`62fd3fc` + `fbd152b` — `lastError` text deliberately omitted from the public response).
- **ADR-002/003 staleness (backlog #2)** — RESOLVED 2026-06-11 (timing): **one** amendment ADR covering both errata (002: nullable location is by design; 003: as-shipped columns + deliberate state update on conflict), written on docs day to avoid ADR-number collisions with the live Tier-2 session. Owner: docs-day session.
- **MML Ley de Transparencia letter** — SENT 2026-06-11 (Mesa de Partes Virtual). Response window 7–30 business days ≈ 2026-06-22 → 2026-07-23; the Ord. 1680 import path proceeds against sample data meanwhile. Tick the brief's human-prereq checkbox at next docs touch.
- **Discovery-conversation cadence (Notion Supuesto #1)** — consciously PAUSED 2026-06-11 until after the sprint (resumes post-06-22). Caveat: demo-audience outreach for the 06-22 demo still happens during the sprint despite the pause.
- **Map tile provider** — RESOLVED 2026-06-10 (v1 re-scope): default OpenFreeMap (no key, no account); swap to MapTiler only if the user supplies a key. Recorded in V1-BRIEF Tier 0.
- **Postgres machine size on Fly** — RESOLVED 2026-06-11: shared-cpu-1x / 512MB per app (ADR-006); size up only on observed bottleneck.
- **"Known issues" section** — RESOLVED 2026-06-11: self-resolved — the "Known issues / review backlog" section above exists with real content; slot question closed.
- **v2 candidates — LLM-assisted extraction** — parked 2026-06-11; gate AMENDED at the 2026-06-11 workshop: **milestone-based, not date-based**. Unparks the moment Tier 2 + gated Tier 3 + the demo-cut list (polish, docs, Loom) are all complete, even if before 06-22 — explicit user amendment to the brief's LLM fence; first step then is eval prep (hand-label ~12 real MML posts as regression fixtures). Use cases ranked: (1) _parser-failure diagnosis_ — one call per incident attaching a fix hypothesis to the Sentry event; advisory-only, zero data risk; (2) _news-post extraction_ (MML/gob.pe) — LLM as just-another-parser behind `scrapedEventSchema`: keyword filter stays as cost firewall, `externalId` stays deterministic (WP post id per ADR-007), content-hash caching, grounding check (extracted date/place strings must appear in source text), confidence fallback to region-level, model never emits coordinates (place names resolve via gazetteer); (3) _cross-channel dedup judge_ for pairs the canonical-URL/title+date rules can't decide (cached verdicts); (4) _Ord. 1680 PDF transcription_ into the manual-import path, human-reviewed. Rejected: runtime LLM fallback for broken parsers (masks drift, defeats loud-failure design; quarantine-table variant only if ever needed). **Cost is a non-factor at our volume** (~10 keyword-positive posts/day ≈ 600k in / 90k out tokens/mo): Groq Llama 8B ≈ $0.04/mo, Llama 4 Scout ≈ $0.10, OpenAI gpt-5.4-nano ≈ $0.23, Claude Haiku 4.5 ≈ $1.05 — all with ~50% batch discounts (daily cron is batch-shaped), all rounding errors vs Fly hosting (prices checked 2026-06-11). **Decide by eval, not price:** build the call site provider-agnostic (text in → Zod-validated JSON out), hand-label ~12 real MML posts as regression fixtures, run them across Groq/Haiku/gpt-nano and promote the winner; weight extraction fidelity (esp. Spanish dates/times — wrong-hour errors are the worst failure for fleet ops; consider an "estimado" UI flag) over the irrelevant cost delta. Diagnosis use case wants a stronger model (Haiku/Sonnet tier) — still pennies per incident. Real budget line = eval-set hours, not API dollars; log tokens-per-run in ingest_state from day one.

---

## Update protocol

After each work session that advances the project, update this file:

1. Tick milestone checkboxes for items completed
2. Refresh **Current state** (bump **Last sync point** to the new HEAD, update what's running if it changed)
3. Rewrite **Next move** to reflect the new pickup point
4. If a non-obvious choice was made that needs cross-session memory, add it to [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) (or write an ADR if it's a major architectural decision)
5. **Ship the wrap-up as one commit.** Stage this PLAN.md update plus any ARCHITECTURE.md or ADR additions made during the session and commit them together as a single `docs: record [unit] wrap-up + [non-obvious decisions]` commit (e.g. `docs: record Commit C wrap-up + Drizzle runtime client conventions`). The `Last sync point` field above stays pointing at the commit _before_ the wrap-up — the wrap-up itself is expected to appear in the next session's `git log <sync>..HEAD` diff (that's how Current state stays synchronized with the recorded SHA). Small same-session follow-ups (a meta-doc fix, a typo, a forgotten dep bump) that land after the wrap-up just show up in the same diff and get read together; sync point doesn't need to be re-bumped per follow-up. The agent does not auto-fire this; the user pulls the trigger.

Don't update for trivial commits (formatting, comment fixes). Do update when a milestone advances or a non-obvious decision is recorded. Keep the file under ~250 lines; if it grows past that, sweep settled decisions into ADRs and stale "open questions" out.
