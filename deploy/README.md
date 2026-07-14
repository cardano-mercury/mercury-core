# Deploying the Mercury stack

Financials and tokenomics, on one Postgres with one account set, behind Caddy. This directory is the
composition only; each app owns its own `Dockerfile`.

It lives in mercury-core because core is where the two apps already meet: shared schema, shared auth,
shared secret. `deploy/` is deliberately excluded from the npm package (`files` is `dist`, `drizzle`,
`bin`), so it never ships to consumers.

## Do the local dry run first

You do not need a VPS, a domain, or DNS to exercise nearly all of this. One command brings up the
real stack on your machine: the same images, the same migration order, the same Caddy, the same
cross-subdomain session cookie.

```sh
cd deploy
cp .env.local.example .env.local
docker compose -f compose.yaml -f compose.local.yaml --env-file .env.local up -d --build
```

Then open **https://demo-financials.mercury.localhost** and
**https://demo-tokenomics.mercury.localhost**.

Chrome and Firefox resolve any `*.localhost` name to 127.0.0.1 on their own, so there is no hosts
file to edit. Caddy signs both hosts with its own local CA, so the browser will warn once per
hostname; click through, or trust the CA to make it clean:

```sh
docker compose -f compose.yaml -f compose.local.yaml --env-file .env.local \
  cp caddy:/data/caddy/pki/authorities/local/root.crt ./caddy-local-ca.crt
# then trust caddy-local-ca.crt in your OS/browser certificate store
```

Magic-link emails go to a throwaway inbox at **http://localhost:8025** (mailpit), because without an
SMTP transport tokenomics' magic-link sign-in is a `console.log` stub and simply does not work.

### Testing SSO by hand: create the account on tokenomics, not financials

Financials runs with `SINGLE_USER_MODE=true`, so **its `/signup` page redirects to `/login` and
creates nothing.** If you try to prove SSO by signing up on financials in a browser, it will look
exactly like SSO is broken when it is fine. Sign up on **tokenomics**, then load financials in the
same browser — you should already be signed in.

(Cookie sharing itself is direction-agnostic; this is only about which app will let you create an
account through the UI.)

### Seeding demo data

The runner images carry only `build/`, so they cannot seed themselves. Use the migrate stage, which
still has the dev dependencies:

```sh
docker compose -f compose.yaml -f compose.local.yaml --env-file .env.local \
  run --rm --entrypoint sh tokenomics-migrate -c 'node scripts/seed.mjs'
```

Financials seeds its chart of accounts on first boot, so it needs nothing.

To tear it down, including the database:

```sh
docker compose -f compose.yaml -f compose.local.yaml --env-file .env.local down -v
```

### What the dry run does and does not prove

Verified working in a local run on 2026-07-13, with **both apps on the published
`@cardano-mercury/core@0.2.1`** and each building from its own directory alone:

- both app images build, and both come up healthy on `/healthz`;
- the migration order holds: core's five shared auth tables are created first, then each app's own
  tables, giving `user` + `session` + `account` + `verification` + `two_factor`, seven `financials_*`
  tables, six `tokenomics_*` tables, and **three separate drizzle journals coexisting** in one
  database with no collisions;
- Caddy terminates TLS and routes both hostnames;
- **single sign-on works.** An account created on financials produces a session cookie scoped to
  `.mercury.localhost` (`Secure`, `HttpOnly`, `__Secure-` prefixed), and that same cookie is
  recognised as a valid session by tokenomics. No cookie means no session, so the check is real.

The one thing a local run **cannot** prove is ACME certificate issuance, which by definition needs a
public domain and ports 80/443 reachable from the internet. Locally Caddy uses its own CA instead.
Everything else is the same code path, so if the dry run is green the remaining risk on a real host
is DNS, firewall, and Let's Encrypt — not the application.

## Sizing the VPS

Measured on the local run above (Caddy + Postgres + Redis + both apps, after light load; the mailpit
sink is local-only and excluded):

| Service          | Resident     |
| ---------------- | ------------ |
| financials       | ~104 MiB     |
| db (postgres 16) | ~49 MiB      |
| tokenomics       | ~39 MiB      |
| caddy            | ~30 MiB      |
| redis            | ~7 MiB       |
| **total**        | **~228 MiB** |

