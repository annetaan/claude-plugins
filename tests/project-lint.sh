#!/usr/bin/env bash
# Test: project.sh --lint reads a sub-issue body that carries `### Shared state`, `### Model decisions` and an
# `Only you know:` line, and the lines do not hide the file list, the sections or the options from it.
#
# Run: bash tests/project-lint.sh   (exit 0 is success, anything else is failure)
# Runs offline: --lint touches neither GitHub nor git.
# PROJECT_SH=<path> tests another copy of project.sh.
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj1-plan/scripts/project.sh"
SCRIPT="${PROJECT_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# body <box1> <box2> <extra> writes a body with two decisions. Each carries an `Only you know:` line before its
# options. <box1> and <box2> are the mark in the box of each decision's recommended option, `x` or a space.
# <extra> is appended to the second option of the first decision. <broken> is appended to ## Design after
# ### Model decisions.
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

# reasons <body file> prints the lint reasons as a comma-separated list, and ok as the first word
lint() { bash "$SCRIPT" --lint "$1"; }
reasons() {
  lint "$1" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(json.dumps(d['reasons'] if all(isinstance(r, str) for r in d['reasons']) else [r['code'] for r in d['reasons']]))"
}
ok() { lint "$1" | python3 -c "import json, sys; print(json.load(sys.stdin)['ok'])"; }

# Case 1: one decision settled and one open. The only reason is decisions-open, so the subsections and the
# `Only you know:` lines cost the body nothing.
body x " " "" >"$TMP/open.md"
got="$(reasons "$TMP/open.md")"
[ "$got" = '["decisions-open"]' ] || fail "an open decision with the line printed $got, wanted [\"decisions-open\"]"
echo "ok: an open decision with its Only you know line fails only decisions-open"

# Case 2: tick the open decision too. The lint passes.
body x x "" >"$TMP/ticked.md"
got="$(ok "$TMP/ticked.md")"
[ "$got" = "True" ] || fail "a body with both decisions ticked printed ok $got: $(lint "$TMP/ticked.md")"
echo "ok: both decisions ticked pass the lint with the subsections and the lines in place"

# Case 3: two `(recommended)` in one decision still fail decision-shape, so the line does not hide the options.
body x x " (recommended)" >"$TMP/shape.md"
got="$(reasons "$TMP/shape.md")"
case "$got" in
  *decision-shape*) ;;
  *) fail "two (recommended) in one decision printed $got, wanted decision-shape" ;;
esac
echo "ok: two (recommended) in one decision still fail decision-shape"

# Case 4: a ### Left broken subsection with a backticked check passes the lint.
body x x "" '
### Left broken

- `npm test -- signin`: fails until the next task moves the callers' >"$TMP/broken.md"
got="$(ok "$TMP/broken.md")"
[ "$got" = "True" ] || fail "a body with ### Left broken printed ok $got: $(lint "$TMP/broken.md")"
got="$(bash "$SCRIPT" --lint - <"$TMP/broken.md" | python3 -c "import json, sys; print(json.load(sys.stdin)['ok'])")"
[ "$got" = "True" ] || fail "the same body from standard input printed ok $got"
echo "ok: a body with ### Left broken passes the lint"

# Case 5: a bullet with no backticked check fails breakage-entry.
body x x "" '
### Left broken

- the signin tests fail until the next task' >"$TMP/nocheck.md"
got="$(reasons "$TMP/nocheck.md")"
[ "$got" = '["breakage-entry"]' ] || fail "a Left broken bullet with no check printed $got, wanted [\"breakage-entry\"]"
echo "ok: a Left broken bullet with no backticked check fails breakage-entry"
