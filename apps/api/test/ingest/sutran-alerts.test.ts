import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, roadAlerts } from '@disruption-intelligence/db';
import { parseSutranAlerts, replaceRoadAlerts } from '../../src/ingest/sutran-alerts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureJson = readFileSync(join(__dirname, 'fixtures', 'sutran-alerts.json'), 'utf8');

describe('parseSutranAlerts — live fixture (captured 2026-06-11)', () => {
    const parsed = parseSutranAlerts(fixtureJson);

    it('parses all three levels into one alert list', () => {
        expect(parsed.alerts).toHaveLength(19);
        const byEstado = Object.groupBy(parsed.alerts, (a) => a.estado);
        expect(byEstado.normal).toHaveLength(9);
        expect(byEstado.restringido).toHaveLength(8);
        expect(byEstado.interrumpido).toHaveLength(2);
    });

    it('maps the upstream feature fields onto the alert shape', () => {
        const callao = parsed.alerts.find(
            (a) => a.estado === 'interrumpido' && a.ubigeo === 'CALLAO/CALLAO/MI PERU',
        );
        expect(callao).toBeDefined();
        expect(callao!.location).toEqual({ lng: -77.1301, lat: -11.8542 });
        expect(callao!.codigoVia).toBe('PE-20');
        expect(callao!.nombreCarretera).toBe('CARRETERA VENTANILLA - GAMBETA - CALLAO');
        expect(callao!.afectacion).toBe('KM 03');
        expect(callao!.evento).toBe('PERDIDA DE LA CALZADA');
        expect(callao!.motivo).toBe('INFRAESTRUCTURA');
        expect(callao!.fuente).toBe('PROVIAS NACIONAL');
    });

    it('parses the per-alert and payload-level timestamps as Lima-local instants', () => {
        const callao = parsed.alerts.find((a) => a.ubigeo === 'CALLAO/CALLAO/MI PERU')!;
        // "11/06/2026 10:30 HORAS" → 10:30 Lima = 15:30Z
        expect(callao.reportedAt).toBe('2026-06-11T10:30:00-05:00');
        // "28/04/2026"
        expect(callao.eventStartedOn).toBe('2026-04-28');
        // "11/06/2026 10:32"
        expect(parsed.datasetUpdatedAt).toBe('2026-06-11T10:32:00-05:00');
    });

    it('tolerates the BOM prefix the endpoint emits', () => {
        // The captured fixture carries it verbatim; parsing it at all proves this,
        // but pin the contract explicitly.
        expect(fixtureJson.charCodeAt(0)).toBe(0xfeff);
    });

    it('throws on a non-JSON response', () => {
        expect(() => parseSutranAlerts('<html>mantenimiento</html>')).toThrow(/not JSON/);
    });

    it('throws when the payload shape breaks (Zod contract)', () => {
        expect(() => parseSutranAlerts('{"normal": []}')).toThrow();
    });
});

describe('replaceRoadAlerts — transactional snapshot mirror (ADR-010)', () => {
    const parsed = parseSutranAlerts(fixtureJson);

    async function count(): Promise<number> {
        const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(roadAlerts);
        return row!.n;
    }

    it('inserts the full snapshot', async () => {
        const n = await replaceRoadAlerts(parsed);
        expect(n).toBe(19);
        expect(await count()).toBe(19);
    });

    it('round-trips the alert position through the geography column', async () => {
        const [row] = await db
            .select({
                lng: sql<number>`ST_X(${roadAlerts.location}::geometry)`,
                lat: sql<number>`ST_Y(${roadAlerts.location}::geometry)`,
            })
            .from(roadAlerts)
            .where(sql`${roadAlerts.ubigeo} = 'CALLAO/CALLAO/MI PERU'`);
        expect(row!.lng).toBeCloseTo(-77.1301, 4);
        expect(row!.lat).toBeCloseTo(-11.8542, 4);
    });

    it('REPLACES on re-sync: vanished alerts are gone (absence = resolved)', async () => {
        const shrunk = { ...parsed, alerts: parsed.alerts.filter((a) => a.estado !== 'normal') };
        const n = await replaceRoadAlerts(shrunk);
        expect(n).toBe(10);
        expect(await count()).toBe(10);
        const [normales] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(roadAlerts)
            .where(sql`${roadAlerts.estado} = 'normal'`);
        expect(normales!.n).toBe(0);
    });

    it('is idempotent: same snapshot twice → same end state', async () => {
        await replaceRoadAlerts(parsed);
        const n = await replaceRoadAlerts(parsed);
        expect(n).toBe(19);
        expect(await count()).toBe(19);
    });
});
