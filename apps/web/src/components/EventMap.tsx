import { useEffect, useRef } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router';
import maplibregl from 'maplibre-gl';
import type { ApiEvent } from '@disruption-intelligence/shared';
import { formatDateTime } from '../format';

// OpenFreeMap: no key, no account (V1-BRIEF Tier 0 default; MapTiler only if a key lands).
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const LIMA_CENTER: [number, number] = [-77.03, -12.06];
// Keep in sync with EventDrawer's w-96: the drawer overlays the map's right edge,
// so centering on a selected event pads by its width to keep the marker visible.
const DRAWER_WIDTH_PX = 384;

function markerElement(count: number): HTMLDivElement {
    const el = document.createElement('div');
    el.className =
        'flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-blue-600 text-xs font-bold text-white shadow-md';
    el.textContent = String(count);
    return el;
}

// Plain-DOM popup content (MapLibre popups live outside the React tree). Built
// with textContent — scraped titles must not reach innerHTML.
function popupContent(group: ApiEvent[], onSelect: (id: number) => void): HTMLElement {
    const root = document.createElement('div');
    root.className = 'max-h-56 w-64 overflow-y-auto';
    for (const e of group) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
            'block w-full cursor-pointer border-b border-zinc-100 px-2 py-1.5 text-left text-xs hover:bg-zinc-50';
        const title = document.createElement('span');
        title.className = 'block font-medium text-zinc-900';
        title.textContent = e.title;
        const date = document.createElement('span');
        date.className = 'block text-zinc-500';
        date.textContent = formatDateTime(e.startAt);
        btn.append(title, date);
        btn.addEventListener('click', () => onSelect(e.id));
        root.appendChild(btn);
    }
    return root;
}

export default function EventMap({ events }: { events: ApiEvent[] }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<maplibregl.Marker[]>([]);
    const navigate = useNavigate();
    const { search } = useLocation();

    // Marker click handlers read the latest router state through this ref so
    // markers don't need re-creating on every navigation.
    const routerRef = useRef({ navigate, search });
    routerRef.current = { navigate, search };

    useEffect(() => {
        if (!containerRef.current) return;
        const map = new maplibregl.Map({
            container: containerRef.current,
            style: STYLE_URL,
            center: LIMA_CENTER,
            zoom: 11,
        });
        map.addControl(new maplibregl.NavigationControl(), 'top-right');
        mapRef.current = map;
        return () => {
            map.remove();
            mapRef.current = null;
        };
    }, []);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        for (const m of markersRef.current) m.remove();
        markersRef.current = [];

        // Events stack heavily per venue (GTN alone has dozens at one point), so
        // markers group by coordinate: count badge on the pin, event picker in the popup.
        const byVenue = new Map<string, ApiEvent[]>();
        for (const e of events) {
            if (!e.location) continue;
            const key = `${e.location.lng},${e.location.lat}`;
            const group = byVenue.get(key);
            if (group) {
                group.push(e);
            } else {
                byVenue.set(key, [e]);
            }
        }

        for (const group of byVenue.values()) {
            const first = group[0];
            if (!first?.location) continue;
            const popup = new maplibregl.Popup({ offset: 18, maxWidth: '280px' }).setDOMContent(
                popupContent(group, (id) => {
                    const { navigate: nav, search: s } = routerRef.current;
                    nav({ pathname: `/eventos/${id}`, search: s });
                }),
            );
            const marker = new maplibregl.Marker({ element: markerElement(group.length) })
                .setLngLat([first.location.lng, first.location.lat])
                .setPopup(popup)
                .addTo(map);
            markersRef.current.push(marker);
        }
    }, [events]);

    // Drawer open → ease the selected event's marker into the visible (unpadded)
    // half of the map; drawer dismissed → ease the padding back out.
    const selectedIdParam = useMatch('/eventos/:id')?.params.id;
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const selected = selectedIdParam
            ? events.find((e) => e.id === Number(selectedIdParam))
            : undefined;
        if (selected?.location) {
            map.easeTo({
                center: [selected.location.lng, selected.location.lat],
                padding: { right: DRAWER_WIDTH_PX },
                duration: 600,
            });
        } else {
            map.easeTo({ padding: { right: 0 }, duration: 600 });
        }
    }, [selectedIdParam, events]);

    return <div ref={containerRef} className="h-full w-full" />;
}
