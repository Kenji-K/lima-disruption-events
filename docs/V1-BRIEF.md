# V1 Build Brief — Disruption Intelligence data platform

**Status:** Active build spec. Created 2026-06-10. This file is the authoritative scope for the v1 build sprint — it distills the Notion plan's product spec so build sessions never need Notion access. If this brief and Notion disagree, this brief wins for build scope; surface the conflict to the user for anything strategic.

**Sources distilled here:** Notion *Mapa de fuentes de datos — selección y roadmap (v0 → v1)* (2026-05-04, updated 2026-05-06), its subpage *Fuentes programáticas Lima sin solicitud formal — inventario validado* (2026-05-08), *Tema 5 Paso 22 (MVBP)*, and the Etapa 2 entry criteria.

---

## Mission and context

I'm the solo founder of Disruption Intelligence. The window through **2026-06-22** is a full-speed build sprint: ship the v1 data platform end to end so real Lima disruption coverage can be demoed to fleet-operator prospects. This is production code and the first live slice of the actual business — CLAUDE.md conventions are non-negotiable. Mentor mode is retired; build directly.

**Versioning decoder:** v0 / v0.5 / v1 are *product release cycles* (defined by the source roadmap). Etapa 0/1/2 are *business stages*. v1 ≈ the artifact for the Etapa 0 → 1 transition. This sprint builds the product releases; it does not attempt the MVBP business wrapper (contracts, invoicing, advisory) — see Out of scope.

**What exists today:** see `docs/PLAN.md` (always current). Summary: pnpm monorepo, Drizzle schema (`regions` hierarchical dimension + `events` with PostGIS geography point, BRIN/GiST indexes, idempotent upsert on `(source_id, external_id)` per ADR-003), one live scraper (Gran Teatro Nacional), node-cron daily run, 18 Testcontainers/fixture tests, five ADRs. No HTTP API, no frontend, no deploy yet.

---

## Build order — four tiers

Tiers are strictly ordered; each tier's acceptance criteria gate the next. Within a tier, order is the agent's call.

### Tier 0 — Close out v0 (pipeline + API + frontend, local)

1. **`refactor(api): extract fetchWithRetry`** — lift the two-phase retry wrapper out of `gran-teatro-nacional-scraper.ts` into `apps/api/src/ingest/fetch.ts`. GTN tests pass unchanged.
2. **futbolperuano.com Liga 1 scraper** — per `docs/plans/scraper-2-futbolperuano.md`. Listing at `https://www.futbolperuano.com/liga-1/` (`div.match` → match URLs, filter home team ∈ {Universitario, Alianza Lima, Sporting Cristal} via URL slug); per-match detail page carries a schema.org JSON-LD `SportsEvent` (nested inside `Review.itemReviewed`) with `startDate`/`endDate` (TZ `-05:00`), `location`, `competitor[]`, `eventStatus`. Static venue→region fallback map (Monumental/Matute/Gallardo → Lima level-1) for null/unexpected `location`. Fixtures already in tree at `apps/api/test/ingest/fixtures/futbolperuano-*.html`.
3. **Fastify HTTP API** — Fastify 5 + `fastify-type-provider-zod`; endpoints `GET /healthz` (ok + DB ping), `GET /events` (filters: `from`, `to`, `category`, `source`, `limit`; time-range query exercises ADR-001), `GET /events/:id` (404 if missing). OpenAPI auto-generated from the Zod schemas, served at `/docs`. Attach the cron schedule to the Fastify lifecycle (decision already leaned in PLAN.md — one process, one logger).
4. **Frontend** — Vite + React + Tailwind + MapLibre GL + TanStack Query + react-router. Map with event markers + filterable list, event detail drawer, filters (date range, category, source). UI text in **es-PE** with `America/Lima` formatting (ARCHITECTURE.md "Customer-facing language"). Map tiles: default **OpenFreeMap** (no key, no account); swap to MapTiler only if the user supplies a key.

**Accept when:** ≥20 real events from 2 sources render on the local map and list; re-running ingest inserts 0 duplicates; all tests green (each scraper has a fixture-driven parser test; pipeline tests on Testcontainers); OpenAPI spec accurate at `/docs`.

### Tier 1 — Deploy + v0.5 sources

