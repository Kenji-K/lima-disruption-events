import { eq, sql } from 'drizzle-orm';
import { db, ingestState } from '@disruption-intelligence/db';

/** Per-source runtime state (ADR-007): cursor persistence + freshness/failure
 *  tracking. The runner owns all writes; scrapers only compute cursor values.
 *  Rows appear lazily on a source's first recorded run. */

export async function getCursor(sourceId: string): Promise<unknown> {
    const rows = await db
        .select({ cursor: ingestState.cursor })
        .from(ingestState)
        .where(eq(ingestState.sourceId, sourceId));
    return rows[0]?.cursor ?? null;
}

/** Records a successful run. The cursor column is only touched when the scraper
 *  returned one (`nextCursor !== undefined`) — full-window scrapers never do, and
 *  an incremental scraper that processed nothing new may deliberately return
 *  undefined to leave its resume point untouched. */
export async function recordSuccess(sourceId: string, nextCursor: unknown): Promise<void> {
    const cursorCols = nextCursor === undefined ? {} : { cursor: nextCursor };
    await db
        .insert(ingestState)
        .values({
            sourceId,
            lastRunAt: sql`now()`,
            lastSuccessAt: sql`now()`,
            consecutiveFailures: 0,
            ...cursorCols,
        })
        .onConflictDoUpdate({
            target: ingestState.sourceId,
            set: {
                lastRunAt: sql`now()`,
                lastSuccessAt: sql`now()`,
                lastError: null,
                consecutiveFailures: 0,
                ...cursorCols,
            },
        });
}

/** Records a failed run. The cursor is deliberately untouched — a failed run must
 *  never advance a resume point past data it didn't process (ADR-007). */
export async function recordFailure(sourceId: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await db
        .insert(ingestState)
        .values({
            sourceId,
            lastRunAt: sql`now()`,
            lastErrorAt: sql`now()`,
            lastError: message,
            consecutiveFailures: 1,
        })
        .onConflictDoUpdate({
            target: ingestState.sourceId,
            set: {
                lastRunAt: sql`now()`,
                lastErrorAt: sql`now()`,
                lastError: message,
                consecutiveFailures: sql`${ingestState.consecutiveFailures} + 1`,
            },
        });
}
