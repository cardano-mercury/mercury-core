#!/usr/bin/env node
/**
 * `npx @cardano-mercury/core migrate` — create or update the shared Better Auth tables.
 *
 * This is what the deploy stack's one-shot `core-migrate` service runs. It works from the published
 * package, with no checkout of this repo: the SQL ships in the tarball (see the `files` array) and
 * is resolved relative to `dist/`.
 *
 * Both apps foreign-key to `user`, so this must complete before either app migrates.
 */
import { runCoreMigrations } from '../dist/db/migrate.js';

const [command, ...rest] = process.argv.slice(2);

if (command !== 'migrate') {
	console.error('usage: mercury-core migrate [--baseline]\n');
	console.error("  migrate      apply core's shared auth migrations to $DATABASE_URL");
	console.error(
		"  --baseline   adopt shared tables that already exist but predate core's journal"
	);
	process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	console.error('DATABASE_URL is not set.');
	process.exit(1);
}

try {
	await runCoreMigrations(connectionString, {
		baseline: rest.includes('--baseline'),
		log: (message) => console.log(`[mercury-core] ${message}`)
	});
} catch (error) {
	console.error(
		`[mercury-core] migration failed: ${error instanceof Error ? error.message : error}`
	);
	process.exit(1);
}
