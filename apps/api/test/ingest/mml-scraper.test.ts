import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { newsDedupKey, scrapedEventSchema } from '@disruption-intelligence/shared';
import { extractDateRange } from '../../src/ingest/extract-dates';
import { extractDisruptionEvent, parseMmlPostsJson } from '../../src/ingest/mml-scraper';

const __dirname = dirname(fileURLToPath(import.meta.url));
const recentJson = readFileSync(join(__dirname, 'fixtures', 'mml-posts-recent.json'), 'utf8');
const cierreJson = readFileSync(join(__dirname, 'fixtures', 'mml-posts-cierre.json'), 'utf8');

describe('parseMmlPostsJson', () => {
    it('parses the live recent-posts fixture (20 posts, full WP objects)', () => {
        expect(parseMmlPostsJson(recentJson)).toHaveLength(20);
    });

    it('throws the WAF-challenge classification on HTML instead of JSON', () => {
        expect(() => parseMmlPostsJson('<HTML>\n<HEAD>...')).toThrow(/not JSON/);
    });

    it('rejects JSON that is not the WP posts shape', () => {
        expect(() => parseMmlPostsJson('[{"id":"not-a-number"}]')).toThrow();
    });
});

describe('extractDisruptionEvent — live fixtures', () => {
    const recent = parseMmlPostsJson(recentJson);
    const cierre = parseMmlPostsJson(cierreJson);
    const events = (posts: ReturnType<typeof parseMmlPostsJson>) =>
        posts
            .map((p) => extractDisruptionEvent(p))
            .flatMap((o) => (o.kind === 'event' ? [o.event] : []));

    it('extracts zero events from the mixed recent batch (all municipal noise)', () => {
        expect(events(recent)).toHaveLength(0);
    });

    it('skips the degenerate empty-title post that exists in the live feed', () => {
        const emptyTitle = recent.find((p) => p.id === 79845);
        expect(emptyTitle).toBeDefined();
        expect(extractDisruptionEvent(emptyTitle!).kind).toBe('skipped');
    });

    it('keeps only the genuine forward-looking road posts from the search=cierre batch', () => {
        const extracted = events(cierre);
        // 78389 (posted Mar 27): the pre-Semana-Santa announcement with the
        // street closures — the only forward-looking disruption in the batch.
        // 78558 + 78604 were posted Apr 6, the day AFTER the Apr 2–5 closures
        // they describe ("SE DESPLEGARON", "INTENSIFICAMOS") — the ADR-011
        // date-past guard quarantines them (asserted below). The other 7
        // (electoral-campaign "cierre", court-case "corte", budget "obras",
        // etc.) must NOT survive the trigger+road-context+proximity gate.
        expect(extracted.map((e) => e.externalId).sort()).toEqual(['78389']);
        for (const event of extracted) {
            expect(() => scrapedEventSchema.parse(event)).not.toThrow();
            expect(event.sourceId).toBe('mml');
            expect(event.category).toBe('road_closure');
            expect(event.sourceUrl).toMatch(/^https:\/\/www\.munlima\.gob\.pe\//);
            // ADR-009: every news-derived event carries the cross-channel key.
            expect(event.dedupKey).toBe(newsDedupKey(event.title));
            expect(event.dedupKey).toMatch(/^[a-z0-9][a-z0-9-]*$/);
        }
    });

    it('quarantines (never silently drops) keyword-positive rejects from the cierre batch', () => {
        const quarantined = cierre
            .map((p) => extractDisruptionEvent(p))
            .flatMap((o) => (o.kind === 'quarantined' ? [o.entry] : []));
        // ADR-011: everything that matched a trigger but failed a later gate
        // must surface in the quarantine, with the gate as the reason. The two
        // posted-after-the-fact Semana Santa reports land here as past-event.
        const reasons = new Map(quarantined.map((e) => [e.externalId, e.reason]));
        expect(reasons.get('78558')).toBe('past-event');
        expect(reasons.get('78604')).toBe('past-event');
        for (const entry of quarantined) {
            expect(entry.sourceId).toBe('mml');
            expect(['no-road-context', 'no-date', 'past-event']).toContain(entry.reason);
            expect(entry.postDate).toMatch(/-05:00$/);
        }
    });

    it('extracts the date range "del 2 al 5 de abril" on the announcement post', () => {
        const outcome = extractDisruptionEvent(cierre.find((p) => p.id === 78389)!);
        expect(outcome.kind).toBe('event');
        if (outcome.kind !== 'event') return;
        expect(outcome.event.startAt).toBe('2026-04-02T00:00:00-05:00');
        expect(outcome.event.endAt).toBe('2026-04-05T23:59:00-05:00');
    });
});

describe('extractDisruptionEvent — ADR-011 date-past guard (live FP fixtures)', () => {
    const fixturePost = (name: string) =>
        parseMmlPostsJson(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))[0]!;

    it('quarantines the completed-works post (RECUPERAMOS…, the prod false positive)', () => {
        // Work finished May 9, posted May 13 — a report, not an announcement.
        const outcome = extractDisruptionEvent(fixturePost('mml-post-79391-past-fp.json'));
        expect(outcome.kind).toBe('quarantined');
        if (outcome.kind !== 'quarantined') return;
        expect(outcome.entry.reason).toBe('past-event');
        expect(outcome.entry.externalId).toBe('79391');
        expect(outcome.entry.detail).toMatchObject({ matchedDate: '09 de mayo de 2026' });
    });

    it('quarantines the political INDULTOS post ("cierre de campaña" near "paseo")', () => {
        // "mitin de cierre de campaña en el paseo de los héroes navales … del
        // pasado 12 de abril", posted June 11 — the second live false positive.
        const outcome = extractDisruptionEvent(fixturePost('mml-post-79872-past-fp.json'));
        expect(outcome.kind).toBe('quarantined');
        if (outcome.kind !== 'quarantined') return;
        expect(outcome.entry.reason).toBe('past-event');
        expect(outcome.entry.externalId).toBe('79872');
    });
});