1. **Deploy** — API + Postgres co-located on Fly.io, single region, talking over `6PN` (ADR-004); migrations + seed chained via Fly `release_command`; cron live in prod. Frontend on Vercel. Sentry on API and web. *Blocked on user-provided accounts/secrets — see Human prerequisites. If blocked, build everything up to the final `deploy` command (Dockerfile, fly.toml, Vercel config, env schema) and continue with the source work.*
2. **MML WordPress feed** — `https://www.munlima.gob.pe/wp-json/wp/v2/posts` (WP REST; RSS at `/feed/` only returns 10 newest). Useful params verified 2026-05-08: `?search=`, `?after=<ISO>`, `?per_page=100&page=N`, `?_fields=id,title,link,date,excerpt`. Strategy: incremental `?after=<last_run>` polls + Spanish keyword filter over `title.rendered + content.rendered` (`cierre`, `vía`, `interferencia`, `desvío`, `obra`, `cerrada`, `corte`, `clausura` — tune against reality). High false-positive rate without the filter (MML posts everything through this channel). Rule-based date/place extraction from post text; events that can't be precisely located get `regionId` = Lima level-1 and `location = null` (schema already allows it).
3. **Lima Expresa pressroom** — `https://prensa.limaexpresa.pe/` (Symfony listing; detail at `/news/{slug}`). **Trap:** `www.limaexpresa.pe/feed/` returns 200 but is empty — the pressroom subdomain is the real source. Covers Vía Expresa Paseo de la República, Vía de Evitamiento, Línea Amarilla — the three highest-signal arteries in Lima. ~1–3 posts/week; cache seen-URL set, process deltas.
4. **Hardcoded recurring events** — Peru national-team home matches (~6–8 per qualifying cycle, all Estadio Nacional, from official FIFA/CONMEBOL calendars) + Maratón Lima 42K and the annual race calendar (predictable date + route). Ship as additive reference-data entries (seed-style, idempotent, provenance URL documented inline per ARCHITECTURE.md provenance rules).
5. **Venue direct calendars** — Costa 21, Jockey Club, Arena Perú (first-party, no ToS friction, big-concert traffic signal). Lowest priority in this tier; drop to Tier 2 if time-pressed.

**Accept when:** live public URL serves events from ≥4 sources; cron runs in prod; re-ingest in prod produces 0 duplicates; data freshness < 24h (Etapa 2 exit criterion, pulled forward); Sentry receiving from both apps.

### Tier 2 — v1 sources

