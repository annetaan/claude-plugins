#!/usr/bin/env bash
# Test: panel.sh gives each review seat its own git worktree beside the run's worktree. open snapshots the working
# tree without touching it, sync re-points the seats and keeps what they hold, and close removes them.
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

setup
dirty
status_before="$(git -C "$WT" status --porcelain)"
index_before="$(git -C "$WT" diff --cached)"
out="$("$SCRIPT" open "$WT")"
[ "$(echo "$out" | json 'd["status"]')" = open ] || fail "open status: $out"
[ "$(echo "$out" | json 'd["head"]')" = "$(git -C "$WT" rev-parse HEAD)" ] || fail "open head: $out"
[ "$(echo "$out" | json 'd["mergeHead"]')" = None ] || fail "open mergeHead: $out"
[ "$(echo "$out" | json '[s["worktree"] for s in d["seats"]]')" = "['$A', '$B']" ] || fail "open seats: $out"
[ "$(git -C "$WT" status --porcelain)" = "$status_before" ] || fail "open changed the status of the run"
[ "$(git -C "$WT" diff --cached)" = "$index_before" ] || fail "open changed the index of the run"
snap="$(echo "$out" | json 'd["snapshot"]')"
[ "$(git -C "$WT" rev-parse "$snap^")" = "$(git -C "$WT" rev-parse HEAD)" ] || fail "snapshot parent"
for seat in "$A" "$B"; do
  [ "$(git -C "$seat" rev-parse HEAD)" = "$snap" ] || fail "$seat is not at the snapshot"
  [ "$(cat "$seat/a")" = two ] || fail "$seat a"
  [ "$(cat "$seat/c")" = staged ] || fail "$seat c"
  [ "$(cat "$seat/b")" = new ] || fail "$seat b"
  [ ! -e "$seat/node_modules" ] || fail "$seat holds an ignored file"
  [ -z "$(git -C "$seat" symbolic-ref -q HEAD || true)" ] || fail "$seat is not detached"
done
echo "ok: open leaves the run's status and index as they were, and each seat holds the changed and the untracked files and no ignored one"

setup
dirty
"$SCRIPT" open "$WT" > /dev/null
echo repro > "$A/repro.sh"
mkdir -p "$A/node_modules"
echo dep > "$A/node_modules/y"
echo edit > "$A/a"
out="$("$SCRIPT" open "$WT")"
[ "$(echo "$out" | json 'd["status"]')" = open ] || fail "reopen status: $out"
[ ! -e "$A/repro.sh" ] || fail "reopen kept an untracked repro"
[ "$(cat "$A/node_modules/y")" = dep ] || fail "reopen removed an ignored file"
[ "$(cat "$A/a")" = two ] || fail "reopen kept a tracked edit"
echo "ok: open on an existing seat removes its untracked files and keeps its ignored ones"

setup
dirty
"$SCRIPT" open "$WT" > /dev/null
echo repro > "$A/repro.sh"
mkdir -p "$A/node_modules"
echo dep > "$A/node_modules/y"
echo edit > "$A/a"
echo mine > "$A/d"
echo three > "$WT/a"
echo fromrun > "$WT/d"
out="$("$SCRIPT" sync "$WT")"
[ "$(echo "$out" | json 'd["status"]')" = synced ] || fail "sync status: $out"
[ "$(cat "$A/repro.sh")" = repro ] || fail "sync removed an untracked repro"
[ "$(cat "$A/node_modules/y")" = dep ] || fail "sync removed an ignored file"
[ "$(cat "$A/a")" = three ] || fail "sync kept a tracked edit: $(cat "$A/a")"
[ "$(cat "$A/d")" = fromrun ] || fail "sync kept an untracked file the new tree holds: $(cat "$A/d")"
[ "$(git -C "$B" rev-parse HEAD)" = "$(echo "$out" | json 'd["snapshot"]')" ] || fail "sync left seat b behind"
echo "ok: sync keeps a seat's untracked repro and ignored files, and overwrites a tracked edit and an untracked file the new tree holds"

setup
echo side > "$WT/a"
git -C "$WT" commit -q -am side
git -C "$MAIN" branch other HEAD
git -C "$MAIN" checkout -q other
echo other > "$MAIN/a"
git -C "$MAIN" commit -q -am other
side="$(git -C "$WT" rev-parse HEAD)"
git -C "$WT" merge -q "other" > /dev/null 2>&1 && fail "the merge did not conflict"
[ -f "$MAIN/.git/worktrees/wf-test/MERGE_HEAD" ] || fail "no merge in progress"
out="$("$SCRIPT" open "$WT")"
[ "$(echo "$out" | json 'd["mergeHead"]')" = "$(git -C "$MAIN" rev-parse other)" ] || fail "merge mergeHead: $out"
[ "$(echo "$out" | json 'd["head"]')" = "$side" ] || fail "merge head: $out"
[ -f "$MAIN/.git/worktrees/wf-test/MERGE_HEAD" ] || fail "open removed MERGE_HEAD"
[ -n "$(git -C "$WT" diff --name-only --diff-filter=U)" ] || fail "open resolved the conflict in the run"
echo "ok: open during a merge in progress prints mergeHead and leaves MERGE_HEAD in place"

