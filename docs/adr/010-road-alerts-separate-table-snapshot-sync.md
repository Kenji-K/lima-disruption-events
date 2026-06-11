# ADR-010: SUTRAN road alerts — separate snapshot table, viewer data endpoint, own cadence

## Status

Accepted — 2026-06-11. Written before the road-alert layer implementation (V1-BRIEF Tier 2 item 2) per the ADR-first rule.

## Context

The brief's design lead was the MTC GeoServer (`mtcgeo2.mtc.gob.pe:8080`, WMS/WFS over `red_vial_*` layers) with the SUTRAN viewer as fallback, and flagged the geometry question — line-shaped alerts vs point events — as the structural decision. Re-verification by fetch on 2026-06-11 rewrote those premises:

- **The GeoServer is unreachable** (connection refused/timeout on port 8080). The live viewer corroborates the rot: its layer names have drifted to `red_vial_*_dic18`, and the SUTRAN-workspace alert layer it references sits on an **RFC-1918 internal GeoServer** (`192.168.212.135:8080`) that was never publicly reachable. The `red_vial_*` layers are in any case the static road *network*, not the alerts.
- **The viewer's own bootstrap endpoint is the real public alert source:** `https://gis.sutran.gob.pe/alerta_sutran/script_cgm/carga_xlsx.php?tipo=MAPA` returns JSON — three GeoJSON-Feature arrays keyed exactly by the brief's three levels (`normal`, `restringido`, `interrumpido`) plus a dataset timestamp (`fecha_hora_actualizacion`) and counters. HTTPS on 443, no port-8080 fragility. Live sample 2026-06-11: 19 alerts nationally, 4 in Lima/Callao, dataset ~hourly-fresh.
- **Alerts are POINTS, not lines.** Each feature is a Point at a km marker with `afectacion: "KM 03"`, `codigo_via` (e.g. `PE-20`), `nombre_carretera`, `evento` (cause), `motivo` (category), `fuente` (e.g. PROVIAS NACIONAL), `ubigeo`, event/update dates. The line-vs-point dilemma evaporates for this source.
- **No stable upstream identity.** `item` is a per-category running index, not an id. Two polls can renumber everything.
- **Absence means resolved.** The payload is the complete current alert set — an alert missing from the next poll was lifted. This is the opposite of the events table's semantics, where a source no longer listing an event is weak evidence (ADR-003's gated sweep, ADR-007's no-sweep rule for news).

## Decision

**1. Separate table `road_alerts` — not rows in `events`.** The brief leaned separate and the data confirms it: alerts are *observations of current network state* with their own lifecycle (level transitions, resolution-by-absence), not calendar entries. Forcing them into `events` would poison every event-table invariant: ADR-003's stable-key upsert (no stable key exists), the sweep gates (absence here IS resolution), and the from/to overlap semantics (an alert has no scheduled window — it is simply *current*).

Columns (Drizzle, snake_case): `id serial PK`; `estado text` (`normal | restringido | interrumpido` — CHECK-constrained, it's a closed upstream set); `location geography(Point,4326) NOT NULL` (every alert has coordinates; GiST per ADR-002's rationale); `codigo_via`, `nombre_carretera`, `afectacion`, `evento`, `motivo`, `fuente`, `ubigeo` text; `reported_at timestamptz` (parsed `fecha_actualizacion`); `event_started_on date NULL` (parsed `fecha_evento`); `dataset_updated_at timestamptz` (payload-level timestamp); `fetched_at timestamptz default now()`; `source_payload jsonb` (raw feature properties, existing convention).

