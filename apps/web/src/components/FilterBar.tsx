import { useSearchParams } from 'react-router';
import type { ApiEvent } from '@disruption-intelligence/shared';
import { categoryLabel, sourceLabel } from '../format';

const FILTER_KEYS = ['from', 'to', 'category', 'source'] as const;

export default function FilterBar({ events }: { events: ApiEvent[] }) {
    const [params, setParams] = useSearchParams();

    function setParam(key: string, value: string): void {
        setParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                if (value) {
                    next.set(key, value);
                } else {
                    next.delete(key);
                }
                return next;
            },
            { replace: true },
        );
    }

    function clearFilters(): void {
        setParams(new URLSearchParams(), { replace: true });
    }

    // Options derive from the loaded events; the active selection stays listed
    // even when it filters itself out of the result set.
    const category = params.get('category') ?? '';
    const source = params.get('source') ?? '';
    const categories = [...new Set(events.map((e) => e.category))].sort();
    const sources = [...new Set(events.map((e) => e.sourceId))].sort();
    if (category && !categories.includes(category)) categories.push(category);
    if (source && !sources.includes(source)) sources.push(source);
    const hasFilters = FILTER_KEYS.some((k) => params.get(k));

    const inputClass = 'rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900';

    return (
        <div className="flex flex-wrap items-end gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2">
            <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-600">Desde</span>
                <input
                    type="date"
                    value={params.get('from') ?? ''}
                    onChange={(e) => setParam('from', e.target.value)}
                    className={inputClass}
                />
            </label>
            <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-600">Hasta</span>
                <input
                    type="date"
                    value={params.get('to') ?? ''}
                    onChange={(e) => setParam('to', e.target.value)}
                    className={inputClass}
                />
            </label>
            <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-600">Categoría</span>
                <select
                    value={category}
                    onChange={(e) => setParam('category', e.target.value)}
                    className={inputClass}
                >
                    <option value="">Todas las categorías</option>
                    {categories.map((c) => (
                        <option key={c} value={c}>
                            {categoryLabel(c)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-600">Fuente</span>
                <select
                    value={source}
                    onChange={(e) => setParam('source', e.target.value)}
                    className={inputClass}
                >
                    <option value="">Todas las fuentes</option>
                    {sources.map((s) => (
                        <option key={s} value={s}>
                            {sourceLabel(s)}
                        </option>
                    ))}
                </select>
            </label>
            {hasFilters && (
                <button
                    type="button"
                    onClick={clearFilters}
                    className="cursor-pointer rounded px-2 py-1 text-sm text-blue-700 hover:bg-blue-50"
                >
                    Limpiar filtros
                </button>
            )}
        </div>
    );
}
