import { setTimeout as sleep } from 'node:timers/promises';
import type { Logger } from 'pino';

// Polite UA identifies the project. Add a contact suffix (public alias or repo URL)
// once the repo is public — never a personal email.
export const USER_AGENT = 'disruption-intelligence/0.1';
const REQUEST_TIMEOUT_MS = 10_000;
// 1 initial attempt + N retries; this array's length = N. Phase 1 default → 4 total attempts.
export const PHASE_1_RETRY_BACKOFFS_MS = [250, 500, 1000];

export type FetchOutcome =
    | { ok: true; html: string }
    | { ok: false; reason: 'http-4xx'; status: number }
    | { ok: false; reason: 'transient'; status?: number; cause?: unknown };

// Shared two-phase retry fetch per ARCHITECTURE.md "Scraper conventions": callers run
// phase 1 with the default backoffs, accumulate transient failures, then make a single
// end-of-run phase-2 pass with retryBackoffsMs = [].
export async function fetchWithRetry(
    url: string,
    log: Logger,
    retryBackoffsMs: number[] = PHASE_1_RETRY_BACKOFFS_MS,
): Promise<FetchOutcome> {
    let lastTransient: { status?: number; cause?: unknown } = {};
    const totalAttempts = 1 + retryBackoffsMs.length;

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
        if (attempt > 0) {
            await sleep(retryBackoffsMs[attempt - 1]);
        }

        try {
            const res = await fetch(url, {
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: { 'User-Agent': USER_AGENT },
            });

            if (res.ok) {
                return { ok: true, html: await res.text() };
            }
            if (res.status >= 400 && res.status < 500) {
                return { ok: false, reason: 'http-4xx', status: res.status };
            }
            // 5xx — operational, retryable.
            lastTransient = { status: res.status };
            log.debug({ url, attempt, status: res.status }, 'http 5xx, will retry');
        } catch (cause) {
            // Network error, abort, timeout — all transient.
            lastTransient = { cause };
            log.debug({ url, attempt, cause }, 'fetch threw, will retry');
        }
    }

    return { ok: false, reason: 'transient', ...lastTransient };
}
