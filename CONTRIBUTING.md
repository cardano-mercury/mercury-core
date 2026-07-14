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

## Which branch

**Open your pull request against `development`, not `main`.**

`development` is where work accumulates. `main` is what has been released, and nothing lands on it
except a release: when CI is green on `development`, the `Release PR` workflow collapses everything
waiting there into one version bump and one changelog section and offers it as an ordinary pull
request into `main`. Merging that is the release; tagging it publishes.

That is the whole reason the changesets below exist. Several pull requests open against `development`
at once, each editing `CHANGELOG.md` directly, would conflict on the same lines every time. A
changeset is a separate file, so they cannot.

## The gate

Run this before you open a pull request. CI runs exactly the same set, and neither branch will accept
a PR that fails it.

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

1. Merge the **"Release vX.Y.Z"** pull request that the `Release PR` workflow keeps open against
   `main`. It is rebuilt from `development` on every green CI run, so it always reflects what is
   actually waiting. It carries the version bump and the assembled changelog, and it runs the same CI
   as any other pull request — nothing pushes to `main`, and no bot bypasses branch protection.
2. Tag it. **This is what publishes.**

   ```sh
   git checkout main && git pull
   git tag "v$(node -p "require('./package.json').version")"
   git push --tags
   ```

The tag fires `release.yml`, which re-runs the full gate, refuses to publish if the tag and
`package.json` disagree, and publishes to npm with provenance.

The release pull request is opened by the **Mercury Release Bot**, a GitHub App owned by the
organisation. It has to be an App rather than the built-in `GITHUB_TOKEN`: GitHub will not let a run
created by that token trigger further runs, so a release pull request opened with it gets its checks
stuck at `action_required` and can never merge against a protected `main`.

Merging the release PR does not publish on its own. That separation is deliberate: a release is a
decision rather than a side effect, and the tag always points at exactly what went out.

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
