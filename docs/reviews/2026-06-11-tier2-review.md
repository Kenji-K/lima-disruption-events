# Five-lens review — post-Tier-2 (2026-06-11)

**Method:** five fresh-context subagents (architecture, conventions, functionality gaps, conceptual model, hands-on usability on the live URL), findings then verified in the main session — same protocol as the 2026-06-10 five-lens review. ✓ = claim re-verified directly (DB query, code inspection, or live check) before recording. All file:line references are to the tree at `99ce2e5`.

**Owner's directive on receipt:** demonstrate **feasibility and usefulness ASAP** (next sessions). The priority synthesis at the bottom is ordered for that.

---

## Verdict

A well-engineered system carrying the wrong cargo. Architecture and conventions graded the build high — clean boundaries, no cycles, ADRs true to code, near-total Zod/idempotency/politeness compliance, exemplary URL state. But: **zero forward-looking road disruptions exist in the platform** ✓ (`road_closure`: 3 rows, all past, one a false positive), **the four gob.pe sources have produced zero events ever** ✓, and 88 of 114 public events are GTN calendar rows (70 `proximamente`, 18 stage-assembly filler). The pitch noun is "disruption"; the data is a venue calendar plus a national-highway snapshot with ~3 Lima-relevant alerts.

---

## A. Architecture findings

- **A1 (HIGH, ✓) Lima-context gate leaks non-Lima events, then hard-stamps `regionId = Lima`.** `gob-pe-scraper.ts` `LIMA_CONTEXT_RE` matches `panamericana norte|sur` / `carretera central` anywhere along those national roads; `upsert.ts` stamps Lima level-1. First false row corrupts the customer surface and the T+30 density evidence. Fix: tighten the regex to Lima-Metropolitana terms or pull the region-resolution ADR forward.
- **A2 (MED, ✓) Boot race on the road-alert full replace.** `main.ts` fires the alert warm-up fire-and-forget AND the first-run catch-up (whose `runIngestOnce` ends with another alert sync); two concurrent `replaceRoadAlerts` DELETE+INSERT transactions can leave both snapshots in the table until the next tick. Fix: `pg_advisory_xact_lock` in `replaceRoadAlerts` or await the warm-up before catch-up.
- **A3 (MED) `/events` silent 500-row truncation is a deterministic future failure.** Web pins `limit=500`, no default window, oldest-first; joinnus-scale growth breaches the cap with no signal anywhere. Deflect now with a client default window (`from=today`); real pagination post-sprint.
- **A4 (MED) Demo fence mechanism contradicts the policy.** `EXPOSE_GATED_SOURCES` flips the single always-on prod app — serving ToS-fenced data to the open internet for the demo's duration, which the controlled-audience rule prohibits. Fix is runbook, not code: demo from localhost or a second short-lived app; never flip prod.
- **A5 (MED) Source identity is stringly across three places** (`SCRAPERS`, per-scraper consts, `GATED_SOURCE_IDS`); a rename silently un-gates ToS data. Minimum: a test asserting `GATED_SOURCE_IDS ⊆ SCRAPERS.map(name)`; better: one `sources.ts` registry carrying `gated?: true`.
- **A6 (MED-LOW) `trustProxy: true` makes the rate limiter spoofable** (client-supplied XFF). Set Fly hop count or key on `Fly-Client-IP`.
- **A7 (LOW-MED) Joinnus aborts the whole run on one failed detail** — re-fetching up to ~80 pages against the most ToS-sensitive host; lima-expresa's skip-and-continue is the in-repo correct pattern. (Pairs with C2.)
- **A8 (LOW) Two live mechanisms lack durable records:** the visibility gate (legal load-bearing — only PLAN notes + comments) and the boot catch-up/warm-up (changed the cron topology contract). Fold into docs-day amendment work; ADR-002's claimed access patterns also still have no API consumer.
- **A9 (LOW) `import-events` can mark any source fresh / mint phantom `/sources` rows** (file-supplied sourceId hits `recordSuccess`). Reject ids colliding with registry entries (or require a `manual-`/known prefix).

**Defended as exactly right:** ADR-010 separate snapshot mirror; ADR-007 registry-in-code + cursor-after-success; ADR-006 plain-postgis single-machine topology.

## C. Conventions findings

