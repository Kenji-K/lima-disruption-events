# ADR-011: Recall-measurable road gates — quarantine log, date-past guard, unified trigger vocabulary

## Status

Accepted — 2026-06-11. Written before the gate re-tune implementation, per the ADR-first rule. Responds to review 2026-06-11 finding P2 ("the only MML prod event is a false positive and the gates have no concept of tense; recall is structurally unmeasurable") and A1 (Lima-context gate leaks non-Lima events).

## Context

The MML/gob.pe road-disruption gates (trigger keywords → road-context proximity → date extraction) were precision-tuned on 2026-06-11 against small live fixture batches. A 60-day replay of real post history (118 MML posts + 632 gob.pe items across the four institutions; harness: `pnpm -F api audit-gates`, committed as `gate-audit-cli.ts`) measured them properly for the first time:

- **Precision ≈ 42%**: 12 extractions, 7 false positives. Every FP follows one of three mechanisms:
    1. **Past events reported as news** (5/7): "RECUPERAMOS … VÍA PÚBLICA" (work completed May 9, posted May 13), "mitin de cierre de campaña … del pasado 12 de abril" (posted June 11). All five share one machine-checkable signal: **the extracted date window ends strictly before the post's publication date**. Zero true positives have that property.
    2. **`clausura` as trigger** (4/4 clausura-only extractions are FPs): in Peruvian institutional usage "clausura" means administrative shutdown of _premises_ (discotecas, cocheras, terminales, CITVs) — never a road. Real closures say "cierre/cerrada/corte".
    3. **Lima-context leak (review A1)**: the old `LIMA_CONTEXT_RE` matched bare `lima` (SUTRAN's dateline/boilerplate — a Rioja, San Martín post passed) and bare national-road names (`panamericana sur` matched a Nazca km-461 closure ~450 km away). `upsert.ts` then stamps `regionId = Lima` on whatever leaks.
- **Recall has a measured gap**: ATU 1394289 — "Desde el 20 de mayo: **cierran** temporalmente acceso a la Vía Expresa por obras del túnel [Línea 2]" — a real, forward-looking, high-value Lima closure — died at `no-trigger`. The vocabulary has noun/participle/future forms but no third-person present ("cierran", "desvían", "restringen"), the tense institutional headlines actually use. MML's list also lacks the whole restriction/suspension family that the gob.pe list has — an asymmetry with no evidence behind it.
- **Rejected keyword-positive posts vanish** (a `log.debug` line at best), so every future re-tune starts blind again.

All seven FP kills and all six TP survivals below were verified against the real post bodies before this ADR was accepted (gate simulation over fetched pages, 2026-06-11).

## Decision

**1. Quarantine log: `ingest_quarantine` table (migration 0006).** Every **keyword-positive** post that a downstream gate rejects is recorded: `source_id`, `external_id`, `title`, `url`, `reason` (`no-road-context | no-date | past-event | non-lima`), `detail` jsonb (matched keywords, extracted date, post date), `post_date`, `first_seen_at`/`last_seen_at`. Idempotent upsert on `(source_id, external_id)` — re-runs refresh `last_seen_at` and the verdict, never duplicate. Scrapers stay pure: they return quarantine entries in `ScrapeResult.quarantined`; the runner persists them (write failures are logged, never fail the source run — this is measurement, not data). No API exposure; it's an internal audit surface (`psql`/future tooling). No-trigger posts are _not_ quarantined — they're the overwhelming majority and carry no per-post signal; vocabulary gaps are what the periodic `audit-gates` replay measures.

**2. Date-past guard.** After date extraction, a window that **ends strictly before the post's publication date** is quarantined as `past-event` instead of becoming an event. A news post announcing a future disruption dates it today-or-later; a window entirely in the past means the post _reports_ something, it doesn't _announce_ it. Evidence: kills 5/7 FPs, costs 0/6 TPs on the 60-day window. (gob.pe's publication-date fallback for dateless posts is unaffected — fallback dates equal the post date by construction.)

**3. One shared trigger vocabulary** (`road-filter.ts`), replacing the per-source lists:

- **dropped:** `clausura*` (mechanism 2 above);
- **added:** third-person present forms — `cierran?`, `desvian?`, `restringen?`, `suspenden?`, `interrumpen?`, `cortan` (recovers the missed Vía Expresa closure; bare `corta` stays out — it collides with the adjective);
- **unified:** MML gains the restriction/suspension/interruption family. The per-source split was a precision hedge; with the quarantine log making errors visible and the date-past guard catching the dominant FP class, the hedge costs more recall than it buys precision.

**4. Road-context additions:** `vías? expresas?`, `carril(es)`, `túnel(es)`, `paso a desnivel`. "Vía Expresa" is Lima's most important named artery and was invisible to the proximity gate because bare `vía` is (correctly) excluded.

**5. Lima gate (A1 fix): positive Lima-Metropolitana vocabulary** for the national institutions (SUTRAN/MTC), replacing the leaky regex. Curated list: Lima-metro phrases (`lima metropolitana`, `lima norte/sur/este`, `cercado de lima`), Callao (+`ventanilla`), unambiguous district names (deliberately excluding collision-prone ones: `comas` — a Junín corridor town, `san luis`, `santa rosa` — Áncash/Junín homonyms), and metro arteries (`via expresa`, `javier prado`, `morales duarez`, `nestor gambetta`, `jorge chavez`, …). **Bare `lima` and bare national-road names (`panamericana norte/sur`, `carretera central`) are out** — they are precisely the leak. Posts rejected here are quarantined as `non-lima`, so over-tightening is visible and reversible.

## Consequences

**Positive**

- Measured on 60 days of reality: 7/7 FPs eliminated, 6/6 TPs retained (5 prior + 1 recovered miss). The two bad prod/local rows (MML 79391, 79872) are rejected by the new gates and kept as regression fixtures.
- Recall is now continuously measurable (quarantine table in prod) _and_ periodically re-measurable (`audit-gates` replay) — review P2's structural complaint is closed.
- When the LLM-extraction gate unparks (PLAN), the quarantine table is a ready-made eval feed of hard cases.

**Negative / accepted risks**

- The date-past guard will quarantine a post announcing an _ongoing_ open-ended closure that started in the past ("a partir del 9 de mayo", posted later, no end date). Zero such posts exist in the 60-day window; if one appears it lands in quarantine, visibly, not silently.
- The tightened Lima gate trades unmeasured leak risk for measured miss risk: a genuine Lima-metro disruption naming only a street with no district/artery term would be quarantined `non-lima`. Quarantine review is the watch on this.
- A national-institution post about Carretera Central works _inside_ Lima province (e.g. Huarochirí) no longer passes — fleet-relevant arguably, out of the Lima-Metropolitana product promise for now. Revisit with the route-awareness tier, where corridor relevance is computable.

**Revisit triggers**

- Quarantine rows showing systematic `non-lima`/`past-event` misjudgments → loosen the specific rule, with the rows as evidence.
- LLM extraction unparking (PLAN's milestone gate) → quarantine becomes its eval set; the rule-based gates stay as the cost firewall.
