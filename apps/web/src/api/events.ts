import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiEventSchema, type ApiEvent } from '@disruption-intelligence/shared';
import { env } from '../env';

export type EventFilters = {
    from?: string;
    to?: string;
    category?: string;
    source?: string;
};

// Responses are Zod-validated at this boundary: a drifted API contract fails
// loudly here instead of rendering garbage downstream.
async function fetchEvents(filters: EventFilters): Promise<ApiEvent[]> {
    const url = new URL('/events', env.apiUrl);
    url.searchParams.set('limit', '500');
    for (const key of ['from', 'to', 'category', 'source'] as const) {
        const value = filters[key];
        if (value) url.searchParams.set(key, value);
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET /events → ${res.status}`);
    return z.array(apiEventSchema).parse(await res.json());
}

async function fetchEvent(id: string): Promise<ApiEvent> {
    const res = await fetch(new URL(`/events/${id}`, env.apiUrl));
    if (!res.ok) throw new Error(`GET /events/${id} → ${res.status}`);
    return apiEventSchema.parse(await res.json());
}

export function useEvents(filters: EventFilters) {
    return useQuery({ queryKey: ['events', filters], queryFn: () => fetchEvents(filters) });
}

export function useEvent(id: string | undefined) {
    return useQuery({
        queryKey: ['event', id],
        queryFn: () => fetchEvent(id!),
        enabled: id !== undefined,
    });
}
