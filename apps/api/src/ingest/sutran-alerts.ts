import * as Sentry from '@sentry/node';
import { z } from 'zod';
import type { Logger } from 'pino';
import { db, roadAlerts } from '@disruption-intelligence/db';
import { fetchWithRetry } from './fetch';
import { recordFailure, recordSuccess } from './state';

/** SUTRAN road-alert snapshot sync (ADR-010).
 *
 *  Source: the official viewer's own data bootstrap (re-verified 2026-06-11) —
 *  the brief's MTC GeoServer lead is dead (port-8080 host unreachable, alert
 *  layer was internal-only anyway). Payload: three GeoJSON-Feature arrays
 *  keyed by alert level + a dataset timestamp. Point geometries (km markers).
 *  No stable per-alert identity and absence = resolved, hence the transactional
 *  full-replace mirror instead of ADR-003 upserts. */

export const SUTRAN_ALERTS_SOURCE_ID = 'sutran-alerts';
const ALERTS_URL = 'https://gis.sutran.gob.pe/alerta_sutran/script_cgm/carga_xlsx.php?tipo=MAPA';

const ESTADOS = ['normal', 'restringido', 'interrumpido'] as const;
export type AlertEstado = (typeof ESTADOS)[number];

const featureSchema = z.object({
    type: z.literal('Feature'),
    geometry: z.object({
        type: z.literal('Point'),
        coordinates: z.tuple([z.number(), z.number()]),
    }),
    // Upstream properties are loosely-typed prose; only what we map is named.
    properties: z
        .object({
            ubigeo: z.string().optional(),
            afectacion: z.string().optional(),
            evento: z.string().optional(),
            motivo: z.string().optional(),
            fuente: z.string().optional(),
            codigo_via: z.string().optional(),
            nombre_carretera: z.string().optional(),
            fecha_evento: z.string().optional(),
            fecha_actualizacion: z.string().optional(),
        })
        .loose(),
});

const payloadSchema = z.object({
    normal: z.array(featureSchema),
    restringido: z.array(featureSchema),
    interrumpido: z.array(featureSchema),
    fecha_hora_actualizacion: z.string().min(1),
});

export type ParsedRoadAlert = {
    estado: AlertEstado;
    location: { lng: number; lat: number };
    codigoVia: string | null;
    nombreCarretera: string | null;
    afectacion: string | null;
    evento: string | null;
    motivo: string | null;
    fuente: string | null;
    ubigeo: string | null;
    reportedAt: string | null;
    eventStartedOn: string | null;
    sourcePayload: unknown;
};

export type ParsedSnapshot = { alerts: ParsedRoadAlert[]; datasetUpdatedAt: string };

/** "28/04/2026" → "2026-04-28"; null when malformed (per-alert tolerance). */
function parseDmy(text: string | undefined): string | null {
    const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(text ?? '');
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** "11/06/2026 10:30 HORAS" → Lima-local ISO instant; null when malformed. */
function parseDmyTime(text: string | undefined): string | null {
    const m = /(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/.exec(text ?? '');
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}T${m[4]!.padStart(2, '0')}:${m[5]}:00-05:00`;
}

export function parseSutranAlerts(json: string): ParsedSnapshot {
    let raw: unknown;
    try {
        // The endpoint prefixes its JSON with (sometimes repeated) UTF-8 BOMs.
        raw = JSON.parse(json.replace(/^\ufeff+/, ''));
    } catch {
        // Operational: an HTML maintenance page or truncated body. The previous
        // snapshot stays in place; staleness is visible via ingest_state.
        throw new Error('sutran-alerts: response is not JSON');
    }
    const payload = payloadSchema.parse(raw);

    const datasetUpdatedAt = parseDmyTime(payload.fecha_hora_actualizacion);
    if (!datasetUpdatedAt) {
        throw new Error(
            `sutran-alerts: unparseable dataset timestamp "${payload.fecha_hora_actualizacion}"`,
        );
    }

    const alerts = ESTADOS.flatMap((estado) =>
        payload[estado].map((f): ParsedRoadAlert => {
            const p = f.properties;
            return {
                estado,
                location: { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] },
                codigoVia: p.codigo_via ?? null,
                nombreCarretera: p.nombre_carretera ?? null,
                afectacion: p.afectacion ?? null,
                evento: p.evento ?? null,
                motivo: p.motivo ?? null,
                fuente: p.fuente ?? null,
                ubigeo: p.ubigeo ?? null,
                reportedAt: parseDmyTime(p.fecha_actualizacion),
                eventStartedOn: parseDmy(p.fecha_evento),
                sourcePayload: p,
            };
        }),
    );

    return { alerts, datasetUpdatedAt };
}

/** Transactional full replace (ADR-010): same snapshot in → same table out.
 *  Returns the row count of the new snapshot. */
export async function replaceRoadAlerts(snapshot: ParsedSnapshot): Promise<number> {
    const rows = snapshot.alerts.map((a) => ({
        estado: a.estado,
        location: a.location,
        codigoVia: a.codigoVia,
        nombreCarretera: a.nombreCarretera,
        afectacion: a.afectacion,
        evento: a.evento,
        motivo: a.motivo,
        fuente: a.fuente,
        ubigeo: a.ubigeo,
        reportedAt: a.reportedAt ? new Date(a.reportedAt) : null,
        eventStartedOn: a.eventStartedOn,
        datasetUpdatedAt: new Date(snapshot.datasetUpdatedAt),
        sourcePayload: a.sourcePayload,
    }));

    await db.transaction(async (tx) => {
        await tx.delete(roadAlerts);
        if (rows.length > 0) await tx.insert(roadAlerts).values(rows);
    });
    return rows.length;
}

/** Fetch → validate → replace, with ADR-007 state tracking under
 *  'sutran-alerts'. Never throws: a failed sync leaves the last snapshot in
 *  place and records the failure — degrade gracefully, never block a run. */
export async function runRoadAlertSyncOnce(log: Logger): Promise<void> {
    try {
        const outcome = await fetchWithRetry(ALERTS_URL, log);
        if (!outcome.ok) {
            throw new Error(`sutran-alerts: fetch failed (${outcome.reason})`);
        }
        const snapshot = parseSutranAlerts(outcome.html);
        const count = await replaceRoadAlerts(snapshot);
        await recordSuccess(SUTRAN_ALERTS_SOURCE_ID, undefined);
        log.info(
            { alerts: count, datasetUpdatedAt: snapshot.datasetUpdatedAt },
            'sutran-alerts: snapshot synced',
        );
    } catch (err) {
        Sentry.captureException(err, { tags: { source: SUTRAN_ALERTS_SOURCE_ID } });
        log.error({ err }, 'sutran-alerts: sync failed — previous snapshot stays');
        await recordFailure(SUTRAN_ALERTS_SOURCE_ID, err).catch((stateErr: unknown) => {
            log.error({ err: stateErr }, 'sutran-alerts: ingest_state write failed');
        });
    }
}
