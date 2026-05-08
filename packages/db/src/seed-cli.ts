/**
 * CLI entry for `pnpm -F @disruption-intelligence/db seed`.
 * Idempotent: re-runs are safe (ON CONFLICT DO NOTHING in seed.ts).
 * Mirrors apps/api/src/ingest/index.ts: run-once with finally-closeDb so
 * the postgres-js pool drains and the event loop exits cleanly.
 */

import { closeDb } from './client';
import { seed } from './seed';

async function main(): Promise<void> {
    const result = await seed();
    console.log(
        `seed: inserted=${result.inserted} skipped=${result.skipped} ` +
            `(skipped rows already existed from a prior seed or migration)`,
    );
}

main()
    .catch((err) => {
        console.error('seed failed:', err);
        process.exitCode = 1;
    })
    .finally(() => closeDb());
