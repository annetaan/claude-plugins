#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/workflow/scripts/panel.sh"
SCRIPT="${PANEL_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
git config --global init.defaultBranch main

fail() { echo "FAIL: $*" >&2; exit 1; }

json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }

setup() {
  rm -rf "$TMP/work"
  git init -q "$TMP/work"
  MAIN="$(cd "$TMP/work" && pwd -P)"
  (
    cd "$MAIN"
    echo one > a
    echo cee > c
    git add a c
    git commit -q -m init
    printf 'work-reports/\n.claude/worktrees/\nnode_modules/\n' >> .git/info/exclude
    git worktree add -q --detach .claude/worktrees/wf-test HEAD
  )
  WT="$MAIN/.claude/worktrees/wf-test"
  A="$MAIN/.claude/worktrees/review-wf-test-a"
  B="$MAIN/.claude/worktrees/review-wf-test-b"
  REPORT="$WT/work-reports/2026-01-01-0000-aaaaaaa"
  cd "$MAIN"
}

dirty() {
  echo two > "$WT/a"
  echo staged > "$WT/c"
  git -C "$WT" add c
  echo new > "$WT/b"
  mkdir -p "$WT/node_modules"
  echo dep > "$WT/node_modules/x"
}

probe() {
  local dir="$REPORT/seats/$1/$2"
  mkdir -p "$dir"
  printf '%s\n' "$3" > "$dir/run.sh"
  echo "$dir"
}

setup
dirty
status_before="$(git -C "$WT" status --porcelain)"
index_before="$(git -C "$WT" diff --cached)"
p="$(probe a list 'cat a c b; ls node_modules 2>&1 || true; git rev-parse HEAD')"
out="$("$SCRIPT" run "$WT" a "$p")"
[ "$(echo "$out" | json 'd["status"]')" = ran ] || fail "run status: $out"
[ "$(echo "$out" | json 'd["seat"]')" = a ] || fail "run seat: $out"
[ "$(echo "$out" | json 'd["exit"]')" = 0 ] || fail "run exit: $out"
snap="$(echo "$out" | json 'd["snapshot"]')"
[ "$(git -C "$WT" rev-parse "$snap^")" = "$(git -C "$WT" rev-parse HEAD)" ] || fail "snapshot parent"
[ "$(git -C "$A" rev-parse HEAD)" = "$snap" ] || fail "seat a is not at the snapshot"
[ -z "$(git -C "$A" symbolic-ref -q HEAD || true)" ] || fail "seat a is not detached"
[ "$(cat "$A/a")" = two ] || fail "seat a: a"
[ "$(cat "$A/c")" = staged ] || fail "seat a: c"
[ "$(cat "$A/b")" = new ] || fail "seat a: b"
[ ! -e "$A/node_modules" ] || fail "seat a holds an ignored file"
[ "$(echo "$out" | json 'd["output"].splitlines()[:3]')" = "['two', 'staged', 'new']" ] || fail "run output: $out"
[ "$(git -C "$WT" status --porcelain)" = "$status_before" ] || fail "run changed the status of the run"
[ "$(git -C "$WT" diff --cached)" = "$index_before" ] || fail "run changed the index of the run"
[ ! -e "$B" ] || fail "run created seat b"
echo "ok: run puts the seat at a snapshot holding the changed and the untracked files and no ignored one, and leaves the run's status and index as they were"

setup
dirty
p="$(probe b tree 'pwd; cat t/new.test; for i in $(seq 1 50); do echo line$i; done; exit 3')"
mkdir -p "$p/tree/t"
echo fixture > "$p/tree/t/new.test"
out="$("$SCRIPT" run "$WT" b "$p")"
[ "$(echo "$out" | json 'd["exit"]')" = 3 ] || fail "tree exit: $out"
[ "$(echo "$out" | json 'd["lines"]')" = 52 ] || fail "tree lines: $out"
[ "$(echo "$out" | json 'len(d["output"].splitlines())')" = 40 ] || fail "tree output is not the last 40 lines: $out"
[ "$(echo "$out" | json 'd["output"].splitlines()[-1]')" = line50 ] || fail "tree output end: $out"
[ "$(cat "$B/t/new.test")" = fixture ] || fail "the probe's tree was not copied"
[ ! -e "$WT/t" ] || fail "the probe's tree reached the run"
out="$("$SCRIPT" run "$WT" b "$(probe b where 'pwd')")"
[ "$(echo "$out" | json 'd["output"]')" = "$B" ] || fail "run.sh did not run at the seat's root: $out"
echo "ok: run copies the probe's tree over the snapshot, runs run.sh at the seat's root, and prints its exit and its last 40 lines"

setup
dirty
"$SCRIPT" run "$WT" a "$(probe a first 'echo repro > repro.sh; mkdir -p node_modules; echo dep > node_modules/y; echo edit > a; echo mine > d')" > /dev/null
echo three > "$WT/a"
echo fromrun > "$WT/d"
out="$("$SCRIPT" run "$WT" a "$(probe a second 'cat a d')")"
[ "$(echo "$out" | json 'd["output"].splitlines()')" = "['three', 'fromrun']" ] || fail "second run: $out"
[ ! -e "$A/repro.sh" ] || fail "second run kept an untracked file of the first"
[ "$(cat "$A/node_modules/y")" = dep ] || fail "second run removed an ignored file"
[ "$(cat "$A/a")" = three ] || fail "second run kept a tracked edit: $(cat "$A/a")"
[ "$(cat "$A/d")" = fromrun ] || fail "second run kept an untracked file the tree holds: $(cat "$A/d")"
echo "ok: a second run removes what the first left untracked, restores a tracked edit, and keeps ignored files"

setup
printf '.env.local\n.env.other\n.worktreeinclude\n' >> "$MAIN/.git/info/exclude"
echo secret > "$MAIN/.env.local"
echo other > "$MAIN/.env.other"
echo /.env.local > "$MAIN/.worktreeinclude"
out="$("$SCRIPT" run "$WT" a "$(probe a env 'cat .env.local; git status --porcelain')")"
[ "$(echo "$out" | json 'd["exit"]')" = 0 ] && [ "$(echo "$out" | json 'd["output"]')" = secret ] || fail "seat env: $out"
[ ! -e "$A/.env.other" ] || fail "seat a holds an unlisted file"
echo "ok: a new seat worktree holds the listed ignored files"

setup
dirty
p="$(probe a same 'true')"
first="$("$SCRIPT" run "$WT" a "$p" | json 'd["snapshot"]')"
second="$("$SCRIPT" run "$WT" b "$p" | json 'd["snapshot"]')"
[ "$first" = "$second" ] || fail "the same tree gave two snapshots: $first $second"
echo "ok: the same tree gives the same snapshot"

setup
dirty
p="$(probe a tree 'cat a')"
out="$("$SCRIPT" run "$WT" a "$p")"
[ "$(echo "$out" | json 'd["output"]')" = two ] || fail "first tree: $out"
before="$(echo "$out" | json 'd["snapshot"]')"
echo four > "$WT/a"
out="$("$SCRIPT" run "$WT" a "$p")"
[ "$(echo "$out" | json 'd["output"]')" = four ] || fail "changed tree: $out"
[ "$(echo "$out" | json 'd["snapshot"]')" != "$before" ] || fail "changed tree kept the snapshot"
echo "ok: run after the working tree changed runs on the new tree"

setup
echo side > "$WT/a"
git -C "$WT" commit -q -am side
git -C "$MAIN" branch other HEAD
git -C "$MAIN" checkout -q other
echo other > "$MAIN/a"
git -C "$MAIN" commit -q -am other
git -C "$WT" merge -q "other" > /dev/null 2>&1 && fail "the merge did not conflict"
[ -f "$MAIN/.git/worktrees/wf-test/MERGE_HEAD" ] || fail "no merge in progress"
out="$("$SCRIPT" run "$WT" a "$(probe a merge 'git diff --name-only --diff-filter=U; head -1 a')")"
[ "$(echo "$out" | json 'd["status"]')" = ran ] || fail "merge run status: $out"
[ -f "$MAIN/.git/worktrees/wf-test/MERGE_HEAD" ] || fail "run removed MERGE_HEAD"
[ -n "$(git -C "$WT" diff --name-only --diff-filter=U)" ] || fail "run resolved the conflict in the run"
echo "ok: run during a merge in progress leaves MERGE_HEAD in place"

setup
dirty
p="$(probe a ok 'true')"
out="$("$SCRIPT" run "$WT" a "$TMP")"
[ "$(echo "$out" | json 'd["reason"]')" = outside ] || fail "outside reason: $out"
mkdir -p "$WT/work-reports-x"
out="$("$SCRIPT" run "$WT" a "$WT/work-reports-x")"
[ "$(echo "$out" | json 'd["reason"]')" = outside ] || fail "outside prefix reason: $out"
mkdir -p "$REPORT/seats/a/empty"
out="$("$SCRIPT" run "$WT" a "$REPORT/seats/a/empty")"
[ "$(echo "$out" | json 'd["reason"]')" = no-script ] || fail "no-script reason: $out"
echo stale > "$MAIN/.git/panel-wf-test-a.lock"
out="$("$SCRIPT" run "$WT" a "$p")"
[ "$(echo "$out" | json 'd["status"]')" = ran ] || fail "a lock file nobody holds stopped a run: $out"
slow="$(probe a slow 'sleep 3')"
"$SCRIPT" run "$WT" a "$slow" > "$TMP/slow.out" &
slowpid=$!
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  [ -f "$A/.git" ] && sleep 0.5 && break
  sleep 0.2
