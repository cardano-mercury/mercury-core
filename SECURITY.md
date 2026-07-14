# Security policy

## Reporting a vulnerability

**Do not open a public issue, and do not open a pull request that fixes it.** A fix in the open is a
disclosure: the diff tells anyone reading it exactly what to exploit, and the Mercury apps that depend
on this package will not have updated yet.

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/cardano-mercury/mercury-core/security/advisories/new).
It goes straight to the maintainers, and we can prepare a fix and an advisory together.

If that is unavailable to you, email **security@cardano-mercury.com**.

Please include what it affects, how to reproduce it, and what an attacker gets. A proof of concept is
welcome but not required, and please do not test against anything you do not own.

## What to expect

- An acknowledgement within **3 working days**.
- An assessment, and our view of severity, within **10 working days**.
- We will keep you updated while we work, and credit you in the advisory unless you would rather we
  did not.

We ask that you give us **90 days** before disclosing publicly, or until a fix ships, whichever is
sooner. If a report is being ignored, say so and we will treat that as a failure on our side.

## Scope

This repository is a library: the shared database schema, the Better Auth factory, the Blockfrost
client, and the migration runner. The things most worth your attention:

- **`createAuth`** and the session model. It is the front door for every Mercury app, and a session
  minted by one is valid on the others by design, so a flaw here crosses application boundaries.
- **The shared auth schema and migrations.** Three applications write to one Postgres database. A
  migration that can be made to touch another application's tables is a serious bug, not a papercut.
- **`makeOwnershipTest` / `rewardAddressOf`.** These decide whether an on-chain address belongs to a
  wallet. Getting that wrong misattributes real money.
- **Anything that could leak a secret** — `BETTER_AUTH_SECRET`, `DATABASE_URL`, a Blockfrost project
  id — into logs, an error message, or a built artifact.

Out of scope, though still tell us if it is interesting:

- Vulnerabilities in the Mercury applications themselves. Those belong in
  [mercury-financials](https://github.com/cardano-mercury/mercury-financials) or
  [mercury-tokenomics](https://github.com/cardano-mercury/mercury-tokenomics).
- Known issues in upstream dependencies with no exploitable path through this package. Dependabot
  already watches those.
- The `deploy/` compose stack as a deployment _of_ something insecure — but a flaw in the stack that
  exposes a secret or the database is very much in scope.

## Supported versions

Pre-1.0, only the latest published minor is supported. Fixes go out as a new patch release; we do not
backport.

| Version | Supported |
| ------- | --------- |
| 0.2.x   | yes       |
| < 0.2   | no        |

## What we do on our side

- `npm publish --provenance`, so a published tarball is attestably built from this repository.
- Dependabot, weekly, with a cooldown on version updates — but **security updates are exempt from the
  cooldown** and land immediately.
- Secret scanning with push protection, so a leaked credential is blocked at the push rather than
  found later.
- The release gate packs the tarball and loads every entry point before publishing, and the deploy
  stack's `audit-images.sh` fails a build whose image contains a `.env` or a known secret value.
