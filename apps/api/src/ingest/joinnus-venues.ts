/** Static venue → point map for Joinnus events (same pattern as
 *  futbolperuano-venues): only the big traffic-relevant venues get pins;
 *  everything else stays location-less (visible in the list, not the map).
 *  Coordinates OSM/Nominatim-verified 2026-06-11. Costa 21 (San Miguel) is
 *  deliberately absent — not in OSM; add when verified coordinates exist. */

import type { Location } from '@disruption-intelligence/shared';

const VENUES: [RegExp, Location][] = [
    [/estadio nacional/, { lng: -77.0338629, lat: -12.0670682 }],
    [/arena peru/, { lng: -76.9798119, lat: -12.0860937 }],
];

const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function joinnusVenueLocation(venueName: string): Location | undefined {
    const norm = fold(venueName);
    return VENUES.find(([re]) => re.test(norm))?.[1];
}