So the stack at rest is small. **What actually sizes the box is building the images on it**, not
running them. Two SvelteKit/Vite builds plus their `npm ci` are far hungrier than the servers they
produce, and a 1 GB VPS will OOM partway through a build with a confusing error.

**Recommended: 4 GB RAM, 2 vCPU, 40 GB SSD.** Comfortable for a demo that builds on the box, with
room for Postgres to grow.

**Minimum that works: 2 GB RAM, 1–2 vCPU, 20 GB SSD** — but only if you do **not** build on the
host. Build the images elsewhere (CI, or your machine), push them to a registry such as GHCR, and
change the two `build:` blocks in `compose.yaml` to `image:` references. Then the VPS only ever
pulls and runs, and 2 GB is generous.

Disk is dominated by images (~1.3 GB for the runtime set) and by Postgres. The one thing that grows
without bound is financials' ingestion: it stores the **raw Blockfrost payload for every
transaction**, so a wallet with a long history is the main disk variable. Budget accordingly if you
sync a busy mainnet wallet; for a Catalyst demo wallet it is negligible.

Bandwidth is trivial. Any VPS tier's allowance is orders of magnitude more than this needs.

## Check the images for secrets, once

Docker reads `.dockerignore` from the **context root**, not from next to the Dockerfile. While core
was a `file:` link the apps had to build with the parent directory as context, so their
`.dockerignore` files were silently never applied and `.env` — a real mainnet Blockfrost key and the
Better Auth secret — was copied into the image. Worse, the image worked _because_ the secret file was
in it, which masked a separate bug.

Both apps now build single-context and honour `.dockerignore`, so this is fixed. But "should be fine"
is not a check:

```sh
./audit-images.sh ../../mercury-financials/.env ../../mercury-tokenomics/.env
```

It fails loudly (exit 1) if an image contains a `.env` file or embeds the value of any sensitive key
from those files, and it names the offending file. Run it before pushing an image anywhere.

Two things it deliberately gets right, because both are easy to get wrong:

- It only greps for values of **sensitive** keys (`*SECRET*`, `*PASSWORD*`, `*TOKEN*`, `*KEY*`,
  `*PROJECT_ID*`, ...). Grepping every long env value produces false positives that train you to
  ignore the tool — financials' `REDIS_URL` is `redis://localhost:6379`, and Vite compiles that
  harmless default straight into the bundle. That is not a leak.
- It **counts hits** rather than piping `grep` into `head`. Piping makes the pipeline succeed whether
  or not it matched, so a naive `&& echo LEAKED` fires either way.

## Going to production

### 1. DNS, first, because nothing works without it

`cardano-mercury.com` **does not currently resolve at all**, apex or subdomain. Point these at the
VPS before anything else, and let them propagate:

```
demo-financials.cardano-mercury.com   A (and AAAA)  ->  <VPS IP>
demo-tokenomics.cardano-mercury.com   A (and AAAA)  ->  <VPS IP>
```

Both apps must be siblings under **one** parent domain. The session cookie is scoped to that parent
(`COOKIE_DOMAIN=.cardano-mercury.com`), and that is the entire mechanism behind one login working on
both. Move either app to a different registrable domain and SSO stops working, silently.

Verify before continuing, since Caddy will otherwise burn Let's Encrypt attempts:

```sh
dig +short demo-financials.cardano-mercury.com
dig +short demo-tokenomics.cardano-mercury.com
```

### 2. The host

Ports **80 and 443 must be reachable from the internet** — 80 is not optional, Caddy needs it for
the ACME HTTP challenge.

```sh
# Docker Engine + compose plugin, then:
sudo ufw allow 22,80,443/tcp && sudo ufw enable
```

### 3. Get the code onto it

Both apps install core from npm, so each builds from its own directory alone. Nothing needs a
sibling checkout any more, but the compose file lives in mercury-core and its default build contexts
are relative, so the simplest layout is still to clone all three side by side:

```sh
mkdir -p ~/cardano-mercury && cd ~/cardano-mercury
git clone https://github.com/cardano-mercury/mercury-core.git
git clone https://github.com/cardano-mercury/mercury-financials.git
git clone https://github.com/cardano-mercury/mercury-tokenomics.git
```

