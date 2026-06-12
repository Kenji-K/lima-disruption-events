import { Link, useLocation, useMatch } from 'react-router';
import type { ApiEvent } from '@disruption-intelligence/shared';
import { categoryLabel, formatDateTime, sourceLabel } from '../format';

type Props = {
    events: ApiEvent[] | undefined;
    isPending: boolean;
    isError: boolean;
};

export default function EventList({ events, isPending, isError }: Props) {
    const { search } = useLocation();
    const match = useMatch('/eventos/:id');
    const selectedId = match?.params.id ? Number(match.params.id) : undefined;

    if (isPending) {
        return <p className="p-4 text-sm text-zinc-500">Cargando eventos…</p>;
    }
    if (isError || !events) {
        return <p className="p-4 text-sm text-red-700">No se pudieron cargar los eventos.</p>;
    }
    if (events.length === 0) {
        return (
            <p className="p-4 text-sm text-zinc-600">
                No hay eventos para los filtros seleccionados.
            </p>
        );
    }

    // An unexplained empty map ("Concierto" → every result unpinned) reads as
    // broken (review U3/G6) — say out loud how many results have no pin.
    const unpinned = events.filter((e) => !e.location).length;

    return (
        <div>
            <p className="px-4 pt-3 pb-1 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                {events.length} {events.length === 1 ? 'evento' : 'eventos'}
            </p>
            {unpinned > 0 && (
                <p className="px-4 pb-1 text-xs text-zinc-500">
                    {unpinned === events.length
                        ? 'Ninguno tiene ubicación en el mapa'
                        : `${unpinned} sin ubicación en el mapa`}
                </p>
            )}
            <ul className="divide-y divide-zinc-100">
                {events.map((e) => (
                    <li key={e.id}>
                        <Link
                            to={{ pathname: `/eventos/${e.id}`, search }}
                            className={`block px-4 py-3 hover:bg-zinc-50 ${selectedId === e.id ? 'bg-blue-50' : ''}`}
                        >
                            <span className="block text-sm font-medium text-zinc-900">
                                {e.title}
                            </span>
                            <span className="block text-xs text-zinc-500">
                                {formatDateTime(e.startAt)}
                                {e.venueName && ` · ${e.venueName}`}
                            </span>
                            <span className="mt-1 flex flex-wrap gap-1">
                                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                                    {categoryLabel(e.category)}
                                </span>
                                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500">
                                    {sourceLabel(e.sourceId)}
                                </span>
                                {e.state === 'cancelled' && (
                                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                        Cancelado
                                    </span>
                                )}
                                {!e.location && (
                                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                                        Sin ubicación
                                    </span>
                                )}
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}
