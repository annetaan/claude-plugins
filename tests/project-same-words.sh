#!/usr/bin/env bash
# Test: project.sh --same-words tells whether two bodies differ in backticks and whitespace only,
# and prints the lint of the second body.
#
# Run: bash tests/project-same-words.sh   (exit 0 is success, anything else is failure)
# Runs offline: --same-words touches neither GitHub nor git.
# PROJECT_SH=<path> tests another copy of project.sh.
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj1-plan/scripts/project.sh"
SCRIPT="${PROJECT_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# body <anchor> <entry> writes a body whose criterion is <anchor> and whose file entry is <entry>.
body() {
  cat <<EOF2
## Goal

Rename foo.

## Design

$2

## Acceptance criteria

- $1

## Decisions

None.

## Out of scope

Nothing.
EOF2
}

# field <file-a> <file-b> <key> prints one key of the JSON --same-words prints.
field() {
  bash "$SCRIPT" --same-words "$1" "$2" | python3 -c "import json, sys; print(json.load(sys.stdin)[sys.argv[1]])" "$3"
}

body '`foo` is renamed.' '- `src/app.ts` (changed): rename `foo` to `bar`' > "$TMP/before.md"

# Backticks gone: the same words.
body 'foo is renamed.' '- `src/app.ts` (changed): rename foo to bar' > "$TMP/no-ticks.md"
[ "$(field "$TMP/before.md" "$TMP/no-ticks.md" ok)" = "True" ] || fail "backticks taken off changed the words"

# Wrapped and indented differently: the same words.
body '`foo` is
  renamed.' '- `src/app.ts` (changed): rename
  `foo` to   `bar`' > "$TMP/wrapped.md"
[ "$(field "$TMP/before.md" "$TMP/wrapped.md" ok)" = "True" ] || fail "a rewrap changed the words"
echo "ok: bodies that differ in backticks and whitespace only are the same words"

# One word changed.
body '`foo` is renamed.' '- `src/app.ts` (changed): rename `foo` to `baz`' > "$TMP/word.md"
[ "$(field "$TMP/before.md" "$TMP/word.md" ok)" = "False" ] || fail "a changed word was read as the same words"
echo "ok: a changed word is not the same words"

# lint is the lint of <after>: the anchor loses its backticks, so criteria appears.
lint_after="$(field "$TMP/before.md" "$TMP/no-ticks.md" lint)"
case "$lint_after" in
  *"criteria"*) ;;
  *) fail "lint of the second body printed $lint_after, wanted criteria" ;;
esac
lint_before="$(field "$TMP/no-ticks.md" "$TMP/before.md" lint)"
case "$lint_before" in
  *"criteria"*) fail "lint followed the first body: $lint_before" ;;
esac
echo "ok: --same-words prints the lint of the second body"

# Refusals.
rc=0; err="$(bash "$SCRIPT" 1 --same-words "$TMP/before.md" "$TMP/before.md" 2>&1)" || rc=$?
[ "$rc" -ne 0 ] || fail "a parent number was accepted"
case "$err" in *"--same-words takes no parent"*) ;; *) fail "a parent number printed: $err" ;; esac
rc=0; err="$(bash "$SCRIPT" --same-words "$TMP/none.md" "$TMP/before.md" 2>&1)" || rc=$?
[ "$rc" -ne 0 ] || fail "a missing file was accepted"
case "$err" in *"no such file"*) ;; *) fail "a missing file printed: $err" ;; esac
echo "ok: --same-words refuses a parent and a missing file"