- **C1 (✓) es-PE violation on the live public URL.** `format.ts` `CATEGORY_LABELS` lacks `road_work`/`civil`/`festival` → "Road_work" rendered; `SOURCE_LABELS` covers 2 of 11 → raw slugs (`mml`, `gob-pe-atu`, `costa-21`) shown in dropdowns/chips/drawer.
- **C2 (✓) 4xx wedge in gob.pe + Joinnus.** Both throw on ANY detail-fetch failure; the written taxonomy (and lima-expresa's implementation) says 4xx = warn + skip. A permanently-404 page still listed/sitemapped freezes the source's cursor indefinitely.
- **C3 Request-spacing hard-rule gaps:** lima-expresa's first detail fetch has zero delay after the listing fetch; the four gob.pe scrapers hit <www.gob.pe> back-to-back with no inter-source spacing.
- **C4 Robots verification undocumented for futbolperuano and MML** (the other seven record it in-file or in plans/ADR).
- **C5 Smaller:** `routes.ts` estado `as`-cast (only unknown-data cast besides the known EWKB lie); `schedule.ts` road-alert tick comment claims a guard that isn't there; `run.ts` hardcodes two source-name literals where the other nine use consts; `apps/api` misses the written `@opentelemetry/api` peer-mirror rule; web `roadAlerts.ts` camelCase filename.
- **De-facto conventions worth writing down:** console-in-db-CLIs; "cursor freeze + next-run retry" as the sanctioned incremental-source variant of two-layer retry; in-file robots/ToS documentation (better than the plan-doc form ARCHITECTURE prescribes — codify, then backfill C4).

Compliance is otherwise genuinely high: idempotency clean across all write paths; every JSON.parse feeds a schema; logs structured with deliberate levels; provenance rules followed everywhere checked.

## G. Functionality gaps (jointly with the data)

- **G1 (demo-blocker, ✓) Zero forward-looking road disruptions** (headline; see Verdict). gob.pe ×4: 0 events ever. MML: 2 events, 1 false positive ("…INDULTOS…" as road_closure). A prospect asking "what blocks my routes next week?" gets nothing.
- **G2 (demo-blocker) Default view = past events, oldest first, ALL-CAPS news leading.** No default `from` anywhere.
- **G3/G4 Category taxonomy is per-source debris** (`proximamente`/`montaje`/`descanso` as customer-facing filter options; `futbol` vs `sport`); the brief's canonical-list-in-Zod promise is unimplemented (`category: z.string()`); GTN filler rows (18× "montaje escénico", "descanso") shown as events.
- **G5 (✓) Date-only events render "12:00 a. m."** — 24/114 public rows at midnight Lima; no precision concept (see X3).
- **G6 (✓) Location-less events invisible on the map with no indication** — 23/114 public; 103/195 ≈ 53% with gate lifted (joinnus 80/80 unpinned: venue map matched zero current events); drawer shows raw coordinates or nothing.
- **G7 ALL-CAPS titles** (43/196). **G8** Joinnus admits non-disruption inventory (swim slots, bar gigs).
- **G9–G13 API gaps:** no bbox/geo param (GiST serves zero queries), no `state` filter, `/road-alerts` unfilterable (9/19 rows are `normal`), no default window/pagination/caching, OpenAPI example `'musica'` doesn't exist in data, no category/source enumeration for integrators.
- **G14–G18 Web gaps:** no freshness chip despite `/sources` (cheapest credibility win); venue names buried in `sourcePayload` while the drawer shows coordinates; alert layer at default zoom shows ~1 green diamond (signal buried in `normal` noise); zero responsive breakpoints.
- **G19/G20 Coverage:** no Estadio Nacional signal on the public URL (only via gated joinnus, and venue regex currently matches zero events); SUTRAN data is national-highway, thin in Lima-metro — the "differentiator" under-delivers in the customer's geography until Ord. 1680 lands.
- **G22/G23 Ops:** "success with 0 events" is invisible (parser drift → fresh lastSuccessAt, no alert, sweep guarded); no cron deadman (a Sentry Cron Monitor fits the existing account; needs no new vendor).

## X. Conceptual gaps (model-level; brief/Notion treated as hypotheses)

- **X1 No magnitude/severity concept** — rehearsal and 40k-person stadium concert are identical objects; venue capacity is a static fact the existing venue maps could carry (fence-safe).
- **X2 (✓) Lifecycle can't say "in effect right now", and the model contradicts itself on null `endAt`:** schema comment says "unknown", overlap query treats it as "instant". Live consequence: a cleared June-2 incident reads "Programado" forever, while an open-ended "a partir del" closure vanishes from queries the day after it starts — it expires exactly the wrong items. ADR-003's unshipped `superseded` state and ADR-007's no-cancellation punt compound it. Cheapest fix: `openEnded`/`endAtKnown` + per-class default durations; real fix: lifecycle states + `supersedes`.
- **X3 No `datePrecision` concept** — publication-time, occurrence-time, and date-only facts all collapse into `startAt`; UI invents midnight instants (PLAN itself calls wrong-hour the worst fleet-ops failure).
- **X4 No extent concept; the one extracted spatial fact is discarded** — `roadMentions` dies in `sourcePayload`; every road closure ever ingested is map-invisible. Cheapest: corridor gazetteer for the bounded sources (Lima Expresa = 3 fixed arteries) + surface roadMentions; storing corridor geometry is NOT fenced (matching against client routes is).
- **X5 Cross-type identity missing and already manifest:** the same Carretera Central intervention exists as an MML event AND a SUTRAN alert, uncorrelated. Corroboration is the trust signal operators would pay for. Real fix is a third entity — _disruption_ — that events and alerts reference: **write this ADR before Ord. 1680 data arrives** or the import hardens channel-as-source confusion.
- **X6 "Source" = channel, not authority** — officialness inexpressible; Ord. 1680 (legally binding) would arrive indistinguishable from a fan site. Cheapest: `authority` + officialness tier on registry entries.
- **X7 Data freshness ≠ pipeline freshness** — no `as-of` on events (API doesn't even serve `updatedAt`); road_alerts side gets this right (`datasetUpdatedAt`), proving the concept is known.
- **X8 Audience gating is per-source; the ToS constraint is per-use.** A derived "venue congestion" datum (Estadio Nacional, Friday 19:00–23:00, large event — fixture fields stripped) is plausibly transformation, not redistribution-as-fixture-data — would put Lima's biggest recurring disruption on the public map. **Needs the owner's ToS judgment; surface, don't build.**

### Premises challenged outright

- **P1 "Public programmatic sources are dense enough" — half-falsified for the road half, now.** What's dense is venue calendars. Road density was always coming from the non-programmatic source (Ord. 1680). Build the demo narrative on what's dense; hedge road-coverage claims until 1680 lands.
- **P2 "Rule-based extraction is sufficient" — the only MML prod event is a false positive and the gates have no concept of tense** ("recuperamos" = completed work → scheduled closure). Recall is structurally unmeasurable (rejected posts vanish). Fence-safe fixes: quarantine log of rejected keyword-positive posts + past-tense guard. Strongest argument for unparking LLM extraction when the milestone gate opens.
- **P3 "Daily cadence is enough" conflates planning calendar with situational awareness** — reactive incident posts are stale before the next tick (ADR-010 already conceded the principle for SUTRAN). Either filter incidents out or give them alert-cadence + an "active now" lifecycle; today they're stale incidents wearing "Programado".

## U. Usability (hands-on, live URL)

- **U1 (demo-blocker) Drawer covers the zoom controls; its × sits exactly on "+"** — zooming while presenting an event closes the event. Move NavigationControl bottom-left or inset the map when the drawer opens.
- **U2 (demo-blocker) = G2** stale ALL-CAPS opener. **U3 (demo-blocker) = G6**: "Concierto" filter empties the map entirely (all 20 location-less) with no explanation.
- **U4 Mobile broken** (fixed 384px sidebar, 6px map sliver, drawer off-canvas; prospects open links on phones).
- **U5–U12 daily-use:** raw slugs (=C1); "12:00 a. m." (=G5); the 89-event cluster popup is an unlabeled 4,261px scroll well (header + cap at ~10 + "ver todos"); no marker legend and the only default-zoom diamond is a green "todo normal" (toggle appears dead); selection gives no map feedback (no flyTo/highlight; road closures produce zero map response); list doesn't scroll to selection; ALL-CAPS titles; May events still "Programado" (derive "Finalizado" at render).
- **U13–U17 minor:** header copy promises fútbol that isn't there; drawer outlives filters; same-tick `setSearchParams` race; Escape doesn't close drawer; native date inputs follow browser locale (demo from an es-PE browser).
- **Keep as-is:** URL state round-trips perfectly; localized loading/empty/error states; drawer field model + "Ver en la fuente"; the alert popup's "Actualizado…" freshness line (extend the pattern).

---

## Priority synthesis (ordered for "feasibility + usefulness ASAP")

**1. Demo substance — feasibility of the core claim (G1/P1/P2):** recall-tune the MML/gob.pe gates against ~60 days of history; add the past-tense guard + quarantine log; fix/remove the two bad MML rows; hand-import 5–10 verified upcoming Lima closures via `import-events`. In-fence, highest substance-per-hour.

**2. Demo-week usefulness (high impact-per-hour):** default window today→+30d (U2/G2/A3 deflection) · zoom/drawer overlap (U1) · label maps (C1/U5) · date-only formatter (G5/U6) · hide `normal` alerts + 3-chip legend (G17/U8) · drop GTN `montaje`/`descanso` at the scraper (G4/X1) · venue name into API+drawer (G16) · freshness chip from `/sources` (G14) · cluster popup header/cap (U7) · Costa 21 geocode-or-notice (U3).

**3. Correctness batch (small, alongside):** A1 Lima-gate tighten · C2 4xx skip-and-continue · A2 boot-race lock · A5 gate⊆registry test · A6 trustProxy · A9 import sourceId guard · A4 demo-fence runbook sentence · C3 spacing fixes.

**4. Post-sprint / ADR-worthy:** X5+X6 disruption-entity + authority ADR (before Ord. 1680 data arrives) · X2+X3 lifecycle/precision fields · X4 corridor gazetteer · X8 per-use gating (owner ToS judgment) · U4 mobile · G23 cron deadman · A3 real pagination · A8 mechanism ADRs/amendments (with the planned ADR-002/003 errata).
