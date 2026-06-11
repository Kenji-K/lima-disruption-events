import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRoadAlertSchema, type ApiRoadAlert } from '@disruption-intelligence/shared';
import { env } from '../env';

// Same boundary rule as events: responses are Zod-validated so a drifted API
// contract fails loudly here instead of rendering garbage downstream.
async function fetchRoadAlerts(): Promise<ApiRoadAlert[]> {
    const res = await fetch(new URL('/road-alerts', env.apiUrl));
    if (!res.ok) throw new Error(`GET /road-alerts → ${res.status}`);
    return z.array(apiRoadAlertSchema).parse(await res.json());
}

export function useRoadAlerts() {
    return useQuery({
        queryKey: ['road-alerts'],
        queryFn: fetchRoadAlerts,
        // The API mirror refreshes 2-hourly (ADR-010); refetching the snapshot
        // more often than every few minutes buys nothing.
        staleTime: 5 * 60 * 1000,
    });
}
