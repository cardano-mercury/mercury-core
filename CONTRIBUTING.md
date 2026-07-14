# Contributing

`@cardano-mercury/core` is the shared library the Mercury apps (financials, tokenomics) depend on.
A change here can break both of them at once, against one shared production database. That is the
reason for most of what follows.

## Getting set up

```sh
git clone https://github.com/cardano-mercury/mercury-core.git
cd mercury-core
npm install
npm test
```

Node 22 or newer. No database is needed for the test suite; the migration runner is unit-tested
against a fake client, and the end-to-end migration behaviour is exercised in `deploy/`.

## The gate

Run this before you open a pull request. CI runs exactly the same set, and `main` will not accept a
PR that fails it.

```sh
npm run lint          # eslint
npm run format:check  # prettier; `npm run format` fixes
npm run check         # strict tsc over src and the tests
npm run test:coverage # vitest; fails under 100% on the logic-bearing modules
npm run build         # the published artifact must compile
npm run smoke         # packs the tarball and imports every entry point through plain node
```

`npm run smoke` is not ceremony. Version 0.2.0 published with two of its five entry points
unimportable, because tsc emitted extensionless relative imports that only a bundler can resolve, and
nothing in the gate had ever loaded the built package the way Node actually loads it. Type-checking a
tarball does not exercise the ESM resolver. This does.

## Every pull request needs a changeset

```sh
npx changeset
```

It asks for a bump type and a sentence, and writes a file into `.changeset/`. Commit it.

**Do not edit `CHANGELOG.md`, and do not bump `version` in `package.json`.** Both are generated. If
several open pull requests all edit the changelog directly, they conflict on the same lines every
time, and the conflicts get resolved in a hurry, and entries get lost. A changeset is a new file with
a random name, so two pull requests never touch the same one; they pile up on `main` and are collapsed
into a single version bump and a single changelog section when a release is cut. CI enforces this.

Choose the bump from what a **consumer** would experience, not from how much work it was:

| bump      | when                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------- |
| **patch** | a fix; a docs, comment or type-only change that does not alter behaviour                       |
| **minor** | a backwards-compatible addition to the `db` / `auth` / `cardano` / `money` exports             |
| **major** | any breaking change to those exports — including narrowing a peer range, which breaks installs |

If a pull request ships nothing to the package at all — CI, the `deploy/` stack, repo documentation —
say so explicitly:

```sh
npx changeset --empty
```

That records "I considered the release impact and there is none", which is a different statement from
having forgotten.

### Watch the peer dependencies

`better-auth`, `drizzle-orm` and `@meshsdk/core` are peer dependencies, and an app must resolve the
**same physical copy** as core, not merely the same version. Moving `better-auth` is a **major** here
and has to happen in core and both apps together, or the shared auth schema diverges against a shared
database. Dependabot is deliberately configured not to open PRs for it. The README explains why.

## Releasing

Maintainers only.

1. Merge the **"Release: version packages"** pull request that the `Version` workflow keeps up to
   date. That is what bumps the version and writes the changelog, from the accumulated changesets.
2. Tag it:

   ```sh
   git tag "v$(node -p "require('./package.json').version")"
   git push --tags
   ```

The tag fires `release.yml`, which re-runs the full gate, refuses to publish if the tag and
`package.json` disagree, and publishes to npm with provenance. Merging the version PR does not
publish on its own — that separation is deliberate, so a release is a decision rather than a side
effect, and the tag always points at exactly what went out.

## House style

- **Tests.** Every function carries its happy path, its unhappy paths, and a regression test for any
  bug being fixed. `test:coverage` enforces 100% on the logic-bearing modules. The declarative pieces
  (the drizzle schema, the re-export barrels) are excluded from the threshold but still shape-tested.
- **Exercise it, do not just write it.** Where a change has a runtime surface, drive it. The
  migration runner's advisory lock was tested by racing five containers at an empty database; the
  deploy stack was brought up from an empty volume. Two real bugs were caught that way that no unit
  test would have found.
- **Comments say why, not what.** Match the terse, reason-giving style already in `src/`. No
  changelog-style comments ("previously this did X") — git already knows.
- **Prose has no AI tells.** No em dashes, no arrow characters, no numbered headings. Write plainly.
- Prettier owns formatting; ESLint is for correctness only.

## Reporting a vulnerability

Do not open an issue. See [SECURITY.md](SECURITY.md).
