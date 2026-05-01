import { afterAll } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';

const migrationsFolder = path.resolve(import.meta.dirname, '../../../packages/db/migrations');

// Top-level execution (not beforeAll) so the container URL is set BEFORE
// any test file's static imports trigger client.ts and bind the db
// singleton. Vitest awaits setup-file evaluation before loading test
// files, so top-level await blocks at the right point.
const container = await new PostgreSqlContainer('imresamu/postgis:16-3.5').start();
process.env.DATABASE_URL = container.getConnectionUri();

const { db, closeDb } = await import('@disruption-intelligence/db');
await migrate(db, { migrationsFolder });

afterAll(async () => {
    await closeDb();
    await container.stop();
});
