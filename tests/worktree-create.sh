#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/workflow/scripts/worktree.sh"
SCRIPT="${WORKTREE_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'chmod -R u+rwx "$TMP" 2>/dev/null || true; rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

fail() { echo "FAIL: $*" >&2; exit 1; }

json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }

RUNS=6

git init -q --bare -b main "$TMP/origin.git"
git init -q -b main "$TMP/work"
MAIN="$(cd "$TMP/work" && pwd -P)"
(
  cd "$MAIN"
  echo '.claude/worktrees/' > .gitignore
  echo readme > README.md
  git add .gitignore README.md
  git commit -q -m init
  git remote add origin "$TMP/origin.git"
  git push -q origin main
)
git clone -q "$TMP/origin.git" "$TMP/other"
(
  cd "$TMP/other"
  echo more >> README.md
  git commit -q -am more
  git push -q origin main
)
TIP="$(git -C "$TMP/other" rev-parse HEAD)"

cd "$MAIN"
for i in $(seq "$RUNS"); do
  bash "$SCRIPT" create main > "$TMP/out-$i" 2> "$TMP/err-$i" &
  echo $! > "$TMP/pid-$i"
done
for i in $(seq "$RUNS"); do
  wait "$(cat "$TMP/pid-$i")" || fail "create $i exited non-zero: $(cat "$TMP/err-$i") $(cat "$TMP/out-$i")"
done

for i in $(seq "$RUNS"); do
  out="$(cat "$TMP/out-$i")"
  [ "$(echo "$out" | json 'd["status"]')" = ready ] || fail "create $i status: $out"
  [ "$(echo "$out" | json 'd["head"]')" = "$TIP" ] || fail "create $i head is not origin's tip: $out"
done
echo "ok: $RUNS parallel creates against a moved origin all print ready on origin's tip"

names="$(for i in $(seq "$RUNS"); do json 'd["name"]' < "$TMP/out-$i"; done | sort)"
[ "$(echo "$names" | uniq | wc -l | tr -d ' ')" = "$RUNS" ] || fail "names are not distinct: $names"
echo "ok: the names are distinct"

listed="$(git -C "$MAIN" worktree list --porcelain)"
for i in $(seq "$RUNS"); do
  wt="$(json 'd["worktree"]' < "$TMP/out-$i")"
  name="$(json 'd["name"]' < "$TMP/out-$i")"
  echo "$listed" | grep -qx "worktree $wt" || fail "git worktree list misses $wt"
  gitdir="$(sed 's/^gitdir: //' "$wt/.git")"
  [ "$(basename "$gitdir")" = "$name" ] || fail "$name has the git dir $gitdir"
  [ -z "$(git -C "$wt" status --porcelain)" ] || fail "status of $wt is not empty"
done
[ -z "$(git -C "$MAIN" status --porcelain)" ] || fail "status of MAIN is not empty"
echo "ok: every worktree is listed, owns its git dir and is clean, and MAIN is clean"
