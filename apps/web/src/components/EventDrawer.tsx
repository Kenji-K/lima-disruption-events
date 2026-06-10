import { useLocation, useNavigate, useParams } from 'react-router';
import { useEvent } from '../api/events';
import { categoryLabel, formatDateTime, sourceLabel, stateLabel } from '../format';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
            <dd className="mt-0.5 text-sm text-zinc-900">{children}</dd>
        </div>
    );
}

export default function EventDrawer() {
    const { id } = useParams();
    const { search } = useLocation();
    const navigate = useNavigate();
    const { data: event, isPending, isError } = useEvent(id);

    return (
        <div className="absolute inset-y-0 right-0 z-20 w-96 max-w-full overflow-y-auto border-l border-zinc-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-2 border-b border-zinc-200 p-4">
                <h2 className="text-base font-semibold text-zinc-900">
                    {event?.title ?? 'Evento'}
                </h2>
                <button
                    type="button"
                    onClick={() => void navigate({ pathname: '/', search })}
                    aria-label="Cerrar"
                    className="cursor-pointer rounded px-2 text-xl leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                >
                    ×
                </button>
            </div>
            {isPending && <p className="p-4 text-sm text-zinc-500">Cargando…</p>}
            {isError && <p className="p-4 text-sm text-red-700">No se pudo cargar el evento.</p>}
            {event && (
                <dl className="space-y-3 p-4">
                    <Field label="Inicio">{formatDateTime(event.startAt)}</Field>
                    {event.endAt && <Field label="Fin">{formatDateTime(event.endAt)}</Field>}
                    <Field label="Categoría">{categoryLabel(event.category)}</Field>
                    <Field label="Estado">
                        {event.state === 'cancelled' ? (
                            <span className="font-medium text-red-700">
                                {stateLabel(event.state)}
                            </span>
                        ) : (
                            stateLabel(event.state)
                        )}
                    </Field>
                    <Field label="Fuente">
                        {sourceLabel(event.sourceId)}
                        {event.sourceUrl && (
                            <>
                                {' · '}
                                <a
                                    href={event.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-700 underline"
                                >
                                    Ver en la fuente
                                </a>
                            </>
                        )}
                    </Field>
                    {event.location && (
                        <Field label="Ubicación">
                            {event.location.lat.toFixed(5)}, {event.location.lng.toFixed(5)}
                        </Field>
                    )}
                </dl>
            )}
        </div>
    );
}
