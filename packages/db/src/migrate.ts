import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './client';

/**
 * Programmatic migration runner (ADR-006). drizzle-kit is a devDependency and
 * absent from the production image; drizzle-orm's own migrate() applies the
 * committed migrations/ folder against the same journal table
 * (drizzle.__drizzle_migrations) drizzle-kit writes, so local `pnpm migrate`
 * and production release runs share one ledger. Same call the Testcontainers
 * setup already uses.
 */
export async function runMigrations(): Promise<void> {
    const migrationsFolder = path.resolve(import.meta.dirname, '../migrations');
    await migrate(db, { migrationsFolder });
}
