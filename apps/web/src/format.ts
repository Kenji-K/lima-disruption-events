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

export function formatDateTime(iso: string): string {
    return dateTimeFmt.format(new Date(iso));
}

const CATEGORY_LABELS: Record<string, string> = {
    musica: 'Música',
    folclore: 'Folclore',
    montaje: 'Montaje',
    proximamente: 'Próximamente',
    futbol: 'Fútbol',
    concert: 'Concierto',
    sport: 'Deporte',
    road_closure: 'Cierre vial',
};

export function categoryLabel(category: string): string {
    return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

const SOURCE_LABELS: Record<string, string> = {
    'gran-teatro-nacional': 'Gran Teatro Nacional',
    futbolperuano: 'futbolperuano.com',
};

export function sourceLabel(sourceId: string): string {
    return SOURCE_LABELS[sourceId] ?? sourceId;
}

export function stateLabel(state: ApiEvent['state']): string {
    return state === 'scheduled' ? 'Programado' : 'Cancelado';
}
