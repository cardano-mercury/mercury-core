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
  conventions (email/password with an 8 character minimum, two-factor, Postgres adapter, and for SSO
  both cross-subdomain cookies and the matching `trustedOrigins`). Pass framework and app plugins
  (e.g. SvelteKit's cookie plugin, magic link) via `options.plugins`; the returned instance's
  `auth.api` picks up those plugins' endpoints with full types, no manual cast needed.
- `@cardano-mercury/core/cardano` — a Blockfrost REST client (network and project id passed in),
  plus `rewardAddressOf` / `makeOwnershipTest` for stake-key based wallet ownership. `makeOwnershipTest`
  answers **membership** ("is this address ours?"), not **attribution** ("whose bucket or account is
  it?") — one stake key routinely spans several payment addresses, so see its JSDoc before using it to
  label anything.
- `@cardano-mercury/core/money` — `formatAda` for lovelace.
- `@cardano-mercury/core/db/migrate` — `runCoreMigrations(connectionString)`, the programmatic form
  of the `mercury-core migrate` command below.

## The shared auth migrations

Core owns the five shared tables, so core also ships the SQL that creates them and a runner that
applies it. Both apps foreign-key to `user`, so this has to run **before** either app migrates:

```sh
DATABASE_URL=postgres://... npx @cardano-mercury/core migrate
```

The SQL is bundled in the published package, so this works from a container that installed core from
the registry, with no checkout of this repo. It is safe to run repeatedly (an applied migration is a
no-op) and safe to run from several containers at once: the runner takes a Postgres advisory lock, so
a `docker compose up` that starts both apps together serialises rather than racing on `CREATE TABLE`.
Apps that would rather call it in-process can import `runCoreMigrations` from
`@cardano-mercury/core/db/migrate` instead.

The ownership rule, stated once:

- Core generates and applies migrations for `user`, `session`, `account`, `verification`, and
  `two_factor`. Its journal is `__drizzle_migrations_core` in `public`.
- Apps set `tablesFilter` to their own prefix, keep their own journal, and never generate, alter, or
  drop the five shared tables. They re-export the schema from `@cardano-mercury/core/db` so they can
  query and foreign-key to it.
- Nobody runs `drizzle-kit push` against the shared database. It honours `tablesFilter` for tables
  but not for sequences, and will offer to drop another app's migration-journal sequence.

**Adopting a database that predates this.** If the shared tables already exist because an app created
them (or from a hand-run stopgap script), core refuses to touch them rather than failing halfway
through a `CREATE TABLE`. Run it once with `--baseline` to adopt them as they are: core records its
migrations as applied without altering the tables, and later migrations then apply normally on top.

```sh
DATABASE_URL=postgres://... npx @cardano-mercury/core migrate --baseline
```

### Two ways a shared database bites, both silent

Three writers on one Postgres is core's design, so these belong here rather than in an app. Both were
found the hard way, in production data.

**`drizzle-kit push` will eat another app's migration history.** It applies `tablesFilter` to tables
but **not to sequences**, so from an app with `tablesFilter: ['financials_*']` correctly set, `push`
still proposes `DROP SEQUENCE "public"."__drizzle_migrations_tokenomics_id_seq"` — another app's
journal. One invocation is enough. Do not add a `db:push` script; core does not have one, and neither
should an app. Generate and migrate only, so you are applying committed SQL and never diffing against
tables you do not own.

**Postgres truncates identifiers at 63 characters, and drizzle's derived names can exceed that.**
Drizzle names a foreign key `{table}_{column}_{reftable}_{refcolumn}_fk`. Add a table prefix and it
overflows:

```
financials_transaction_tag_transaction_id_financials_transaction_id_fk   (70 chars)
```

Postgres silently truncates that to 63 on creation. Drizzle then compares the 70-character name it
expects against the 63 in the database, concludes the constraint is missing, and offers to create it —
on every diff, forever. On a unique constraint it offers to **truncate the table** to add it. Nothing
warns you: Postgres emits a `NOTICE` and drizzle says nothing.

Name long constraints explicitly with `foreignKey({ ..., name })` and keep them under 63. Audit any
shared database with:

```sql
select conrelid::regclass, conname, length(conname)
from pg_constraint
where connamespace = 'public'::regnamespace and length(conname) >= 63
order by length(conname) desc;
```

Anything at exactly 63 is almost certainly a truncated name that will never match again.

Core's own tables are unprefixed, which is what keeps it clear: its longest derived identifier is
`two_factor_user_id_user_id_fk` at 29 characters, 34 short of the cliff. The apps, with their
`financials_` and `tokenomics_` prefixes, have far less room.

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

### An app needs the same _copy_ of `better-auth` as core, not just the same version

Install core from the registry, not as a `file:../mercury-core` link. The link is what breaks this,
and the failure is worth understanding because the error message hides the cause completely.

A `file:` link is a symlink, and TypeScript resolves through it to core's real path — so core's
`.d.ts` picks up `better-auth` (and its `@better-auth/core` dependency) from **core's own**
`node_modules`, while the app picks up **its** copy. Two directories, two type identities, even when
both are byte-identical at the same version. The instance `createAuth` returns then fails to satisfy
consumers such as `svelteKitHandler`, and TypeScript reports it as an inscrutable structural mismatch
somewhere deep in a plugin's `hooks.after.matcher`, never as "you have two copies". It is tempting to
paper over it with a cast in the app's `hooks.server.ts`. Don't. Installing core from the registry
hoists a single shared copy and the error disappears on its own.

Keep versions aligned too: the peer range is pinned narrow (`~1.6.23`) so a mismatched app fails
loudly at `npm install` instead of quietly generating a different auth schema against the shared
database. Moving `better-auth` means moving core and both apps together, in one go. But note that
matching versions alone is not sufficient — only a single copy makes the types agree.

## Develop

```sh
npm install
npm run build      # emit dist/ (ESM + types)
npm run dev        # tsc --watch
```

Apps should depend on a published version (`"@cardano-mercury/core": "^0.2.0"`). A local
`file:../mercury-core` link is convenient for iterating on core and an app together — run
`npm run dev` here to rebuild on change — but it gives the app a second physical copy of
`better-auth`, with the type consequences described above, so treat it as a temporary development
tool rather than the normal way to consume core.

Releases are cut by tagging: `.github/workflows/release.yml` fires on a `v*` tag, re-runs the full
gate, checks the tag matches `package.json`, and publishes to npm with provenance.

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