**2. Sync = transactional full replace.** Each poll validates the payload (Zod), then in one transaction: `DELETE FROM road_alerts` + bulk `INSERT`. Idempotent by construction (same payload → same end state); honest about the upstream semantics (we mirror a snapshot, we don't accumulate observations). A failed fetch or validation aborts *before* the transaction — the table keeps the last good snapshot and `ingest_state` records the failure, so staleness is visible rather than data being lost. No history kept in v1 (revisit trigger below).

**3. The whole national set is stored, not just Lima.** 19 rows is noise-level volume; Lima fleet routes leave Lima (Carretera Central, Panamericana); and filtering would hard-code a product assumption into the ingest layer. The map simply shows what's in view.

**4. Freshness rides the existing `ingest_state` machinery** under `source_id = 'sutran-alerts'` (the table is keyed by source name, not FK-bound to events — ADR-007's registry concept extends as-is). Cursorless: every poll is a full snapshot.

**5. Own cadence: every 2 hours, plus membership in the daily ingest run.** A "current state" layer that can be 24h stale is misleading by design (a resolved `interrumpido` still shown red). The upstream dataset updates ~hourly; a 2-hourly single-request poll of the endpoint that feeds SUTRAN's own public map is comfortably polite (UA identifies us; no robots.txt exists — the path 302s to the map). This is ADR-007's anticipated "sources need independent schedules" trigger, resolved minimally: a second node-cron task in the same process/lifecycle, not a registry cadence field.

**6. API + map.** `GET /road-alerts` returns the current snapshot (Zod schema, OpenAPI, same conventions as `/events`). The web map renders it as its own toggleable layer — color by `estado`, popup with road/km/cause/freshness — independent of the event filters.

## Consequences

**Positive**

- The Tier-2 differentiator (live road-state on the map) ships against a source that actually works, with graceful degradation falling out of the design: fetch fails → last snapshot stays, staleness queryable, other sources unaffected.
- Replace-sync sidesteps the missing-identity problem entirely; no synthetic-key fragility.
- Events keep their invariants; neither model contaminates the other.

**Negative / accepted**

- **No alert history.** Each snapshot overwrites the last; level transitions and resolution times are lost. Accepted for v1 — the product question ("what's the road state now?") doesn't need it. Revisit: an analytics/prediction need, or the T+30 density check wanting alert-frequency data; the fix is an append-only `road_alert_observations` log beside the mirror.
- **Unofficial endpoint.** `carga_xlsx.php` is the viewer's internal bootstrap, not a documented API — it can change shape or vanish without notice. Mitigated: Zod validates the full contract loudly; failure degrades to a stale-but-visible snapshot; the structure (an .php endpoint feeding a Leaflet map) has the inertia of being SUTRAN's own production dependency. The dead "official" GeoServer is the cautionary tale that documented ≠ durable here.
- **Point semantics.** A 50-km closure renders as one km-marker. Fine for v1's "where is the network broken" question; the (dead) road-network line layers would only matter for route-overlap analysis, which is Tier 3.
- A second cron cadence in-process — slightly more lifecycle surface, still no queue/Redis (ADR-006's fence holds).

## Alternatives considered

**MTC GeoServer WMS/WFS (the brief's lead).** Dead on arrival (verified 2026-06-11): host unreachable, layer names drifted, and the alert layer was never on the public instance anyway — only static road geometry was.

**Rows in `events` with a `road_alert` category.** Rejected: no stable externalId for ADR-003's key; "absence = resolved" inverts the sweep semantics; no scheduled window for the API's from/to overlap predicate. Every shared mechanism would need a special case.

**Upsert on a synthetic key (`codigo_via` + `afectacion` + `motivo`) instead of replace.** Rejected: the key is mutable prose (km strings get re-edited; two alerts can share a via+km), and resolution would still need a delete-missing pass — replace does the same work without the fragile key.

**Scraping the viewer HTML / WMS tiles.** The HTML contains no alert data (it arrives via this endpoint + socket.io); tiles are rasters. The bootstrap endpoint *is* the viewer scrape, done at the data layer.

**Socket.io live feed (the viewer's realtime channel).** Rejected for v1: a persistent connection to an IP-addressed port-3001 service is operationally fragile and overkill against a 2-hourly freshness target.
