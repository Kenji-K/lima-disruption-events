import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { newsDedupKey, scrapedEventSchema } from '@disruption-intelligence/shared';
import {
    parseNoticiasJson,
    passesPrefilter,
    extractGobPeEvent,
    type GobPeNewsItem,
} from '../../src/ingest/gob-pe-scraper';
import { parseSpanishDate } from '../../src/ingest/extract-dates';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const listings = {
    atu: parseNoticiasJson(fixture('gob-pe-noticias-atu.json'), 'atu'),
    sutran: parseNoticiasJson(fixture('gob-pe-noticias-sutran.json'), 'sutran'),
    mtc: parseNoticiasJson(fixture('gob-pe-noticias-mtc.json'), 'mtc'),
    munilima: parseNoticiasJson(fixture('gob-pe-noticias-munilima.json'), 'munilima'),
};

describe('parseSpanishDate', () => {
    it('parses the listing date format, leading space included', () => {
        expect(parseSpanishDate(' 3 de junio de 2026')).toEqual({ y: 2026, m: 6, d: 3 });
        expect(parseSpanishDate('29 de abril de 2026')).toEqual({ y: 2026, m: 4, d: 29 });
    });

    it('handles the setiembre/septiembre variants', () => {
        expect(parseSpanishDate('13 de setiembre de 2025')).toEqual({ y: 2025, m: 9, d: 13 });
        expect(parseSpanishDate('13 de septiembre de 2025')).toEqual({ y: 2025, m: 9, d: 13 });
    });

    it('returns null on garbage', () => {
        expect(parseSpanishDate('hace 3 días')).toBeNull();
    });
});

describe('parseNoticiasJson — live fixtures (captured 2026-06-11)', () => {
    it('parses all four institutions with the documented shape', () => {
        expect(listings.atu).toHaveLength(8);
        expect(listings.sutran).toHaveLength(9);
        expect(listings.mtc).toHaveLength(9);
        expect(listings.munilima).toHaveLength(9);
    });

    it('extracts the numeric news id from each item URL', () => {
        expect(Math.max(...listings.atu.map((i) => i.id))).toBe(1404992);
        const corredor = listings.munilima.find((i) => i.id === 1385665);
        expect(corredor).toBeDefined();
        expect(corredor!.title).toMatch(/Vía Expresa Grau/);
    });

    it('parses each item publication date (Spanish text format)', () => {
        const corredor = listings.munilima.find((i) => i.id === 1385665)!;
        expect(corredor.published).toEqual({ y: 2026, m: 4, d: 29 });
    });

    it('throws on a non-JSON response (HTML error page)', () => {
        expect(() => parseNoticiasJson('<html>mantenimiento</html>', 'atu')).toThrow(/not JSON/);
    });

    it('throws on an item URL without a numeric news id (markup contract break)', () => {
        const broken = JSON.stringify([
            {
                title: 'x',
                description: 'y',
                url: 'https://www.gob.pe/institucion/atu/noticias/sin-id',
                image: null,
                date: '1 de junio de 2026',
            },
        ]);
        expect(() => parseNoticiasJson(broken, 'atu')).toThrow(/news id/);
    });
});

describe('passesPrefilter — trigger scan over title+description', () => {
    it('matches exactly the one trigger-bearing item across all four fixtures', () => {
        // 1404232 (cochera clausura) matched under the pre-ADR-011 vocabulary;
        // dropping 'clausura' (premises enforcement, never a road) removes it
        // at the cheapest possible stage — no detail fetch spent on it.
        const hits = Object.values(listings)
            .flat()
            .filter(passesPrefilter)
            .map((i) => i.id)
            .sort();
        expect(hits).toEqual([1399490]);
    });

    it('rejects the munilima corredor mirror item (no disruption trigger)', () => {
        const corredor = listings.munilima.find((i) => i.id === 1385665)!;
        expect(passesPrefilter(corredor)).toBe(false);
    });
});

