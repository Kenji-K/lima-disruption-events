import type { Location } from '@disruption-intelligence/shared';

export type ClubSlug = 'universitario-de-deportes' | 'alianza-lima' | 'sporting-cristal';

export type Venue = {
    stadiumName: string;
    // Substring expected inside the JSON-LD SportsEvent.location string. Defensive
    // cross-check at parse time: a mismatch means a venue swap or rename (Liga 1 clubs
    // occasionally relocate matches) — programmer error, update this map deliberately.
    jsonLdLocationContains: string;
    location: Location;
};

// Static venue map for the three Lima home clubs (the home-team filter's key set).
// Region resolution stays in upsert.ts (single Lima level-1 lookup per ADR-005) since
// all three stadiums are in Lima Metropolitana; this map carries the stadium point for
// events.location. Coordinates verified against OpenStreetMap via Nominatim 2026-06-10.
export const VENUES: Record<ClubSlug, Venue> = {
    'universitario-de-deportes': {
        stadiumName: 'Estadio Monumental',
        jsonLdLocationContains: 'Estadio Monumental',
        // OSM: Av. Javier Prado Este 7400, Ate/La Molina boundary (~80K capacity)
        location: { lng: -76.9353339, lat: -12.0556474 },
    },
    'alianza-lima': {
        stadiumName: 'Estadio Alejandro Villanueva',
        jsonLdLocationContains: 'Estadio Alejandro Villanueva',
        // OSM way 40300870: Av. Isabel La Católica 395, La Victoria (~35K)
        location: { lng: -77.0229272, lat: -12.0685041 },
    },
    'sporting-cristal': {
        stadiumName: 'Estadio Alberto Gallardo',
        jsonLdLocationContains: 'Estadio Alberto Gallardo',
        // OSM way 123815473: Vía de Evitamiento, San Martín de Porres (~18K)
        location: { lng: -77.0450308, lat: -12.0378485 },
    },
};
