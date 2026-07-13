import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

/**
 * Core owns the five shared Better Auth tables and nothing else. Three writers share one Postgres,
 * so this config is deliberately blinkered the same way each app's is:
 *
 * - `tablesFilter` keeps drizzle-kit from seeing the apps' `financials_*` / `tokenomics_*` tables
 *   and offering to drop them as drift.
 * - `migrations.table` gives core its own journal, so the three migration histories cannot
 *   overwrite each other.
 *
 * There is no `push` script here, on purpose. `drizzle-kit push` applies `tablesFilter` to tables
 * but not to sequences, and against the shared database it proposes dropping the *other* apps'
 * migration-journal sequences. Generate and migrate only.
 */
export default defineConfig({
	schema: './src/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DATABASE_URL },
	tablesFilter: ['user', 'session', 'account', 'verification', 'two_factor'],
	migrations: { table: '__drizzle_migrations_core', schema: 'public' },
	verbose: true,
	strict: true
});
