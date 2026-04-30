import type { ScrapedEvent } from '@disruption-intelligence/shared';

export async function stubScraper(): Promise<ScrapedEvent[]> {
    return [
        {
            sourceId: 'stub',
            externalId: 'stub-001',
            title: 'Bad Bunny en el Estadio Nacional',
            category: 'concert',
            state: 'scheduled',
            startAt: '2026-06-12T21:00:00-05:00',
            endAt: '2026-06-13T00:00:00-05:00',
            location: { lng: -77.0339, lat: -12.0683 },
            sourcePayload: { venue: 'Estadio Nacional' },
        },
        {
            sourceId: 'stub',
            externalId: 'stub-002',
            title: 'Partido Alianza Lima vs Universitario de Deportes',
            category: 'sport',
            state: 'scheduled',
            startAt: '2026-06-19T18:00:00-05:00',
            endAt: '2026-06-19T21:00:00-05:00',
            location: { lng: -77.0441496, lat: -12.0484395 },
            sourcePayload: { venue: 'Estadio Monumental' },
        },
        {
            sourceId: 'stub',
            externalId: 'stub-003',
            title: 'Mantenimiento de Av. La Mar',
            category: 'road_closure',
            state: 'scheduled',
            startAt: '2026-06-10T21:00:00-05:00',
            sourcePayload: { affected: 'Av. La Mar, Pueblo Libre' },
        },
    ];
}
