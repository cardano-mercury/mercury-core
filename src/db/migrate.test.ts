import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	runCoreMigrations,
	defaultMigrationsFolder,
	MIGRATIONS_TABLE,
	MIGRATIONS_SCHEMA,
	ADVISORY_LOCK_KEY
} from './migrate';

// Mock the driver and the drizzle migrator so these tests assert the *orchestration* (lock, adopt,
// migrate, unlock, disconnect) without a live Postgres. The end-to-end behaviour against a real
// database is exercised separately; what is easy to get wrong and cheap to pin here is the ordering
// and the failure paths.
const { postgres, migrate, drizzle } = vi.hoisted(() => ({
	postgres: vi.fn(),
	migrate: vi.fn(async () => {}),
	drizzle: vi.fn((sql) => ({ __db: sql }))
}));
vi.mock('postgres', () => ({ default: postgres }));
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle }));
vi.mock('drizzle-orm/postgres-js/migrator', () => ({ migrate }));

/** The subset of a postgres.js client this module actually uses, plus a log of what it was asked. */
interface FakeSql {
	(strings: TemplateStringsArray | string, ...values: unknown[]): unknown;
	unsafe: ReturnType<typeof vi.fn>;
	end: ReturnType<typeof vi.fn>;
	queries: string[];
}

/**
 * A stand-in for a postgres.js `sql` client. `existing` is the set of tables the fake database
 * already has, which is what drives the adoption logic.
 */
function makeSql(existing: string[] = []): FakeSql {
	const queries: string[] = [];
	const present = new Set(existing);

	const sql = ((strings: TemplateStringsArray | string, ...values: unknown[]) => {
		// postgres.js doubles as an identifier escaper: sql('table_name').
		if (typeof strings === 'string') return { __identifier: strings };

		const text = strings.join('?');
		queries.push(text.replace(/\s+/g, ' ').trim());

		if (text.includes('information_schema.tables')) {
			return Promise.resolve([{ exists: present.has(values[0] as string) }]);
		}
		return Promise.resolve([]);
	}) as FakeSql;

	sql.unsafe = vi.fn(async () => []);
	sql.end = vi.fn(async () => {});
	sql.queries = queries;
	return sql;
}

const URL = 'postgres://u:p@localhost:5432/db';

beforeEach(() => {
	postgres.mockReset();
	migrate.mockReset();
	migrate.mockResolvedValue(undefined);
	drizzle.mockClear();
});

