# ADR-009: Cross-channel news dedup via shared headline slug + date window

## Status

Accepted — 2026-06-11. Written before the gob.pe multi-institution news job (its first consumer) per the ADR-first rule. Builds on ADR-007, which locked the news identity convention and explicitly deferred the dedup algorithm to a successor ADR.

## Context

Tier 2 adds the gob.pe news channels (`atu`, `sutran`, `mtc`, `munilima`). The `munilima` channel republishes Municipalidad de Lima comunicados that the MML WordPress scraper already ingests from `munlima.gob.pe` — the same press release would otherwise become two event rows. Tier-2 acceptance requires the opposite: same comunicado from munlima + gob.pe → **one** event.

ADR-007 anticipated canonical-URL equality as the primary join key. Verified by fetching on 2026-06-11, that key **does not exist**: gob.pe is self-canonical — `og:url` and `rel=canonical` on a `munilima` noticia point at the gob.pe URL itself, with no backlink to the WordPress original anywhere in the page.

What the same verification *did* establish (two independent comunicado samples):

- Both channels embed a **character-identical headline-derived slug** in their URLs — e.g. `…/2026/04/30/nuevo-corredor-de-la-via-expresa-grau-alcanza-90-de-avance-…/` (WP) vs `…/noticias/1385665-nuevo-corredor-de-la-via-expresa-grau-alcanza-90-de-avance-…` (gob.pe). Both platforms slugify the same press-office headline the same way; only letter case differs in the displayed titles (WP shouts in caps).
- **Publication dates drift across channels** — 1 day in one sample, 5 days in the other (WP 2026-04-27 vs gob.pe "22 de abril"). Any date-based guard must tolerate days of skew.
- Cross-institution duplicates also exist but with **different headlines**: the 2026-06-02 transport-subsidy announcement appears on both `atu` and `mtc` with editorially distinct titles. No verbatim key catches these.

## Decision

**1. `dedupKey` = our own slugification of the event title.** NFD accent-fold → lowercase → non-alphanumeric runs collapsed to single hyphens → trimmed. Computed in TS from the title text, *not* parsed out of URLs — it equals the slug both channels embed today, but is immune to either platform changing its URL format. The slugifier lives in `@disruption-intelligence/shared` next to the schemas.

**2. Carried on `ScrapedEvent` as optional `dedupKey`; news-derived sources populate it.** Venue/sport scrapers don't: their cross-source duplication problem (if ticketers ever list GTN shows) is a different shape — exact start instants, shared venue — and GTN's recurring filler titles ("En proceso de montaje escénico") would make title slugs actively wrong as a dedup signal there.

**3. Suppression at write time, in `upsertEvents`, first-channel-wins.** Before insert, each incoming event carrying a `dedupKey` is checked against existing rows: same `dedup_key`, **different** `source_id`, `start_at` within **±14 days**. A match drops the incoming copy with a structured log line (both source ids + URLs). Same-source rows never suppress each other — ADR-003's `(source_id, external_id)` upsert already owns that case. Living in the upsert layer means every write path inherits dedup, including Tier 2's manual-import command.

**4. The ±14-day window on `start_at`** separates recycled annual headlines (~365 days apart — "cierre por Año Nuevo" style) from true cross-channel copies, whose extracted start dates come from the same announcement text and whose observed publication skew is ≤5 days. Generous on purpose: a false *negative* costs one duplicate marker on the map; a false *positive* silently hides a real disruption.

**5. Scraper order is the ownership rule.** `SCRAPERS` runs `mml` before the gob.pe channels, so in steady state the WordPress copy — full post content, richer date-extraction material — wins and the gob.pe mirror is the suppressed copy. Sources run sequentially and upsert per-source, so first-wins is deterministic within a run, not racy.

**6. Schema: `events.dedup_key text NULL`** + partial btree index (`WHERE dedup_key IS NOT NULL`), included in the upsert's `ON CONFLICT` SET so a retitled post re-keys. New append-only migration; the handful of existing news rows are backfilled in the same migration with a `translate()`-based SQL fold equivalent to the TS slugifier for the Spanish character set (equivalence asserted by a test, spot-checked in prod post-deploy).

## Consequences

**Positive**

- Tier-2 acceptance becomes mechanical: the same comunicado on two channels produces one row, demonstrable by running the two scrapers in sequence in a test.
- Rule-based, zero ML — stays inside the v1 fence.
- Uniform for future channels (district-municipality WP feeds are the known second wave).

**Negative / accepted**

- **Only verbatim cross-posts dedupe.** The ATU/MTC subsidy pair (different headlines, same announcement) stays two events. Accepted: they *are* different posts, the rule-based fence bans similarity scoring, and PLAN.md already parks an LLM dedup judge as the v2 upgrade path.
- **First-wins can crown the thinner copy** if a gob.pe channel happens to ingest a comunicado before MML's poll sees it (backfill ordering, WP outage). The row's data is still correct, just sparser. Mitigated by scraper order; if observed in practice, a priority-replace rule is a successor ADR.
- The suppressed copy's URL survives only in logs — the winning row doesn't accumulate alternate provenance. No consumer for that today.
- TS and SQL slugifiers must agree for the one-shot backfill; divergence on an exotic character costs at most one duplicate, caught by the post-deploy check.

## Alternatives considered

**Canonical-URL equality (ADR-007's lean).** Unavailable — gob.pe self-canonicalizes with no backlink to the WP original (verified 2026-06-11). The slug convergence is what's left of that idea, and it's sturdier than it looks: it rests on both platforms slugifying the same upstream headline, not on either site's URL scheme.

**Parse the slug out of `sourceUrl` instead of slugifying the title.** Same value today, but couples the key to two sites' URL formats (gob.pe prefixes a numeric id, WP nests under a date path — each needs its own parser, each can drift). The title text is the actual shared fact.

**Make title+date the identity (replace `externalId`).** No — identity stays ADR-003/007's `(source_id, external_id)`; titles get edited upstream, and dedup is a *filter* on top of identity, not a replacement for it.

**A unique index on `(dedup_key, date_bucket)`.** Can't express a ±window as an index constraint; fixed bucket boundaries split real pairs (a May-31/June-2 pair lands in different buckets and both insert).

**Post-hoc merge job** (let both rows land, periodically pick winners and delete losers). More moving parts, a visible flicker (event appears, then vanishes), and the loser resurrects on its source's next idempotent re-run unless the job also maintains a tombstone table — write-time suppression needs none of that.
