#!/usr/bin/env bash
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj4-running/scripts"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }

mkdir -p "$TMP/skills/pj4-running/scripts" "$TMP/skills/pj1-plan/scripts" "$TMP/skills/workflow/scripts" "$TMP/bin"
cp "$SCRIPTS/run.sh" "$SCRIPTS/run.py" "$TMP/skills/pj4-running/scripts/"
cp "$SCRIPTS/../../pj1-plan/scripts/issue.py" "$TMP/skills/pj1-plan/scripts/"
cp "$SCRIPTS/../../workflow/scripts/clone.py" "$TMP/skills/workflow/scripts/"
SCRIPT="$TMP/skills/pj4-running/scripts/run.sh"

cat > "$TMP/skills/pj1-plan/scripts/project.sh" <<'EOF'
#!/usr/bin/env bash
echo '{"parent":{"number":1,"state":"OPEN","merged":true,"base":"pj/1","waitsOn":[],"waitedOnBy":[]},"issues":[{"number":2,"state":"OPEN","pr":{"number":3,"state":"MERGED"}}]}'
EOF

cat > "$TMP/skills/pj1-plan/scripts/issue.sh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE/issue.log"
if [ -e "$FAKE/fail-$1" ]; then echo "issue: boom" >&2; exit 1; fi
if [ -e "$FAKE/refuse-$1" ]; then cat "$FAKE/refuse-$1"; exit 0; fi
case "$1" in
  sub) echo '{"status":"ok","number":9,"url":"https://github.com/o/r/issues/9"}' ;;
  *)   echo '{"status":"ok"}' ;;
esac
EOF

cat > "$TMP/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE/gh.log"
echo "unexpected gh $*" >&2
exit 1
EOF
chmod +x "$TMP/bin/gh" "$TMP/skills/pj1-plan/scripts/project.sh" "$TMP/skills/pj1-plan/scripts/issue.sh"
export PATH="$TMP/bin:$PATH"

export FAKE="$TMP/fake"
setup() { rm -rf "$FAKE"; mkdir -p "$FAKE"; }

C="$TMP/comment.md"
STUB="$TMP/stub.md"
echo "**[pj4-running]** stopped" > "$C"
echo "## Goal" > "$STUB"
echo "stopped" > "$TMP/unmarked.md"

calls() { if [ -e "$FAKE/issue.log" ]; then tr '\n' '|' < "$FAKE/issue.log"; fi; }

no_gh() { if [ -s "$FAKE/gh.log" ]; then fail "$1 called gh: $(cat "$FAKE/gh.log")"; fi; }

blocking() { "$SCRIPT" stop 1 2 blocking --comment "$1" --stub "$STUB" --title "Stub"; }