describe('runCoreMigrations', () => {
	// Happy path: an empty database just migrates.
	it('takes the advisory lock, migrates, then unlocks and disconnects', async () => {
		const sql = makeSql();
		postgres.mockReturnValue(sql);

		await runCoreMigrations(URL);

		expect(sql.queries.some((q) => q.includes(`pg_advisory_lock(?)`))).toBe(true);
		expect(sql.queries.some((q) => q.includes(`pg_advisory_unlock(?)`))).toBe(true);
		expect(migrate).toHaveBeenCalledTimes(1);
		expect(sql.end).toHaveBeenCalledTimes(1);
	});

	// The journal must land in `public` beside the apps' journals. Drizzle's runtime migrator
	// otherwise defaults it to a separate `drizzle` schema, where nobody would think to look — and
	// where this module's own "does the journal exist" probe (which reads `public`) cannot see it,
	// so every later run would misread the database as pre-core and refuse to migrate.
	it('writes the journal to public, under core-specific table name', async () => {
		postgres.mockReturnValue(makeSql());

		await runCoreMigrations(URL);

		expect(migrate).toHaveBeenCalledWith(expect.anything(), {
			migrationsFolder: defaultMigrationsFolder(),
			migrationsTable: MIGRATIONS_TABLE,
			migrationsSchema: MIGRATIONS_SCHEMA
		});
		expect(MIGRATIONS_SCHEMA).toBe('public');
	});

	// Regression: once core's own journal exists, the adoption check must not fire. Getting this
	// wrong makes the *second* run of a database core itself migrated fail as "tables already exist".
	it("migrates normally when core's journal already exists, tables and all", async () => {
		postgres.mockReturnValue(makeSql([MIGRATIONS_TABLE, 'user', 'session', 'account']));

		await expect(runCoreMigrations(URL)).resolves.toBeUndefined();
		expect(migrate).toHaveBeenCalledTimes(1);
	});

	// Unhappy path: tables predating core (an app's old migration, or financials' stopgap SQL).
	// Creating them again would fail on CREATE TABLE, and altering them blindly could drop data, so
	// refuse and say exactly how to proceed.
	it('refuses a pre-core database rather than touching it, and names the escape hatch', async () => {
		postgres.mockReturnValue(makeSql(['user', 'session']));

		await expect(runCoreMigrations(URL)).rejects.toThrow(/already exist.*--baseline/s);
		expect(migrate).not.toHaveBeenCalled();
	});

	it('adopts a pre-core database when baselining, without running the migration', async () => {
		const sql = makeSql(['user', 'session', 'account', 'verification', 'two_factor']);
		postgres.mockReturnValue(sql);
		const log = vi.fn();

		await runCoreMigrations(URL, { baseline: true, log });

		// The tables are adopted as they are: the SQL is never applied.
		expect(migrate).not.toHaveBeenCalled();
		// ...but the journal is written, so later migrations still apply on top.
		expect(sql.unsafe).toHaveBeenCalledWith(expect.stringContaining(MIGRATIONS_TABLE));
		expect(sql.queries.some((q) => q.includes('INSERT INTO'))).toBe(true);
		expect(log).toHaveBeenCalledWith(expect.stringContaining('baselining'));
	});

	// Baselining an empty database is a normal migrate: there is nothing to adopt.
	it('ignores the baseline flag on an empty database', async () => {
		postgres.mockReturnValue(makeSql());

		await runCoreMigrations(URL, { baseline: true });

		expect(migrate).toHaveBeenCalledTimes(1);
	});

	// Regression: a failed migration must still release the lock and close the socket, or the next
	// container to try blocks forever on a lock nobody holds a session for.
	it('releases the lock and disconnects even when the migration throws', async () => {
		const sql = makeSql();
		postgres.mockReturnValue(sql);
		migrate.mockRejectedValue(new Error('boom'));

		await expect(runCoreMigrations(URL)).rejects.toThrow('boom');
		expect(sql.queries.some((q) => q.includes('pg_advisory_unlock(?)'))).toBe(true);
		expect(sql.end).toHaveBeenCalledTimes(1);
	});

	it('honours a custom migrations folder', async () => {
		postgres.mockReturnValue(makeSql());

		await runCoreMigrations(URL, { migrationsFolder: '/somewhere/else' });

		expect(migrate).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ migrationsFolder: '/somewhere/else' })
		);
	});

	// The lock is session-scoped, so it has to be taken and released on the one connection the
	// migration runs on. A pool would hand the unlock to a different backend and leak the lock.
	// The notice handler is silenced because drizzle's journal setup emits "already exists,
	// skipping" on every run after the first, which is noise in a deploy log.
	it('opens a single-connection client that swallows notices', async () => {
		postgres.mockReturnValue(makeSql());

		await runCoreMigrations(URL);

		expect(postgres).toHaveBeenCalledWith(
			URL,
			expect.objectContaining({ max: 1, onnotice: expect.any(Function) })
		);
		const { onnotice } = postgres.mock.calls[0][1];
		expect(() => onnotice({ message: 'relation already exists, skipping' })).not.toThrow();
	});
});

describe('defaultMigrationsFolder', () => {
	// Resolves relative to this module, so it points at the SQL bundled in the published package
	// rather than at a checked-out repo.
	it('points at the drizzle folder that ships in the package', () => {
		expect(defaultMigrationsFolder()).toMatch(/[/\\]drizzle$/);
	});
});

describe('ADVISORY_LOCK_KEY', () => {
	// Two containers racing at boot must contend on the same key, and it must fit in the bigint
	// pg_advisory_lock takes.
	it('is a stable integer inside Postgres bigint range', () => {
		expect(Number.isInteger(ADVISORY_LOCK_KEY)).toBe(true);
		expect(ADVISORY_LOCK_KEY).toBeLessThan(2 ** 63 - 1);
	});
});
