import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

/**
 * Core's own migration journal. Three writers share one Postgres, so each keeps a separate history
 * table; without this they overwrite each other's.
 */
export const MIGRATIONS_TABLE = '__drizzle_migrations_core';

/**
 * The journal lives in `public`, alongside the apps' `__drizzle_migrations_financials` and
 * `__drizzle_migrations_tokenomics`. Drizzle's runtime migrator otherwise defaults it to a separate
 * `drizzle` schema, which would put core's history somewhere nobody thinks to look.
 */
export const MIGRATIONS_SCHEMA = 'public';

/**
 * Key for the Postgres advisory lock held across the migration. A `docker compose up` starts both
 * apps at once and each may invoke this, so the runs must serialise rather than race on `CREATE
 * TABLE`. The value is arbitrary but must be stable and unique to core; the lock is session-scoped
 * and released even if the process dies, which is what makes this safe to retry.
 */
export const ADVISORY_LOCK_KEY = 4_312_071_301;

/** The five tables core owns. Used to detect a database that predates core's migration journal. */
const SHARED_TABLES = ['user', 'session', 'account', 'verification', 'two_factor'];

/** Ships inside the published package (see the `files` array), so this resolves from `dist/` too. */
export function defaultMigrationsFolder(): string {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
}

export interface RunCoreMigrationsOptions {
	/** Overrides the bundled `drizzle/` folder. Mainly for tests. */
	migrationsFolder?: string;
	/**
	 * Adopt shared tables that already exist but that core's journal does not know about, by
	 * recording the migrations as applied instead of running them. This is the one-time escape hatch
	 * for a database where the tables were created before core owned them (an app's own migration, or
	 * financials' `drizzle/manual/shared-auth-tables.sql` stopgap). Without it, such a database is
	 * reported rather than silently altered.
	 */
	baseline?: boolean;
	log?: (message: string) => void;
}

/**
 * Create or update the shared Better Auth tables on `connectionString`.
 *
 * Safe to run repeatedly (drizzle's journal makes an applied migration a no-op) and safe to run
 * concurrently from several containers (the advisory lock serialises them). Apps call this, or the
 * `mercury-core migrate` bin does, before their own migrations: tokenomics and financials both
 * foreign-key to `user`, so `user` has to exist first.
 */
export async function runCoreMigrations(
	connectionString: string,
	options: RunCoreMigrationsOptions = {}
): Promise<void> {
	const log = options.log ?? (() => {});
	const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder();

	// `max: 1` because the advisory lock is session-scoped: it must be taken and released on the same
	// connection the migration runs on. `onnotice` is silenced because drizzle's own
	// `CREATE ... IF NOT EXISTS` journal setup emits "already exists, skipping" notices on every run
	// after the first, which are noise in a deploy log.
	const sql = postgres(connectionString, { max: 1, onnotice: () => {} });

	try {
		await sql`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`;
		log(`acquired advisory lock ${ADVISORY_LOCK_KEY}`);

		try {
			const adopted = await adoptPreexistingTables(
				sql,
				options.baseline ?? false,
				migrationsFolder,
				log
			);
			if (adopted) return;

			await migrate(drizzle(sql), {
				migrationsFolder,
				migrationsTable: MIGRATIONS_TABLE,
				migrationsSchema: MIGRATIONS_SCHEMA
			});
			log('shared auth tables are up to date');
		} finally {
			await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`;
		}
	} finally {
		await sql.end();
	}
}

/**
 * Handle a database whose shared tables predate core's journal. Returns true when the migration
 * should be skipped because the tables were adopted as-is; throws when they exist but `baseline`
 * was not given, since creating them again would fail on `CREATE TABLE ... already exists` and
 * altering them blindly could drop data.
 */
async function adoptPreexistingTables(
	sql: postgres.Sql,
	baseline: boolean,
	migrationsFolder: string,
	log: (message: string) => void
): Promise<boolean> {
	const journalExists = await tableExists(sql, MIGRATIONS_TABLE);
	if (journalExists) return false;

	const existing: string[] = [];
	for (const table of SHARED_TABLES) {
		if (await tableExists(sql, table)) existing.push(table);
	}
	if (existing.length === 0) return false;

	if (!baseline) {
		throw new Error(
			`The shared auth tables ${existing.join(', ')} already exist, but core's migration ` +
				`journal (${MIGRATIONS_TABLE}) does not. This database predates core owning these ` +
				`tables. Re-run with --baseline to adopt them as they are (core records its migrations ` +
				`as applied without touching the tables), or drop them first if the database is ` +
				`disposable.`
		);
	}

	log(`baselining: adopting existing ${existing.join(', ')} without altering them`);
	await baselineJournal(sql, migrationsFolder, log);
	return true;
}

async function tableExists(sql: postgres.Sql, name: string): Promise<boolean> {
	const rows = await sql<{ exists: boolean }[]>`
		SELECT EXISTS (
			SELECT FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = ${name}
		) AS exists
	`;
	return rows[0].exists;
}

/**
 * Write the bundled migrations into core's journal as already-applied, in the shape drizzle's
 * postgres-js migrator expects (hash of the SQL file, plus the journal's `when` timestamp).
 */
async function baselineJournal(
	sql: postgres.Sql,
	folder: string,
	log: (message: string) => void
): Promise<void> {
	const { readFile } = await import('node:fs/promises');
	const { createHash } = await import('node:crypto');

	const journal = JSON.parse(await readFile(path.join(folder, 'meta/_journal.json'), 'utf8')) as {
		entries: { idx: number; when: number; tag: string }[];
	};

	await sql.unsafe(`
		CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at bigint
		)
	`);

	for (const entry of journal.entries) {
		const sqlText = await readFile(path.join(folder, `${entry.tag}.sql`), 'utf8');
		const hash = createHash('sha256').update(sqlText).digest('hex');
		await sql`
			INSERT INTO ${sql(MIGRATIONS_TABLE)} (hash, created_at)
			VALUES (${hash}, ${entry.when})
		`;
		log(`baselined ${entry.tag}`);
	}
}