setup
out="$(blocking "$C")"
[ "$(echo "$out" | json 'd["status"]')" = stopped ] || fail "blocking: $out"
[ "$(echo "$out" | json 'd["number"]')" = 2 ] || fail "blocking number: $out"
[ "$(echo "$out" | json 'd["stub"]["number"]')" = 9 ] || fail "blocking stub number: $out"
[ "$(echo "$out" | json 'd["stub"]["url"]')" = https://github.com/o/r/issues/9 ] || fail "blocking stub url: $out"
[ "$(calls)" = "sub 1 --title Stub --blocking 2 --label blocker --body $STUB|comment 2 --body $C|" ] \
  || fail "blocking calls: $(calls)"
no_gh blocking
echo "ok: stop blocking files the stub, then comments"

setup
out="$("$SCRIPT" stop 1 2 decision --comment "$C")"
[ "$(echo "$out" | json 'd["status"]')" = stopped ] || fail "decision: $out"
[ "$(echo "$out" | json '"stub" in d')" = False ] || fail "decision carries a stub: $out"
[ "$(calls)" = "label 2 --remove ready|titles 1|comment 2 --body $C|" ] || fail "decision calls: $(calls)"
echo "ok: stop decision takes ready off, syncs the titles and comments"

setup
out="$("$SCRIPT" stop 1 2 detail --comment "$C")"
[ "$(echo "$out" | json 'd["status"]')" = stopped ] || fail "detail: $out"
[ "$(calls)" = "label 2 --add blocker --remove ready|comment 2 --body $C|" ] || fail "detail calls: $(calls)"
echo "ok: stop detail adds blocker, takes ready off and comments"

setup
out="$("$SCRIPT" stop 1 2 round-cap --comment "$C")"
[ "$(echo "$out" | json 'd["status"]')" = stopped ] || fail "round-cap: $out"
[ "$(calls)" = "comment 2 --body $C|" ] || fail "round-cap calls: $(calls)"
echo "ok: stop round-cap only comments"

U="$TMP/unmarked.md"
setup
for cmd in "close 1 2 --comment $U" "stop 1 2 decision --comment $U" "stop 1 2 detail --comment $U" \
           "stop 1 2 round-cap --comment $U" "stop 1 2 blocking --comment $U --stub $STUB --title Stub"; do
  out="$("$SCRIPT" $cmd)"
  [ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "$cmd: $out"
  [ "$(echo "$out" | json 'd["reason"]')" = no-marker ] || fail "$cmd reason: $out"
  [ "$(echo "$out" | json '"step" in d')" = False ] || fail "$cmd carries a step: $out"
done
[ -z "$(calls)" ] || fail "wrote with an unmarked comment: $(calls)"
no_gh "an unmarked comment"
echo "ok: close and stop refuse an unmarked comment before any write"

for marker in '**[pj3-doctor]**' '**[pj4-running]**' '**[pj-cleanup]**'; do
  setup
  echo "$marker closed" > "$TMP/marked.md"
  out="$("$SCRIPT" close 1 2 --comment "$TMP/marked.md")"
  [ "$(echo "$out" | json 'd["status"]')" = closed ] || fail "close with $marker: $out"
  [ "$(calls)" = "close 2 --reason completed --comment $TMP/marked.md|" ] || fail "close with $marker calls: $(calls)"
done
setup
echo '**[pj-cleanup]** merged' > "$TMP/cleanup.md"
out="$("$SCRIPT" close 1 1 --comment "$TMP/cleanup.md")"
[ "$(echo "$out" | json 'd["status"]')" = closed ] || fail "pj-cleanup close of the parent: $out"
[ "$(calls)" = "close 1 --reason completed --comment $TMP/cleanup.md|" ] || fail "parent close calls: $(calls)"
echo "ok: close takes the marker of every skill"

setup
echo '{"status":"stop","reason":"closed","message":"#2 is closed"}' > "$FAKE/refuse-comment"
out="$(blocking "$C")"
[ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "closed at comment: $out"
[ "$(echo "$out" | json 'd["reason"]')" = closed ] || fail "closed at comment reason: $out"
[ "$(echo "$out" | json 'd["message"]')" = "#2 is closed" ] || fail "closed at comment message: $out"
[ "$(echo "$out" | json 'd["step"]')" = comment ] || fail "closed at comment step: $out"
[ "$(echo "$out" | json 'd["stub"]["number"]')" = 9 ] || fail "closed at comment stub: $out"
setup
echo '{"status":"stop","reason":"cycle","message":"#9 made a cycle","number":9,"url":"https://github.com/o/r/issues/9"}' \
  > "$FAKE/refuse-sub"
out="$(blocking "$C")"
[ "$(echo "$out" | json 'd["reason"]')" = cycle ] || fail "cycle reason: $out"
[ "$(echo "$out" | json 'd["step"]')" = sub ] || fail "cycle step: $out"
[ "$(echo "$out" | json 'd["stub"]')" = "{'number': 9, 'url': 'https://github.com/o/r/issues/9'}" ] || fail "cycle stub: $out"
[ "$(echo "$out" | json '"number" in d')" = False ] || fail "cycle carries number: $out"
[ "$(calls)" = "sub 1 --title Stub --blocking 2 --label blocker --body $STUB|" ] || fail "cycle commented: $(calls)"
setup
echo '{"status":"stop","reason":"lint","message":"the body fails the lint","reasons":["goal"]}' > "$FAKE/refuse-sub"
out="$(blocking "$C")"
[ "$(echo "$out" | json 'd["reason"]')" = lint ] || fail "lint reason: $out"
[ "$(echo "$out" | json 'd["reasons"]')" = "['goal']" ] || fail "lint reasons: $out"
[ "$(echo "$out" | json '"stub" in d')" = False ] || fail "lint carries a stub: $out"
setup
echo '{"status":"stop","reason":"closed","message":"#2 is closed"}' > "$FAKE/refuse-label"
out="$("$SCRIPT" stop 1 2 decision --comment "$C")"
[ "$(echo "$out" | json 'd["reason"]')" = closed ] || fail "closed at label: $out"
[ "$(echo "$out" | json 'd["step"]')" = label ] || fail "closed at label step: $out"
[ "$(calls)" = "label 2 --remove ready|" ] || fail "went on after label: $(calls)"
setup
echo '{"status":"stop","reason":"closed","message":"#2 is closed"}' > "$FAKE/refuse-titles"
out="$("$SCRIPT" stop 1 2 decision --comment "$C")"
[ "$(echo "$out" | json 'd["step"]')" = titles ] || fail "closed at titles step: $out"
[ "$(calls)" = "label 2 --remove ready|titles 1|" ] || fail "went on after titles: $(calls)"
echo "ok: stop passes on a refusal of issue.sh and names the step"

setup
touch "$FAKE/fail-label"
out="$("$SCRIPT" stop 1 2 detail --comment "$C")"
[ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "failure at label: $out"
[ "$(echo "$out" | json 'd["reason"]')" = issue-failed ] || fail "failure at label reason: $out"
[ "$(echo "$out" | json 'd["message"]')" = "issue: boom" ] || fail "failure at label message: $out"
[ "$(echo "$out" | json 'd["step"]')" = label ] || fail "failure at label step: $out"
[ "$(calls)" = "label 2 --add blocker --remove ready|" ] || fail "went on after a failure: $(calls)"
setup
touch "$FAKE/fail-comment"
out="$(blocking "$C")"
[ "$(echo "$out" | json 'd["reason"]')" = issue-failed ] || fail "failure at comment reason: $out"
[ "$(echo "$out" | json 'd["step"]')" = comment ] || fail "failure at comment step: $out"
[ "$(echo "$out" | json 'd["stub"]["number"]')" = 9 ] || fail "failure at comment stub: $out"
echo "ok: stop turns a failure of issue.sh into issue-failed at its step"

setup
out="$("$SCRIPT" stop 1 5 round-cap --comment "$C")"
[ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "outside the project: $out"
[ "$(echo "$out" | json 'd["reason"]')" = unknown-issue ] || fail "outside the project reason: $out"
[ "$(echo "$out" | json 'd["number"]')" = 5 ] || fail "outside the project number: $out"
[ -z "$(calls)" ] || fail "wrote outside the project: $(calls)"
echo "ok: stop refuses an issue outside the project"

setup
for cmd in "stop 1 2 later --comment $C" "stop 1 2 blocking --comment $C" \
           "stop 1 2 blocking --comment $C --title Stub --stub $STUB" \
           "stop 1 2 detail --comment $C --stub $STUB --title Stub" "stop 1 x detail --comment $C" \
           "stop 1 2 detail --body $C"; do
  if "$SCRIPT" $cmd > /dev/null 2>&1; then fail "not a usage error: $cmd"; fi
done
"$SCRIPT" stop 1 2 blocking --comment "$C" --stub "$TMP/none.md" --title Stub > /dev/null 2>&1 \
  && fail "a missing stub file is not an error"
[ -z "$(calls)" ] || fail "wrote on a usage error: $(calls)"
echo "ok: stop usage errors"
