#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj4-running/scripts/run.sh"
SCRIPT="${RUN_SH:-$SCRIPT}"

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
  rm -rf "$TMP/work" "$TMP/check"
  git init -q "$TMP/work"
  MAIN="$(cd "$TMP/work" && pwd -P)"
  (
    cd "$MAIN"
    echo one > a
    git add a
    git commit -q -m init
    printf 'work-reports/\n.claude/worktrees/\n' >> .git/info/exclude
    git worktree add -q -b feat .claude/worktrees/pj-1 HEAD
  )
  WT="$MAIN/.claude/worktrees/pj-1"
  START="$(git -C "$WT" rev-parse HEAD)"
  mkdir -p "$WT/work-reports"
  cd "$MAIN"
}

dirty() {
  echo two > "$WT/a"
  git -C "$WT" commit -q -am "second"
  echo three >> "$WT/a"
  echo new > "$WT/b"
}

setup
dirty
out="$("$SCRIPT" save 1 --to "$WT/work-reports/stopped.diff" --since "$START")"
[ "$(echo "$out" | json 'd["status"]')" = saved ] || fail "status: $out"
[ "$(echo "$out" | json 'd["commits"]')" = 1 ] || fail "commits: $out"
[ "$(echo "$out" | json 'd["head"]')" = "$START" ] || fail "head: $out"
[ "$(echo "$out" | json 'd["errors"]')" = "[]" ] || fail "errors: $out"
git worktree add -q --detach "$TMP/check" "$START"
git -C "$TMP/check" apply "$WT/work-reports/stopped.diff"
[ "$(cat "$TMP/check/a")" = "$(printf 'two\nthree')" ] || fail "a after apply: $(cat "$TMP/check/a")"
[ "$(cat "$TMP/check/b")" = new ] || fail "b after apply"
echo "ok: save holds the commits and the uncommitted work in one diff that applies onto START"

setup
dirty
"$SCRIPT" save 1 --to "$WT/work-reports/stopped.diff" --since "$START" > /dev/null
[ "$(git -C "$WT" rev-parse HEAD)" = "$START" ] || fail "HEAD is not START"
git -C "$WT" symbolic-ref -q HEAD > /dev/null && fail "worktree is not detached"
git -C "$WT" rev-parse --verify --quiet refs/heads/feat > /dev/null && fail "branch feat is left"
[ -z "$(git -C "$WT" status --porcelain)" ] || fail "worktree is not clean: $(git -C "$WT" status --porcelain)"
git -C "$WT" switch -q --no-track -c next "$START" || fail "cannot make the next branch"
echo "ok: save leaves the worktree detached at START with the branch deleted"

setup
out="$("$SCRIPT" save 1 --to "$WT/work-reports/stopped.diff" --since "$START")"
[ "$(echo "$out" | json 'd["status"]')" = clean ] || fail "clean status: $out"
[ "$(echo "$out" | json 'd["commits"]')" = 0 ] || fail "clean commits: $out"
[ "$(echo "$out" | json 'd["branch"]')" = feat ] || fail "clean branch: $out"
git -C "$WT" rev-parse --verify --quiet refs/heads/feat > /dev/null && fail "clean left the branch"
[ ! -e "$WT/work-reports/stopped.diff" ] || fail "clean wrote a file"
echo "ok: save with nothing to save prints clean and deletes the branch"

setup
if "$SCRIPT" save 1 --to "$WT/work-reports/stopped.diff" 2> "$TMP/err"; then fail "save without --since succeeded"; fi
grep -q '^usage:' "$TMP/err" || fail "no usage on stderr: $(cat "$TMP/err")"
git -C "$WT" rev-parse --verify --quiet refs/heads/feat > /dev/null || fail "usage error touched the branch"
echo "ok: save without --since is a usage error"
