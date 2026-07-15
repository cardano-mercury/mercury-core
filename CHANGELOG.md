# @cardano-mercury/core

## 0.2.3

### Patch Changes

- 829c079: Pinned three vulnerable transitive dependencies through `overrides`: `undici` to `^6.27.0` (a high
  severity advisory), `ip-address` to `^10.1.1`, and `esbuild` to `^0.25.0`. That clears all fourteen
  advisories `npm audit` reported against core's tree.

  There was no upgrade path. `undici` and `ip-address` arrive through `@meshsdk/core`, `esbuild` through
  `drizzle-kit`, and both parents are already on their latest release, so there was nothing to bump.
  `npm audit fix` proposes `@meshsdk/core@1.5.25` and `drizzle-kit@0.18.1`, which are **downgrades** from
  the 1.9.1 and 0.31.10 we run: it will walk you backwards to find a tree it can satisfy. `overrides` is
  the right instrument.

  Verified rather than assumed, because core parses Cardano addresses with MeshJS and forcing a major
  bump of its HTTP stack is exactly the kind of thing that breaks quietly: with and without the
  overrides, `resolveRewardAddress` returns the identical stake address for a real mainnet base address,
  and enterprise addresses (which have no staking part) behave identically.

  **This does not protect a consuming app.** npm honours `overrides` only from the root project and
  ignores them inside a dependency's `package.json`. Any app that installs `@meshsdk/core`, which is a
  peer dependency of core so every Mercury app does, still resolves `undici@5.29.0` in its own tree and
  needs its own `overrides` block.

## 0.2.2

### Patch Changes

- 73a32a6: Corrected the license metadata. `package.json` declared MIT while the repository has always shipped
  Apache-2.0, so the published package advertised the wrong license. It is now `Apache-2.0`, matching
  the LICENSE file and the other Mercury repositories, and the LICENSE's copyright placeholder is filled
  in for Cardano Mercury, Inc. Also adds `engines` (Node 22 or newer), `author`, keywords, and
  `sideEffects: false` so bundlers can tree-shake the barrels.
- 8fd62f8: `makeOwnershipTest` now documents that it answers membership ("is this address ours?"), not
  attribution ("which bucket or account is it?"). One stake key routinely spans several payment
  addresses, so labelling an undeclared sibling by its stake key merges things that were deliberately
  kept apart, while the totals still balance and nothing catches it. Behaviour is unchanged; the
  predicate was never wrong, only under-described.
- 53ee118: Documented the two ways a shared database bites, in the README where the shared-migration conventions
  are stated: `drizzle-kit push` applies `tablesFilter` to tables but not to sequences, so it offers to
  drop another app's migration journal; and Postgres silently truncates identifiers at 63 characters, so
  a drizzle-derived foreign key name over that length drifts permanently and invisibly.

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
