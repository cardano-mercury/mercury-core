import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuth } from './index';

// Mock the three better-auth entry points so the test asserts the *configuration* createAuth
// assembles, without standing up a real auth instance. betterAuth echoes its config back, and the
// adapter/plugin factories return tagged markers so we can spot them in that config.
const { betterAuth, drizzleAdapter, twoFactor } = vi.hoisted(() => ({
	betterAuth: vi.fn((config) => ({ config })),
	drizzleAdapter: vi.fn((db, opts) => ({ __adapter: 'drizzle', db, opts })),
	twoFactor: vi.fn((opts) => ({ __plugin: 'twoFactor', opts }))
}));
vi.mock('better-auth/minimal', () => ({ betterAuth }));
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter }));
vi.mock('better-auth/plugins', () => ({ twoFactor }));

const db = { __db: true } as never;

beforeEach(() => {
	betterAuth.mockClear();
	drizzleAdapter.mockClear();
	twoFactor.mockClear();
});

function configFor(opts: Parameters<typeof createAuth>[0]) {
	createAuth(opts);
	return betterAuth.mock.calls[0][0];
}

describe('createAuth', () => {
	// Happy path: the shared conventions every Mercury app gets.
	it('bakes in email/password, the pg drizzle adapter, and passes through baseURL/secret', () => {
		const config = configFor({ db, secret: 's3cret', baseURL: 'https://app.example' });

		expect(config.baseURL).toBe('https://app.example');
		expect(config.secret).toBe('s3cret');
		expect(config.emailAndPassword).toEqual({ enabled: true });
		expect(drizzleAdapter).toHaveBeenCalledWith(db, { provider: 'pg' });
		expect(config.database).toMatchObject({ __adapter: 'drizzle', opts: { provider: 'pg' } });
	});

	it('enables two-factor with the default Mercury issuer', () => {
		const config = configFor({ db, secret: 's', baseURL: 'u' });
		expect(twoFactor).toHaveBeenCalledWith({ issuer: 'Mercury' });
		expect(config.plugins[0]).toMatchObject({ __plugin: 'twoFactor', opts: { issuer: 'Mercury' } });
	});

	it('uses a custom 2FA issuer when given', () => {
		configFor({ db, secret: 's', baseURL: 'u', issuer: 'Financials' });
		expect(twoFactor).toHaveBeenCalledWith({ issuer: 'Financials' });
	});

	// Cross-subdomain SSO: present vs absent are two distinct config shapes.
	it('enables cross-subdomain cookies when a cookieDomain is given', () => {
		const config = configFor({
			db,
			secret: 's',
			baseURL: 'u',
			cookieDomain: '.cardano-mercury.com'
		});
		expect(config.advanced).toEqual({
			crossSubDomainCookies: { enabled: true, domain: '.cardano-mercury.com' }
		});
	});

	it('omits the advanced cookie block entirely for local single-app use', () => {
		const config = configFor({ db, secret: 's', baseURL: 'u' });
		expect(config.advanced).toBeUndefined();
	});

	// Regression: the SvelteKit cookie plugin must stay last, so twoFactor is prepended and the app's
	// plugins keep their given order after it.
	it('appends app plugins after twoFactor, preserving their order', () => {
		const magicLink = { __plugin: 'magicLink' };
		const sveltekitCookies = { __plugin: 'sveltekitCookies' };
		const config = configFor({
			db,
			secret: 's',
			baseURL: 'u',
			plugins: [magicLink, sveltekitCookies]
		});

		expect(config.plugins).toHaveLength(3);
		expect(config.plugins[0]).toMatchObject({ __plugin: 'twoFactor' });
		expect(config.plugins[1]).toBe(magicLink);
		expect(config.plugins[2]).toBe(sveltekitCookies);
	});

	// Regression: no app plugins still yields a valid single-element plugin list (the `?? []` branch).
	it('defaults to just the twoFactor plugin when none are passed', () => {
		const config = configFor({ db, secret: 's', baseURL: 'u' });
		expect(config.plugins).toHaveLength(1);
	});

	// Unhappy path: undefined secret/baseURL (e.g. missing env) pass straight through rather than
	// being silently defaulted — better-auth is left to decide how to react.
	it('passes undefined secret and baseURL through unchanged', () => {
		const config = configFor({ db, secret: undefined, baseURL: undefined });
		expect(config.secret).toBeUndefined();
		expect(config.baseURL).toBeUndefined();
	});
});
