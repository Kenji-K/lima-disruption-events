import { pgTable, serial, text, timestamp, date, jsonb, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { geographyPoint } from './_types';

/** Current SUTRAN road-network alert snapshot — a MIRROR of upstream state,
 *  not an event log (ADR-010). Sync is a transactional full replace: upstream
 *  publishes the complete current set with no stable per-alert identity, and
 *  absence means resolved. No ADR-003 upsert key applies here by design. */
export const roadAlerts = pgTable(
    'road_alerts',
    {
        id: serial().primaryKey(),
        /** Alert level — the key of the upstream payload array the feature came
         *  from (closed set, mirrors SUTRAN's own taxonomy). */
        estado: text().notNull(),
        /** Alert position: a km-marker point on the affected road. Always present
         *  upstream (ADR-010) — unlike events.location, NOT NULL holds here. */
        location: geographyPoint().notNull(),
        /** Route code, e.g. 'PE-20'. */
        codigoVia: text(),
        nombreCarretera: text(),
        /** Affected stretch as upstream prose, e.g. 'KM 03'. */
        afectacion: text(),
        /** Cause description, e.g. 'PERDIDA DE LA CALZADA'. */
        evento: text(),
        /** Cause category, e.g. 'INFRAESTRUCTURA', 'CLIMATOLOGICO'. */
        motivo: text(),
        /** Reporting entity, e.g. 'PROVIAS NACIONAL'. */
        fuente: text(),
        /** Slash-joined upstream region path, e.g. 'CALLAO/CALLAO/MI PERU'. */
        ubigeo: text(),
        /** Parsed per-alert fecha_actualizacion. */
        reportedAt: timestamp({ withTimezone: true }),
        /** Parsed fecha_evento — the day the situation began. */
        eventStartedOn: date(),
        /** Payload-level fecha_hora_actualizacion — upstream dataset freshness. */
        datasetUpdatedAt: timestamp({ withTimezone: true }).notNull(),
        fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
        /** Raw upstream feature properties (existing debugging convention). */
        sourcePayload: jsonb().notNull(),
    },
    (t) => [
        check(
            'road_alerts_estado_chk',
            sql`${t.estado} IN ('normal', 'restringido', 'interrumpido')`,
        ),
        index('road_alerts_location_gix').using('gist', t.location),
    ],
);