setup
dirty
"$SCRIPT" open "$WT" > /dev/null
echo from-seat > "$A/c"
echo four > "$WT/a"
out="$(cd "$A" && "$SCRIPT" sync "$WT")"
[ "$(echo "$out" | json 'd["status"]')" = synced ] || fail "sync in seat status: $out"
[ "$(cat "$A/a")" = four ] || fail "sync in seat did not act on the argument: $(cat "$A/a")"
out="$(cd "$A" && "$SCRIPT" open "$WT")"
[ "$(echo "$out" | json 'd["status"]')" = open ] || fail "open in seat status: $out"
[ "$(echo "$out" | json 'd["head"]')" = "$(git -C "$WT" rev-parse HEAD)" ] || fail "open in seat head: $out"
[ "$(git -C "$WT" status --porcelain | wc -l | tr -d ' ')" = 3 ] || fail "open in seat changed the run: $(git -C "$WT" status --porcelain)"
echo "ok: open and sync run from inside a seat still act on the worktree named in the argument"

setup
dirty
out="$("$SCRIPT" sync "$WT")"
[ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "no-seat status: $out"
[ "$(echo "$out" | json 'd["reason"]')" = no-seat ] || fail "no-seat reason: $out"
[ ! -e "$A" ] || fail "sync created a seat"
"$SCRIPT" open "$WT" > /dev/null
rm -rf "$B"
out="$("$SCRIPT" sync "$WT")"
[ "$(echo "$out" | json 'd["reason"]')" = no-seat ] || fail "deleted seat reason: $out"
out="$("$SCRIPT" open "$WT")"
[ "$(echo "$out" | json 'd["status"]')" = open ] || fail "open after a deleted seat: $out"
[ -f "$B/a" ] || fail "open did not bring the deleted seat back"
out="$("$SCRIPT" open "$TMP")"
[ "$(echo "$out" | json 'd["reason"]')" = unknown ] || fail "unknown reason: $out"
echo "ok: sync without a seat stops with no-seat"

setup
out="$("$SCRIPT" close "$WT")"
[ "$(echo "$out" | json 'd["status"]')" = closed ] || fail "close none status: $out"
[ "$(echo "$out" | json 'd["removed"]')" = "[]" ] || fail "close none removed: $out"
dirty
"$SCRIPT" open "$WT" > /dev/null
echo repro > "$A/repro.sh"
out="$("$SCRIPT" close "$WT")"
[ "$(echo "$out" | json 'd["removed"]')" = "['$A', '$B']" ] || fail "close removed: $out"
[ ! -e "$A" ] && [ ! -e "$B" ] || fail "close left a seat"
git worktree list --porcelain | grep -q review- && fail "close left a registered seat"
[ -d "$WT" ] || fail "close removed the run's worktree"
echo "ok: close removes both seats, and prints an empty list when there is none"

setup
"$SCRIPT" open "$WT" > /dev/null
git -C "$MAIN" worktree remove --force "$WT"
out="$("$SCRIPT" close "$WT")"
[ "$(echo "$out" | json 'd["removed"]')" = "['$A', '$B']" ] || fail "close after gone removed: $out"
[ ! -e "$A" ] && [ ! -e "$B" ] || fail "close after gone left a seat"
git worktree list --porcelain | grep -q review- && fail "close after gone left a registered seat"
echo "ok: close after the run's worktree is gone still removes the seats"

setup
dirty
"$SCRIPT" open "$WT" > /dev/null
echo mainedit > "$MAIN/a"
rm "$A/.git"
branch_before="$(git -C "$MAIN" rev-parse --abbrev-ref HEAD)"
out="$("$SCRIPT" sync "$WT")"
[ "$(echo "$out" | json 'd["reason"]')" = no-seat ] || fail "broken seat sync reason: $out"
"$SCRIPT" open "$WT" > /dev/null 2>&1 && fail "open accepted a seat without .git"
[ "$(git -C "$MAIN" rev-parse --abbrev-ref HEAD)" = "$branch_before" ] || fail "open moved the main clone off its branch"
[ "$(cat "$MAIN/a")" = mainedit ] || fail "open overwrote the main clone: $(cat "$MAIN/a")"
echo "ok: a seat whose .git is gone is no seat, and open and sync leave the main clone alone"

setup
dirty
out="$("$SCRIPT" open "$WT/")"
[ "$(echo "$out" | json '[s["worktree"] for s in d["seats"]]')" = "['$A', '$B']" ] || fail "trailing slash seats: $out"
[ ! -e "$WT/review--a" ] || fail "a seat landed inside the run's worktree"
out="$("$SCRIPT" close "$WT/")"
[ "$(echo "$out" | json 'd["removed"]')" = "['$A', '$B']" ] || fail "trailing slash close: $out"
"$SCRIPT" open "relative/wt" > /dev/null 2>&1 && fail "open accepted a relative path"
echo "ok: a trailing slash in <WT> changes nothing, and a relative <WT> is refused"
