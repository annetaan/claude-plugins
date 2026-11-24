#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj1-plan/scripts/project.sh"
SCRIPT="${PROJECT_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

body() {
  cat <<EOF
## Goal

Sign-out stops emptying what the page fetched once.

## Design

- \`src/session.ts\` (changed): \`signOut\` clears only the entries the session owns
- \`src/session.test.ts\` (changed): adds \`keeps the page-level cache on sign-out\` beside the \`signOut\` cases

\`signOut\` narrows its clear to the session's keys, so the sign-in form finds the fetched value where it left it.

### Shared state

- \`cache\` in \`src/cache.ts\`: written by \`signOut\`
  - \`SignInForm\` in \`src/signin.ts\`: assumes the value lives for the whole app, and it still does

### Model decisions

- Narrow the clear instead of refetching on a miss. The cause is the wide clear (\`src/session.ts\` \`signOut\`).
${4:-}

## Acceptance criteria

- sign out, then sign in again: \`npm test -- signin\` prints \`3 passed\`
- \`keeps the page-level cache on sign-out\` passes

## Decisions

### D1. Does the admin screen show the retry count?

It changes what the people who run it see.

Only you know: whether the people who run the admin screen need the count.

- [$1] Show it (recommended)
  Adds a column to \`src/admin.ts\`.
- [ ] Hide it$3
  Leaves \`src/admin.ts\` as it is.

### D2. Does the page warn before sign-out?

Only you know: whether the people who sign out lose unsaved work.

- [$2] Warn (recommended)
  Adds a prompt.
- [ ] Do not warn
  Nothing changes.

## Out of scope

The admin screen.
EOF
}

lint() { bash "$SCRIPT" --lint "$1"; }
reasons() {
  lint "$1" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(json.dumps(d['reasons'] if all(isinstance(r, str) for r in d['reasons']) else [r['code'] for r in d['reasons']]))"
}
ok() { lint "$1" | python3 -c "import json, sys; print(json.load(sys.stdin)['ok'])"; }

body x " " "" >"$TMP/open.md"
got="$(reasons "$TMP/open.md")"
[ "$got" = '["decisions-open"]' ] || fail "an open decision with the line printed $got, wanted [\"decisions-open\"]"
echo "ok: an open decision with its Only you know line fails only decisions-open"

body x x "" >"$TMP/ticked.md"
got="$(ok "$TMP/ticked.md")"
[ "$got" = "True" ] || fail "a body with both decisions ticked printed ok $got: $(lint "$TMP/ticked.md")"
echo "ok: both decisions ticked pass the lint with the subsections and the lines in place"

body x x " (recommended)" >"$TMP/shape.md"
got="$(reasons "$TMP/shape.md")"
case "$got" in
  *decision-shape*) ;;
  *) fail "two (recommended) in one decision printed $got, wanted decision-shape" ;;
esac
echo "ok: two (recommended) in one decision still fail decision-shape"

body x x "" '
### Left broken

- `npm test -- signin`: fails until the next task moves the callers' >"$TMP/broken.md"
got="$(ok "$TMP/broken.md")"
[ "$got" = "True" ] || fail "a body with ### Left broken printed ok $got: $(lint "$TMP/broken.md")"
got="$(bash "$SCRIPT" --lint - <"$TMP/broken.md" | python3 -c "import json, sys; print(json.load(sys.stdin)['ok'])")"
[ "$got" = "True" ] || fail "the same body from standard input printed ok $got"
echo "ok: a body with ### Left broken passes the lint"

body x x "" '
### Left broken

- the signin tests fail until the next task' >"$TMP/nocheck.md"
got="$(reasons "$TMP/nocheck.md")"
[ "$got" = '["breakage-entry"]' ] || fail "a Left broken bullet with no check printed $got, wanted [\"breakage-entry\"]"
echo "ok: a Left broken bullet with no backticked check fails breakage-entry"

body_one() {
  printf '## Goal\n\nx\n\n## Design\n\n- `%s` (changed): %s\n\n## Acceptance criteria\n\n- `foo` is renamed.\n\n## Decisions\n\nNone.\n\n## Out of scope\n\nNothing.\n' "$1" "$2" >"$TMP/one.md"
}
for doc in docs/guide.md README.MD; do
  body_one "$doc" "says the count comes from the settings"
  [ "$(ok "$TMP/one.md")" = "True" ] || fail "a changed entry on $doc printed: $(lint "$TMP/one.md")"
done
echo "ok: a changed entry on a document passes with no symbol"
for code in src/app.ts requirements.txt; do
  body_one "$code" "says the count comes from the settings"
  [ "$(ok "$TMP/one.md")" = "True" ] || fail "a changed entry on $code printed: $(lint "$TMP/one.md")"
done
echo "ok: --lint leaves a code entry with no symbol to --check"