done
out="$("$SCRIPT" run "$WT" a "$p")"
[ "$(echo "$out" | json 'd["reason"]')" = busy ] || fail "busy reason: $out"
out="$("$SCRIPT" run "$WT" b "$p")"
[ "$(echo "$out" | json 'd["status"]')" = ran ] || fail "seat b was held by the lock of seat a: $out"
wait "$slowpid"
[ "$(json 'd["status"]' < "$TMP/slow.out")" = ran ] || fail "the holding run did not finish: $(cat "$TMP/slow.out")"
out="$("$SCRIPT" run "$WT" a "$(probe a fails 'exit 7')")"
[ "$(echo "$out" | json 'd["exit"]')" = 7 ] || fail "failing probe exit: $out"
out="$("$SCRIPT" run "$WT" a "$p")"
[ "$(echo "$out" | json 'd["status"]')" = ran ] || fail "a failing run kept its seat: $out"
out="$("$SCRIPT" run "$TMP" a "$p")"
[ "$(echo "$out" | json 'd["reason"]')" = unknown ] || fail "unknown reason: $out"
"$SCRIPT" run "$WT" c "$p" > /dev/null 2>&1 && fail "run accepted a seat c"
echo "ok: run stops with outside, no-script, busy and unknown, a lock file nobody holds is no lock, and a run that ended frees its seat"

setup
dirty
p="$(probe a ok 'true')"
"$SCRIPT" run "$WT" a "$p" > /dev/null
rm "$A/.git"
echo mainedit > "$MAIN/a"
branch_before="$(git -C "$MAIN" rev-parse --abbrev-ref HEAD)"
"$SCRIPT" run "$WT" a "$p" > /dev/null 2>&1 && fail "run accepted a seat without .git"
[ "$(git -C "$MAIN" rev-parse --abbrev-ref HEAD)" = "$branch_before" ] || fail "run moved the main clone off its branch"
[ "$(cat "$MAIN/a")" = mainedit ] || fail "run overwrote the main clone: $(cat "$MAIN/a")"
echo "ok: a seat whose .git is gone is refused, and run leaves the main clone alone"

setup
out="$("$SCRIPT" close "$WT")"
[ "$(echo "$out" | json 'd["status"]')" = closed ] || fail "close none status: $out"
[ "$(echo "$out" | json 'd["removed"]')" = "[]" ] || fail "close none removed: $out"
dirty
p="$(probe a ok 'echo repro > repro.sh')"
"$SCRIPT" run "$WT" a "$p" > /dev/null
"$SCRIPT" run "$WT" b "$p" > /dev/null
out="$("$SCRIPT" close "$WT")"
[ "$(echo "$out" | json 'd["removed"]')" = "['$A', '$B']" ] || fail "close removed: $out"
[ ! -e "$A" ] && [ ! -e "$B" ] || fail "close left a seat"
git worktree list --porcelain | grep -q review- && fail "close left a registered seat"
[ -d "$WT" ] || fail "close removed the run's worktree"
echo "ok: close removes seats a and b, and prints an empty list when there is none"

setup
dirty
p="$(probe a ok 'true')"
"$SCRIPT" run "$WT" a "$p" > /dev/null
out="$("$SCRIPT" close "$WT")"
[ "$(echo "$out" | json 'd["removed"]')" = "['$A']" ] || fail "close lone seat a removed: $out"
[ ! -e "$A" ] || fail "close left seat a"
git worktree list --porcelain | grep -q review- && fail "close left a registered seat"
echo "ok: close removes a lone seat a"

setup
p="$(probe a ok 'true')"
"$SCRIPT" run "$WT" a "$p" > /dev/null
"$SCRIPT" run "$WT" b "$p" > /dev/null
git -C "$MAIN" worktree remove --force "$WT"
out="$("$SCRIPT" close "$WT")"
[ "$(echo "$out" | json 'd["removed"]')" = "['$A', '$B']" ] || fail "close after gone removed: $out"
[ ! -e "$A" ] && [ ! -e "$B" ] || fail "close after gone left a seat"
git worktree list --porcelain | grep -q review- && fail "close after gone left a registered seat"
echo "ok: close after the run's worktree is gone still removes the seats"

setup
dirty
p="$(probe a ok 'true')"
out="$("$SCRIPT" run "$WT/" a "$p")"
[ "$(echo "$out" | json 'd["status"]')" = ran ] || fail "trailing slash run: $out"
[ -d "$A" ] && [ ! -e "$WT/review--a" ] || fail "a seat landed in the wrong place"
out="$("$SCRIPT" close "$WT/")"
[ "$(echo "$out" | json 'd["removed"]')" = "['$A']" ] || fail "trailing slash close: $out"
"$SCRIPT" run "relative/wt" a "$p" > /dev/null 2>&1 && fail "run accepted a relative path"
"$SCRIPT" open "$WT" > /dev/null 2>&1 && fail "open is still accepted"
"$SCRIPT" run "$WT" a > /dev/null 2>&1 && fail "run accepted three arguments"
echo "ok: a trailing slash in <WT> changes nothing, a relative <WT> and a wrong argument count are refused"

setup
dirty
p="$(probe a finding 'test "$(cat a)" = fixed || { echo "a is $(cat a)"; exit 1; }')"
command="$SCRIPT run $WT a $p"
out="$($command)"
[ "$(echo "$out" | json 'd["exit"]')" = 1 ] || fail "finding did not fail: $out"
[ "$(echo "$out" | json 'd["output"]')" = "a is two" ] || fail "finding output: $out"
again="$($command)"
[ "$(echo "$again" | json '[d["exit"], d["output"]]')" = "$(echo "$out" | json '[d["exit"], d["output"]]')" ] || fail "the main session's rerun differs: $again"
echo fixed > "$WT/a"
fixedrun="$($command)"
[ "$(echo "$fixedrun" | json 'd["exit"]')" = 0 ] || fail "the worker's rerun after the fix did not pass: $fixedrun"
echo "ok: a finding end to end: a probe that fails, the same line again, a change in the run's worktree, the same line passing"

setup
dirty
slow="$(probe a slow 'sleep 1')"
"$SCRIPT" run "$WT" a "$slow" > /dev/null
for trial in 1 2 3 4 5 6 7 8; do
  "$SCRIPT" run "$WT" a "$slow" > "$TMP/one.out" 2>&1 &
  first=$!
  "$SCRIPT" run "$WT" a "$slow" > "$TMP/two.out" 2>&1 &
  second=$!
  wait "$first" || fail "trial $trial: a run of two at once exited non-zero: $(cat "$TMP/one.out")"
  wait "$second" || fail "trial $trial: a run of two at once exited non-zero: $(cat "$TMP/two.out")"
  statuses="$(json 'd["status"] + ":" + d.get("reason", "")' < "$TMP/one.out") $(json 'd["status"] + ":" + d.get("reason", "")' < "$TMP/two.out")"
  case "$statuses" in
    "ran: stop:busy"|"stop:busy ran:") ;;
    *) fail "trial $trial: two runs of one seat at once gave: $statuses" ;;
  esac
done
echo "ok: two runs of one seat started together give one ran and one busy, eight times"

setup
out="$("$SCRIPT" begin "$WT" --level high --source default)"
[ "$(echo "$out" | json 'd["status"]')" = ok ] || fail "begin status: $out"
start="$(echo "$out" | json 'd["start"]')"
[ "$start" = "$(git -C "$WT" rev-parse HEAD)" ] || fail "begin start is not HEAD: $out"
workdir="$(echo "$out" | json 'd["workdir"]')"
case "$workdir" in
  "$WT"/work-reports/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]-"${start:0:7}") ;;
  *) fail "begin workdir: $workdir" ;;
esac
[ -d "$workdir/review" ] && [ -d "$workdir/seats" ] && [ -f "$workdir/run.json" ] || fail "begin did not make review/, seats/ and run.json"
read_back="$("$SCRIPT" status "$WT")"
[ "$(echo "$read_back" | json '[d["status"], d["start"], d["workdir"], d["level"], d["source"], d["issue"], d["parent"]]')" = "['ok', '$start', '$workdir', 'high', 'default', None, None]" ] || fail "status after begin: $read_back"
echo "ok: begin makes the work directory with review/, seats/ and run.json, and status reads back what begin wrote"

setup
for given in "standard override" "high file"; do
  level="${given% *}"
  source="${given#* }"
  out="$("$SCRIPT" begin "$WT" --level "$level" --source "$source")"
  [ "$(echo "$out" | json '[d["level"], d["source"]]')" = "['$level', '$source']" ] || fail "begin output for $given: $out"
  [ "$(json '[d["level"], d["source"]]' < "$(echo "$out" | json 'd["workdir"]')/run.json")" = "['$level', '$source']" ] || fail "run.json for $given"
  read_back="$("$SCRIPT" status "$WT")"
  [ "$(echo "$read_back" | json '[d["level"], d["source"]]')" = "['$level', '$source']" ] || fail "status for $given: $read_back"
done
echo "ok: begin records the level and source it is given, unchanged, in run.json and in status"

refused() {
  local rc=0
  "$SCRIPT" "$@" > /dev/null 2>&1 || rc=$?
  [ "$rc" = 1 ] || fail "panel.sh $* exited $rc, not 1"
}

