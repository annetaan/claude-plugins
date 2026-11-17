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

body() {
  local anchor="$1" entry="$2"
  cat <<EOF2
## Goal

Rename foo.

## Design

$entry

## Acceptance criteria

- $anchor

## Decisions

None.

## Out of scope

Nothing.
EOF2
}

field() {
  local before="$1" after="$2" key="$3"
  bash "$SCRIPT" --same-words "$before" "$after" | python3 -c "import json, sys; print(json.load(sys.stdin)[sys.argv[1]])" "$key"
}

body '`foo` is renamed.' '- `src/app.ts` (changed): rename `foo` to `bar`' > "$TMP/before.md"

body 'foo is renamed.' '- `src/app.ts` (changed): rename foo to bar' > "$TMP/no-ticks.md"
[ "$(field "$TMP/before.md" "$TMP/no-ticks.md" ok)" = "True" ] || fail "backticks taken off changed the words"

body '`foo` is
  renamed.' '- `src/app.ts` (changed): rename
  `foo` to   `bar`' > "$TMP/wrapped.md"
[ "$(field "$TMP/before.md" "$TMP/wrapped.md" ok)" = "True" ] || fail "a rewrap changed the words"
echo "ok: bodies that differ in backticks and whitespace only are the same words"

body '`foo` is renamed.' '- `src/app.ts` (changed): rename `foo` to `baz`' > "$TMP/word.md"
[ "$(field "$TMP/before.md" "$TMP/word.md" ok)" = "False" ] || fail "a changed word was read as the same words"
echo "ok: a changed word is not the same words"

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

rc=0; err="$(bash "$SCRIPT" 1 --same-words "$TMP/before.md" "$TMP/before.md" 2>&1)" || rc=$?
[ "$rc" -ne 0 ] || fail "a parent number was accepted"
case "$err" in *"--same-words takes no parent"*) ;; *) fail "a parent number printed: $err" ;; esac
rc=0; err="$(bash "$SCRIPT" --same-words "$TMP/none.md" "$TMP/before.md" 2>&1)" || rc=$?
[ "$rc" -ne 0 ] || fail "a missing file was accepted"
case "$err" in *"no such file"*) ;; *) fail "a missing file printed: $err" ;; esac
echo "ok: --same-words refuses a parent and a missing file"
