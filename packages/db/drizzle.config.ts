import { defineConfig } from 'drizzle-kit';

try {
    process.loadEnvFile('../../.env');
} catch {
    // .env is optional - env vars may come from the shell or CI
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required (set it in .env or the environment)');

export default defineConfig({
    schema: './src/schema/*.ts',
    out: './migrations',
    dialect: 'postgresql',
    dbCredentials: { url },
    casing: 'snake_case',
    verbose: true,
    strict: true,
});