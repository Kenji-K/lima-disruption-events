import { Outlet, useSearchParams } from 'react-router';
import { useEvents, type EventFilters } from '../api/events';
import FilterBar from '../components/FilterBar';
import EventList from '../components/EventList';
import EventMap from '../components/EventMap';

// Lima is UTC-5 year-round (no DST), so date-only filter values convert statically:
// the from-date starts at local midnight, the to-date covers through end of day.
function filtersFromParams(params: URLSearchParams): EventFilters {
    const from = params.get('from');
    const to = params.get('to');
    return {
        from: from ? `${from}T00:00:00-05:00` : undefined,
        to: to ? `${to}T23:59:59-05:00` : undefined,
        category: params.get('category') ?? undefined,
        source: params.get('source') ?? undefined,
    };
}

export default function MapPage() {
    const [params] = useSearchParams();
    const { data: events, isPending, isError } = useEvents(filtersFromParams(params));

    return (
        <div className="flex h-screen flex-col">
            <header className="flex flex-wrap items-baseline gap-x-3 border-b border-zinc-200 bg-white px-4 py-3">
                <h1 className="text-lg font-semibold text-zinc-900">
                    Eventos de disrupción · Lima
                </h1>
                <span className="text-sm text-zinc-500">
                    conciertos, fútbol y cierres viales desde fuentes públicas
                </span>
            </header>
            <FilterBar events={events ?? []} />
            <main className="flex min-h-0 flex-1">
                <aside className="w-96 shrink-0 overflow-y-auto border-r border-zinc-200 bg-white">
                    <EventList events={events} isPending={isPending} isError={isError} />
                </aside>
                <div className="relative min-w-0 flex-1">
                    <EventMap events={events ?? []} />
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
