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

# render: the sample draws with no source files (image cuts become placeholders). Never render in place on sample/.
SIZE() { ffprobe -v error -of json -show_entries stream=codec_type,width,height:format=duration "$1"; }
set +e
R1="$(node "$EV" render "$TMP/sample/story.md" --preview 2>"$TMP/render.log")"
CODE=$?
set -e
[ "$CODE" = "0" ] || { cat "$TMP/render.log" >&2; fail "render --preview exited $CODE: $R1"; }
[ "$(echo "$R1" | json "d['ok']")" = "True" ] || fail "render did not report ok: $R1"
[ "$(echo "$R1" | json "sorted(d['rendered'])")" = "['basket', 'headline', 'question', 'recipe', 'table', 'twenty', 'week']" ] || fail "render rendered the wrong cuts: $R1"
PREVIEW="$TMP/sample/build/preview.mp4"
[ -f "$PREVIEW" ] || fail "render --preview wrote no build/preview.mp4"
DUR="$(echo "$CHECK" | json "d['duration']")"
PROBE="$(SIZE "$PREVIEW")"
[ "$(echo "$PROBE" | json "[s['codec_type'] for s in d['streams']]")" = "['video']" ] || fail "the preview should have one video stream and no audio yet: $PROBE"
[ "$(echo "$PROBE" | json "(d['streams'][0]['width'], d['streams'][0]['height'])")" = "(960, 540)" ] || fail "the preview is not 960x540: $PROBE"
[ "$(echo "$PROBE" | json "abs(float(d['format']['duration']) - $DUR) < 0.1")" = "True" ] || fail "the preview is not $DUR s long: $PROBE"
echo "ok: render --preview"

# A second render renders no cut.
R2="$(node "$EV" render "$TMP/sample/story.md" --preview 2>/dev/null)" || fail "second render failed: $R2"
[ "$(echo "$R2" | json "(d['rendered'], len(d['cached']))")" = "([], 7)" ] || fail "a second render should render nothing: $R2"
echo "ok: a second render is cached"

# --force renders every cut.
RF="$(node "$EV" render "$TMP/sample/story.md" --preview --force 2>/dev/null)" || fail "render --force failed: $RF"
[ "$(echo "$RF" | json "len(d['rendered'])")" = "7" ] || fail "--force should render all 7 cuts: $RF"
echo "ok: render --force"

# Editing one telop renders exactly one cut.
sed -i.bak 's/"Again."/"Again!"/' "$TMP/sample/story.md"
R3="$(node "$EV" render "$TMP/sample/story.md" --preview 2>/dev/null)" || fail "render after a telop edit failed: $R3"
[ "$(echo "$R3" | json "d['rendered']")" = "['question']" ] || fail "a telop edit should render only question: $R3"
echo "ok: a telop edit renders one cut"

# Lengthening an early cut renders that cut and nothing after.
python3 - "$TMP/sample/story.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = "  - id: basket\n    part: image\n    bars: 2\n"
assert old in s
open(p, "w").write(s.replace(old, old.replace("bars: 2", "bars: 3")))
PY
R4="$(node "$EV" render "$TMP/sample/story.md" --preview 2>/dev/null)" || fail "render after lengthening failed: $R4"
[ "$(echo "$R4" | json "d['rendered']")" = "['basket']" ] || fail "lengthening basket should render only basket: $R4"
# A longer crossfade on recipe changes only the cut before it (its tail).
python3 - "$TMP/sample/story.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = "    zoom: out\n    in: crossfade\n"
assert old in s
open(p, "w").write(s.replace(old, "    zoom: out\n    in: { type: crossfade, duration: 1 }\n"))
PY
R5="$(node "$EV" render "$TMP/sample/story.md" --preview 2>/dev/null)" || fail "render after a crossfade edit failed: $R5"
[ "$(echo "$R5" | json "d['rendered']")" = "['basket']" ] || fail "a longer crossfade should render only basket: $R5"
echo "ok: edits render only the cuts they change"

# Pruning leaves only the referenced files. Four edits have replaced the files of question and basket by now, so the
# old ones are gone only if prune removed them: one file per distinct key, 7.
[ "$(ls "$TMP/sample/build/cuts/preview" | wc -l | tr -d ' ')" = "7" ] || fail "build/cuts/preview should hold 7 files after the edits"
echo "ok: pruning leaves only referenced files"

# snapshot at peak+0.5 writes a PNG of the output size and names the cut.
SNAP="$(node "$EV" snapshot "$TMP/sample/story.md" --at "peak+0.5")" || fail "snapshot failed: $SNAP"
[ "$(echo "$SNAP" | json "d['cut']")" = "twenty" ] || fail "snapshot at peak+0.5 should land in twenty: $SNAP"
SNAP_FILE="$(echo "$SNAP" | json "d['file']")"
[ "$(python3 -c 'import struct,sys; b=open(sys.argv[1],"rb").read(24); print(struct.unpack(">II", b[16:24]))' "$SNAP_FILE")" = "(1920, 1080)" ] || fail "the snapshot is not 1920x1080"
echo "ok: snapshot"

# A 9:16 story renders at 1080x1920 (540x960 in preview).
mkdir -p "$TMP/tall"
cat >"$TMP/tall/story.md" <<'MD'
---
title: Tall
output: { aspect: "9:16", fps: 30 }
music: { bpm: 120, beats_per_bar: 4 }
---

## Brief

A one-scene vertical test.

## Scene 1 — Only

Purpose.

```yaml
role: headline
cuts:
  - part: card
    bars: 1
    lines: [Tall, { text: "and narrow", style: small }]
```
MD
node "$EV" render "$TMP/tall/story.md" --preview >/dev/null 2>&1 || fail "the 9:16 render failed"
TALL="$(SIZE "$TMP/tall/build/preview.mp4")"
[ "$(echo "$TALL" | json "(d['streams'][0]['width'], d['streams'][0]['height'])")" = "(540, 960)" ] || fail "the 9:16 preview is not 540x960: $TALL"
echo "ok: 9:16"

# A story with an error exits 1 and writes no video.
rm -f "$TMP/bad-render/build/preview.mp4"
mkdir -p "$TMP/bad-render"
sed 's/^## Scene 2 /## Scene 7 /' "$TMP/sample/story.md" >"$TMP/bad-render/story.md"
set +e
node "$EV" render "$TMP/bad-render/story.md" --preview >/dev/null 2>&1
CODE=$?
set -e
[ "$CODE" = "1" ] || fail "render on a story error should exit 1, got $CODE"
[ ! -e "$TMP/bad-render/build/preview.mp4" ] || fail "render wrote a video for a story with an error"
echo "ok: render rejects a bad story"

# clean removes build/ and keeps story.md.
node "$EV" clean "$TMP/sample/story.md" >/dev/null || fail "clean failed"
[ ! -e "$TMP/sample/build" ] || fail "clean left build/"
[ -f "$TMP/sample/story.md" ] || fail "clean removed story.md"
echo "ok: clean"

echo "PASS"
