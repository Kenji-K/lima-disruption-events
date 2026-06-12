# Feasibility & usefulness — verdict after the 2026-06-12 session

**Status:** findings memo for the owner's strategy discussion. Self-contained; evidence pointers at the bottom. Written at the close of the `/goal` session that shipped ADR-011, the demo-week web batch, the correctness batch, and the curated import.

## The one-paragraph verdict

**The platform is feasible; programmatic-only road coverage is validated as insufficient.** Extraction can be made accurate and self-measuring, the import path absorbs external data cleanly, and the product surface presents it credibly — none of which was demonstrably true before this session. But the data supply the "Disruption Intelligence" pitch needs does not exist in scrapeable public sources at useful density. Usefulness is therefore not yet demonstrated *and not yet falsified*: it now hinges on supply channels that don't come from scraping (Ord. 1680, curation, gated-data decisions), all of which the platform is ready to absorb.

## The numbers (all measured, this session)

| Fact | Number | Source of evidence |
| --- | --- | --- |
| Default public view (hoy→+30d) | **32 events: ~28 GTN (one venue), 1 Costa 21, 3 curated road disruptions** | live URL, in-browser 2026-06-12 |
| Programmatic road-disruption yield, MML + 4×gob.pe | **~1 event/week** (12 extractions / 60 days, 6 true positives after re-tune) | `pnpm -F api audit-gates` 60-day replay |
| Old-gate precision before re-tune | **~42%** (incl. the only MML prod event ever — a false positive) | same audit; ADR-011 |
| Hidden (ToS-gated) inventory | **~90 events** (80 Joinnus + Liga 1 fixtures incl. Estadio Nacional) — roughly half the system's data is publicly invisible | prod DB vs public `/events` |
| New-source uplift available | "a handful of road items/week, mostly works-progress" (EMAPE + 5 district slugs + metrolima2) | source survey 2026-06-12 |
| Dead ends, confirmed | Rutas de Lima (liquidated 2025-12-03), all open-data portals, ATU extra surfaces, Línea 1 | source survey 2026-06-12 |
| Manual curation throughput | **6 verified disruptions per ~1 evening** (each with official provenance) | `manual-curated` import, live in prod |

## What WAS validated (feasibility — the machine)

- **Extraction quality is controllable and measurable:** the re-tuned gates killed 7/7 known false positives and kept 6/6 true positives (one a recovered miss); the quarantine table caught the INDULTOS false positive *live in prod* on its first tick (2026-06-12 06:00) instead of publishing it. Recall is now continuously measurable (review P2 closed).
- **The absorption path works end-to-end:** verified external data → `import-events` → idempotent upsert → ADR-009 dedup protection → live on the map with provenance, in one evening. This is the exact path Ord. 1680 data will take.
- **The product surface is demo-credible:** default forward-looking window, venue names, freshness chip, alert layer with honest signal/noise handling.

## What was NOT validated (usefulness — the supply)

Review P1 ("public programmatic sources are dense enough") is now **confirmed half-falsified for roads**, by measurement rather than impression. What is dense is one venue calendar (GTN) plus a national highway snapshot that is thin in Lima metro. A fleet operator looking at the public URL today sees a real product with too little in it — the owner's read is correct.

## Levers, in order of impact

1. **Ord. 1680** (structural answer): legally mandated 15-day-ahead closure filings; Ley de Transparencia response window opens ~2026-06-22. Platform-ready since Tier 2; second-wave letters to district municipalities are drafted-template work.
2. **Weekly curation pass** (bridge): ~30 min/week sustains the demonstrated 6-per-evening rate. Cheap, honest, keeps the map alive through demo week.
3. **Owner decisions pending:**
   - **X8 venue-congestion derivation** — a stripped datum (venue + window + "evento masivo") from gated sources would put Estadio Nacional matchdays on the PUBLIC map. Plausibly transformation rather than redistribution; it is the owner's ToS/legal judgment. Highest usefulness-per-effort if approved.
   - **EMAPE + district slug pack** — config-only addition to the gob.pe scraper (survey shortlist items 1–2). Modest yield, near-zero cost.
4. **Demo framing:** demo with the timed flip (`EXPOSE_GATED_SOURCES_UNTIL`) or localhost so the gated venue layer shows; pitch the measured pipeline + the 1680 trajectory, not today's public density.
5. **Brecha #29 (strategy-side):** this result is the strongest evidence yet for the alternative-country desk research — a LatAm metro that publishes structured road-works data (Santiago/Bogotá/CDMX candidates) would let the same platform demonstrate usefulness in days. Research, not build; the single-city v1 fence is unchanged.

## Evidence artifacts

- [`docs/adr/011-recall-measurable-road-gates.md`](../adr/011-recall-measurable-road-gates.md) — gate re-tune, measured outcomes, quarantine design
- [`docs/research/2026-06-12-road-source-survey.md`](2026-06-12-road-source-survey.md) — verify-by-fetch source survey + ranked shortlist
- [`docs/reviews/2026-06-11-tier2-review.md`](../reviews/2026-06-11-tier2-review.md) — the five-lens review that framed P1/P2/G1
- `apps/api/data/imports/2026-06-12-manual-curated.json` — the curated batch with per-row provenance
- Prod `ingest_quarantine` table — the live recall log (first row: MML 79872, `past-event`)
