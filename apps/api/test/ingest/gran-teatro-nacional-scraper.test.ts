import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { scrapedEventSchema } from '@disruption-intelligence/shared';
import { parseCalendarHtml } from '../../src/ingest/gran-teatro-nacional-scraper';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(
    join(__dirname, 'fixtures', 'gran-teatro-nacional-calendario-202605.html'),
    'utf8',
);

describe('granTeatroNacionalScraper / parseCalendarHtml', () => {
    const events = parseCalendarHtml(fixtureHtml);

    it('parses every public event-occurrence anchor (15 in May 2026 fixture)', () => {
        // The fixture renders 25 occurrence anchors; 10 are montaje/descanso
        // stage-calendar filler, dropped per review G4 (see test below).
        expect(events).toHaveLength(15);
    });

    it('every event passes scrapedEventSchema', () => {
        // Throws if any event is malformed — this is the contract test.
        expect(() => scrapedEventSchema.array().parse(events)).not.toThrow();
    });

    it('every event has the locked sourceId and scheduled state', () => {
        for (const e of events) {
            expect(e.sourceId).toBe('gran-teatro-nacional');
            expect(e.state).toBe('scheduled');
        }
    });

    it('startAt is Lima local time with -05:00 offset (the timezone fix is applied)', () => {
        for (const e of events) {
            expect(e.startAt).toMatch(/-05:00$/);
            expect(e.startAt).not.toMatch(/Z$/);
        }
    });

    it('externalId is <slug>:<YYYY-MM-DDTHH:MM>', () => {
        for (const e of events) {
            expect(e.externalId).toMatch(/^[a-z0-9-]+:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
        }
    });

    it('externalIds are unique within a fetched month', () => {
        const ids = events.map((e) => e.externalId);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('pins every event to the fixed GTN venue point (San Borja)', () => {
        for (const e of events) {
            expect(e.location).toEqual({ lng: -77.003169, lat: -12.0866312 });
        }
    });

    it('sourceUrl points at the canonical /evento/<slug>', () => {
        for (const e of events) {
            expect(e.sourceUrl).toMatch(/^https:\/\/granteatronacional\.pe\/evento\/[a-z0-9-]+$/);
        }
    });

    it('preserves GTN categories verbatim, with proximamente fallback for uncategorized', () => {
        const categories = new Set(events.map((e) => e.category));
        // From the May 2026 fixture: cat-folclore, cat-musica, plus events with
        // no cat-* class (popup label "Próximamente") → 'proximamente' fallback.
        expect(categories).toEqual(new Set(['folclore', 'musica', 'proximamente']));
    });

    it('drops montaje/descanso stage-calendar filler (review G4 reversed lossless capture)', () => {
        // The fixture carries cat-montaje cells; none may survive as events —
        // they are the theatre's internal calendar, not public disruptions.
        expect(events.filter((e) => e.category === 'montaje' || e.category === 'descanso')).toEqual(
            [],
        );
    });

    it('returns [] for a month whose grid renders with no event anchors (unpublished month)', () => {
        // GTN serves unpublished months as HTTP 200 + bare grid (verified live
        // against /calendario/202702) — legitimately empty, not a markup change.
        const gridOnly =
            '<table><tbody><tr><td date-date="2027-02-01"><div class="contents"></div></td></tr></tbody></table>';
        expect(parseCalendarHtml(gridOnly)).toEqual([]);
    });

    it('throws when no calendar grid exists at all (markup change)', () => {
        expect(() =>
            parseCalendarHtml('<html><body><p>sitio en mantenimiento</p></body></html>'),
        ).toThrow(/no calendar grid/);
    });

    it('captures AIDA 2026-05-17 17:00 as a known concrete event', () => {
        const aida = events.find((e) => e.externalId === 'aida:2026-05-17T17:00');
        expect(aida).toBeDefined();
        expect(aida).toMatchObject({
            sourceId: 'gran-teatro-nacional',
            title: 'AIDA',
            category: 'musica',
            state: 'scheduled',
            startAt: '2026-05-17T17:00:00-05:00',
            sourceUrl: 'https://granteatronacional.pe/evento/aida',
        });
    });
});
