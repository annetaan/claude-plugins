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
[ "$(echo "$R1" | json "sorted(d['rendered'])")" = "['basket', 'headline', 'order', 'question', 'recipe', 'table', 'twenty', 'week']" ] || fail "render rendered the wrong cuts: $R1"
[ "$(echo "$R1" | json "d['errors']")" = "[]" ] || fail "the sample should render with no findings, fragments included: $R1"
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
[ "$(echo "$R2" | json "(d['rendered'], len(d['cached']))")" = "([], 8)" ] || fail "a second render should render nothing: $R2"
echo "ok: a second render is cached"

# --force renders every cut.
RF="$(node "$EV" render "$TMP/sample/story.md" --preview --force 2>/dev/null)" || fail "render --force failed: $RF"
[ "$(echo "$RF" | json "len(d['rendered'])")" = "8" ] || fail "--force should render all 8 cuts: $RF"
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
# old ones are gone only if prune removed them: one file per distinct key, 8.
[ "$(ls "$TMP/sample/build/cuts/preview" | wc -l | tr -d ' ')" = "8" ] || fail "build/cuts/preview should hold 8 files after the edits"
echo "ok: pruning leaves only referenced files"

# snapshot at peak+0.5 writes a PNG of the output size and names the cut.
SNAP="$(node "$EV" snapshot "$TMP/sample/story.md" --at "peak+0.5")" || fail "snapshot failed: $SNAP"
[ "$(echo "$SNAP" | json "d['cut']")" = "twenty" ] || fail "snapshot at peak+0.5 should land in twenty: $SNAP"
SNAP_FILE="$(echo "$SNAP" | json "d['file']")"
[ "$(python3 -c 'import struct,sys; b=open(sys.argv[1],"rb").read(24); print(struct.unpack(">II", b[16:24]))' "$SNAP_FILE")" = "(1920, 1080)" ] || fail "the snapshot is not 1920x1080"
echo "ok: snapshot"

# snapshot of the screen cut writes a PNG of the output size.
SNAP2="$(node "$EV" snapshot "$TMP/sample/story.md" --at "order+2")" || fail "snapshot of the screen cut failed: $SNAP2"
[ "$(echo "$SNAP2" | json "d['cut']")" = "order" ] || fail "snapshot at order+2 should land in order: $SNAP2"
SNAP2_FILE="$(echo "$SNAP2" | json "d['file']")"
[ "$(python3 -c 'import struct,sys; b=open(sys.argv[1],"rb").read(24); print(struct.unpack(">II", b[16:24]))' "$SNAP2_FILE")" = "(1920, 1080)" ] || fail "the screen snapshot is not 1920x1080"
echo "ok: snapshot of the screen cut"

# A story of small helpers for the part tests: story_with <dir> <cuts yaml> writes <dir>/story.md.
story_with() {
  mkdir -p "$1/assets"
  {
    printf -- '---\ntitle: Parts\nmusic: { bpm: 120, beats_per_bar: 4 }\n%s---\n\n## Brief\n\nA small test.\n\n## Scene 1 — Only\n\nPurpose.\n\n```yaml\nrole: headline\ncuts:\n' "${3:-}"
    printf '%s\n```\n' "$2"
  } >"$1/story.md"
}

# Media made here with ffmpeg: no binary file is kept in the repository.
mkdir -p "$TMP/media"
story_with "$TMP/media" "  - { id: pic, part: image, bars: 1, src: assets/pic.png, prompt: A red picture, zoom: in }
  - { id: clip, part: video, bars: 1, src: assets/clip.mp4, prompt: A test clip, start: 0.5 }"
M1="$(node "$EV" render "$TMP/media/story.md" --preview 2>/dev/null)" || fail "render with no media failed: $M1"
[ "$(echo "$M1" | json "d['rendered']")" = "['pic', 'clip']" ] || fail "the placeholders should render both cuts: $M1"
ffmpeg -v error -y -f lavfi -i color=c=red:s=640x360 -frames:v 1 "$TMP/media/assets/pic.png" || fail "could not make the image"
M2="$(node "$EV" render "$TMP/media/story.md" --preview 2>/dev/null)" || fail "render after dropping the image failed: $M2"
[ "$(echo "$M2" | json "d['rendered']")" = "['pic']" ] || fail "dropping an image should render only that cut: $M2"
echo "ok: a dropped-in image re-renders exactly its cut"

