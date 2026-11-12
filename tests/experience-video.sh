#!/usr/bin/env bash
# Test: the experience-video renderer installs its dependencies, passes its unit tests, and checks the sample story.
#
# Run: bash tests/experience-video.sh   (exit 0 is success, anything else is failure)
# The first run needs the network: setup runs `npm ci` (playwright, yaml) and may download a Chromium headless shell,
# and the --deps step installs a second copy of the dependencies into a temp directory.
# Needs node 20 or newer and ffmpeg. With no --deps, setup installs into the renderer directory itself.
# VIDEO_DIR=<path> tests another copy of the skill directory.
set -euo pipefail

VIDEO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/experience-video"
VIDEO="${VIDEO_DIR:-$VIDEO}"
EV="$VIDEO/renderer/bin/ev.js"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# json <expression over d>: evaluate against the JSON on stdin and print the result.
json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }

# setup with no --deps installs into the renderer directory.
SETUP="$(node "$EV" setup)" || fail "setup exited non-zero: $SETUP"
[ "$(echo "$SETUP" | json "d['ok']")" = "True" ] || fail "setup did not report ok: $SETUP"
echo "ok: setup"

# The renderer's own unit tests.
(cd "$VIDEO/renderer" && npm test >"$TMP/npm-test.log" 2>&1) || { cat "$TMP/npm-test.log" >&2; fail "npm test failed"; }
echo "ok: unit tests"

# check on a temp copy of the sample, so build/ lands outside the repository.
cp -R "$VIDEO/sample" "$TMP/sample"
CHECK="$(node "$EV" check "$TMP/sample/story.md")" || fail "check exited non-zero: $CHECK"
[ "$(echo "$CHECK" | json "d['ok']")" = "True" ] || fail "check did not report ok: $CHECK"
[ "$(echo "$CHECK" | json "0 < d['duration'] < 60")" = "True" ] || fail "sample duration is not under 60 s: $CHECK"
[ "$(echo "$CHECK" | json "len(d['scenes'])")" = "5" ] || fail "sample does not have 5 scenes: $CHECK"
[ -f "$TMP/sample/build/timeline.json" ] || fail "check wrote no build/timeline.json"
echo "ok: check on the sample"

# A story with a mismatched heading fails with exit 1 and a finding.
sed 's/^## Scene 2 /## Scene 7 /' "$TMP/sample/story.md" >"$TMP/bad.md"
set +e
BAD="$(node "$EV" check "$TMP/bad.md")"
CODE=$?
set -e
[ "$CODE" = "1" ] || fail "a story error should exit 1, got $CODE"
[ "$(echo "$BAD" | json "d['errors'][0]['code']")" = "scene-number" ] || fail "expected scene-number: $BAD"
echo "ok: check rejects a bad story"

# setup --deps installs outside the skill, and check runs from there.
DEPS_OUT="$(node "$EV" setup --deps "$TMP/deps")" || fail "setup --deps exited non-zero: $DEPS_OUT"
[ "$(echo "$DEPS_OUT" | json "d['ok']")" = "True" ] || fail "setup --deps did not report ok: $DEPS_OUT"
[ "$(echo "$DEPS_OUT" | json "d['deps']")" = "$TMP/deps" ] || fail "setup --deps reported another directory: $DEPS_OUT"
[ -d "$TMP/deps/node_modules" ] || fail "setup --deps installed no node_modules"
DEPS_CHECK="$(node "$EV" check "$TMP/sample/story.md" --deps "$TMP/deps")" || fail "check --deps exited non-zero: $DEPS_CHECK"
[ "$(echo "$DEPS_CHECK" | json "d['ok']")" = "True" ] || fail "check --deps did not report ok: $DEPS_CHECK"
AGAIN="$(node "$EV" setup --deps "$TMP/deps")" || fail "second setup --deps exited non-zero: $AGAIN"
[ "$(echo "$AGAIN" | json "d['installed']")" = "False" ] || fail "a second setup --deps reinstalled: $AGAIN"
echo "ok: setup --deps"

echo "PASS"
