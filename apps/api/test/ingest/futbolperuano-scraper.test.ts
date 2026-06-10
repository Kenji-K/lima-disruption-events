import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { scrapedEventSchema } from '@disruption-intelligence/shared';
import { parseListingHtml, parseMatchHtml } from '../../src/ingest/futbolperuano-scraper';
import { VENUES } from '../../src/ingest/futbolperuano-venues';

const __dirname = dirname(fileURLToPath(import.meta.url));
const listingHtml = readFileSync(
    join(__dirname, 'fixtures', 'futbolperuano-liga-1-listing.html'),
    'utf8',
);
const matchPath =
    '/liga-1/alianza-lima-vs-deportivo-moquegua-2-mayo-2026-liga-1-peru---torneo-apertura-m3230710';
const matchHtml = readFileSync(
    join(__dirname, 'fixtures', 'futbolperuano-match-alianza-lima-vs-moquegua-m3230710.html'),
    'utf8',
);

describe('futbolperuanoScraper / parseListingHtml', () => {
    const { totalMatches, parseableMatches, targetPaths } = parseListingHtml(listingHtml);

    it('counts every match in the fixture (6 in the May 2026 matchday)', () => {
        expect(totalMatches).toBe(6);
        expect(parseableMatches).toBe(6);
    });

    it('reports parseable matches with zero targets when all Lima clubs are away (warn-not-throw input)', () => {
        // Swap the two target home clubs for provincial clubs — a legitimate
        // all-away matchday, which the scraper completes with zero events.
        const allAway = listingHtml
            .replaceAll('/liga-1/alianza-lima-vs-', '/liga-1/cienciano-vs-')
            .replaceAll('/liga-1/sporting-cristal-vs-', '/liga-1/adt-tarma-vs-');
        const parsed = parseListingHtml(allAway);
        expect(parsed.totalMatches).toBe(6);
        expect(parsed.parseableMatches).toBe(6);
        expect(parsed.targetPaths).toEqual([]);
    });

    it('keeps only target-home-club matches, deduped across the two anchors per match', () => {
        expect(targetPaths).toEqual([
            '/liga-1/alianza-lima-vs-deportivo-moquegua-2-mayo-2026-liga-1-peru---torneo-apertura-m3230710',
            '/liga-1/sporting-cristal-vs-cusco-futbol-club-3-mayo-2026-liga-1-peru---torneo-apertura-m3230727',
        ]);
    });

    it('excludes Universitario when they are the away side (home-team filter via URL slug)', () => {
        // The fixture has juan-pablo-ii-vs-universitario-de-deportes — Universitario away.
        expect(listingHtml).toContain('vs-universitario-de-deportes');
        expect(targetPaths.join()).not.toContain('universitario-de-deportes');
    });
});

describe('futbolperuanoScraper / parseMatchHtml', () => {
    const event = parseMatchHtml(matchHtml, matchPath);

    it('extracts the SportsEvent from the Review.itemReviewed JSON-LD block', () => {
        expect(event).toMatchObject({
            sourceId: 'futbolperuano',
            externalId: 'm3230710',
            title: 'Alianza Lima vs Moquegua',
            category: 'futbol',
            state: 'scheduled',
            startAt: '2026-05-02T20:00:00-05:00',
            endAt: '2026-05-02T22:00:00-05:00',
            sourceUrl: `https://www.futbolperuano.com${matchPath}`,
        });
    });

    it('passes scrapedEventSchema', () => {
        expect(() => scrapedEventSchema.parse(event)).not.toThrow();
    });

    it('pins events.location to the static venue map (Matute), not page content', () => {
        expect(event.location).toEqual(VENUES['alianza-lima'].location);
    });

    it('captures competitors and the raw venue string in sourcePayload', () => {
        expect(event.sourcePayload).toMatchObject({
            competitors: ['Alianza Lima', 'Moquegua'],
            jsonLdLocation: 'Estadio Alejandro Villanueva  - Perú',
            stadium: 'Estadio Alejandro Villanueva',
        });
    });

    it('throws when the venue cross-check fails (venue swap → programmer error)', () => {
        const tampered = matchHtml.replaceAll('Estadio Alejandro Villanueva', 'Estadio Nacional');
        expect(() => parseMatchHtml(tampered, matchPath)).toThrow(/venue cross-check/);
    });

    it('throws on an eventStatus value we have not mapped', () => {
        const tampered = matchHtml.replaceAll('"EventScheduled"', '"EventPostponed"');
        expect(() => parseMatchHtml(tampered, matchPath)).toThrow(/unmapped eventStatus/);
    });

    it('throws when no Review JSON-LD block exists (markup change → programmer error)', () => {
        const tampered = matchHtml.replaceAll('"@type": "Review"', '"@type": "ReviewGone"');
        expect(() => parseMatchHtml(tampered, matchPath)).toThrow(/no Review JSON-LD/);
    });

    it('throws on a non-target-club path (caller contract)', () => {
        expect(() =>
            parseMatchHtml(matchHtml, '/liga-1/fbc-melgar-vs-utc-cajamarca-3-mayo-2026-m3230724'),
        ).toThrow(/not a target-club match path/);
    });
});
