import postgres from 'postgres';
import * as schema from './schema';
import { drizzle } from 'drizzle-orm/postgres-js';

try {
    process.loadEnvFile('../../.env');
} catch {
    // .env is optional - env vars may come from the shell or CI
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required (set it in .env or the environment)');

const client = postgres(url);

export const db = drizzle(client, { schema, casing: 'snake_case' });
export const closeDb = () => client.end();
