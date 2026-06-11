import { z } from 'zod';
import { locationSchema } from './location';

/** API ↔ web contract for the SUTRAN road-alert layer (ADR-010). A snapshot
 *  mirror row, not an event: no start/end window — `estado` IS current state. */
export const apiRoadAlertSchema = z.object({
    id: z.number().int(),
    estado: z.enum(['normal', 'restringido', 'interrumpido']),
    location: locationSchema,
    codigoVia: z.string().nullable(),
    nombreCarretera: z.string().nullable(),
    afectacion: z.string().nullable(),
    evento: z.string().nullable(),
    motivo: z.string().nullable(),
    fuente: z.string().nullable(),
    ubigeo: z.string().nullable(),
    reportedAt: z.iso.datetime().nullable(),
    /** YYYY-MM-DD — the day the situation began upstream. */
    eventStartedOn: z.string().nullable(),
    datasetUpdatedAt: z.iso.datetime(),
});

export type ApiRoadAlert = z.infer<typeof apiRoadAlertSchema>;