setup
"$SCRIPT" begin "$WT" --level high --source default --issue 12 --parent 88 > /dev/null
read_back="$("$SCRIPT" status "$WT")"
[ "$(echo "$read_back" | json '[d["issue"], d["parent"]]')" = "[12, 88]" ] || fail "status issue and parent: $read_back"
refused begin "$WT" --source default
refused begin "$WT" --level high
refused begin "$WT" --level 4 --source default
refused begin "$WT" --level 2 --source default
refused begin "$WT" --level high --source other
refused begin "$WT" --level high --source default --issue 12
refused begin relative/wt --level high --source default
echo "ok: begin writes --issue and --parent to run.json, and refuses a missing --level or --source, --level 4, --level 2, --source other, --issue without --parent and a relative <WT>"

setup
grep -vx 'work-reports/' "$MAIN/.git/info/exclude" > "$TMP/exclude"
cp "$TMP/exclude" "$MAIN/.git/info/exclude"
out="$("$SCRIPT" begin "$WT" --level high --source default)"
[ "$(echo "$out" | json 'd["reason"]')" = not-ignored ] || fail "not-ignored reason: $out"
[ ! -e "$WT/work-reports" ] || fail "begin wrote under work-reports/ when it is not ignored"
echo "ok: begin stops with not-ignored and writes nothing when work-reports/ is not ignored"

setup
echo side > "$WT/a"
git -C "$WT" commit -q -am side
before_merge="$(git -C "$WT" rev-parse HEAD)"
git -C "$MAIN" branch other HEAD
git -C "$MAIN" checkout -q other
echo other > "$MAIN/a"
git -C "$MAIN" commit -q -am other
git -C "$WT" merge -q "other" > /dev/null 2>&1 && fail "the merge did not conflict"
[ -f "$MAIN/.git/worktrees/wf-test/MERGE_HEAD" ] || fail "no merge in progress"
out="$("$SCRIPT" begin "$WT" --level high --source default)"
[ "$(echo "$out" | json 'd["start"]')" = "$before_merge" ] || fail "begin during a merge: $out"
[ -f "$MAIN/.git/worktrees/wf-test/MERGE_HEAD" ] || fail "begin removed MERGE_HEAD"
echo "ok: begin during a merge in progress takes the commit the merge started on"

for try in 1 2 3; do
  setup
  first="$("$SCRIPT" begin "$WT" --level high --source default | json 'd["workdir"]')"
  sum_before="$(cksum < "$first/run.json")"
  second="$("$SCRIPT" begin "$WT" --level standard --source override | json 'd["workdir"]')"
  [ "$second" = "$first-2" ] && break
  [ "$try" != 3 ] || fail "a second begin made $second, not $first-2"
done
[ "$(cksum < "$first/run.json")" = "$sum_before" ] || fail "the second begin changed the first run.json"
[ "$("$SCRIPT" status "$WT" | json 'd["workdir"]')" = "$second" ] || fail "status did not read the second begin"
echo "ok: a second begin on the same commit in the same minute makes <name>-2, and status reads the second"

setup
workdir="$("$SCRIPT" begin "$WT" --level high --source default | json 'd["workdir"]')"
later="$WT/work-reports/9999-12-31-2359-fffffff"
mkdir -p "$later" "$WT/work-reports/9999-12-31-2359-design"
echo '{"start": "fffffff", "level": "standard", "source": "file", "issue": null, "parent": null}' > "$later/run.json"
touch -t 200001010000 "$later/run.json"
read_back="$("$SCRIPT" status "$WT")"
[ "$(echo "$read_back" | json 'd["workdir"]')" = "$workdir" ] || fail "status past a later name: $read_back"
echo "ok: status reads the run.json written last, past a later name and past directories with no run.json"

setup
out="$("$SCRIPT" status "$WT")"
[ "$(echo "$out" | json 'd["reason"]')" = no-run ] || fail "no-run reason: $out"
out="$("$SCRIPT" begin "$TMP" --level high --source default)"
[ "$(echo "$out" | json 'd["reason"]')" = unknown ] || fail "begin unknown reason: $out"
echo "ok: status stops with no-run when no directory holds a run.json, and begin stops with unknown outside a worktree"

REVIEW_FILES="$(cd "$(dirname "$SCRIPT")/.." && pwd)/review-files.md"
CMD='`/abs/skills/workflow/scripts/panel.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/probe`'

write() {
  mkdir -p "$(dirname "$1")"
  cat > "$1"
}

passes() {
  local out
  out="$("$SCRIPT" lint "$1")"
  [ "$(echo "$out" | json '[d["status"], d["ok"], d["kind"], d["reasons"]]')" = "['ok', True, '$2', []]" ] || fail "lint $1: $out"
}

gives() {
  local out
  out="$("$SCRIPT" lint "$1")"
  [ "$(echo "$out" | json '[d["ok"], d["reasons"]]')" = "[False, $2]" ] || fail "lint $1 did not give $2: $out"
}

swap() {
  python3 -c '
import sys
path, pairs = sys.argv[1], sys.argv[2:]
text = open(path, encoding="utf-8").read()
for old, new in zip(pairs[::2], pairs[1::2]):
    if text.count(old) != 1:
        sys.exit("%r is not in %s once" % (old, path))
    text = text.replace(old, new)
open(path, "w", encoding="utf-8").write(text)
' "$@"
}

breaks() {
  local file="$1" reason="$2" good out
  shift 2
  good="$(cat "$file")"
  swap "$file" "$@" || fail "cannot break $file for $reason"
  out="$("$SCRIPT" lint "$file")"
  [ "$(echo "$out" | json '[d["ok"], d["reasons"]]')" = "[False, ['$reason']]" ] || fail "lint $file did not give only $reason: $out"
  printf '%s\n' "$good" > "$file"
  passes "$file" "$(echo "$out" | json 'd["kind"]')"
}

evidence_file() {
  write "$1" <<EOF
# Evidence

## Acceptance criteria

- the tests pass
  - ran: bash tests/run.sh
  - saw: ok
- the browser flow works
  - not run: no browser here

## Flows

- sign out, then sign in again
  - ran: bash tests/signin.sh
  - saw: 3 passed

## Reproduced first

- ran: bash tests/retry.sh before the fix
  - saw: FAIL stops at zero attempts
EOF
}

seat_file() {
  local findings="None."
  [ "${2:-}" = none ] || findings="$(printf '### 1. the cache keeps a stale value\n\nCommand: %s\nPrinted: exit 1, stale\nRequired: the value is fresh' "$CMD")"
  write "$1" <<EOF
# Seat

## Findings

$findings

## Not run

None.
${3:-}
EOF
}

WALK='
## Walk

- the tests pass
  - ran: bash tests/run.sh
  - saw: ok
- the browser flow works
  - not run: no browser here'

finding() {
  printf '### %s the cache keeps a stale value\n\nFound by: a, b\nCommand: %s\nPrinted: exit 1, stale\nRequired: the value is fresh\nBreaks: the second sign-in shows the old value\n' "$1" "$CMD"
}

round_file() {
  write "$(dirname "$(dirname "$1")")/drafts/$(basename "$1")" <<EOF
# Draft

## Earlier findings

$2

## New findings

$3

## Dropped

- a: none
- b: none
EOF
  write "$1" <<EOF
# Round

Seats: a on opus, b on fable

## Earlier findings

$2

## New findings

$3

## Dropped

- a: none
- b: none

## Not run

None.

## Verdict

$4
EOF
}

reply_file() {
  local path="$1"
  shift
  { echo "# Reply"; echo; printf '%s\n' "$@"; } | write "$path"
}

FIXED="fixed: the cache is cleared on sign-out. ran: $CMD; saw: exit 0"

D="$TMP/lint/examples/review"
mkdir -p "$D"
python3 -c '
import os, re, sys
names = {"# Task 2, evidence": "task-2-evidence.md", "# Task 2, round 1, seat a": "task-2-round-1-a.md",
         "# Task 2, round 2": "task-2-round-2.md", "# Task 2, round 2, reply": "task-2-round-2-reply.md",
         "# task-2, round 2, draft": "../drafts/task-2-round-2.md"}
text = open(sys.argv[1], encoding="utf-8").read()
for block in re.findall(r"^```markdown\n(.*?)^```$", text, re.S | re.M):
    title = block.split("\n", 1)[0]
    if title in names:
        path = os.path.join(sys.argv[2], names[title])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w", encoding="utf-8").write(block)
' "$REVIEW_FILES" "$D"
round_file "$D/task-2-round-1.md" None. "$(finding R1.1; echo; finding R1.2)" changes-requested
passes "$D/task-2-round-1.md" round
passes "$D/task-2-evidence.md" evidence
passes "$D/task-2-round-1-a.md" seat
passes "$D/task-2-round-2.md" round
cp "$D/task-2-evidence.md" "$D/task-2-round-2-evidence.md"
passes "$D/task-2-round-2-reply.md" reply
echo "ok: lint passes the examples in review-files.md"

D="$TMP/lint/seat/review"
seat_file "$D/task-5-round-1-a.md"
passes "$D/task-5-round-1-a.md" seat
seat_file "$D/task-5-round-1-b.md" none
passes "$D/task-5-round-1-b.md" seat
seat_file "$D/integration-round-1-a.md" one "$WALK"
passes "$D/integration-round-1-a.md" seat
breaks "$D/task-5-round-1-a.md" sections "## Not run" "## Skipped"
breaks "$D/task-5-round-1-a.md" sections "# Seat" "Seat"
breaks "$D/task-5-round-1-b.md" sections "## Findings

None." "## Findings

