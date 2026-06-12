import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiSourceStatusSchema, type ApiSourceStatus } from '@disruption-intelligence/shared';
import { env } from '../env';

// Same boundary rule as events: responses are Zod-validated so a drifted API
// contract fails loudly here instead of rendering garbage downstream.
async function fetchSources(): Promise<ApiSourceStatus[]> {
    const res = await fetch(new URL('/sources', env.apiUrl));
    if (!res.ok) throw new Error(`GET /sources → ${res.status}`);
    return z.array(apiSourceStatusSchema).parse(await res.json());
}

export function useSources() {
    return useQuery({
        queryKey: ['sources'],
        queryFn: fetchSources,
        // Freshness moves at cron cadence (daily + 2-hourly); refetching every
        // few minutes keeps the chip honest without hammering the API.
        staleTime: 5 * 60 * 1000,
        refetchInterval: 5 * 60 * 1000,
    });
}
