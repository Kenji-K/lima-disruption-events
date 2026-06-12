import { Outlet, useSearchParams } from 'react-router';
import { useEvents, type EventFilters } from '../api/events';
import { useRoadAlerts } from '../api/roadAlerts';
import { DEFAULT_WINDOW_DAYS, limaDateString } from '../dates';
import FilterBar from '../components/FilterBar';
import EventList from '../components/EventList';
import EventMap from '../components/EventMap';
import FreshnessChip from '../components/FreshnessChip';

// Lima is UTC-5 year-round (no DST), so date-only filter values convert statically:
// the from-date starts at local midnight, the to-date covers through end of day.
// Absent date params fall back to the default hoy→+30d window (review G2) —
// the URL stays clean and FilterBar displays the effective dates.
function filtersFromParams(params: URLSearchParams): EventFilters {
    const from = params.get('from') ?? limaDateString(0);
    const to = params.get('to') ?? limaDateString(DEFAULT_WINDOW_DAYS);
    return {
        from: `${from}T00:00:00-05:00`,
        to: `${to}T23:59:59-05:00`,
        category: params.get('category') ?? undefined,
        source: params.get('source') ?? undefined,
    };
}

export default function MapPage() {
    const [params, setParams] = useSearchParams();
    const { data: events, isPending, isError } = useEvents(filtersFromParams(params));
    const { data: roadAlerts } = useRoadAlerts();
    // Default ON: the road-state layer is the map's differentiator. '0' hides it.
    const showAlerts = params.get('alertas') !== '0';
    // Markers only render incidencias ('normal' is noise — review G17/U8); the
    // toggle carries the count so an all-clear network still reads as alive.
    const incidentCount = (roadAlerts ?? []).filter((a) => a.estado !== 'normal').length;

    const toggleAlerts = () => {
        setParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                if (showAlerts) {
                    next.set('alertas', '0');
                } else {
                    next.delete('alertas');
                }
                return next;
            },
            { replace: true },
        );
    };

    return (
        <div className="flex h-screen flex-col">
            <header className="flex flex-wrap items-baseline gap-x-3 border-b border-zinc-200 bg-white px-4 py-3">
                <h1 className="text-lg font-semibold text-zinc-900">
                    Eventos de disrupción · Lima
                </h1>
                <span className="text-sm text-zinc-500">
                    conciertos, cierres viales y estado de vías desde fuentes públicas
                </span>
                <span className="ml-auto">
                    <FreshnessChip />
                </span>
            </header>
            <FilterBar events={events ?? []} />
            <main className="flex min-h-0 flex-1">
                <aside className="w-96 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white">
                    <EventList events={events} isPending={isPending} isError={isError} />
                </aside>
                <div className="relative min-w-0 flex-1">
                    <EventMap
                        events={events ?? []}
                        roadAlerts={roadAlerts ?? []}
                        showAlerts={showAlerts}
                    />
                    <div className="absolute top-3 left-3 z-10 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs shadow-sm select-none">
                        <label className="flex cursor-pointer items-center gap-2 font-medium text-zinc-700">
                            <input
                                type="checkbox"
                                checked={showAlerts}
                                onChange={toggleAlerts}
                                className="h-3.5 w-3.5 accent-red-600"
                            />
                            Alertas viales (SUTRAN)
                            {roadAlerts &&
                                ` · ${incidentCount} ${incidentCount === 1 ? 'incidencia' : 'incidencias'}`}
                        </label>
                        {showAlerts && (
                            <div className="mt-1.5 flex items-center gap-3 text-zinc-500">
                                <span className="flex items-center gap-1.5">
                                    <span className="inline-block h-2 w-2 rotate-45 bg-red-600" />
                                    Interrumpido
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <span className="inline-block h-2 w-2 rotate-45 bg-amber-500" />
                                    Restringido
                                </span>
                            </div>
                        )}
                    </div>
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