1. **gob.pe multi-institution news job** — `https://www.gob.pe/institucion/{slug}/noticias.json` for slugs `atu` (corridor closures, Metropolitano detours), `sutran` (national-highway alerts), `mtc` (road works), `munilima` (MML mirror). Identical JSON shape across institutions (verified 2026-05-08): `{title, description, url, image}`, ~10 items/page; historical backfill via the HTML listing `?sheet=N&sort_by=recent`. Same keyword-filter + extraction approach as the MML feed. **Dedup warning:** `munilima` on gob.pe mirrors `munlima.gob.pe` WP posts, and official comunicados replicate across channels — cross-source dedup of news-derived events is a real design problem (canonical-URL or title+date similarity; ADR-worthy, agent's design call).
2. **SUTRAN/MTC geospatial alert layer** — SUTRAN's public viewer (`gis.sutran.gob.pe/alerta_sutran/`) sits on a public MTC GeoServer: `http://mtcgeo2.mtc.gob.pe:8080/geoserver/MTC_pg/red_vial_nacional/wms` (also `red_vial_departamental`, `red_vial_vecinal`). Standard WMS ops confirmed; GeoServer typically exposes WFS too — try `GetFeature&outputFormat=application/json&bbox=<Lima Metropolitana>`. Three alert levels (normal / restringido / interrumpido). This is the only native-geospatial source and the map-layer differentiator for the pitch. **Risk:** port-8080 infra, may be down without notice — degrade gracefully (skip + warn, never block the run; optional fallback: scrape the viewer HTML).
3. **Teleticket / Joinnus ticketers** — *approved for v1* in the source map (permissive robots.txt as of the 2026-05 survey, high-value concert/stadium coverage incl. Estadio Nacional). Re-verify robots.txt + ToS at build time before writing the scraper; politeness rules below apply with extra care (commercial sites).
4. **MML Ord. 1680 road-interference authorizations** — the legally canonical road-closure source (organizers *must* file 15 days ahead). **Blocked on the Ley de Transparencia request** (drafted 2026-05-06; response takes 7–30 business days; district municipalities are a second wave). Do not scrape-hunt for this; instead design the ingest so a structured manual-import path exists (CSV/JSON import command that writes through the same idempotent upsert), ready for whenever the data arrives in whatever shape (likely PDFs → manual transcription at first).

**Accept when:** all programmatic Tier-2 sources ingesting on schedule; road-alert layer renders on the map as its own toggleable layer; per-source ingest freshness visible (at minimum in logs/healthz; a tiny `/sources` status endpoint is a fine touch); cross-channel news dedup demonstrably working (same comunicado from munlima + gob.pe → one event).

### Tier 3 — STRETCH, not yet authorized

Thin route-awareness: client routes stored as geometries, PostGIS `ST_DWithin` proximity flagging, "disruptions near this route this week" view. This crosses the old v0 fence (route-impact analysis) and is the demo magnet for fleet prospects — but it is **pending an explicit go from the user**. Ask before starting it; do not drift into predictive impact modeling regardless.

---

## Expansion pressure this puts on the existing design

Flagged so they're designed deliberately, not discovered mid-scrape. How to solve each is the agent's call (ADR-first for the non-trivial ones, numbered 006+):

- **Category taxonomy grows** — `concert`/`sport` era ends; news-derived events need `road_closure`, `road_work`, `road_alert`, `civil` (marches/paros), etc. Canonical list lives in the API/Zod layer per the schema comment, not the DB.
- **Source registry** — 8+ sources by Tier 2 (vs 2 today). Per-source freshness/last-run/failure tracking wants a home (table or structured logs + healthz).
- **Unstructured-text extraction without ML** — keyword filter + rule-based date/place extraction only. No LLM/NER-model features in v1 (out-of-scope fence). Accept region-level granularity when extraction fails; precision improves at the source level (Ord. 1680 data) rather than the parsing level.
- **News dedup across channels** — see Tier 2 item 1.
- **Geospatial layer vs point events** — SUTRAN alerts are line/segment-shaped, not points. Decide: separate table/layer vs forcing into `events`. (Lean: separate — they're observations with their own lifecycle, not calendar events. Agent decides, ADR if structural.)

## Operating constraints — politeness, ToS, legal (hard rules)

- User-Agent identifies the project (`disruption-intelligence/x.y`), **never personal contact info** (pre-public-repo rule, ARCHITECTURE.md).
- ≥1–2s between requests per host; aggressive caching; incremental fetch (`?after=`, seen-URL sets, matchday-change detection). Volume stays trivial — keep it that way.
- Check robots.txt for the *actual URL pattern* before locking any new scraper.
- **No verbatim redistribution.** Raw HTML/JSON-LD/news text is transformed into disruption-event records before anything user-facing. Committed test fixtures are fine (existing convention).
- **futbolperuano data: internal + demo use only** until an Interlatin partnership conversation happens (their ToS clause 1(f); Notion BRECHA 6). Do not build anything that re-publishes their fixture data as fixture data.
- Sofascore, Transfermarkt, Twitter/X scraping: rejected sources, do not revisit. Andina RSS: dead, covered via gob.pe.
- All endpoint claims above were verified 2026-05-08 by direct fetch — **re-verify by fetching before building against them**; expect drift (the MML open-data portal already died quietly once).

## Out of scope — do not build (v1 fence)

MVBP business wrapper (contracts, SOW, invoicing/RUC, WhatsApp support, advisory-call tooling); auth, user accounts, multi-tenant; payments; predictive impact modeling / route-delta forecasting; anomaly-detection ML or any LLM/NER-model features; driver app; FMS/telematics integration; email digests; admin UI; multiple cities; customer-facing exposure of ticketer/futbolperuano-derived data beyond demos. If any of these starts feeling necessary, stop and surface to the user.

## Verification protocol (per CLAUDE.md operating mode)

- Fixture-first parser tests before any scraper is "done"; Testcontainers for pipeline paths; never mock the DB.
- Each tier's acceptance list is checked by a **fresh-context verifier subagent** reading this brief — not by the implementing context grading itself.
- Progress claims trace to tool output from the session. Failing tests are reported as failing.
- Every session ends with the PLAN.md update protocol; PLAN.md "Next move" always points at the next unfinished tier item.

## Suggested session plan (`/goal` conditions)

| Session | Scope | `/goal` condition |
|---|---|---|
| 1 | Tier 0 | All four Tier-0 items done: ≥20 events from 2 sources on the local map, 0-duplicate re-ingest, all tests green, OpenAPI accurate at /docs, PLAN.md updated |
| 2 | Tier 1 | Live URL with ≥4 sources, prod cron + Sentry live, 0-dup prod re-ingest, tests green, PLAN.md updated |
| 3 | Tier 2 | All programmatic v1 sources ingesting, road-alert map layer rendering, news dedup verified, tests green, PLAN.md updated |
| 4 | Tier 3 (if authorized) + polish | — |

## Human prerequisites (user to-do, not agent work)

- [x] **Send the MML Ley de Transparencia letter** — SENT 2026-06-11 via Mesa de Partes Virtual (response window ≈ 2026-06-22 → 2026-07-23). The Ord. 1680 import path (`pnpm -F api import-events`) is built and waiting for the data. Same template second-wave to district municipalities still pending.
- [ ] Fly.io: account, billing, `fly auth login`, app + Postgres created (or grant the session a token).
- [ ] Vercel: account + project link (or token).
- [ ] Sentry: org + two DSNs (api, web).
- [ ] Map tiles: confirm OpenFreeMap default (no action) or provide a MapTiler key.
- [ ] Decide Tier 3 (route-awareness stretch): go / no-go.
- [ ] Keep 1–2 discovery conversations/week alive — building cannot test willingness-to-pay (Notion Supuesto #1).
