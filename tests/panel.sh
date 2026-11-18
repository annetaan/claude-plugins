#!/usr/bin/env bash
# Test: panel.sh run puts a review seat, a git worktree beside the run's worktree, at a snapshot of the run's working
# tree without touching the run, copies a probe's tree over it and runs the probe's run.sh there. close removes the seats.
#
# Run: bash tests/panel.sh   (exit 0 is success, anything else is failure)
# Runs offline, with git only. The clone is a temp repository with a worktree at .claude/worktrees/wf-test, and
# work-reports/, .claude/worktrees/ and node_modules/ are ignored through info/exclude.
# PANEL_SH=<path> tests another copy of panel.sh.
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

# probe <seat> <name> <run.sh text> makes the probe directory and prints its path.
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
echo "ok: close removes both seats, and prints an empty list when there is none"

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
