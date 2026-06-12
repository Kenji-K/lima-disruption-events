# Road-disruption source survey — verify-by-fetch findings (2026-06-12)

**Method:** fresh-context research agent, every claim verified by live fetch this session (polite UA, ≥1.5–2s/host spacing, robots.txt checked where recurring scraping would be proposed). Targets per PLAN's feasibility item: district-municipality WP feeds, Rutas de Lima, ATU channels, Lima open-data portals, other concessionaires/authorities. **Research only — nothing here is built**; the ranked shortlist below is the build proposal.

## Headline findings

1. **The districts have consolidated onto gob.pe** — the platform we already scrape (`/institucion/<slug>/noticias.json`, identical shape). Most district-owned WP sites are dead (San Borja, La Molina, SJL: DNS dead), locked (Miraflores: REST 401, RSS works), WAF-walled (Ate: Cloudflare), or explicitly migrated (La Victoria's wp-json 301s to gob.pe). Working gob.pe district slugs with current content: `munisanjuandelurigancho` (road-works items, density **medium**), `muniate`, `munilamolina`, `munilavictoria`, `munisantiagodesurco` (low each), `munisanborja`/`munibarranco`/`municallao` (low/none). `munilosolivos`, `munisanmartindeporres`: stale.
2. **Rutas de Lima is DEAD.** Every path on rutasdelima.pe redirects to a liquidation notice: the concession ended **2025-12-03** ("Rutas de Lima SAC en liquidación… ha dejado de ser concesionario del Proyecto Vías Nuevas de Lima"). Panamericanas + Ramiro Prialé coverage reverted to MML's orbit — i.e. to EMAPE (below). Strategy-side note: this also retires the brief's "concessionaire pressrooms beyond Lima Expresa" lead.
3. **EMAPE is the find of the survey.** `gob.pe/institucion/emape/noticias.json` is active and road-dense (4 of 5 recent titles road-related, including a forward-looking detour plan we imported this session). Config-only addition to the existing gob.pe scraper; inherits the dead Rutas de Lima's highway coverage.
4. **Open-data portals are conclusively useless for this purpose.** datosabiertos.gob.pe: MML's datasets are mototaxi registries/papeletas/TUPA — zero road-works datasets; "obras viales" search returns nothing; no working CKAN API. MML's own portal (datosabiertos.munlima.gob.pe) is DNS-dead — it died quietly _again_. Do not revisit soon.
5. **metrolima2.com** (Línea 2 consortium, WordPress, REST open, robots unrestricted) is the only dedicated detour inventory in the city: `/planes-de-desvio-l2/` (Desvío N°1–18) + `/planes-de-desvio-l4/` (N°1–7), plus ~monthly milestone posts. High relevance, low cadence; detour detail is map images (locations would come from titles/posts).
6. **ATU has nothing programmatic beyond what we ingest** (atu.gob.pe 301s to gob.pe/atu; campañas/normas have no JSON views; informes-publicaciones is procurement paperwork). Línea 1 feed stale since 2020. INVERMET: one item ever. Provías Nacional (`pvn`): works but national-corridor content, Lima-metro relevance ~zero.

## Ranked shortlist — worth building (proposal, not yet authorized)

1. **EMAPE via the existing gob.pe scraper** (`emape` registry entry — one line + label). Highest density found; Lima-mandate institution (no Lima gate needed).
2. **District slug pack on the same scraper:** `munisanjuandelurigancho`, `muniate`, `munilamolina`, `munilavictoria`, `munisantiagodesurco` (optional: `munibarranco`, `municallao`). Near-zero build cost; low per-district density but the only programmatic district coverage that exists. Politeness note: each slug adds one listing fetch/day (the scraper now spaces them 2s apart).
3. **metrolima2.com** (WP-JSON posts + the two desvío pages) — covers Lima's largest multi-year disruption; needs a small new scraper (real build work, post-sprint candidate).
4. **Miraflores RSS** (`miraflores.gob.pe/feed/`) — trivial RSS parse, very active, key district, low road density per item.

## Premise check (review P1)

The survey **confirms the half-falsification**: no dense forward-looking programmatic road feed exists in district sites or open-data portals. The remaining density consolidated onto gob.pe plus one genuinely new surface (metrolima2.com). Realistic uplift from the full shortlist: a handful of road items/week, mostly works-progress rather than advance closure notices. The structural answer for road density remains **Ord. 1680** (in flight via Ley de Transparencia) — these sources pad coverage, they don't replace it.
