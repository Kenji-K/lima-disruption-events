import type { ApiEvent } from '@disruption-intelligence/shared';

// All user-visible formatting is es-PE / America/Lima per ARCHITECTURE.md
// "Customer-facing language".
const dateTimeFmt = new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

const dateOnlyFmt = new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
});

const limaTimeFmt = new Intl.DateTimeFormat('es-PE', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
});

/** Date-only sources (news posts, manual imports) carry the whole-day
 *  convention from the ingest layer: start 00:00, end 23:59 Lima. Those are
 *  date facts, not time facts — rendering "12:00 a. m." invents a precision
 *  the source never stated (review G5). */
function isWholeDayBoundary(iso: string): boolean {
    const hm = limaTimeFmt.format(new Date(iso));
    return hm === '00:00' || hm === '23:59';
}

export function formatDateTime(iso: string): string {
    const date = new Date(iso);
    return isWholeDayBoundary(iso) ? dateOnlyFmt.format(date) : dateTimeFmt.format(date);
}

const CATEGORY_LABELS: Record<string, string> = {
    musica: 'Música',
    folclore: 'Folclore',
    danza: 'Danza',
    teatro: 'Teatro',
    montaje: 'Montaje',
    descanso: 'Descanso',
    proximamente: 'Próximamente',
    futbol: 'Fútbol',
    concert: 'Concierto',
    sport: 'Deporte',
    road_closure: 'Cierre vial',
    road_work: 'Obra vial',
    civil: 'Evento cívico',
};

export function categoryLabel(category: string): string {
    return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

const SOURCE_LABELS: Record<string, string> = {
    'gran-teatro-nacional': 'Gran Teatro Nacional',
    futbolperuano: 'futbolperuano.com',
    mml: 'Municipalidad de Lima',
    'lima-expresa': 'Lima Expresa',
    'recurring-events': 'Eventos recurrentes',
    'gob-pe-atu': 'ATU (gob.pe)',
    'gob-pe-sutran': 'SUTRAN (gob.pe)',
    'gob-pe-mtc': 'MTC (gob.pe)',
    'gob-pe-munilima': 'Municipalidad de Lima (gob.pe)',
    joinnus: 'Joinnus',
    'costa-21': 'Costa 21',
    'manual-curated': 'Curado de fuentes oficiales',
};

export function sourceLabel(sourceId: string): string {
    return SOURCE_LABELS[sourceId] ?? sourceId;
}

export function stateLabel(state: ApiEvent['state']): string {
    return state === 'scheduled' ? 'Programado' : 'Cancelado';
}

/** Relative freshness for the header chip ("hace 5 min", "hace 2 h"). */
export function formatAgo(iso: string): string {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    if (min < 1) return 'hace un momento';
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 48) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} días`;
}
