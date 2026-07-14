#!/usr/bin/env bash
#
# Check the built app images for baked-in secrets. Run it once per image, as a matter of course.
#
#   ./audit-images.sh                                    # checks for .env files only
#   ./audit-images.sh ../../mercury-financials/.env ...  # also greps for the real values in them
#
# Why this exists: while core was a `file:` link, the only way to build was with the PARENT directory
# as the build context, and Docker reads `.dockerignore` from the **context root**, not from next to
# the Dockerfile. The apps' `.dockerignore` files were therefore silently never applied, and `.env`
# — a real mainnet Blockfrost key and the Better Auth secret — was copied into the image. Worse, the
# image worked *because* the secret file was in it, which masked a separate bug. Both apps now build
# single-context and honour `.dockerignore`, but "should be fine" is not a check.
#
# Note the exit-code trap this avoids: piping `grep -rl` into `head` makes the pipeline succeed
# whether or not it matched, so a naive `&& echo LEAKED` fires either way. Count hits, compare to 0.
#
# Secret values are fed to grep as a patterns file on stdin (-F -f -), never interpolated into a
# shell string, so a quote or a $ in a secret cannot break the command or leak into a process list.
set -uo pipefail

read -ra IMAGES <<<"${MERCURY_IMAGES:-mercury-financials mercury-tokenomics}"

# Only values of genuinely sensitive keys. Grepping for *every* long env value produces false
# positives that train you to ignore the tool: financials' REDIS_URL is "redis://localhost:6379",
# and Vite compiles that harmless default straight into the bundle, which is not a leak.
SENSITIVE_KEY_RE='(SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PROJECT_ID|PRIVATE|CREDENTIAL)'

patterns="$(mktemp)"
keynames="$(mktemp)"
trap 'rm -f "$patterns" "$keynames"' EXIT

for envfile in "$@"; do
	[ -f "$envfile" ] || continue
	while IFS='=' read -r key value; do
		case "$key" in '' | \#*) continue ;; esac
		printf '%s' "$key" | grep -qiE "$SENSITIVE_KEY_RE" || continue
		value="${value%\"}" value="${value#\"}" # strip surrounding quotes if present
		[ "${#value}" -ge 12 ] || continue      # empty or placeholder
		printf '%s\n' "$value" >>"$patterns"
		printf '%s\n' "$key" >>"$keynames"
	done <"$envfile"
done

n_patterns="$(wc -l <"$patterns" | tr -d ' ')"
failed=0

for img in "${IMAGES[@]}"; do
	if ! docker image inspect "$img" >/dev/null 2>&1; then
		echo "  skip    $img (not built)"
		continue
	fi

	envfound="$(docker run --rm --entrypoint sh "$img" -c 'ls -a /app 2>/dev/null | grep "^\.env" || true')"

	leaked_files=''
	if [ "$n_patterns" -gt 0 ]; then
		leaked_files="$(docker run --rm -i --entrypoint sh "$img" -c \
			'cat > /tmp/p; grep -rlF -f /tmp/p /app 2>/dev/null' <"$patterns")"
	fi

	if [ -n "$envfound" ]; then
		echo "  LEAKED  $img contains: $envfound"
		failed=1
	elif [ -n "$leaked_files" ]; then
		echo "  LEAKED  $img embeds the value of one of: $(tr '\n' ' ' <"$keynames")"
		printf '%s\n' "$leaked_files" | sed 's/^/            /'
		failed=1
	else
		echo "  ok      $img: no .env, and none of the $n_patterns sensitive values"
	fi
done

if [ "$failed" -ne 0 ]; then
	echo
	echo "A secret is baked into an image. Do not push it."
	exit 1
fi

echo
echo "no secrets found in the built images"
