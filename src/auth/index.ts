import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';

export interface CreateAuthOptions {
	/** A drizzle client whose schema includes the shared auth tables from `@cardano-mercury/core/db`. */
	db: Parameters<typeof drizzleAdapter>[0];
	secret: string | undefined;
	baseURL: string | undefined;
	/** Issuer shown in authenticator apps for 2FA. */
	issuer?: string;
	/**
	 * Parent domain for cross-subdomain cookies, e.g. `.cardano-mercury.com`, so a session created
	 * on one Mercury app is valid on the others. Omit for local single-app use.
	 */
	cookieDomain?: string;
	/**
	 * App-side plugins appended after the shared ones. A SvelteKit app passes
	 * `sveltekitCookies(getRequestEvent)` here (and it should be last).
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	plugins?: any[];
}

/**
 * Build a Better Auth instance with the conventions shared across the Mercury apps: email/password,
 * two-factor, the Drizzle (Postgres) adapter, and optional cross-subdomain cookies for SSO. The
 * framework-specific glue (e.g. SvelteKit's cookie plugin) is passed in via `plugins`.
 */
export function createAuth(opts: CreateAuthOptions) {
	return betterAuth({
		baseURL: opts.baseURL,
		secret: opts.secret,
		database: drizzleAdapter(opts.db, { provider: 'pg' }),
		emailAndPassword: { enabled: true },
		...(opts.cookieDomain
			? {
					advanced: {
						crossSubDomainCookies: { enabled: true, domain: opts.cookieDomain }
					}
				}
			: {}),
		plugins: [twoFactor({ issuer: opts.issuer ?? 'Mercury' }), ...(opts.plugins ?? [])]
	});
}
