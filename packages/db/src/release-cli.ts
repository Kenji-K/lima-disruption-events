/**
 * Fly `release_command` entry (ADR-006): apply pending migrations, then re-run
 * the idempotent reference-data seed, before a deploy is promoted. A non-zero
 * exit aborts the deploy and leaves the running version untouched.
 * Run-once with finally-closeDb so the postgres-js pool drains and the event
 * loop exits cleanly (same shape as seed-cli.ts).
 */

import { closeDb } from './client';
import { runMigrations } from './migrate';
import { seed } from './seed';

async function main(): Promise<void> {
    await runMigrations();
    console.log('release: migrations applied');
    const result = await seed();
    console.log(`release: seed inserted=${result.inserted} skipped=${result.skipped}`);
}

main()
    .catch((err) => {
        console.error('release failed:', err);
        process.exitCode = 1;
    })
    .finally(() => closeDb());
