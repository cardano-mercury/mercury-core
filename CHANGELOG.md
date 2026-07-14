# @cardano-mercury/core

## 0.2.1

### Patch Changes

- Fixed unloadable ESM output. The package is `"type": "module"`, so `dist/` is real ESM and Node's
  resolver requires a file extension on every relative import; tsc emits them verbatim, so the `db`
  and `cardano` entry points shipped broken (`ERR_MODULE_NOT_FOUND`) and could not be imported from
  the registry at all. Relative imports now carry `.js`, and `tsconfig` uses `NodeNext` so an
  extensionless import is a compile error rather than a runtime one.
- Releases now run `npm run smoke`, which packs the tarball and imports every entry point through
  plain `node` with no bundler. That is the check whose absence let 0.2.0 publish in an unimportable
  state: type-checking a tarball does not exercise Node's ESM resolver.

## 0.2.0

### Minor Changes

- Core now owns the shared Better Auth migrations, as its documentation had long claimed. Ships
  `drizzle/` SQL for the five shared tables and a runner exposed both as
  `npx @cardano-mercury/core migrate` and as `runCoreMigrations()` from
  `@cardano-mercury/core/db/migrate`. The runner holds a Postgres advisory lock, so app containers
  starting together serialise instead of racing on `CREATE TABLE`, and a `--baseline` flag adopts a
  database whose shared tables predate core owning them.
- `createAuth` gained `trustedOrigins` (defaulting to the baseURL plus a wildcard over `cookieDomain`
  when one is set, which is the other half of cross-subdomain SSO) and a configurable
  `emailAndPassword` over a shared floor of an 8 character minimum.
- **Breaking:** `better-auth` moved to 1.6.23 and the peer range narrowed to `~1.6.23`. An app on a
  different minor now fails at install rather than silently generating a divergent auth schema against
  the shared database.

## 0.1.0

### Minor Changes

- `createAuth` is generic over its plugin tuple, so the endpoints an app's plugins add (magic link's
  `signInMagicLink`, two-factor's `enableTwoFactor`) infer onto `auth.api` without a hand-rolled cast.

## 0.0.1

### Initial

- The shared Drizzle schema for Better Auth (`user`, `session`, `account`, `verification`,
  `two_factor`), the `createAuth` factory, a Blockfrost REST client with stake-key ownership helpers,
  and `formatAda`.