describe('extractDateRange — Spanish rule-based patterns', () => {
    const june = { y: 2026, m: 6, d: 10 };
    const december = { y: 2026, m: 12, d: 20 };

    it('same-month range: "del 12 al 15 de junio"', () => {
        const r = extractDateRange('cierre del 12 al 15 de junio por obras', june);
        expect(r?.start).toEqual({ y: 2026, m: 6, d: 12 });
        expect(r?.end).toEqual({ y: 2026, m: 6, d: 15 });
    });

    it('cross-month range: "desde el 28 de diciembre hasta el 2 de enero" rolls the year', () => {
        const r = extractDateRange('desde el 28 de diciembre hasta el 2 de enero', december);
        expect(r?.start).toEqual({ y: 2026, m: 12, d: 28 });
        expect(r?.end).toEqual({ y: 2027, m: 1, d: 2 });
    });

    it('open start: "a partir del 20 de junio"', () => {
        const r = extractDateRange('cerrada a partir del 20 de junio', june);
        expect(r?.start).toEqual({ y: 2026, m: 6, d: 20 });
        expect(r?.end).toBeUndefined();
    });

    it('bare date with explicit year: "15 de enero del 2027"', () => {
        const r = extractDateRange('el corte será el 15 de enero del 2027', december);
        expect(r?.start).toEqual({ y: 2027, m: 1, d: 15 });
    });

    it('year inference rolls forward when the date is far behind the post date', () => {
        const r = extractDateRange('desvío el 15 de enero', december);
        expect(r?.start).toEqual({ y: 2027, m: 1, d: 15 });
    });

    it('rejects impossible dates: "30 de febrero"', () => {
        expect(extractDateRange('cierre el 30 de febrero', june)).toBeNull();
    });

    it('returns null when no date pattern exists', () => {
        expect(extractDateRange('cierre indefinido de la avenida', june)).toBeNull();
    });
});
