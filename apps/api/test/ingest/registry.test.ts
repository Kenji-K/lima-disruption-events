import { describe, it, expect } from 'vitest';
import { SCRAPER_SOURCE_IDS } from '../../src/ingest/run';
import { GATED_SOURCE_IDS } from '../../src/api/routes';

/** Source identity is stringly across the registry, per-scraper consts, and
 *  the visibility gate (review A5). This invariant test is the tripwire: a
 *  registry rename that silently un-gates ToS-fenced data fails CI instead. */
describe('source registry invariants', () => {
    it('every gated source id is a registered scraper id', () => {
        for (const gated of GATED_SOURCE_IDS) {
            expect(SCRAPER_SOURCE_IDS).toContain(gated);
        }
    });

    it('registry ids are unique', () => {
        expect(new Set(SCRAPER_SOURCE_IDS).size).toBe(SCRAPER_SOURCE_IDS.length);
    });
});
