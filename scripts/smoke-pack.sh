#!/usr/bin/env bash
#
# Load every published entry point through plain Node, from the packed tarball.
#
# This exists because 0.2.0 shipped with `db` and `cardano` unloadable: tsc emitted extensionless
# relative imports, which only a bundler can resolve. Both apps consumed core as a `file:` link at
# the time, so Vite bundled it and nothing noticed until the first registry install hit Node's ESM
# resolver, which is strict. Type-checking the tarball does not catch this. Importing it with a
# bundler in the path does not catch this. Only `node -e "import(...)"` does, which is exactly the
# resolver a production container uses.
#
# NodeNext in tsconfig.json now makes the mistake a compile error, so this is the belt to that
# braces: it exercises the real artifact, so a packaging mistake NodeNext cannot see (a bad `exports`
# map, a file missing from `files`) still fails the gate.
set -euo pipefail

ENTRY_POINTS=(db db/migrate auth cardano money)

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "packing..."
npm pack --silent --pack-destination "$work" >/dev/null
tarball="$(find "$work" -name '*.tgz' -print -quit)"
echo "packed $(basename "$tarball")"

# A bare project with no bundler and no config: just Node and the tarball. Peers are installed
# because the entry points import them at load time.
cd "$work"
echo '{"name":"smoke","private":true,"type":"module"}' > package.json
npm install --silent --no-audit --no-fund --legacy-peer-deps \
	"$tarball" better-auth@~1.6.23 drizzle-orm@^0.45.2 @meshsdk/core postgres >/dev/null

failed=0
for entry in "${ENTRY_POINTS[@]}"; do
	if node -e "import('@cardano-mercury/core/${entry}')" 2>/tmp/smoke-err; then
		echo "  ok      @cardano-mercury/core/${entry}"
	else
		echo "  BROKEN  @cardano-mercury/core/${entry}"
		sed 's/^/            /' /tmp/smoke-err | head -3
		failed=1
	fi
done

# The migrate runner has to work from the installed package too: the deploy stack's one-shot
# core-migrate service runs it with no checkout of this repo. Invoked with no command it prints its
# usage and exits non-zero, which is correct, so capture rather than pipe (pipefail would read that
# exit code as a failure).
bin_out="$(node "$work/node_modules/@cardano-mercury/core/bin/mercury-core.js" 2>&1 || true)"
if grep -q 'usage: mercury-core' <<<"$bin_out"; then
	echo "  ok      mercury-core bin"
else
	echo "  BROKEN  mercury-core bin"
	sed 's/^/            /' <<<"$bin_out" | head -3
	failed=1
fi

if [ "$failed" -ne 0 ]; then
	echo
	echo "The published package would not load. Do not release this."
	exit 1
fi

echo
echo "all entry points load under plain node"