describe('extractGobPeEvent — detail fixtures', () => {
    const desvioItem: GobPeNewsItem = {
        id: 1245756,
        title: 'ATU: transporte público desviará su recorrido por obras en la av. Miguel Grau desde el lunes 15 de setiembre',
        description:
            'La Municipalidad Metropolitana de Lima realizará trabajos de rehabilitación en las vías principal y auxiliar.',
        url: 'https://www.gob.pe/institucion/atu/noticias/1245756-atu-transporte-publico-desviara-su-recorrido-por-obras-en-la-av-miguel-grau-desde-el-lunes-15-de-setiembre',
        published: { y: 2025, m: 9, d: 13 },
    };

    const eventOf = (outcome: ReturnType<typeof extractGobPeEvent>) => {
        expect(outcome.kind).toBe('event');
        return outcome.kind === 'event' ? outcome.event : (undefined as never);
    };

    it('turns the ATU desvío announcement into a road_closure event', () => {
        const event = eventOf(
            extractGobPeEvent(desvioItem, fixture('gob-pe-detail-atu-desvio.html'), 'atu'),
        );
        expect(() => scrapedEventSchema.parse(event)).not.toThrow();
        expect(event.sourceId).toBe('gob-pe-atu');
        expect(event.externalId).toBe('1245756');
        expect(event.category).toBe('road_closure');
        // "desde el lunes 15 de setiembre" in the headline, year-anchored to the post.
        expect(event.startAt).toBe('2025-09-15T00:00:00-05:00');
        expect(event.sourceUrl).toBe(desvioItem.url);
        expect(event.dedupKey).toBe(newsDedupKey(desvioItem.title));
        const payload = event.sourcePayload as { institution: string; matchedKeywords: string[] };
        expect(payload.institution).toBe('atu');
        expect(payload.matchedKeywords).toContain('desvios');
    });

    it('extracts the Vía Expresa "cierran" closure the pre-ADR-011 vocabulary missed', () => {
        // The 60-day audit's one confirmed recall miss: a real forward-looking
        // Lima closure announced in third-person present ("cierran"), a tense
        // the old trigger list did not cover.
        const item: GobPeNewsItem = {
            id: 1394289,
            title: 'Desde el 20 de mayo: cierran temporalmente acceso a la Vía Expresa por obras del túnel que integrará la Línea 2 con el Metropolitano',
            description: 'A partir de este miércoles 20 de mayo se cerrará el acceso.',
            url: 'https://www.gob.pe/institucion/atu/noticias/1394289-cierre-via-expresa',
            published: { y: 2026, m: 5, d: 19 },
        };
        const event = eventOf(
            extractGobPeEvent(item, fixture('gob-pe-detail-atu-via-expresa-cierran.html'), 'atu'),
        );
        expect(event.category).toBe('road_closure');
        expect(event.startAt).toBe('2026-05-20T00:00:00-05:00');
        const payload = event.sourcePayload as { matchedKeywords: string[] };
        expect(payload.matchedKeywords).toContain('cierran');
    });

    it('quarantines the Nazca Panamericana closure as non-lima (review A1 regression)', () => {
        // Real disruption, wrong geography: km 461 of the Panamericana Sur is
        // ~450 km from Lima. The old gate passed it on the bare road name.
        const item: GobPeNewsItem = {
            id: 1399502,
            title: 'MTC: Habilitan desvío provisional tras cierre preventivo del Pontón ubicado en el km 461 de la Panamericana Sur, en Nazca',
            description: 'Se habilitó un desvío provisional.',
            url: 'https://www.gob.pe/institucion/mtc/noticias/1399502-desvio-nazca',
            published: { y: 2026, m: 5, d: 29 },
        };
        const outcome = extractGobPeEvent(item, fixture('gob-pe-detail-mtc-nazca.html'), 'mtc');
        expect(outcome.kind).toBe('quarantined');
        if (outcome.kind === 'quarantined') expect(outcome.entry.reason).toBe('non-lima');
    });

    it('quarantines the SUTRAN cochera clausura (premises enforcement, not a road)', () => {
        // ADR-011 dropped 'clausura' from the triggers; the post reaches the
        // detail stage only via other body keywords, and must end quarantined.
        const cochera = listings.sutran.find((i) => i.id === 1404232)!;
        const outcome = extractGobPeEvent(
            cochera,
            fixture('gob-pe-detail-sutran-cochera.html'),
            'sutran',
        );
        expect(outcome.kind).toBe('quarantined');
        if (outcome.kind !== 'quarantined') return;
        expect(['no-trigger', 'no-road-context', 'non-lima']).toContain(outcome.entry.reason);
    });

    it('applies the Lima gate to national institutions (sutran/mtc)', () => {
        const item: GobPeNewsItem = {
            id: 99,
            title: 'Sutran informa cierre de la carretera Fernando Belaúnde Terry',
            description: '',
            url: 'https://www.gob.pe/institucion/sutran/noticias/99-cierre',
            published: { y: 2026, m: 6, d: 10 },
        };
        const outside =
            '<main>Sutran informa cierre de la carretera Fernando Belaúnde Terry en Amazonas el 15 de junio</main>';
        const rejected = extractGobPeEvent(item, outside, 'sutran');
        expect(rejected.kind).toBe('quarantined');
        if (rejected.kind === 'quarantined') expect(rejected.entry.reason).toBe('non-lima');

        const inLima =
            '<main>Sutran informa cierre de la carretera Central a la altura de Chosica el 15 de junio</main>';
        expect(extractGobPeEvent(item, inLima, 'sutran').kind).toBe('event');
    });

    it('rejects dateline-boilerplate Lima mentions (bare "lima" is not Lima context)', () => {
        // ADR-011 / review A1: the old gate passed a Rioja (San Martín) post on
        // SUTRAN's "Lima, 21 de mayo" dateline alone.
        const item: GobPeNewsItem = {
            id: 103,
            title: 'Sutran dispone cierre temporal de un tramo en Rioja',
            description: '',
            url: 'https://www.gob.pe/institucion/sutran/noticias/103-cierre',
            published: { y: 2026, m: 6, d: 10 },
        };
        const html =
            '<main>Lima, 10 de junio de 2026. Sutran dispone el cierre temporal de la carretera Rioja–Tarapoto el 15 de junio.</main>';
        const outcome = extractGobPeEvent(item, html, 'sutran');
        expect(outcome.kind).toBe('quarantined');
        if (outcome.kind === 'quarantined') expect(outcome.entry.reason).toBe('non-lima');
    });

    it('skips the Lima gate for Lima-mandate institutions (atu/munilima)', () => {
        const item: GobPeNewsItem = {
            id: 100,
            title: 'Cierre de la avenida Arequipa por trabajos',
            description: '',
            url: 'https://www.gob.pe/institucion/atu/noticias/100-cierre',
            published: { y: 2026, m: 6, d: 10 },
        };
        const html = '<main>Cierre de la avenida Arequipa por trabajos el 15 de junio</main>';
        expect(extractGobPeEvent(item, html, 'atu').kind).toBe('event');
    });

    it('quarantines a window that ended before publication (ADR-011 date-past guard)', () => {
        const item: GobPeNewsItem = {
            id: 104,
            title: 'Cierre de la avenida Argentina se realizó del 1 al 3 de junio',
            description: '',
            url: 'https://www.gob.pe/institucion/munilima/noticias/104-cierre',
            published: { y: 2026, m: 6, d: 8 },
        };
        const html =
            '<main>El cierre de la avenida Argentina se realizó del 1 al 3 de junio con desvíos.</main>';
        const outcome = extractGobPeEvent(item, html, 'munilima');
        expect(outcome.kind).toBe('quarantined');
        if (outcome.kind === 'quarantined') expect(outcome.entry.reason).toBe('past-event');
    });

    it('falls back to the publication date when the text has no extractable date', () => {
        const item: GobPeNewsItem = {
            id: 101,
            title: 'Cierre temporal del puente Ricardo Palma',
            description: '',
            url: 'https://www.gob.pe/institucion/munilima/noticias/101-cierre',
            published: { y: 2026, m: 6, d: 9 },
        };
        const html = '<main>Cierre temporal del puente Ricardo Palma por seguridad vial</main>';
        const event = eventOf(extractGobPeEvent(item, html, 'munilima'));
        expect(event.startAt).toBe('2026-06-09T00:00:00-05:00');
    });

    it('throws when the detail page has no <main> (markup contract break)', () => {
        const item: GobPeNewsItem = {
            id: 102,
            title: 'Cierre x',
            description: '',
            url: 'https://www.gob.pe/institucion/atu/noticias/102-x',
            published: { y: 2026, m: 6, d: 9 },
        };
        expect(() => extractGobPeEvent(item, '<html><body>nada</body></html>', 'atu')).toThrow(
            /main/i,
        );
    });
});
