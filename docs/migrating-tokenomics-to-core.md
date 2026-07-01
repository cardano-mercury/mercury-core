# Migrating mercury-tokenomics onto mercury-core

This is the playbook for moving mercury-tokenomics onto the shared `@cardano-mercury/core` package
and the shared Postgres database, the same way mercury-financials already did. mercury-financials
is the working reference; mirror what it does.

The two real pieces of work are: switch tokenomics from SQLite to Postgres, and consume core for
auth, the shared schema, and the Cardano utilities. Everything else is wiring.

## Why

Both apps already use SvelteKit, Drizzle, adapter-node, and Better Auth. The only thing keeping
them from sharing a database and a single login is that tokenomics is on SQLite while the shared
target is Postgres. Once tokenomics is on Postgres and consuming core, a session created on either
app is valid on both (shared DB, shared secret, parent-domain cookie).

## 1. Depend on core

```jsonc
// package.json
"dependencies": {
  "@cardano-mercury/core": "file:../mercury-core" // or the published version once it's on npm
}
```

`better-auth`, `drizzle-orm`, and `@meshsdk/core` are peer dependencies of core, so keep them in
tokenomics at compatible versions. Pin `better-auth` to the same version both apps use so the
generated auth schema stays identical.

## 2. Switch the database engine to Postgres

This is the largest change because tokenomics' own tables are defined for SQLite.

- `drizzle.config.ts`: `dialect: 'sqlite'` to `'postgresql'`.
- `src/lib/server/db/index.ts`: replace `drizzle-orm/better-sqlite3` + `better-sqlite3` with
  `drizzle-orm/postgres-js` + `postgres`, and point `DATABASE_URL` at the shared Postgres.
- Rewrite the app tables in `src/lib/server/db/schema.ts` from `sqliteTable` to `pgTable`, mapping
  column types: integer timestamp (`{ mode: 'timestamp_ms' }`) to `timestamp`, integer booleans to
  `boolean`, text ids stay text, and so on. The tables to convert are the tokenomics-specific ones
  (project, bucket, controlledWallet, transactionTag, anchorRecord, tokenMovement).
- Drop the hand-written SQLite `auth.schema.ts`; it is replaced in step 3.

## 3. Adopt core for auth and the shared schema

Replace the local auth schema re-export and auth config with core's.

```ts
// src/lib/server/db/schema.ts  (end of file)
export * from '@cardano-mercury/core/db'; // shared user/session/account/verification/two_factor
```

```ts
// src/lib/server/auth.ts
import { env } from '$env/dynamic/private';
import { createAuth } from '@cardano-mercury/core/auth';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { magicLink } from 'better-auth/plugins';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { sendMagicLinkEmail } from '$lib/server/email';

export const auth = createAuth({
  db,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.ORIGIN,
  issuer: 'Mercury Tokenomics',
  cookieDomain: env.COOKIE_DOMAIN || undefined, // .cardano-mercury.com in production
  plugins: [
    magicLink({ sendMagicLink: async ({ email, url }) => sendMagicLinkEmail(email, url) }),
    sveltekitCookies(getRequestEvent) // keep last
  ]
});
```

Note: core's factory already enables email/password and two-factor. Tokenomics' magic-link and its
email sending stay app-side via the `plugins` array, because the email transport is app-specific.
The app tables keep foreign-keying to `user` (now imported from core).

`hooks.server.ts`, `app.d.ts` (`Locals { user?: User; session?: Session }`), and the login/signup/
signout routes do not change shape; they already match what financials does.

## 4. Migration ownership and the shared database

- mercury-core owns the migrations for the shared auth tables and runs them once against the shared
  Postgres.
- tokenomics' `drizzle-kit` should generate migrations only for its own app tables. Re-exporting
  core's tables into the schema (step 3) means drizzle-kit sees them and won't try to drop them,
  but it should not own creating them on the shared DB. On a fresh shared database, let core create
  the auth tables, then have tokenomics create only its app tables.
- All apps point `DATABASE_URL` at the same Postgres, share `BETTER_AUTH_SECRET`, and set
  `COOKIE_DOMAIN=.cardano-mercury.com`.

## 5. Move existing data (if any)

If there is production data in `local.db`, export it and load it into Postgres (a one-off script,
or `pgloader`). If tokenomics is still early, a clean start on Postgres is simpler. Auth users will
live in the shared `user` table going forward.

## 6. Fold shared needs into core

While migrating, look for things tokenomics needs that belong in core rather than being duplicated:

- Cardano utilities: if tokenomics has its own Blockfrost client, address parsing, or money
  formatting, switch to `@cardano-mercury/core/cardano` and `/money`. If it needs Blockfrost
  endpoints core doesn't expose yet (assets, pools, etc.), add them to core's client.
- A shared wallet model: both apps track Cardano wallets (financials `wallets`, tokenomics
  `controlledWallet`). If we want CIP-8 verified wallet ownership shared across apps, promote a
  wallet/ownership table and the CIP-8 verification into core rather than implementing it twice.
- Auth options: if magic-link should be a default for all apps, add an optional `magicLink` switch
  to core's `createAuth` (keeping the email transport app-injected).

Anything genuinely tokenomics-specific (projects, buckets, token movements, anchoring) stays in
tokenomics.

## Checklist

- [ ] Add the core dependency; align peer versions.
- [ ] Postgres: drizzle config, db client, app tables converted from SQLite.
- [ ] `export * from '@cardano-mercury/core/db'`; remove the local auth schema.
- [ ] `auth.ts` uses `createAuth` plus tokenomics' magic-link/email and the SvelteKit cookie plugin.
- [ ] Shared `DATABASE_URL`, `BETTER_AUTH_SECRET`, `COOKIE_DOMAIN`; core owns auth migrations.
- [ ] Cardano utils and money come from core; add missing Blockfrost endpoints to core if needed.
- [ ] `npm run check`, build, and a real signup pass; SSO works across the two apps.