`FINANCIALS_CONTEXT` and `TOKENOMICS_CONTEXT` in `.env` point at those directories. Change them if
you lay the repos out differently, or switch the `build:` blocks to `image:` and pull prebuilt
images instead.

### 4. Configure

```sh
cd ~/cardano-mercury/mercury-core/deploy
cp .env.example .env
```

Fill in `.env`. The two that break things quietly:

- **`BETTER_AUTH_SECRET`** must be byte-identical for both apps (they read the same variable here, so
  just generate it once: `openssl rand -base64 32`). If it ever differs, a session minted by one app
  is rejected by the other with no useful error.
- **`COOKIE_DOMAIN`** must be the parent of both origins, with the leading dot.

`.env` and `.env.local` are git-ignored.

### 5. Bring it up

```sh
docker compose --env-file .env up -d --build
```

Certificates are issued on the first request to each hostname. Watch it happen:

```sh
docker compose --env-file .env logs -f caddy
```

### 6. Check it

```sh
docker compose --env-file .env ps                      # everything healthy?
docker compose --env-file .env logs core-migrate       # shared auth tables applied?
curl -sS https://demo-financials.cardano-mercury.com/healthz
curl -sS https://demo-tokenomics.cardano-mercury.com/healthz
```

Then sign up on one app and load the other. You should already be signed in. That is the whole
point of the shared database and the shared cookie, and it is the thing worth checking by hand.

## The migration order is load-bearing

Both apps foreign-key their own tables to the shared `user` table, so core's migration has to finish
before either app migrates. Compose enforces it with a one-shot `core-migrate` service and
`service_completed_successfully` conditions:

1. `core-migrate` — the five shared auth tables (`npx @cardano-mercury/core migrate`)
2. `financials-migrate` — `financials_*` only
3. `tokenomics-migrate` — `tokenomics_*` only

`core-migrate` needs no Dockerfile: core is a published package, so it is a stock `node:22-alpine`
and an `npx`. It takes a Postgres advisory lock and is idempotent, so re-running it on every `up`
costs nothing and two containers racing it is safe.

**Nobody runs `drizzle-kit push` against this database.** It honours `tablesFilter` for tables but
not for sequences, and will offer to drop another app's migration-journal sequence.

### Adopting a database that predates core owning the auth tables

If the shared tables already exist because an app created them, `core-migrate` will **refuse** rather
than fail halfway through a `CREATE TABLE`, and tell you so. Adopt them once:

```sh
docker compose --env-file .env run --rm core-migrate \
  npx --yes @cardano-mercury/core@0.2.1 migrate --baseline
```

It records the migrations as applied without touching the tables. Normal `up` from then on.

## When it breaks

**Every request 403s, or login redirects in a loop.** The origin check is rejecting you. `ORIGIN`
must exactly equal the public https URL in the Caddyfile. The app images already set
`PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host`; without those adapter-node
builds absolute URLs as `http://financials:3000` and Better Auth rejects its own callbacks as
cross-origin. This is the most common failure of a proxied SvelteKit app.

**Login works on one app but not the other.** `BETTER_AUTH_SECRET` differs, or `COOKIE_DOMAIN` is
missing or is not the parent of both origins.

**Certificates will not issue.** DNS is not pointing here yet, or port 80 is blocked. Check
`docker compose logs caddy`. Do not loop on retries: Let's Encrypt rate-limits failures and can lock
you out for a week. Fix DNS first, then restart Caddy.

**Certificates re-issue on every redeploy.** The `caddy_data` volume is not persisting. That volume
is what stops you hitting the rate limit.

**An app migration fails on a missing `user` table.** `core-migrate` did not run or did not succeed.
Check its logs; it must complete before either app migrates.

**A 503 from an app that is clearly running.** Caddy's active health check marks an upstream down
until its first successful probe, so a Caddy that starts before its upstreams will 503 for up to one
`health_interval` after they are perfectly healthy. The compose file avoids this by making Caddy
`depends_on` both apps with `condition: service_healthy`, and the Caddyfiles probe every 5s rather
than every 30s. If you rework either, keep that pairing, or a cold `up` will serve 503s from a
working stack. Note Caddy itself takes a couple of seconds to start after the apps go healthy, so
connection-refused immediately after `up` is normal and resolves on its own.
