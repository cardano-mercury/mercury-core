import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { user, session, account, verification, twoFactor } from './schema.js';

// These tables are the contract every Mercury app foreign-keys to, and core owns their migrations,
// so these are regression tests: they lock the column names, nullability, keys, and indexes so an
// accidental edit here can't silently desync the shared database from the apps. They assert shape,
// not behaviour — drizzle's own builder is trusted to turn that shape into SQL.

type ColShape = { notNull: boolean; primary: boolean; hasDefault: boolean; isUnique: boolean };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function columnShapes(table: any): Record<string, ColShape> {
	const { columns } = getTableConfig(table);
	const out: Record<string, ColShape> = {};
	for (const c of columns) {
		out[c.name] = {
			notNull: c.notNull,
			primary: c.primary,
			hasDefault: c.hasDefault,
			isUnique: c.isUnique
		};
	}
	return out;
}

describe('user table', () => {
	const cols = columnShapes(user);

	it('has exactly the expected columns', () => {
		expect(Object.keys(cols).sort()).toEqual(
			[
				'id',
				'name',
				'email',
				'email_verified',
				'image',
				'created_at',
				'updated_at',
				'two_factor_enabled'
			].sort()
		);
	});

	it('keys on id and enforces a unique email', () => {
		expect(cols.id.primary).toBe(true);
		expect(cols.email.notNull).toBe(true);
		expect(cols.email.isUnique).toBe(true);
	});

	it('defaults email_verified and the timestamps', () => {
		expect(cols.email_verified.notNull).toBe(true);
		expect(cols.email_verified.hasDefault).toBe(true);
		expect(cols.created_at.hasDefault).toBe(true);
		expect(cols.updated_at.hasDefault).toBe(true);
	});

	it('allows a null image', () => {
		expect(cols.image.notNull).toBe(false);
	});
});

describe('session table', () => {
	const cols = columnShapes(session);
	const { foreignKeys, indexes } = getTableConfig(session);

	it('has a unique token and a not-null expiry', () => {
		expect(cols.token.isUnique).toBe(true);
		expect(cols.expires_at.notNull).toBe(true);
	});

	it('cascades when its user is deleted', () => {
		expect(foreignKeys).toHaveLength(1);
		const ref = foreignKeys[0].reference();
		expect(ref.foreignTable).toBe(user);
		expect(foreignKeys[0].onDelete).toBe('cascade');
	});

	it('indexes user_id for per-user session lookups', () => {
		expect(indexes.map((i) => i.config.name)).toContain('session_user_id_idx');
	});
});

describe('account table', () => {
	const cols = columnShapes(account);
	const { foreignKeys } = getTableConfig(account);

	it('requires accountId, providerId and userId', () => {
		expect(cols.account_id.notNull).toBe(true);
		expect(cols.provider_id.notNull).toBe(true);
		expect(cols.user_id.notNull).toBe(true);
	});

	it('keeps the credential/token fields nullable', () => {
		expect(cols.password.notNull).toBe(false);
		expect(cols.access_token.notNull).toBe(false);
		expect(cols.refresh_token.notNull).toBe(false);
	});

	it('cascades from user', () => {
		expect(foreignKeys[0].onDelete).toBe('cascade');
		expect(foreignKeys[0].reference().foreignTable).toBe(user);
	});
});

describe('verification table', () => {
	const cols = columnShapes(verification);

	it('requires identifier, value and expiry', () => {
		expect(cols.identifier.notNull).toBe(true);
		expect(cols.value.notNull).toBe(true);
		expect(cols.expires_at.notNull).toBe(true);
	});
});

describe('two_factor table', () => {
	const cols = columnShapes(twoFactor);
	const { foreignKeys, indexes } = getTableConfig(twoFactor);

	it('keeps secret and backupCodes nullable but pins userId', () => {
		expect(cols.secret.notNull).toBe(false);
		expect(cols.backup_codes.notNull).toBe(false);
		expect(cols.user_id.notNull).toBe(true);
	});

	it('cascades from user and indexes user_id', () => {
		expect(foreignKeys[0].onDelete).toBe('cascade');
		expect(indexes.map((i) => i.config.name)).toContain('two_factor_user_id_idx');
	});
});
