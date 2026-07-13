# @cardano-mercury/core

Shared building blocks for the Mercury apps (financials, tokenomics): a common database schema,
authentication, and Cardano utilities. The apps depend on this package so they can share one
Postgres database and a single account set, while keeping their own repos and app-specific code.

It is a framework-agnostic TypeScript package. It does not import any SvelteKit specifics
(`$env`, `$app/*`); apps inject their own environment and framework glue.

## Exports

- `@cardano-mercury/core/db` — the shared Drizzle schema (Better Auth `user`/`session`/`account`/
  `verification`/`two_factor`). Merge these into your app's drizzle client and foreign-key your own
  tables to `user`. This package owns the migrations for these tables; apps generate migrations
  only for their own.
- `@cardano-mercury/core/auth` — `createAuth(options)`, a Better Auth factory with the shared
  conventions (email/password, two-factor, Postgres adapter, optional cross-subdomain cookies for
  SSO). Pass framework plugins (e.g. SvelteKit's cookie plugin) via `options.plugins`.
- `@cardano-mercury/core/cardano` — a Blockfrost REST client (network and project id passed in),
  plus `rewardAddressOf` / `makeOwnershipTest` for stake-key based wallet ownership.
- `@cardano-mercury/core/money` — `formatAda` for lovelace.

## Using it from an app (SvelteKit)

```ts
// src/lib/server/auth.ts
import { createAuth } from '@cardano-mercury/core/auth';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { env } from '$env/dynamic/private';
import { db } from './db';

export const auth = createAuth({
	db,
	secret: env.BETTER_AUTH_SECRET,
	baseURL: env.ORIGIN,
	issuer: 'Mercury Financials',
	cookieDomain: env.COOKIE_DOMAIN, // e.g. .cardano-mercury.com in production
	plugins: [sveltekitCookies(getRequestEvent)] // keep last
});
```

`better-auth`, `drizzle-orm`, and `@meshsdk/core` are peer dependencies, so the app and core share
one instance of each.

## Develop

```sh
npm install
npm run build      # emit dist/ (ESM + types)
npm run dev        # tsc --watch
```

During app development, link it locally with a `file:../mercury-core` dependency (rebuild on
change), and publish versioned releases for deploys.

## Test

Vitest is the test runner; tests live next to the code they cover as `src/**/*.test.ts`.

```sh
npm test           # run the suite once
npm run test:watch # re-run on change
npm run test:coverage  # enforce 100% line/branch/function coverage
npm run check      # strict tsc --noEmit; type-checks the source and the tests
```

Because the apps depend on this shared library, every exported function carries happy-path,
unhappy-path, and regression tests, and `test:coverage` fails under 100% on the logic-bearing
modules. The declarative pieces — the drizzle schema and the re-export barrels — are excluded from
the coverage threshold but still have shape regression tests (`src/db/schema.test.ts`). Test files
are excluded from the published build via `tsconfig.build.json`, so `dist/` ships no test code.

## Lint and format

ESLint (correctness/quality rules) and Prettier (formatting) round out the code-quality gate.

```sh
npm run lint          # eslint, @typescript-eslint recommended rules
npm run format        # prettier --write; apply formatting
npm run format:check  # prettier --check; the CI-enforced check
```

Prettier owns all formatting (`eslint-config-prettier` disables any ESLint rule that would fight it),
so its config in `.prettierrc.json` matches the SvelteKit convention the apps use: tabs, single
quotes, no trailing commas, 100-column width.

CI (`.github/workflows/ci.yml`) runs lint, format check, type-check, the coverage-gated tests, and
the build on every pull request and push to `main`; `main` is branch-protected so a PR can't merge
until that check passes.
