import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuth } from './index.js';

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
		expect(config.emailAndPassword).toEqual({ enabled: true, minPasswordLength: 8 });
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

	// trustedOrigins is the other half of cross-subdomain SSO. Without it, better-auth defaults to
	// [baseURL] and rejects requests carrying the sibling app's Origin, which reads as a random 403.
	it('trusts the baseURL and the whole cookie domain when a cookieDomain is given', () => {
		const config = configFor({
			db,
			secret: 's',
			baseURL: 'https://demo-financials.cardano-mercury.com',
			cookieDomain: '.cardano-mercury.com'
		});
		expect(config.trustedOrigins).toEqual([
			'https://demo-financials.cardano-mercury.com',
			'https://*.cardano-mercury.com'
		]);
	});

	it('omits trustedOrigins for local single-app use, leaving better-auth its default', () => {
		const config = configFor({ db, secret: 's', baseURL: 'u' });
		expect(config.trustedOrigins).toBeUndefined();
	});

	it('lets an explicit trustedOrigins override the cookieDomain default', () => {
		const config = configFor({
			db,
			secret: 's',
			baseURL: 'u',
			cookieDomain: '.cardano-mercury.com',
			trustedOrigins: ['https://only-this.example']
		});
		expect(config.trustedOrigins).toEqual(['https://only-this.example']);
	});

	// Unhappy path: a cookieDomain with no baseURL still yields a usable wildcard rather than
	// [undefined, wildcard].
	it('falls back to just the wildcard when cookieDomain is set but baseURL is not', () => {
		const config = configFor({
			db,
			secret: undefined,
			baseURL: undefined,
			cookieDomain: '.cardano-mercury.com'
		});
		expect(config.trustedOrigins).toEqual(['https://*.cardano-mercury.com']);
	});

	// Password policy lives in core so the apps cannot drift apart on it.
	it('defaults email/password to enabled with an 8 character minimum', () => {
		const config = configFor({ db, secret: 's', baseURL: 'u' });
		expect(config.emailAndPassword).toEqual({ enabled: true, minPasswordLength: 8 });
	});

	it('merges an app-supplied emailAndPassword over the shared defaults', () => {
		const config = configFor({
			db,
			secret: 's',
			baseURL: 'u',
			emailAndPassword: { enabled: true, minPasswordLength: 12, requireEmailVerification: true }
		});
		expect(config.emailAndPassword).toEqual({
			enabled: true,
			minPasswordLength: 12,
			requireEmailVerification: true
		});
	});

	// Regression: the SvelteKit cookie plugin must stay last, so twoFactor is prepended and the app's
	// plugins keep their given order after it.
	it('appends app plugins after twoFactor, preserving their order', () => {
		const magicLink = { id: 'magicLink', __plugin: 'magicLink' };
		const sveltekitCookies = { id: 'sveltekitCookies', __plugin: 'sveltekitCookies' };
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

// Compile-time only: never called (calling it would hit the mocked betterAuth above, which doesn't
// return a real Auth instance). Its only job is to fail `npm run check` if createAuth's plugins
// generic regresses to BetterAuthPlugin[], which erases app-plugin endpoints from auth.api and
// forces callers back to a hand-rolled cast (see tokenomics' auth.ts `PluginEndpoints`).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function assertPluginEndpointsAreInferred(
	plugin: ReturnType<typeof import('better-auth/plugins').magicLink>
) {
	const auth = createAuth({ db, secret: 's', baseURL: 'u', plugins: [plugin] });
	return { enableTwoFactor: auth.api.enableTwoFactor, signInMagicLink: auth.api.signInMagicLink };
}
