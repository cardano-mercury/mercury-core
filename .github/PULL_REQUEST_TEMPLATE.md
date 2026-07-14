<!--
  Base this on `development`, not `main`.

  `main` is release-only: nothing lands on it except the "Release vX.Y.Z" pull request that the
  Release PR workflow assembles from everything waiting on `development`. If you opened this against
  `main` by accident, use "Edit" at the top and change the base branch.
-->

## What and why

<!-- What changes, and what problem it solves. Link the issue or TRD if there is one. -->

## Release impact

<!--
Every PR needs a changeset: `npx changeset`. It is what writes the changelog, so do not edit
CHANGELOG.md or bump the version by hand. If this ships nothing to the package (CI, deploy/, repo
docs), run `npx changeset --empty` and say so below.

Bump from what a CONSUMER experiences:
  patch  a fix, or a docs/type change with no behaviour change
  minor  a backwards-compatible addition to db/auth/cardano/money
  major  any breaking change to those exports, or a narrowed peer range (it breaks installs)
-->

- [ ] A changeset is included (`npx changeset`, or `--empty` if nothing ships)

## Checks

- [ ] `npm run lint && npm run format:check && npm run check && npm run test:coverage && npm run build && npm run smoke`
- [ ] Tests cover the happy path, the unhappy paths, and a regression case for any bug fixed
- [ ] Where the change has a runtime surface, I exercised it rather than only writing it
- [ ] Docs updated (README, `docs/`, or JSDoc) if a surface changed

## Blast radius

<!--
Both Mercury apps install this package and share one Postgres database. Say so plainly if this
touches any of:
  - the shared auth tables or their migrations
  - a peer dependency range (better-auth must be the same COPY in core and both apps)
  - anything in the db/auth/cardano/money public surface
-->