none"
breaks "$D/task-5-round-1-a.md" sections "None." "None.

## Walk

- the tests pass
  - not run: no browser"
breaks "$D/integration-round-1-a.md" sections "## Walk" "## Walking"
breaks "$D/task-5-round-1-a.md" id "### 1. " "### 2. "
breaks "$D/task-5-round-1-a.md" id "### 1. " "### F1. "
breaks "$D/task-5-round-1-a.md" finding "Required: the value is fresh" ""
breaks "$D/task-5-round-1-a.md" finding "Printed: exit 1, stale" "Printed: exit 1, stale
Printed: again"
breaks "$D/task-5-round-1-a.md" command "/abs/wt a" "\$(pwd) a"
breaks "$D/task-5-round-1-a.md" command "$CMD" "${CMD//\`/}"
breaks "$D/task-5-round-1-a.md" command "/abs/wt a /abs/wt/work-reports" "/abs/wt a /abs/other/work-reports"
breaks "$D/task-5-round-1-a.md" command "/seats/a/probe" "/seats/a/probe extra"
breaks "$D/integration-round-1-a.md" entry "  - saw: ok
" ""
breaks "$D/integration-round-1-a.md" entry "  - not run: no browser here" "  - skipped"
echo "ok: lint names each reason of a seat file"

D="$TMP/lint/round/review"
round_file "$D/task-4-round-1.md" None. "$(finding R1.1; echo; finding R1.2)" changes-requested
reply_file "$D/task-4-round-1-reply.md" "- R1.1 $FIXED" "- R1.2 disagree: the value is meant to stay"
round_file "$D/task-4-round-2.md" "- R1.1 resolved
- R1.2 stands: ran: $CMD; saw: exit 1; the value has to go." "$(finding R2.1)" changes-requested
passes "$D/task-4-round-1.md" round
passes "$D/task-4-round-2.md" round
breaks "$D/task-4-round-2.md" sections "## Dropped" "## Skipped"
breaks "$D/task-4-round-2.md" sections "## Not run

None.
" "## Not run
"
breaks "$D/task-4-round-1.md" sections "## Earlier findings

None." "## Earlier findings"
breaks "$D/task-4-round-2.md" id "### R2.1 " "### R2.2 "
breaks "$D/task-4-round-2.md" id "### R2.1 " "### R1.3 "
breaks "$D/task-4-round-2.md" id "- R1.1 resolved" "- R1.1 resolved
- R1.9 resolved"
breaks "$D/task-4-round-1.md" id "## Earlier findings

None." "## Earlier findings

- R0.1 resolved"
breaks "$D/task-4-round-2.md" finding "Breaks: the second sign-in shows the old value" ""
breaks "$D/task-4-round-2.md" finding "Found by: a, b" "Found by: a and b"
breaks "$D/task-4-round-2.md" finding "Command: $CMD" "Command (seat a): $CMD"
breaks "$D/task-4-round-2.md" command "Command: $CMD" "Command: ${CMD//\`/}"
breaks "$D/task-4-round-2.md" command "Command: \`/abs/skills/workflow/scripts/panel.sh run /abs/wt a " "Command: \`/abs/skills/workflow/scripts/panel.sh run /abs/wt c "
breaks "$D/task-4-round-2.md" seats "Seats: a on opus, b on fable" ""
breaks "$D/task-4-round-2.md" seats "Seats: a on opus, b on fable" "Seats: a on opus
Seats: b on fable"
round_file "$D/task-4-round-7.md" None. None. changes-requested
gives "$D/task-4-round-7.md" "['no-round']"
breaks "$D/task-4-round-2.md" mark "- R1.1 resolved" "- R1.1 fine"
breaks "$D/task-4-round-2.md" mark "- R1.2 stands: ran:" "- R1.2 stands ran:"
breaks "$D/task-4-round-2.md" mark "- R1.1 resolved" "- R1.1 resolved;"
breaks "$D/task-4-round-2.md" earlier-missing "- R1.1 resolved
" ""
breaks "$D/task-4-round-2.md" verdict "

changes-requested" "

changes requested: R2.1"
breaks "$D/task-4-round-2.md" verdict "

changes-requested" "

changes-requested
approve"
swap "$D/task-4-round-2.md" "

changes-requested" "

approve" || fail "cannot approve task-4-round-2.md"
gives "$D/task-4-round-2.md" "['approve-open', 'approve-no-evidence']"
echo "ok: lint names each reason of a round file"

D="$TMP/lint/reply/review"
round_file "$D/task-3-round-1.md" None. "$(finding R1.1; echo; finding R1.2)" changes-requested
round_file "$D/task-3-round-2.md" "- R1.1 resolved
- R1.2 stands again: ran: $CMD; saw: exit 1; the value still stays" None. changes-requested
evidence_file "$D/task-3-round-1-evidence.md"
evidence_file "$D/task-3-round-2-evidence.md"
reply_file "$D/task-3-round-1-reply.md" "- R1.1 $FIXED" "  the second line of the answer" "- R1.2 disagree: the value is meant to stay"
reply_file "$D/task-3-round-2-reply.md" "- R1.2 fixed: assumed: both fixes took the value to come from the cache; ran: $CMD; saw: exit 0; the store is cleared too"
passes "$D/task-3-round-1-reply.md" reply
passes "$D/task-3-round-2-reply.md" reply
breaks "$D/task-3-round-1-reply.md" sections "the value is meant to stay" "the value is meant to stay

## Notes"
breaks "$D/task-3-round-1-reply.md" sections "# Reply" "Reply"
reply_file "$D/task-3-round-9-reply.md" "- R9.1 disagree: there is no such round"
gives "$D/task-3-round-9-reply.md" "['no-round']"
breaks "$D/task-3-round-1-reply.md" line "- R1.2 disagree:" "R1.3 disagree: a line with no dash
- R1.2 disagree:"
breaks "$D/task-3-round-1-reply.md" line "- R1.2 disagree:" "- R1.3 rejected: no such answer
- R1.2 disagree:"
breaks "$D/task-3-round-1-reply.md" line "# Reply
" "# Reply
  an indented line under no answer
"
breaks "$D/task-3-round-1-reply.md" missing "- R1.2 disagree:" "- R1.3 disagree:"
breaks "$D/task-3-round-2-reply.md" missing "- R1.2 fixed:" "- R1.1 fixed:"
breaks "$D/task-3-round-1-reply.md" ran "ran: $CMD; saw: exit 0" "checked it"
breaks "$D/task-3-round-1-reply.md" ran "; saw: exit 0" ""
breaks "$D/task-3-round-1-reply.md" ran "ran: $CMD; saw: exit 0" "checked it" "- R1.2 disagree:" "- R1.1 disagree: the rest of it
- R1.2 disagree:"
breaks "$D/task-3-round-2-reply.md" assumed "assumed: both fixes took the value to come from the cache; " ""
rm "$D/task-3-round-1-evidence.md"
gives "$D/task-3-round-1-reply.md" "['no-evidence']"
reply_file "$D/task-3-round-1-reply.md" "- R1.1 disagree: the value is meant to stay" "- R1.2 disagree: the value is meant to stay"
passes "$D/task-3-round-1-reply.md" reply
echo "ok: lint names each reason of a reply"

D="$TMP/lint/evidence/review"
evidence_file "$D/task-6-evidence.md"
evidence_file "$D/merge-round-2-evidence.md"
passes "$D/task-6-evidence.md" evidence
passes "$D/merge-round-2-evidence.md" evidence
breaks "$D/task-6-evidence.md" sections "## Flows" "## Shared state"
breaks "$D/task-6-evidence.md" sections "## Acceptance criteria" "## Criteria"
breaks "$D/task-6-evidence.md" sections "## Reproduced first

- ran: bash tests/retry.sh before the fix
  - saw: FAIL stops at zero attempts" "## Reproduced first"
breaks "$D/task-6-evidence.md" sections "## Flows" "## Reproduced first

None.

## Flows"
breaks "$D/task-6-evidence.md" entry "  - ran: bash tests/run.sh
" ""
breaks "$D/task-6-evidence.md" entry "  - not run: no browser here" "  - skipped: no browser here"
breaks "$D/task-6-evidence.md" entry "  - saw: 3 passed" "  saw: 3 passed"
breaks "$D/task-6-evidence.md" entry "- ran: bash tests/retry.sh before the fix" "- bash tests/retry.sh before the fix"
breaks "$D/task-6-evidence.md" entry "  - saw: FAIL stops at zero attempts" "  - ran: again"
echo "ok: lint names each reason of an evidence file"

