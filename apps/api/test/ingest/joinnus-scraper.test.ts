import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { scrapedEventSchema } from '@disruption-intelligence/shared';
import { parseJoinnusSitemap, parseJoinnusEventHtml } from '../../src/ingest/joinnus-scraper';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

const CONCERT_URL =
    'https://www.joinnus.com/events/concerts/lima-in-ten-so-ales-sandro-en-concierto-76586';

describe('parseJoinnusSitemap — live fixture (captured 2026-06-11)', () => {
    const entries = parseJoinnusSitemap(fixture('joinnus-sitemap.xml'));

    it('keeps only Lima events in the traffic-relevant categories', () => {
        // 400 URLs in the sitemap; 80 are lima-* in concerts/sports/futbol.
        expect(entries).toHaveLength(80);
        expect(entries.every((e) => /\/events\/(concerts|sports|futbol)\/lima-/.test(e.url))).toBe(
            true,
        );
    });

    it('extracts the numeric event id from each slug', () => {
        const concert = entries.find((e) => e.id === '76586');
        expect(concert).toBeDefined();
        expect(concert!.url).toBe(CONCERT_URL);
        expect(concert!.category).toBe('concerts');
    });

    it('throws when the sitemap has no <loc> entries (contract break)', () => {
        expect(() => parseJoinnusSitemap('<urlset></urlset>')).toThrow(/zero/);
    });
});

describe('parseJoinnusEventHtml — live fixture', () => {
    it('maps the JSON-LD Event onto ScrapedEvent, reinterpreting fake-UTC as Lima time', () => {
        const event = parseJoinnusEventHtml(
            fixture('joinnus-event-concert.html'),
            CONCERT_URL,
            'concerts',
        );
        expect(() => scrapedEventSchema.parse(event)).not.toThrow();
        expect(event.sourceId).toBe('joinnus');
        expect(event.externalId).toBe('76586');
        expect(event.title).toBe('IN-TEN-SO: ALES SANDRO EN CONCIERTO');
        expect(event.category).toBe('concert');
        expect(event.state).toBe('scheduled');
        // JSON-LD says 21:00:00.000Z but the page displays "9:00p" — Joinnus
        // labels Lima wall-clock as UTC. Verified 2026-06-11.
        expect(event.startAt).toBe('2026-06-11T21:00:00-05:00');
        expect(event.endAt).toBe('2026-06-11T22:30:00-05:00');
        // Discoteca Le Paris is not a mapped traffic-relevant venue → no point.
        expect(event.location).toBeUndefined();
        expect(event.sourceUrl).toBe(CONCERT_URL);
        const payload = event.sourcePayload as { venue: string };
        expect(payload.venue).toBe('Discoteca Le Paris');
    });

    it('pins mapped venues to their verified coordinates', () => {
        const html = fixture('joinnus-event-concert.html').replace(
            '"name":"Discoteca Le Paris"',
            '"name":"Estadio Nacional"',
        );
        const event = parseJoinnusEventHtml(html, CONCERT_URL, 'concerts');
        expect(event.location?.lng).toBeCloseTo(-77.0338629, 4);
        expect(event.location?.lat).toBeCloseTo(-12.0670682, 4);
    });

    it('maps cancelled eventStatus and throws on unmapped values', () => {
        const base = fixture('joinnus-event-concert.html');
        const cancelled = parseJoinnusEventHtml(
            base.replace('https://schema.org/EventScheduled', 'https://schema.org/EventCancelled'),
            CONCERT_URL,
            'concerts',
        );
        expect(cancelled.state).toBe('cancelled');

        expect(() =>
            parseJoinnusEventHtml(
                base.replace(
                    'https://schema.org/EventScheduled',
                    'https://schema.org/EventMovedOnline',
                ),
                CONCERT_URL,
                'concerts',
            ),
        ).toThrow(/eventStatus/);
    });

    it('drops a non-positive endAt instead of emitting an invalid range', () => {
        const html = fixture('joinnus-event-concert.html').replace(
            '"endDate":"2026-06-11T22:30:00.000Z"',
            '"endDate":"2026-06-11T20:00:00.000Z"',
        );
        const event = parseJoinnusEventHtml(html, CONCERT_URL, 'concerts');
        expect(event.endAt).toBeUndefined();
    });

    it('throws when the JSON-LD Event block is missing (markup contract break)', () => {
        expect(() =>
            parseJoinnusEventHtml('<html><body>nada</body></html>', CONCERT_URL, 'concerts'),
        ).toThrow(/JSON-LD/);
    });
});
