#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/workflow/scripts/worktree.sh"
SCRIPT="${WORKTREE_SH:-$SCRIPT}"
CLEANUP_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj-cleanup/scripts/cleanup.sh"
CLEANUP_SRC="${CLEANUP_SH:-$CLEANUP_SRC}"
PANEL_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/workflow/scripts/panel.sh"
PANEL_SRC="${PANEL_SH:-$PANEL_SRC}"

TMP="$(mktemp -d)"
trap 'chmod -R u+rwx "$TMP" 2>/dev/null || true; rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
git config --global protocol.file.allow always
git config --global init.defaultBranch main

fail() { echo "FAIL: $*" >&2; exit 1; }

json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }

exists() { [ -e "$1" ] || [ -L "$1" ]; }

setup() {
  rm -rf "$TMP/work" "$TMP/subsrc"
  git init -q "$TMP/subsrc"
  (cd "$TMP/subsrc" && echo one > f && git add f && git commit -q -m one && git tag v1)
  git init -q "$TMP/work"
  MAIN="$(cd "$TMP/work" && pwd -P)"
  (
    cd "$MAIN"
    echo 'work-reports/' > .gitignore
    echo '.claude/worktrees/' >> .gitignore
    echo readme > README.md
    git submodule -q add "$TMP/subsrc" sub
    git add .gitignore README.md
    git commit -q -m init
    git worktree add -q --detach .claude/worktrees/wf-test HEAD
  )
  WT="$MAIN/.claude/worktrees/wf-test"
  if [ "${1:-}" = init ]; then
    git -C "$WT" submodule -q update --init
  fi
  mkdir -p "$WT/work-reports/2026-01-01-0000-aaaaaaa"
  echo x > "$WT/work-reports/2026-01-01-0000-aaaaaaa/log.md"
  cd "$MAIN"
}

setup_pj() {
  rm -rf "$TMP/pj" "$TMP/subsrc"
  mkdir -p "$TMP/pj/skills/pj-cleanup/scripts" "$TMP/pj/skills/workflow/scripts" "$TMP/pj/skills/pj1-plan/scripts"
  cp "$CLEANUP_SRC" "$TMP/pj/skills/pj-cleanup/scripts/cleanup.sh"
  cp "${CLEANUP_SRC%.sh}.py" "$TMP/pj/skills/pj-cleanup/scripts/cleanup.py"
  cp "$SCRIPT" "$TMP/pj/skills/workflow/scripts/worktree.sh"
  cp "${SCRIPT%.sh}.py" "$TMP/pj/skills/workflow/scripts/worktree.py"
  cp "$PANEL_SRC" "$TMP/pj/skills/workflow/scripts/panel.sh"
  cp "${PANEL_SRC%.sh}.py" "$TMP/pj/skills/workflow/scripts/panel.py"
  cat > "$TMP/pj/skills/pj1-plan/scripts/project.sh" <<'FAKE'
#!/usr/bin/env bash
echo '{"parent":{"number":1,"title":"P","state":"CLOSED","base":"pj/1","from":"main","merged":true}}'
FAKE
  chmod +x "$TMP/pj/skills/pj-cleanup/scripts/cleanup.sh" "$TMP/pj/skills/workflow/scripts/worktree.sh" "$TMP/pj/skills/workflow/scripts/panel.sh" \
           "$TMP/pj/skills/pj1-plan/scripts/project.sh"
  CLEANUP="$TMP/pj/skills/pj-cleanup/scripts/cleanup.sh"
  git init -q "$TMP/subsrc"
  (cd "$TMP/subsrc" && echo one > f && git add f && git commit -q -m one && git tag v1)
  git init -q --bare "$TMP/pj/origin.git"
  git init -q -b main "$TMP/pj/work"
  MAIN="$(cd "$TMP/pj/work" && pwd -P)"
  (
    cd "$MAIN"
    echo 'work-reports/' > .gitignore
    echo '.claude/worktrees/' >> .gitignore
    echo readme > README.md
    git submodule -q add "$TMP/subsrc" sub
    git add .gitignore README.md
    git commit -q -m init
    git remote add origin "$TMP/pj/origin.git"
    git push -q origin main
    git worktree add -q --detach .claude/worktrees/pj-1 HEAD
  )
  WT="$MAIN/.claude/worktrees/pj-1"
  if [ "${1:-}" = init ]; then
    git -C "$WT" submodule -q update --init
  fi
  mkdir -p "$WT/work-reports/2026-01-01-0000-aaaaaaa"
  echo x > "$WT/work-reports/2026-01-01-0000-aaaaaaa/log.md"
  cd "$MAIN"
}

