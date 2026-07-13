import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';

export interface CreateAuthOptions<TPlugins extends BetterAuthPlugin[] = []> {
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
	 * Origins Better Auth accepts requests from. It otherwise defaults to `[baseURL]`, which is too
	 * narrow once two apps share a cookie across a parent domain: a request arriving at one app
	 * carrying an `Origin` or `Referer` from the other fails the check and 403s. When `cookieDomain`
	 * is set and this is omitted, it defaults to the baseURL plus a wildcard over that domain, so the
	 * origin check trusts exactly the apps the shared cookie is already visible to. Pass explicitly
	 * to override.
	 */
	trustedOrigins?: string[];
	/**
	 * Email/password policy, merged over the shared defaults (enabled, 8 character minimum). Set here
	 * rather than per app so the password rules cannot quietly diverge between them.
	 */
	emailAndPassword?: BetterAuthOptions['emailAndPassword'];
	/**
	 * App-side plugins appended after the shared ones. A SvelteKit app passes
	 * `sveltekitCookies(getRequestEvent)` here (and it should be last). Typed as `TPlugins`, inferred
	 * from the array literal passed in, rather than `BetterAuthPlugin[]`, so the endpoints these
	 * plugins add (e.g. magic link's `signInMagicLink`) come through on the returned instance's
	 * `auth.api` without callers hand-rolling a cast.
	 */
	plugins?: TPlugins;
}

/**
 * The session cookie is already shared with every app under `cookieDomain`, so the origin check
 * should trust that same set. Better Auth accepts a wildcard host here.
 */
function defaultTrustedOrigins(
	baseURL: string | undefined,
	cookieDomain: string | undefined
): string[] | undefined {
	if (!cookieDomain) return undefined;
	const wildcard = `https://*${cookieDomain}`;
	return baseURL ? [baseURL, wildcard] : [wildcard];
}

/**
 * Build a Better Auth instance with the conventions shared across the Mercury apps: email/password,
 * two-factor, the Drizzle (Postgres) adapter, and optional cross-subdomain cookies plus matching
 * trusted origins for SSO. The framework-specific glue (e.g. SvelteKit's cookie plugin) is passed
 * in via `plugins`.
 *
 * An app must resolve the same *physical* copy of `better-auth` (and its `@better-auth/core`
 * dependency) that core does, not merely the same version. Two copies on disk are two distinct type
 * identities, so the instance this returns fails to satisfy consumers like `svelteKitHandler` even
 * when both copies are byte-identical and the runtime value is correct. The narrow peer range keeps
 * versions aligned, but only a single hoisted copy makes the types agree; consuming core from the
 * registry rather than a `file:` link is what delivers that.
 */
export function createAuth<TPlugins extends BetterAuthPlugin[] = []>(
	opts: CreateAuthOptions<TPlugins>
) {
	const trustedOrigins =
		opts.trustedOrigins ?? defaultTrustedOrigins(opts.baseURL, opts.cookieDomain);

	return betterAuth({
		baseURL: opts.baseURL,
		secret: opts.secret,
		database: drizzleAdapter(opts.db, { provider: 'pg' }),
		emailAndPassword: { enabled: true, minPasswordLength: 8, ...opts.emailAndPassword },
		...(trustedOrigins ? { trustedOrigins } : {}),
		...(opts.cookieDomain
			? {
					advanced: {
						crossSubDomainCookies: { enabled: true, domain: opts.cookieDomain }
					}
				}
			: {}),
		plugins: [
			twoFactor({ issuer: opts.issuer ?? 'Mercury' }),
			...(opts.plugins ?? ([] as unknown as TPlugins))
		] as [ReturnType<typeof twoFactor>, ...TPlugins]
	});
}
