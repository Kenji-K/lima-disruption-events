import { Badge } from '@/components/ui/badge';
import { useSources } from '../api/sources';
import { formatAgo, sourceLabel } from '../format';

/** Header chip surfacing pipeline freshness from GET /sources (review G14 —
 *  the cheapest credibility signal the data can offer). Garnish, not
 *  load-bearing: renders nothing while loading or on error. */
export default function FreshnessChip() {
    const { data: sources } = useSources();
    if (!sources || sources.length === 0) return null;

    const successTimes = sources.map((s) => s.lastSuccessAt).filter((t): t is string => t !== null);
    if (successTimes.length === 0) return null;
    const newest = successTimes.reduce((a, b) => (a > b ? a : b));

    const failing = sources.filter((s) => s.consecutiveFailures > 0);
    const failingNote =
        failing.length > 0
            ? `Fuentes con fallas: ${failing.map((s) => sourceLabel(s.sourceId)).join(', ')}`
            : `${sources.length} fuentes al día`;

    return (
        <Badge variant={failing.length > 0 ? 'destructive' : 'secondary'} title={failingNote}>
            Datos actualizados {formatAgo(newest)}
            {failing.length > 0 && ` · ${failing.length} con fallas`}
        </Badge>
    );
}