commit_in_sub() {
  git -C "$WT/sub" commit -q --allow-empty -m local
  git -C "$WT" add sub
  git -C "$WT" commit -q -m bump
}

seat_run() {
  local dir="$WT/work-reports/2026-01-01-0000-aaaaaaa/seats/$1/p"
  mkdir -p "$dir"
  echo 'echo repro > repro.sh' > "$dir/run.sh"
  "$PANEL_SRC" run "$WT" "$1" "$dir" > /dev/null
}

seats_gone() {
  local s
  for s in a b; do
    exists "$MAIN/.claude/worktrees/review-$1-$s" && return 1
    exists "$MAIN/.git/worktrees/review-$1-$s" && return 1
  done
  return 0
}

gone() { ! exists "$WT" && ! exists "$MAIN/.git/worktrees/${1:-wf-test}"; }

setup init
seat_run a
seat_run b
out="$("$SCRIPT" cleanup wf-test)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "seats cleanup status: $out"
[ "$(echo "$out" | json 'd["errors"]')" = "[]" ] || fail "seats cleanup errors: $out"
gone || fail "seats cleanup left the worktree"
seats_gone wf-test || fail "worktree.sh cleanup left a seat"
echo "ok: worktree.sh cleanup removes the seats beside a worktree with a submodule"

setup init
out="$("$SCRIPT" check wf-test)"
[ "$(echo "$out" | json 'd["loses"]')" = "[]" ] || fail "check loses: $out"
[ "$(echo "$out" | json 'd["worktree"]["submodules"]')" = "[]" ] || fail "check submodules: $out"
[ "$(echo "$out" | json 'd["worktree"]["hasSubmodules"]')" = True ] || fail "check hasSubmodules: $out"
echo "ok: worktree.sh check on a worktree with an initialized clean submodule has empty loses and submodules, and hasSubmodules"

setup init
out="$("$SCRIPT" cleanup wf-test)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "cleanup status: $out"
gone || fail "worktree or its git dir left"
exists "$MAIN/work-reports/2026-01-01-0000-aaaaaaa" || fail "work report not moved"
echo "ok: worktree.sh cleanup removes a worktree with an initialized clean submodule"

setup
out="$("$SCRIPT" check wf-test)"
[ "$(echo "$out" | json 'd["worktree"]["hasSubmodules"]')" = True ] || fail "uninit hasSubmodules: $out"
out="$("$SCRIPT" cleanup wf-test)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "uninit cleanup status: $out"
gone || fail "uninit worktree left"
echo "ok: worktree.sh cleanup removes a worktree whose submodule is not initialized"