ffmpeg -v error -y -f lavfi -i testsrc=d=2:s=320x240:r=30 -pix_fmt yuv420p "$TMP/media/assets/clip.mp4" || fail "could not make the clip"
M3="$(node "$EV" render "$TMP/media/story.md" --preview 2>/dev/null)" || fail "render with a clip failed: $M3"
[ "$(echo "$M3" | json "d['rendered']")" = "['clip']" ] || fail "dropping a clip should render only that cut: $M3"
MDUR="$(echo "$M3" | json "d['duration']")"
[ "$(SIZE "$TMP/media/build/preview.mp4" | json "abs(float(d['format']['duration']) - $MDUR) < 0.1")" = "True" ] || fail "the preview with a clip is not $MDUR s long"
FRAMES_BEFORE="$(python3 -c 'import os,sys; d=sys.argv[1]; print([ (n, os.stat(os.path.join(d, n)).st_mtime_ns) for n in sorted(os.listdir(d)) ])' "$TMP/media/build/video-frames")"
[ "$(ls "$TMP/media/build/video-frames" | wc -l | tr -d ' ')" = "1" ] || fail "expected one frame directory: $FRAMES_BEFORE"
node "$EV" render "$TMP/media/story.md" --preview --force >/dev/null 2>&1 || fail "a forced render with a clip failed"
FRAMES_AFTER="$(python3 -c 'import os,sys; d=sys.argv[1]; print([ (n, os.stat(os.path.join(d, n)).st_mtime_ns) for n in sorted(os.listdir(d)) ])' "$TMP/media/build/video-frames")"
[ "$FRAMES_BEFORE" = "$FRAMES_AFTER" ] || fail "a second render extracted the frames again: $FRAMES_BEFORE then $FRAMES_AFTER"
echo "ok: a video cut renders from a clip and its frames are kept"

# An image that cannot be decoded is a story error.
echo "not a picture" >"$TMP/media/assets/pic.png"
set +e
MB="$(node "$EV" render "$TMP/media/story.md" --preview 2>/dev/null)"
CODE=$?
set -e
[ "$CODE" = "1" ] || fail "an undecodable image should exit 1, got $CODE: $MB"
[ "$(echo "$MB" | json "(d['errors'][0]['code'], d['errors'][0]['cut'])")" = "('bad-image', 'pic')" ] || fail "expected bad-image on pic: $MB"
echo "ok: an undecodable image fails with bad-image"

# A fragment's relative path resolves against the story's directory: a red picture shows in the middle of the frame.
mkdir -p "$TMP/relpath"
story_with "$TMP/relpath" "  - { id: show, part: custom, bars: 1, src: assets/f.html }"
ffmpeg -v error -y -f lavfi -i color=c=red:s=640x360 -frames:v 1 "$TMP/relpath/assets/photo.png" || fail "could not make the photo"
echo '<img src="assets/photo.png" style="position:absolute;inset:0;width:100%;height:100%">' >"$TMP/relpath/assets/f.html"
RP="$(node "$EV" snapshot "$TMP/relpath/story.md" --at 0.5 --preview)" || fail "snapshot with a relative picture failed: $RP"
PIXEL="$(ffmpeg -v error -i "$(echo "$RP" | json "d['file']")" -vf crop=1:1:480:270 -f rawvideo -pix_fmt rgb24 - | od -An -tu1 | tr -s ' ')"
[ "$(echo "$PIXEL" | python3 -c 'import sys; r,g,b=map(int, sys.stdin.read().split()); print(r > 240 and g < 15 and b < 15)')" = "True" ] || fail "the relative picture is not on screen; the middle pixel is:$PIXEL"
echo "ok: a fragment's relative path resolves against the story"

# Fragments that break the rules fail with the finding and the cut's id, exit 1, and leave no file in build/cuts.
fragment_fails() { # <name> <fragment html> <expected code>
  local dir="$TMP/frag-$1"
  story_with "$dir" "  - { id: boom, part: custom, bars: 1, src: assets/f.html }"
  printf '%s\n' "$2" >"$dir/assets/f.html"
  set +e
  local out
  out="$(node "$EV" render "$dir/story.md" --preview 2>/dev/null)"
  local code=$?
  set -e
  [ "$code" = "1" ] || fail "fragment $1 should exit 1, got $code: $out"
  [ "$(echo "$out" | json "(d['errors'][0]['code'], d['errors'][0]['cut'])")" = "('$3', 'boom')" ] || fail "fragment $1 should fail with $3 on boom: $out"
  [ -z "$(ls "$dir/build/cuts/preview" 2>/dev/null)" ] || fail "fragment $1 left a file in build/cuts/preview"
}
fragment_fails clock '<div>x</div><script>setTimeout(function () {}, 10)</script>' fragment-clock
fragment_fails network '<div>x</div><img src="http://example.invalid/a.png">' fragment-network
fragment_fails error '<div>x</div><script>throw new Error("kaboom")</script>' fragment-error
echo "ok: fragments that break the rules fail"

# A 9:16 story with a screen cut renders at 540x960 in preview.
story_with "$TMP/tallscreen" "  - id: app
    part: screen
    device: phone
    bars: 1
    html: '<div style=\"padding:40px;font-size:30px\">Hello</div>'" 'output: { aspect: "9:16", fps: 30 }
'
node "$EV" render "$TMP/tallscreen/story.md" --preview >/dev/null 2>&1 || fail "the 9:16 screen render failed"
TS="$(SIZE "$TMP/tallscreen/build/preview.mp4")"
[ "$(echo "$TS" | json "(d['streams'][0]['width'], d['streams'][0]['height'])")" = "(540, 960)" ] || fail "the 9:16 screen preview is not 540x960: $TS"
echo "ok: 9:16 screen cut"

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
