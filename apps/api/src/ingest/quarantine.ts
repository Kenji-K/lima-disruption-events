import { sql } from 'drizzle-orm';
import { db, ingestQuarantine } from '@disruption-intelligence/db';
import type { QuarantinedPost } from './types';

/** Persists keyword-positive gate rejections (ADR-011). Idempotent on
 *  (sourceId, externalId): a re-run refreshes lastSeenAt and the verdict —
 *  re-tuned gates overwrite stale reasons instead of duplicating rows. */
export async function recordQuarantine(entries: QuarantinedPost[]): Promise<void> {
    if (entries.length === 0) return;
    await db
        .insert(ingestQuarantine)
        .values(
            entries.map((e) => ({
                sourceId: e.sourceId,
                externalId: e.externalId,
                title: e.title,
                url: e.url ?? null,
                reason: e.reason,
                detail: e.detail ?? null,
                postDate: new Date(e.postDate),
            })),
        )
        .onConflictDoUpdate({
            target: [ingestQuarantine.sourceId, ingestQuarantine.externalId],
            set: {
                title: sql`excluded.title`,
                url: sql`excluded.url`,
                reason: sql`excluded.reason`,
                detail: sql`excluded.detail`,
                postDate: sql`excluded.post_date`,
                lastSeenAt: sql`now()`,
            },
        });
}