setup init
echo dirty > "$WT/sub/new.txt"
out="$("$SCRIPT" cleanup wf-test)"
[ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "dirty status: $out"
[ "$(echo "$out" | json 'd["reason"]')" = discard ] || fail "dirty reason: $out"
[ "$(echo "$out" | json 'd["worktree"]["submodules"][0]["path"]')" = sub ] || fail "dirty path: $out"
[ "$(echo "$out" | json 'd["worktree"]["submodules"][0]["changes"]')" = "['?? new.txt']" ] || fail "dirty changes: $out"
exists "$WT/sub/new.txt" || fail "refused cleanup removed the file"
[ -d "$WT/work-reports/2026-01-01-0000-aaaaaaa" ] || fail "refused cleanup moved the report"
[ ! -e "$MAIN/work-reports" ] || fail "refused cleanup created work-reports in main"
echo "ok: worktree.sh cleanup refuses with discard when a submodule has an uncommitted change, and removes and moves nothing"

setup init
commit_in_sub
out="$("$SCRIPT" cleanup wf-test)"
[ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "commit status: $out"
[ "$(echo "$out" | json 'd["reason"]')" = discard ] || fail "commit reason: $out"
[ "$(echo "$out" | json 'd["worktree"]["state"]')" = clean ] || fail "commit state: $out"
[ "$(echo "$out" | json 'd["loses"]')" = "['submodules']" ] || fail "commit loses: $out"
[ "$(echo "$out" | json 'd["worktree"]["submodules"][0]["commits"]')" = 1 ] || fail "commit count: $out"
exists "$WT" || fail "refused cleanup removed the worktree"
echo "ok: worktree.sh cleanup refuses with discard when a submodule has a commit on no remote that the superproject records"

setup init
commit_in_sub
out="$("$SCRIPT" cleanup wf-test --discard)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "discard status: $out"
gone || fail "discard left the worktree"
echo "ok: worktree.sh cleanup --discard removes a worktree whose submodule holds work"

setup init
git -C "$WT/sub" commit -q --allow-empty -m tagged
git -C "$WT/sub" tag v2
git -C "$WT" add sub
git -C "$WT" commit -q -m bump
out="$("$SCRIPT" check wf-test)"
[ "$(echo "$out" | json 'd["loses"]')" = "[]" ] || fail "tag loses: $out"
[ "$(echo "$out" | json 'd["worktree"]["submodules"]')" = "[]" ] || fail "tag submodules: $out"
echo "ok: worktree.sh check does not count a submodule pinned to a commit that only a tag reaches"

setup init
commit_in_sub
out="$("$SCRIPT" submodules "$WT")"
[ "$(echo "$out" | json 'd["status"]')" = ok ] || fail "submodules status: $out"
[ "$(echo "$out" | json 'd["present"]')" = True ] || fail "submodules present: $out"
[ "$(echo "$out" | json '[(s["path"], s["commits"]) for s in d["submodules"]]')" = "[('sub', 1)]" ] || fail "submodules list: $out"
mkdir "$TMP/elsewhere"
out="$("$SCRIPT" submodules "$TMP/elsewhere")"
[ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "unknown status: $out"
[ "$(echo "$out" | json 'd["reason"]')" = unknown ] || fail "unknown reason: $out"
echo "ok: worktree.sh submodules prints present and the list for a worktree path, and stops with unknown for a path that is no worktree"

setup_pj init
out="$("$CLEANUP" run 1)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "pj run status: $out"
[ "$(echo "$out" | json 'd["worktree"]["action"]')" = removed ] || fail "pj run action: $out"
gone pj-1 || fail "pj worktree or its git dir left"
exists "$MAIN/work-reports/2026-01-01-0000-aaaaaaa" || fail "pj work report not moved"
[ "$(echo "$out" | json 'd["errors"]')" = "[]" ] || fail "pj run errors: $out"
echo "ok: cleanup.sh run removes a worktree with an initialized clean submodule"

setup_pj init
commit_in_sub
out="$("$CLEANUP" run 1)"
[ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "pj commit status: $out"
[ "$(echo "$out" | json 'd["reason"]')" = discard ] || fail "pj commit reason: $out"
[ "$(echo "$out" | json 'd["loses"]')" = "['submodules']" ] || fail "pj commit loses: $out"
[ "$(echo "$out" | json 'd["worktree"]["state"]')" = clean ] || fail "pj commit state: $out"
[ "$(echo "$out" | json 'd["worktree"]["submodules"][0]["commits"]')" = 1 ] || fail "pj commit count: $out"
exists "$WT" || fail "pj refused cleanup removed the worktree"
[ -d "$WT/work-reports/2026-01-01-0000-aaaaaaa" ] || fail "pj refused cleanup moved the report"
[ ! -e "$MAIN/work-reports" ] || fail "pj refused cleanup created work-reports in main"
echo "ok: cleanup.sh run refuses with discard when a submodule has a commit on no remote, and removes nothing"

setup_pj init
commit_in_sub
out="$("$CLEANUP" run 1 --discard)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "pj discard status: $out"
gone pj-1 || fail "pj discard left the worktree"
echo "ok: cleanup.sh run --discard removes a worktree whose submodule holds work"

setup_pj init
seat_run b
before="$("$CLEANUP" check 1)"
[ "$(echo "$before" | json 'd["status"]')" = ok ] || fail "pj seats check status: $before"
[ "$(echo "$before" | json 'd["loses"]')" = "[]" ] || fail "pj seats check loses: $before"
out="$("$CLEANUP" run 1)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "pj seats run status: $out"
[ "$(echo "$out" | json 'd["errors"]')" = "[]" ] || fail "pj seats run errors: $out"
gone pj-1 || fail "pj seats run left the worktree"
seats_gone pj-1 || fail "cleanup.sh run left a seat"
echo "ok: cleanup.sh run removes the seats beside a worktree with a submodule"
