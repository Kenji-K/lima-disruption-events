import type { ScrapedEvent } from '@disruption-intelligence/shared';
import type { ScrapeResult } from './types';

export const RECURRING_SOURCE_ID = 'recurring-events';

/**
 * Hardcoded recurring events (V1-BRIEF Tier-1 item 4): large, predictable
 * disruptions announced on annual calendars rather than scrapeable feeds.
 * Reference-data style — additive, idempotent through the same upsert as every
 * scraper, provenance URL documented per entry (ARCHITECTURE.md provenance
 * rules). Maintenance model: entries are appended as editions/fixtures are
 * announced; rows for past editions stay (history is factual).
 *
 * Peru NT home matches (the brief's first example): NONE included as of
 * 2026-06-11 — the June 2026 FIFA-window friendlies are abroad (Haití in Miami
 * 2026-06-05, España in Puebla 2026-06-08, per FPF coverage:
 * https://www.infobae.com/peru/deportes/2026/05/06/amistosos-de-peru-en-junio-fechas-horarios-y-canales-tv-confirmados-de-los-duelos-ante-espana-y-haiti/ )
 * and no later home fixture at the Estadio Nacional is officially scheduled
 * yet. Add entries here when the FPF announces one; do not guess.
 */
const RECURRING_EVENTS: ScrapedEvent[] = [
    {
        sourceId: RECURRING_SOURCE_ID,
        externalId: 'lima-42k-2026',
        title: 'Maratón adidas Rímac Lima 42K 2026 — cierres en Miraflores–Centro',
        category: 'sport',
        state: 'scheduled',
        // 2026 edition ran Sunday 2026-05-24, start 05:30, Parque Kennedy
        // (Miraflores) → Av. Arequipa → Paseo de los Héroes Navales and back.
        // Provenance: https://elcomercio.pe/deporte-total/running/maraton-adidas-rimac-lima-42k-2026-fecha-horarios-rutas-y-calles-cerradas-en-lima-noticia/
        // and https://www.infobae.com/peru/2026/05/23/cierres-y-desvios-para-la-lima-42k-guia-practica-para-el-domingo-24-de-mayo/
        startAt: '2026-05-24T05:30:00-05:00',
        endAt: '2026-05-24T13:00:00-05:00',
        venueName: 'Parque Kennedy (partida)',
        // Start point Parque Kennedy — OSM/Nominatim-verified 2026-06-11.
        location: { lng: -77.0304221, lat: -12.1217806 },
        sourcePayload: {
            kind: 'annual-race',
            route: 'Parque Kennedy → Av. Arequipa → Paseo de los Héroes Navales (ida y vuelta)',
            distances: ['42K', '21K', '10K'],
        },
        sourceUrl:
            'https://elcomercio.pe/deporte-total/running/maraton-adidas-rimac-lima-42k-2026-fecha-horarios-rutas-y-calles-cerradas-en-lima-noticia/',
    },
    {
        sourceId: RECURRING_SOURCE_ID,
        externalId: 'media-maraton-lima-2026',
        title: '117° KIA Media Maratón de Lima & 10K — domingo 23 de agosto',
        category: 'sport',
        state: 'scheduled',
        // 117th edition confirmed for Sunday 2026-08-23 (21K + 10K).
        // Provenance: https://mediamaratondelima.com.pe/ (official) and
        // https://www.running4peru.com/eventos/media-maraton-de-lima
        // Exact start time and route are published closer to race day — whole-day
        // window and no point geometry until then (location stays null).
        startAt: '2026-08-23T00:00:00-05:00',
        endAt: '2026-08-23T13:00:00-05:00',
        sourcePayload: {
            kind: 'annual-race',
            edition: 117,
            note: 'ruta y hora de partida pendientes de publicación oficial',
        },
        sourceUrl: 'https://mediamaratondelima.com.pe/',
    },
    {
        sourceId: RECURRING_SOURCE_ID,
        externalId: 'gran-parada-militar-2026',
        title: 'Gran Parada y Desfile Cívico Militar — cierre total de la Av. Brasil',
        category: 'civil',
        state: 'scheduled',
        // Fiestas Patrias parade, every July 29 (fixed national date): Av. Brasil
        // closes end to end (plaza Bolognesi → av. Javier Prado) from midnight to
        // ~15:00, affecting Magdalena, Jesús María, Pueblo Libre, Breña, Cercado.
        // Provenance (recurring pattern, prior editions):
        // https://andina.pe/agencia/noticia-gran-parada-y-desfile-civico-militar-av-brasil-conoce-aqui-plan-desvios-mapa-994646.aspx
        // https://elcomercio.pe/lima/gran-parada-militar-conoce-el-plan-de-desvio-por-el-cierre-total-de-la-av-brasil-ultimas-noticia/
        // 2026-specific operational plan lands ~mid-July; update endAt if it changes.
        startAt: '2026-07-29T00:00:00-05:00',
        endAt: '2026-07-29T15:00:00-05:00',
        venueName: 'Av. Brasil (plaza Bolognesi → av. Javier Prado)',
        // Representative point on Av. Brasil (Jesús María stretch) — the closure
        // is the full avenue (line geometry is Tier-2 territory).
        // OSM/Nominatim-verified 2026-06-11.
        location: { lng: -77.0551624, lat: -12.0768665 },
        sourcePayload: {
            kind: 'annual-parade',
            closure: 'Av. Brasil completa, plaza Bolognesi → av. Javier Prado, 00:00–15:00',
            districts: ['Magdalena del Mar', 'Jesús María', 'Pueblo Libre', 'Breña', 'Cercado'],
        },
        sourceUrl:
            'https://andina.pe/agencia/noticia-gran-parada-y-desfile-civico-militar-av-brasil-conoce-aqui-plan-desvios-mapa-994646.aspx',
    },
];

/** Same Scraper contract as the network sources — no fetch, no cursor; the
 *  idempotent upsert makes re-running these entries free every ingest tick. */
export function recurringEventsScraper(): Promise<ScrapeResult> {
    return Promise.resolve({ events: RECURRING_EVENTS, sweepWindowEnd: null });
}
