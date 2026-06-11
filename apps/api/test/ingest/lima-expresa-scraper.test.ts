import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { scrapedEventSchema } from '@disruption-intelligence/shared';
import { parseListingHtml, parseNewsHtml } from '../../src/ingest/lima-expresa-scraper';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const listingHtml = fixture('lima-expresa-listing.html');
const cierrePath =
    '/news/lima-expresa-realiza-cierre-parcial-en-la-via-de-evitamiento-por-siniestro-vehicular-5c304-15019.html';
const openTourPath =
    '/news/lima-expresa-abrio-las-puertas-de-su-operacion-en-una-nueva-edicion-del-open-tour-6b1ed-15019.html';

/** Minimal-but-valid detail page for synthetic cases. */
const syntheticDetail = (body: string, datePublished = '2026-06-05T12:00:00+02:00'): string => `
<!DOCTYPE html><html><head>
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: 'Cierre nocturno por mantenimiento',
    datePublished,
})}</script>
</head><body>
<h1 class="section-title">Cierre nocturno por mantenimiento</h1>
<div class="content-text js-publication-responsive"><p>${body}</p></div>
</body></html>`;

describe('parseListingHtml', () => {
    it('extracts the 4 news paths from the live listing fixture', () => {
        const { paths } = parseListingHtml(listingHtml);
        expect(paths).toHaveLength(4);
        expect(paths).toContain(cierrePath);
        // Non-news links (newsletter, newsroom.limaexpresa.pe, /news/ index) excluded.
        expect(paths.every((p) => /^\/news\/.+\.html$/.test(p))).toBe(true);
    });

    it('throws loudly when the listing has zero news links (markup contract break)', () => {
        expect(() => parseListingHtml('<html><body><a href="/x">x</a></body></html>')).toThrow(
            /zero news links/,
        );
    });
});

describe('parseNewsHtml — live fixtures', () => {
    it('turns the cierre-parcial announcement into a road_closure event', () => {
        const event = parseNewsHtml(fixture('lima-expresa-news-cierre-parcial.html'), cierrePath);
        expect(event).not.toBeNull();
        expect(() => scrapedEventSchema.parse(event)).not.toThrow();
        expect(event!.sourceId).toBe('lima-expresa');
        expect(event!.externalId).toBe(
            'lima-expresa-realiza-cierre-parcial-en-la-via-de-evitamiento-por-siniestro-vehicular-5c304-15019',
        );
        expect(event!.category).toBe('road_closure');
        // "02 de junio de 2026" extracted from the body text.
        expect(event!.startAt).toBe('2026-06-02T00:00:00-05:00');
        expect(event!.sourceUrl).toBe(`https://prensa.limaexpresa.pe${cierrePath}`);
        const payload = event!.sourcePayload as { arteries: string[] };
        expect(payload.arteries).toContain('Vía de Evitamiento');
    });

    it('rejects the open-tour PR post (no disruption trigger)', () => {
        const event = parseNewsHtml(fixture('lima-expresa-news-open-tour.html'), openTourPath);
        expect(event).toBeNull();
    });

    it('throws when the JSON-LD/article contract is missing', () => {
        expect(() => parseNewsHtml('<html><body>nada</body></html>', cierrePath)).toThrow(
            /missing headline/,
        );
    });
});

describe('parseNewsHtml — synthetic date handling', () => {
    it('uses an announced window over the publication date when present', () => {
        const event = parseNewsHtml(
            syntheticDetail('Cierre nocturno del 10 al 12 de junio de 2026 en Línea Amarilla.'),
            '/news/cierre-nocturno-abc12-1.html',
        );
        expect(event?.startAt).toBe('2026-06-10T00:00:00-05:00');
        expect(event?.endAt).toBe('2026-06-12T23:59:00-05:00');
    });

    it('falls back to datePublished when the text has no extractable date', () => {
        const event = parseNewsHtml(
            syntheticDetail('Se mantiene el cierre parcial mientras duren las diligencias.'),
            '/news/cierre-sin-fecha-abc12-2.html',
        );
        expect(event?.startAt).toBe('2026-06-05T12:00:00+02:00');
        expect(event?.endAt).toBeUndefined();
        expect(() => scrapedEventSchema.parse(event)).not.toThrow();
    });
});