D="$TMP/lint/approve-task/review"
round_file "$D/task-1-round-1.md" None. None. approve
gives "$D/task-1-round-1.md" "['approve-no-evidence']"
evidence_file "$D/task-1-evidence.md"
passes "$D/task-1-round-1.md" round
D="$TMP/lint/approve-fixed/review"
evidence_file "$D/task-1-evidence.md"
round_file "$D/task-1-round-1.md" None. "$(finding R1.1)" changes-requested
reply_file "$D/task-1-round-1-reply.md" "- R1.1 $FIXED"
round_file "$D/task-1-round-2.md" "- R1.1 resolved" None. approve
gives "$D/task-1-round-2.md" "['approve-no-evidence']"
evidence_file "$D/task-1-round-1-evidence.md"
passes "$D/task-1-round-2.md" round
rm "$D/task-1-round-1-evidence.md"
reply_file "$D/task-1-round-1-reply.md" "- R1.1 $FIXED" "- R1.1 disagree: the rest of it is meant"
gives "$D/task-1-round-2.md" "['approve-no-evidence']"
D="$TMP/lint/approve-disagree/review"
evidence_file "$D/task-1-evidence.md"
round_file "$D/task-1-round-1.md" None. "$(finding R1.1)" changes-requested
reply_file "$D/task-1-round-1-reply.md" "- R1.1 disagree: the value is meant to stay"
round_file "$D/task-1-round-2.md" "- R1.1 resolved: the value is meant to stay" None. approve
passes "$D/task-1-round-2.md" round
rm "$D/task-1-evidence.md"
gives "$D/task-1-round-2.md" "['approve-no-evidence']"
D="$TMP/lint/approve-integration/review"
round_file "$D/integration-round-1.md" None. None. approve
gives "$D/integration-round-1.md" "['approve-no-evidence']"
seat_file "$D/integration-round-1-a.md" none
gives "$D/integration-round-1.md" "['approve-no-evidence']"
seat_file "$D/integration-round-1-b.md" none "$WALK"
passes "$D/integration-round-1.md" round
D="$TMP/lint/approve-merge/review"
round_file "$D/merge-round-1.md" None. None. approve
gives "$D/merge-round-1.md" "['approve-no-evidence']"
evidence_file "$D/merge-evidence.md"
passes "$D/merge-round-1.md" round
D="$TMP/lint/approve-open/review"
evidence_file "$D/task-1-evidence.md"
round_file "$D/task-1-round-1.md" None. "$(finding R1.1)" approve
gives "$D/task-1-round-1.md" "['approve-open']"
round_file "$D/task-1-round-1.md" None. "$(finding R1.1)" changes-requested
reply_file "$D/task-1-round-1-reply.md" "- R1.1 disagree: the value is meant to stay"
round_file "$D/task-1-round-2.md" "- R1.1 stands: ran: $CMD; saw: exit 1; the value has to go." None. approve
gives "$D/task-1-round-2.md" "['approve-open']"
echo "ok: lint allows approve only with no finding open and the evidence of the latest code change"

D="$TMP/lint/drifted/review"
write "$D/../drafts/task-1-round-1.md" <<EOF
# task-1, round 1, draft

## Earlier findings

None.

## New findings

None.

## Dropped

- a: none
- b: none
EOF
write "$D/task-1-round-1.md" <<EOF
# Task 1, round 1

Seats: a on opus, b on fable

## Earlier findings

none

## New findings

### F1. the cache keeps a stale value

