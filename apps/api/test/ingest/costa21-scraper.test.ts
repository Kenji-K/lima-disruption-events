import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { scrapedEventSchema } from '@disruption-intelligence/shared';
import { parseCosta21Html } from '../../src/ingest/costa21-scraper';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, 'fixtures', 'costa21-home.html'), 'utf8');

describe('parseCosta21Html — live fixture (captured 2026-06-11)', () => {
    const events = parseCosta21Html(fixture);

    it('extracts the 20 real shows and skips the template-junk card', () => {
        // The live page carries 21 .news-block cards; one is leftover theme
        // filler ("Modern Marketing Summit Sydney 2018", href="#", no date).
        expect(events).toHaveLength(20);
        expect(events.every((e) => scrapedEventSchema.safeParse(e).success)).toBe(true);
        expect(events.some((e) => e.title.includes('Modern Marketing'))).toBe(false);
    });

    it('maps a card onto ScrapedEvent', () => {
        const flow = events.find((e) => e.externalId === 'flow-lima-2026');
        expect(flow).toBeDefined();
        expect(flow!.sourceId).toBe('costa-21');
        expect(flow!.title).toBe('FLOW EN LIMA');
        expect(flow!.category).toBe('concert');
        expect(flow!.state).toBe('scheduled');
        // Cards carry DD-MM-YYYY only — date precision, Lima-midnight anchor.
        expect(flow!.startAt).toBe('2026-07-07T00:00:00-05:00');
        expect(flow!.endAt).toBeUndefined();
        // Venue not OSM-verifiable yet (see joinnus-venues note) — no point.
        expect(flow!.location).toBeUndefined();
        expect(flow!.sourceUrl).toBe('https://teleticket.com.pe/flow-lima-2026');
        expect(flow!.sourcePayload).toMatchObject({ venue: 'Costa 21' });
    });

    it('throws on a teleticket-linked card with an unparseable date', () => {
        const broken = fixture.replace('07-07-2026', '99-99-2026');
        expect(() => parseCosta21Html(broken)).toThrow(/date/);
    });

    it('throws when the page parses to zero show cards (markup contract break)', () => {
        expect(() => parseCosta21Html('<html><body>nada</body></html>')).toThrow(/zero/);
    });
});