Command (seat a): ${CMD//\`/}
Printed: exit 1, stale
Required: the value is fresh

### F2. the store keeps a stale value

Command (seat a): ${CMD//\`/}
Printed: exit 1, stale
Required: the value is fresh

## Dropped

None.

## Not run

None.

## Verdict

changes requested: F1, F2
EOF
gives "$D/task-1-round-1.md" "['sections', 'id', 'finding', 'verdict']"
echo "ok: lint fails a round file whose ids, sections and verdict drifted"

D="$TMP/lint/flow/review"
evidence_file "$D/task-1-evidence.md"
passes "$D/task-1-evidence.md" evidence
seat_file "$D/task-1-round-1-a.md"
passes "$D/task-1-round-1-a.md" seat
seat_file "$D/task-1-round-1-b.md" none
passes "$D/task-1-round-1-b.md" seat
round_file "$D/task-1-round-1.md" None. "$(finding R1.1)" changes-requested
passes "$D/task-1-round-1.md" round
evidence_file "$D/task-1-round-1-evidence.md"
passes "$D/task-1-round-1-evidence.md" evidence
reply_file "$D/task-1-round-1-reply.md" "- R1.1 $FIXED"
passes "$D/task-1-round-1-reply.md" reply
seat_file "$D/task-1-round-2-a.md" none
passes "$D/task-1-round-2-a.md" seat
seat_file "$D/task-1-round-2-b.md" none
passes "$D/task-1-round-2-b.md" seat
round_file "$D/task-1-round-2.md" "- R1.1 resolved" None. approve
passes "$D/task-1-round-2.md" round
echo "ok: lint passes each file of a two-round review in the order it is written"

D="$TMP/lint/names/review"
out="$("$SCRIPT" lint "$D/task-1-evidence.md")"
[ "$(echo "$out" | json '[d["status"], d["reason"]]')" = "['stop', 'no-file']" ] || fail "lint of a missing file: $out"
mkdir -p "$D/task-1-round-1.md"
out="$("$SCRIPT" lint "$D/task-1-round-1.md")"
[ "$(echo "$out" | json '[d["status"], d["reason"]]')" = "['stop', 'no-file']" ] || fail "lint of a directory: $out"
echo "# Notes" | write "$D/notes.md"
out="$("$SCRIPT" lint "$D/notes.md")"
[ "$(echo "$out" | json '[d["status"], d["ok"], d["kind"], d["reasons"]]')" = "['ok', False, None, ['name']]" ] || fail "lint of notes.md: $out"
evidence_file "$D/integration-evidence.md"
gives "$D/integration-evidence.md" "['name']"
refused lint
refused lint relative.md
refused lint "$D/notes.md" "$D/notes.md"
echo "ok: lint stops on a missing file and names a file outside Names"

scoped() {
  local out
  out="$("$SCRIPT" status "$WT" "$1")"
  echo "$out" | json "$2"
}

setup
R="$("$SCRIPT" begin "$WT" --level high --source default | json 'd["workdir"]')/review"
plain="$("$SCRIPT" status "$WT")"
[ "$(echo "$plain" | json 'list(d)')" = "['status', 'start', 'workdir', 'level', 'source', 'issue', 'parent']" ] || fail "status without a scope: $plain"
[ "$(scoped task-1 '[d["scope"], d["round"], d["cap"], d["verdict"], d["open"], d["approve"]]')" = "['task-1', 1, False, None, [], {'allowed': False, 'why': ['approve-no-evidence']}]" ] || fail "status before round 1"
[ "$(scoped task-1 '[d["start"], d["level"], d["source"]]')" = "['$(git -C "$WT" rev-parse HEAD)', 'high', 'default']" ] || fail "status with a scope lost the run's keys"
evidence_file "$R/task-1-evidence.md"
[ "$(scoped task-1 'd["approve"]')" = "{'allowed': True, 'why': []}" ] || fail "status before round 1 with the evidence"
round_file "$R/task-1-round-1.md" None. "$(finding R1.1)
$(finding R1.2)" changes-requested
[ "$(scoped task-1 '[d["round"], d["cap"], d["verdict"], d["open"], d["approve"]]')" = "[2, False, 'changes-requested', [{'id': 'R1.1', 'stood': 0, 'reply': None}, {'id': 'R1.2', 'stood': 0, 'reply': None}], {'allowed': False, 'why': ['approve-open']}]" ] || fail "status after round 1"
evidence_file "$R/task-1-round-1-evidence.md"
reply_file "$R/task-1-round-1-reply.md" "- R1.1 $FIXED" "- R1.2 disagree: the value is meant to stay"
[ "$(scoped task-1 'd["open"]')" = "[{'id': 'R1.1', 'stood': 0, 'reply': 'fixed'}, {'id': 'R1.2', 'stood': 0, 'reply': 'disagree'}]" ] || fail "status after the reply to round 1"
round_file "$R/task-1-round-2.md" "- R1.1 resolved
- R1.2 stands: ran: $CMD; saw: exit 1; the value has to go." None. changes-requested
[ "$(scoped task-1 '[d["round"], d["verdict"], d["open"], d["approve"]]')" = "[3, 'changes-requested', [{'id': 'R1.2', 'stood': 1, 'reply': None}], {'allowed': False, 'why': ['approve-open']}]" ] || fail "status after round 2"
reply_file "$R/task-1-round-2-reply.md" "- R1.2 disagree: the value is meant to stay"
round_file "$R/task-1-round-3.md" "- R1.2 stands again: ran: $CMD; saw: exit 1; the value still has to go." None. changes-requested
[ "$(scoped task-1 '[d["round"], d["cap"], d["open"]]')" = "[4, False, [{'id': 'R1.2', 'stood': 2, 'reply': None}]]" ] || fail "status after round 3"
for bad in task-x task-0 review; do
  out="$("$SCRIPT" status "$WT" "$bad" 2>&1)" && fail "status $bad exited 0: $out"
  [ "$out" = "panel: no such scope: $bad" ] || fail "status $bad: $out"
done
refused status "$WT" task-1 task-2
refused status relative/wt task-1
echo "ok: status reports round, cap, verdict, open and approve for a scope"

rounds() {
  local scope="$1" r earlier
  for r in $(seq "$2" "$3"); do
    earlier=None.
    [ "$r" = 1 ] || earlier="- R$((r - 1)).1 resolved"
    round_file "$R/$scope-round-$r.md" "$earlier" "$(finding "R$r.1")" changes-requested
  done
}

setup
R="$("$SCRIPT" begin "$WT" --level high --source default | json 'd["workdir"]')/review"
for scope in task-1 integration merge; do
  rounds "$scope" 1 4
  [ "$(scoped "$scope" '[d["round"], d["cap"]]')" = "[5, False]" ] || fail "$scope cap after four rounds"
  rounds "$scope" 5 5
  [ "$(scoped "$scope" '[d["round"], d["cap"], d["verdict"]]')" = "[6, True, 'changes-requested']" ] || fail "$scope cap after five rounds"
  rounds "$scope" 6 6
  [ "$(scoped "$scope" '[d["round"], d["cap"]]')" = "[7, True]" ] || fail "$scope cap after six rounds"
  rm "$R/$scope-round-6.md"
  round_file "$R/$scope-round-5.md" "- R4.1 resolved" None. approve
  [ "$(scoped "$scope" '[d["round"], d["cap"], d["verdict"], d["open"]]')" = "[6, False, 'approve', []]" ] || fail "$scope cap when round 5 approves"
done
[ "$(scoped task-2 '[d["round"], d["cap"], d["verdict"], d["open"]]')" = "[1, False, None, []]" ] || fail "rounds of task-1 counted for task-2"
echo "ok: status counts the cap the same for task, integration and merge"

setup
R="$("$SCRIPT" begin "$WT" --level high --source default | json 'd["workdir"]')/review"
[ "$(scoped integration '[d["round"], d["verdict"], d["approve"]]')" = "[1, None, {'allowed': False, 'why': ['approve-no-evidence']}]" ] || fail "integration before round 1 with no seat file"
seat_file "$R/integration-round-1-a.md" none
[ "$(scoped integration 'd["approve"]')" = "{'allowed': False, 'why': ['approve-no-evidence']}" ] || fail "integration with a seat file and no walk"
seat_file "$R/integration-round-1-b.md" none "$WALK"
[ "$(scoped integration 'd["approve"]')" = "{'allowed': True, 'why': []}" ] || fail "integration with a walk"
[ ! -e "$R/integration-evidence.md" ] || fail "an evidence file was written"
echo "ok: status allows approve in integration round 1 from a walk"

setup
out="$("$SCRIPT" status "$WT" task-1)"
[ "$(echo "$out" | json 'd["reason"]')" = no-run ] || fail "status task-1 before begin: $out"
out="$("$SCRIPT" status "$WT" task-x 2>&1)" && fail "status task-x before begin exited 0: $out"
[ "$out" = "panel: no such scope: task-x" ] || fail "status task-x before begin: $out"
echo "ok: status refuses a bad scope before begin, and stops with no-run on a good one"

ran_line() { printf '`%s run %s %s %s`' "$SCRIPT" "$WT" "$1" "$2"; }

findings_file() {
  local path="$1" body="" n=0
  shift
  while [ $# -gt 0 ]; do
    n=$((n + 1))
    body="$body$(printf '### %d. %s\n\nCommand: %s\nPrinted: exit 1\nRequired: the design holds' "$n" "$1" "$2")

"
    shift 2
  done
  write "$path" <<EOF
# Seat

## Findings

${body:-None.}

## Not run

None.
EOF
}

round_from_draft() {
  python3 -c '
import sys
draft, out, verdict = sys.argv[1:]
lines = open(draft, encoding="utf-8").read().splitlines()
assert lines[0].endswith(", draft"), lines[0]
kept = [lines[0][:-len(", draft")], "", "Seats: a on opus, b on fable"]
for line in lines[1:]:
    kept.append(line)
    if line.startswith("Printed:"):
        kept += ["Required: the design holds", "Breaks: the flow fails"]
kept += ["", "## Not run", "", "None.", "", "## Verdict", "", verdict]
open(out, "w", encoding="utf-8").write("\n".join(kept) + "\n")
' "$1" "$2" "${3:-changes-requested}"
  passes "$2" round
}

verified() {
  "$SCRIPT" verify "$WT" "$1" > "$TMP/verify.out" || fail "verify $1 exited non-zero: $(cat "$TMP/verify.out")"
  json "$2" < "$TMP/verify.out"
}

setup
W="$("$SCRIPT" begin "$WT" --level high --source default | json 'd["workdir"]')"
R="$W/review"
fails="$(probe a fails "printf '%s\\n' 'the value is two' 'last \`tick\`' '' '   '; exit 1")"
later="$(probe a later 'echo fine')"
other="$(probe b other 'echo b sees it; exit 2')"
findings_file "$R/task-1-round-1-a.md" "the value is two" "$(ran_line a "$fails")" "the value is fine" "$(ran_line a "$later")"
findings_file "$R/task-1-round-1-b.md" "b sees it" "$(ran_line b "$other")"
passes "$R/task-1-round-1-a.md" seat
passes "$R/task-1-round-1-b.md" seat
[ "$(verified task-1 '[d["status"], d["scope"], d["round"], d["draft"], d["dropouts"], d["earlier"]]')" = "['ok', 'task-1', 1, '$W/drafts/task-1-round-1.md', [], []]" ] || fail "verify round 1: $(cat "$TMP/verify.out")"
[ "$(json '[[f["id"], f["seat"], f["number"], f["title"], f["exit"]] for f in d["new"]]' < "$TMP/verify.out")" = "[['R1.1', 'a', 1, 'the value is two', 1], ['R1.2', 'b', 1, 'b sees it', 2]]" ] || fail "verify new: $(cat "$TMP/verify.out")"
[ "$(json '[d["new"][0]["command"], d["new"][0]["output"].splitlines()[-1]]' < "$TMP/verify.out")" = "['${SCRIPT} run $WT a $fails', '   ']" ] || fail "verify new command and output: $(cat "$TMP/verify.out")"
[ "$(json '[[f["seat"], f["number"], f["title"], f["command"], f["why"]] for f in d["dropped"]]' < "$TMP/verify.out")" = "[['a', 2, 'the value is fine', '$SCRIPT run $WT a $later', 'exit-0']]" ] || fail "verify dropped: $(cat "$TMP/verify.out")"
cat > "$TMP/draft.want" <<EOF
# task-1, round 1, draft

## Earlier findings

None.

## New findings

### R1.1 the value is two

Found by: a
Command: $(ran_line a "$fails")
Printed: exit 1, \`\` last \`tick\` \`\`

### R1.2 b sees it

Found by: b
Command: $(ran_line b "$other")
Printed: exit 2, \`b sees it\`

## Dropped

- a: 1, the command exited 0, so the failure did not show (finding 2)
- b: none
EOF
diff "$TMP/draft.want" "$W/drafts/task-1-round-1.md" || fail "the draft of round 1 differs"
printf '%s\n' 'echo now it fails; exit 1' > "$later/run.sh"
[ "$(verified task-1 '[[f["id"], f["seat"], f["number"]] for f in d["new"]] + [d["dropped"]]')" = "[['R1.1', 'a', 1], ['R1.2', 'a', 2], ['R1.3', 'b', 1], []]" ] || fail "verify after the probe changed: $(cat "$TMP/verify.out")"
grep -qx '### R1.3 b sees it' "$W/drafts/task-1-round-1.md" || fail "the second verify did not overwrite the draft"
grep -qx -- '- a: none' "$W/drafts/task-1-round-1.md" || fail "the second verify kept the old dropped line"
round_from_draft "$W/drafts/task-1-round-1.md" "$R/task-1-round-1.md"
echo "ok: verify sorts the findings of both seats by the probe's exit"

setup
W="$("$SCRIPT" begin "$WT" --level high --source default | json 'd["workdir"]')"
R="$W/review"
findings_file "$R/task-1-round-1-a.md" "the value is two" "$(ran_line a "$(probe a fails 'echo two; exit 1')")"
[ "$(verified task-1 '[d["dropouts"], [f["id"] for f in d["new"]], d["dropped"]]')" = "[['b'], ['R1.1'], []]" ] || fail "verify with one seat file: $(cat "$TMP/verify.out")"
grep -qx -- '- b: no seat file' "$W/drafts/task-1-round-1.md" || fail "the draft does not name the missing seat file"
round_from_draft "$W/drafts/task-1-round-1.md" "$R/task-1-round-1.md"
[ "$(verified merge '[d["scope"], d["round"], d["draft"], d["dropouts"], d["new"], d["dropped"]]')" = "['merge', 1, '$W/drafts/merge-round-1.md', ['a', 'b'], [], []]" ] || fail "verify merge with no seat file: $(cat "$TMP/verify.out")"
[ "$(sed -n '/^## New findings/,/^## Dropped/p' "$W/drafts/merge-round-1.md" | grep -cx 'None.')" = 1 ] || fail "the merge draft's new findings do not read None."
grep -qx -- '- a: no seat file' "$W/drafts/merge-round-1.md" && grep -qx -- '- b: no seat file' "$W/drafts/merge-round-1.md" || fail "the merge draft does not name both seats"
echo "ok: verify lists a seat with no file as a dropout"
setup
W="$("$SCRIPT" begin "$WT" --level standard --source default | json 'd["workdir"]')"
R="$W/review"
findings_file "$R/task-1-round-1-a.md" "the value is two" "$(ran_line a "$(probe a fails 'echo two; exit 1')")"
[ "$(verified task-1 '[d["dropouts"], [f["id"] for f in d["new"]], d["dropped"]]')" = "[[], ['R1.1'], []]" ] || fail "verify at standard with seat a's file: $(cat "$TMP/verify.out")"
[ "$(sed -n '/^## Dropped/,$p' "$W/drafts/task-1-round-1.md")" = "## Dropped

- a: none" ] || fail "the draft's dropped at standard: $(cat "$W/drafts/task-1-round-1.md")"
round_from_draft "$W/drafts/task-1-round-1.md" "$R/task-1-round-1.md"
[ "$(verified merge 'd["dropouts"]')" = "['a']" ] || fail "verify merge at standard with no seat file: $(cat "$TMP/verify.out")"
grep -q -- '^- b:' "$W/drafts/merge-round-1.md" && fail "the merge draft at standard names seat b"
echo "ok: verify at standard reads seat a alone"

setup
W="$("$SCRIPT" begin "$WT" --level high --source default | json 'd["workdir"]')"
R="$W/review"
mkdir -p "$REPORT/seats/a/empty"
bare="$SCRIPT run $WT a $(probe a bare 'exit 1')"
findings_file "$R/task-1-round-1-a.md" "no script" "$(ran_line a "$REPORT/seats/a/empty")" "no backticks" "$bare" \
  "it fails" "$(ran_line a "$(probe a fails 'echo two; exit 1')")" "no script again" "$(ran_line a "$REPORT/seats/a/empty")"
[ "$(verified task-1 '[[f["number"], f["command"], f["why"]] for f in d["dropped"]]')" = "[[1, '$SCRIPT run $WT a $REPORT/seats/a/empty', 'no-script'], [2, '$bare', 'command'], [4, '$SCRIPT run $WT a $REPORT/seats/a/empty', 'no-script']]" ] || fail "verify dropped: $(cat "$TMP/verify.out")"
[ "$(json '[[f["id"], f["number"]] for f in d["new"]]' < "$TMP/verify.out")" = "[['R1.1', 3]]" ] || fail "verify new: $(cat "$TMP/verify.out")"
[ "$(sed -n '/^## Dropped/,$p' "$W/drafts/task-1-round-1.md")" = "## Dropped

- a: 2, the command could not be run again, no-script (findings 1, 4)
- a: 1, the command could not be run again, command (finding 2)
- b: no seat file" ] || fail "the draft's dropped: $(cat "$W/drafts/task-1-round-1.md")"
round_from_draft "$W/drafts/task-1-round-1.md" "$R/task-1-round-1.md"
echo "ok: verify drops a command that cannot be run again"

setup
W="$("$SCRIPT" begin "$WT" --level high --source default | json 'd["workdir"]')"
R="$W/review"
fixme="$(probe a fixme 'test "$(cat a)" = fixed || { echo "a is $(cat a)"; exit 1; }')"
still="$(probe a still 'echo still broken; exit 1')"
meant="$(probe a meant 'echo meant to be; exit 1')"
findings_file "$R/task-1-round-1-a.md" "a is not fixed" "$(ran_line a "$fixme")" "still broken" "$(ran_line a "$still")" "meant to be" "$(ran_line a "$meant")"
findings_file "$R/task-1-round-1-b.md"
[ "$(verified task-1 '[f["id"] for f in d["new"]]')" = "['R1.1', 'R1.2', 'R1.3']" ] || fail "verify round 1: $(cat "$TMP/verify.out")"
round_from_draft "$W/drafts/task-1-round-1.md" "$R/task-1-round-1.md"
evidence_file "$R/task-1-round-1-evidence.md"
reply_file "$R/task-1-round-1-reply.md" "- R1.1 $FIXED" "- R1.2 $FIXED" "- R1.3 disagree: the value is meant to stay"
echo fixed > "$WT/a"
findings_file "$R/task-1-round-2-a.md"
findings_file "$R/task-1-round-2-b.md"
[ "$(verified task-1 '[d["round"], [[f["id"], f["state"], f["exit"], f["reply"]] for f in d["earlier"]], d["new"]]')" = "[2, [['R1.1', 'resolved', 0, 'fixed'], ['R1.2', 'stands', 1, 'fixed'], ['R1.3', 'stands', 1, 'disagree']], []]" ] || fail "verify round 2: $(cat "$TMP/verify.out")"
[ "$(sed -n '/^## Earlier findings/,/^## New findings/p' "$W/drafts/task-1-round-2.md")" = "## Earlier findings

- R1.1 resolved: ran: $(ran_line a "$fixme"); saw: exit 0
- R1.2 stands: ran: $(ran_line a "$still"); saw: exit 1, \`still broken\`
- R1.3 stands: ran: $(ran_line a "$meant"); saw: exit 1, \`meant to be\`; reply: disagree

## New findings" ] || fail "the draft of round 2: $(cat "$W/drafts/task-1-round-2.md")"
round_from_draft "$W/drafts/task-1-round-2.md" "$R/task-1-round-2.md"
evidence_file "$R/task-1-round-2-evidence.md"
reply_file "$R/task-1-round-2-reply.md" "- R1.2 fixed: assumed: the value came from the cache; ran: $CMD; saw: exit 0" "- R1.3 disagree: the value is meant to stay"
findings_file "$R/task-1-round-3-a.md"
findings_file "$R/task-1-round-3-b.md"
[ "$(verified task-1 '[d["round"], [[f["id"], f["state"], f["reply"]] for f in d["earlier"]]]')" = "[3, [['R1.2', 'stands again', 'fixed'], ['R1.3', 'stands again', 'disagree']]]" ] || fail "verify round 3: $(cat "$TMP/verify.out")"
[ "$(sed -n '/^## Earlier findings/,/^## New findings/p' "$W/drafts/task-1-round-3.md")" = "## Earlier findings

- R1.2 stands again: ran: $(ran_line a "$still"); saw: exit 1, \`still broken\`
- R1.3 stands again: ran: $(ran_line a "$meant"); saw: exit 1, \`meant to be\`; reply: disagree

## New findings" ] || fail "the draft of round 3: $(cat "$W/drafts/task-1-round-3.md")"
round_from_draft "$W/drafts/task-1-round-3.md" "$R/task-1-round-3.md"
echo "ok: verify marks earlier findings resolved, stands and stands again"

setup
W="$("$SCRIPT" begin "$WT" --level high --source default | json 'd["workdir"]')"
R="$W/review"
gone="$(probe a gone 'echo two; exit 1')"
findings_file "$R/task-1-round-1-a.md" "the value is two" "$(ran_line a "$gone")"
verified task-1 'd["status"]' > /dev/null
round_from_draft "$W/drafts/task-1-round-1.md" "$R/task-1-round-1.md"
rm -r "$gone"
rc=0
"$SCRIPT" verify "$WT" task-1 > "$TMP/verify.out" 2> "$TMP/verify.err" || rc=$?
[ "$rc" = 1 ] || fail "verify with an earlier probe gone exited $rc: $(cat "$TMP/verify.out")"
case "$(cat "$TMP/verify.err")" in
  "panel: R1."*) ;;
  *) fail "verify with an earlier probe gone: $(cat "$TMP/verify.err")" ;;
esac
[ ! -e "$W/drafts/task-1-round-2.md" ] || fail "verify wrote a draft after an earlier probe was gone"
echo "ok: verify exits 1 when an earlier finding's probe is gone"

setup
out="$("$SCRIPT" verify "$WT" task-1)"
[ "$(echo "$out" | json '[d["status"], d["reason"]]')" = "['stop', 'no-run']" ] || fail "verify task-1 before begin: $out"
out="$("$SCRIPT" verify "$WT" task-x 2>&1)" && fail "verify task-x before begin exited 0: $out"
[ "$out" = "panel: no such scope: task-x" ] || fail "verify task-x before begin: $out"
refused verify "$WT"
refused verify "$WT" task-1 x
refused verify relative/wt task-1
echo "ok: verify refuses a bad scope before begin, and stops with no-run on a good one"

setup
W="$("$SCRIPT" begin "$WT" --level high --source default | json 'd["workdir"]')"
R="$W/review"
one="$(probe a one 'test "$(cat a)" = fixed || { echo one fails; exit 1; }')"
fine="$(probe a fine 'echo fine')"
two="$(probe b two 'echo two fails; exit 1')"
findings_file "$R/task-1-round-1-a.md" "one fails" "$(ran_line a "$one")" "fine" "$(ran_line a "$fine")"
findings_file "$R/task-1-round-1-b.md" "two fails" "$(ran_line b "$two")"
[ "$(verified task-1 '[[f["id"], f["seat"]] for f in d["new"]] + [[f["number"], f["why"]] for f in d["dropped"]]')" = "[['R1.1', 'a'], ['R1.2', 'b'], [2, 'exit-0']]" ] || fail "verify for the draft: $(cat "$TMP/verify.out")"
round_from_draft "$W/drafts/task-1-round-1.md" "$R/task-1-round-1.md"
breaks "$R/task-1-round-1.md" draft "Printed: exit 1, \`one fails\`" "Printed: exit 1, \`one failed\`"
breaks "$R/task-1-round-1.md" draft "$(ran_line a "$one")" "$(ran_line a "$fine")"
cp "$R/task-1-round-1.md" "$TMP/round-1.md"
swap "$R/task-1-round-1.md" "### R1.1 one fails

Found by: a
Command: $(ran_line a "$one")
Printed: exit 1, \`one fails\`
Required: the design holds
Breaks: the flow fails

" "" "### R1.2 two fails" "### R1.1 two fails" "Found by: b" "Found by: a, b" || fail "cannot merge the findings of round 1"
passes "$R/task-1-round-1.md" round
cp "$TMP/round-1.md" "$R/task-1-round-1.md"
evidence_file "$R/task-1-round-1-evidence.md"
reply_file "$R/task-1-round-1-reply.md" "- R1.1 fixed: a is fixed. ran: $(ran_line a "$one"); saw: exit 0" "- R1.2 disagree: two is meant to fail"
echo fixed > "$WT/a"
findings_file "$R/task-1-round-2-a.md"
findings_file "$R/task-1-round-2-b.md"
[ "$(verified task-1 '[[f["id"], f["state"], f["reply"]] for f in d["earlier"]]')" = "[['R1.1', 'resolved', 'fixed'], ['R1.2', 'stands', 'disagree']]" ] || fail "verify round 2 for the draft: $(cat "$TMP/verify.out")"
round_from_draft "$W/drafts/task-1-round-2.md" "$R/task-1-round-2.md"
breaks "$R/task-1-round-2.md" draft "- R1.1 resolved:" "- R1.1 stands:"
swap "$R/task-1-round-2.md" "- R1.2 stands:" "- R1.2 resolved:" || fail "cannot resolve R1.2"
grep -qx -- "- R1.2 resolved: ran: $(ran_line b "$two"); saw: exit 1, \`two fails\`; reply: disagree" "$R/task-1-round-2.md" || fail "R1.2 is not written resolved: $(cat "$R/task-1-round-2.md")"
passes "$R/task-1-round-2.md" round
mv "$W/drafts/task-1-round-2.md" "$TMP/draft-2.md"
gives "$R/task-1-round-2.md" "['draft']"
echo "ok: lint holds a round file to the draft"

setup
W="$("$SCRIPT" begin "$WT" --level high --source default | json 'd["workdir"]')"
R="$W/review"
quiet="$(probe a quiet 'exit 1')"
findings_file "$R/task-1-round-1-a.md" "it fails quietly" "$(ran_line a "$quiet")"
findings_file "$R/task-1-round-1-b.md"
verified task-1 'd["status"]' > /dev/null
round_from_draft "$W/drafts/task-1-round-1.md" "$R/task-1-round-1.md"
reply_file "$R/task-1-round-1-reply.md" "- R1.1 disagree: it is meant to fail"
findings_file "$R/task-1-round-2-a.md"
findings_file "$R/task-1-round-2-b.md"
[ "$(verified task-1 '[[f["id"], f["exit"], f["output"]] for f in d["earlier"]]')" = "[['R1.1', 1, '']]" ] || fail "verify round 2 for a quiet probe: $(cat "$TMP/verify.out")"
round_from_draft "$W/drafts/task-1-round-2.md" "$R/task-1-round-2.md"
breaks "$R/task-1-round-2.md" draft "; saw: exit 1;" "; saw: exit 17, \`segfault\`;"
breaks "$R/task-1-round-2.md" draft "; saw: exit 1;" "; saw: exit 10;"
echo "ok: lint holds the exit of a probe that printed nothing to the draft"

LEVEL_SH="$(dirname "$SCRIPT")/level.sh"

recorded() {
  "$SCRIPT" record "$WT" > "$TMP/record.out" || fail "record exited non-zero: $(cat "$TMP/record.out")"
  json "$1" < "$TMP/record.out"
}

reviewed() {
  R="$W/review"
  evidence_file "$R/task-1-evidence.md"
  round_file "$R/task-1-round-1.md" None. "$(finding R1.1; echo; finding R1.2)" changes-requested
  round_file "$R/task-1-round-2.md" "- R1.1 resolved
- R1.2 resolved" None. approve
  round_file "$R/task-2-round-1.md" None. "$(finding R1.1)" changes-requested
  seat_file "$R/integration-round-1-a.md" none "$WALK"
  round_file "$R/integration-round-1.md" None. "$(finding R1.1)" changes-requested
  round_file "$R/integration-round-2.md" "- R1.1 resolved" None. approve
  round_file "$R/merge-round-1.md" None. "$(finding R1.1)" changes-requested
  seat_file "$R/task-1-round-1-a.md"
  reply_file "$R/task-1-round-1-reply.md" "- R1.1 disagree: meant" "- R1.2 disagree: meant"
  for f in "$R"/*-round-[0-9].md; do passes "$f" round; done
}

setup
W="$("$SCRIPT" begin "$WT" --level standard --source file --issue 3 --parent 1 | json 'd["workdir"]')"
reviewed
printf '## What changed\n\nthe body\n\n\n' > "$W/log.md"
LINE="Level: standard (file) · tasks 2 · task rounds 3 · integration rounds 2 · findings 4"
[ "$(recorded '[d["status"], d["line"]]')" = "['ok', '$LINE']" ] || fail "record: $(cat "$TMP/record.out")"
printf 'Implements #3\nPart of #1\n\n## What changed\n\nthe body\n\n%s\n' "$LINE" > "$TMP/log.want"
diff "$TMP/log.want" "$W/log.md" || fail "record: log.md is not the head, the body and the Level: line"
echo "ok: record: writes the head from --issue and --parent and the Level: line with the counts"

[ "$(recorded 'd["status"]')" = ok ] || fail "record twice: $(cat "$TMP/record.out")"
diff "$TMP/log.want" "$W/log.md" || fail "record twice: log.md changed"
[ "$(grep -c '^Implements ' "$W/log.md") $(grep -c '^Level: ' "$W/log.md")" = "1 1" ] || fail "record twice: $(cat "$W/log.md")"
echo "ok: record: run twice leaves one head and one Level: line"

printf 'Implements #99\n\nPart of #98\n\n## What changed\n\nthe body\n' > "$W/log.md"
[ "$(recorded 'd["status"]')" = ok ] || fail "record on a copied head: $(cat "$TMP/record.out")"
diff "$TMP/log.want" "$W/log.md" || fail "record on a copied head: log.md is not the head from run.json"
echo "ok: record: a head copied from another pull request is replaced"

mkdir -p "$TMP/bin"
printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$FX_GH_JSON"\n' > "$TMP/bin/gh"
chmod +x "$TMP/bin/gh"
gh_json="$(python3 -c '
import json, sys
print(json.dumps([{"number": 9, "url": "u9", "mergedAt": "2026-11-12T00:00:00Z", "body": open(sys.argv[1], encoding="utf-8").read()}]))
' "$W/log.md")"
out="$(FX_GH_JSON="$gh_json" PATH="$TMP/bin:$PATH" "$LEVEL_SH" history "$WT")" || fail "history exited non-zero: $out"
[ "$(echo "$out" | json '[d["since"]] + [(r["pr"], r["level"], r["source"], r["tasks"], r["taskRounds"], r["integrationRounds"], r["findings"]) for r in d["runs"]]')" = "[None, (9, 'standard', 'file', 2, 3, 2, 4)]" ] || fail "history did not read the recorded log.md back: $out"
echo "ok: record: level.sh history reads the recorded log.md back"

before="$(cksum < "$W/log.md")"
swap "$R/task-2-round-1.md" "### R1.1 the" "### F1. the"
[ "$(recorded '[d["status"], d["reason"], d["message"]]')" = "['stop', 'malformed', 'round files that fail lint: task-2-round-1.md: id']" ] || fail "record on a ### F1. finding: $(cat "$TMP/record.out")"
swap "$R/task-2-round-1.md" "### F1. the" "### R1.1 the"
swap "$R/merge-round-1.md" "changes-requested" "changes requested: R1.1"
[ "$(recorded '[d["reason"], d["message"]]')" = "['malformed', 'round files that fail lint: merge-round-1.md: verdict']" ] || fail "record on a merge round file: $(cat "$TMP/record.out")"
swap "$R/merge-round-1.md" "changes requested: R1.1" "changes-requested"
mv "$W/drafts/integration-round-2.md" "$TMP/draft.md"
[ "$(recorded '[d["reason"], d["message"]]')" = "['malformed', 'round files that fail lint: integration-round-2.md: draft']" ] || fail "record on a round file with no draft: $(cat "$TMP/record.out")"
mv "$TMP/draft.md" "$W/drafts/integration-round-2.md"
[ "$(cksum < "$W/log.md")" = "$before" ] || fail "record changed log.md on a malformed round file"
echo "ok: record: a round file that fails lint gives stop malformed and leaves log.md unchanged"

rm -r "$R"
[ "$(recorded '[d["status"], d["reason"]]')" = "['stop', 'no-review']" ] || fail "record without review/: $(cat "$TMP/record.out")"
[ "$(cksum < "$W/log.md")" = "$before" ] || fail "record without review/ changed log.md"
rm "$W/log.md"
mkdir "$R"
[ "$(recorded '[d["status"], d["reason"]]')" = "['stop', 'no-log']" ] || fail "record without log.md: $(cat "$TMP/record.out")"
[ ! -e "$W/log.md" ] || fail "record without log.md wrote one"
echo "ok: record: no log.md gives stop no-log, no review/ gives stop no-review"

setup
W="$("$SCRIPT" begin "$WT" --level high --source default | json 'd["workdir"]')"
printf 'Implements #7\r\n\r\nbody\r\nLevel: high (file) · tasks 1 · task rounds 1 · integration rounds 0 · findings 0\r\n' > "$W/log.md"
LINE="Level: high (default) · tasks 0 · task rounds 0 · integration rounds 0 · findings 0"
[ "$(recorded 'd["line"]')" = "$LINE" ] || fail "record standalone: $(cat "$TMP/record.out")"
printf 'Implements #7\r\n\r\nbody\n\n%s\n' "$LINE" > "$TMP/log.want"
cmp "$TMP/log.want" "$W/log.md" || fail "record standalone: the top of log.md moved: $(od -c "$W/log.md")"
echo "ok: record: without --issue the top of log.md is left alone"

setup
[ "$(recorded '[d["status"], d["reason"]]')" = "['stop', 'no-run']" ] || fail "record before begin: $(cat "$TMP/record.out")"
refused record
refused record relative/wt
refused record "$WT" extra
echo "ok: record: no run.json gives stop no-run, and a missing, relative or extra argument exits 1"
