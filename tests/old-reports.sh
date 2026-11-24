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

fail() { echo "FAIL: $*" >&2; exit 1; }

json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }

exists() { [ -e "$1" ] || [ -L "$1" ]; }

OLDEST=2026-01-01-0000-r000
SECOND=2026-01-01-0100-r001
NEWEST=2026-01-05-0400-r100
NEW_IN=2099-12-31-2359-incoming
OLD_IN=2000-01-01-0000-incoming

setup() {
  rm -rf "$TMP/work"
  git init -q -b main "$TMP/work"
  MAIN="$(cd "$TMP/work" && pwd -P)"
  (
    cd "$MAIN"
    echo 'work-reports/' > .gitignore
    echo '.claude/worktrees/' >> .gitignore
    echo readme > README.md
    git add .gitignore README.md
    git commit -q -m init
    git worktree add -q --detach .claude/worktrees/wf-test HEAD
  )
  WT="$MAIN/.claude/worktrees/wf-test"
  R="$MAIN/work-reports"
  seed_reports
  cd "$MAIN"
}

seed_reports() {
  mkdir -p "$R"
  python3 - "$R" <<'PY'
import datetime, os, sys
start = datetime.datetime(2026, 1, 1)
for i in range(101):
    stamp = (start + datetime.timedelta(hours=i)).strftime("%Y-%m-%d-%H%M")
    os.mkdir(os.path.join(sys.argv[1], "%s-r%03d" % (stamp, i)))
PY
  echo x > "$R/$OLDEST/log.md"
  mkdir "$R/notes"
  : > "$R/.DS_Store"
  : > "$R/2099-01-01-0000-file"
  mkdir -p "$TMP/elsewhere"
  rm -f "$R/2000-01-01-0000-link"
  ln -s "$TMP/elsewhere" "$R/2000-01-01-0000-link"
  touch -t 202601010000 "$R/$NEWEST"
}

incoming() {
  mkdir -p "$1/work-reports/$NEW_IN" "$1/work-reports/$OLD_IN" "$1/work-reports/$OLDEST"
}

setup_pj() {
  rm -rf "$TMP/pj"
  mkdir -p "$TMP/pj/skills/pj-cleanup/scripts" "$TMP/pj/skills/workflow/scripts" "$TMP/pj/skills/pj1-plan/scripts"
  cp "$CLEANUP_SRC" "$TMP/pj/skills/pj-cleanup/scripts/cleanup.sh"
  cp "${CLEANUP_SRC%.sh}.py" "$TMP/pj/skills/pj-cleanup/scripts/cleanup.py"
  cp "$SCRIPT" "$TMP/pj/skills/workflow/scripts/worktree.sh"
  cp "${SCRIPT%.sh}.py" "$TMP/pj/skills/workflow/scripts/worktree.py"
  cp "$PANEL_SRC" "$TMP/pj/skills/workflow/scripts/panel.sh"
  cp "${PANEL_SRC%.sh}.py" "$TMP/pj/skills/workflow/scripts/panel.py"
  cp "$(dirname "$SCRIPT")/clone.py" "$TMP/pj/skills/workflow/scripts/clone.py"
  cp "$(dirname "$SCRIPT")/include.py" "$TMP/pj/skills/workflow/scripts/include.py"
  cat > "$TMP/pj/skills/pj1-plan/scripts/project.sh" <<'FAKE'
#!/usr/bin/env bash
echo '{"parent":{"number":1,"title":"P","state":"CLOSED","base":"pj/1","from":"main","merged":true}}'
FAKE
  chmod +x "$TMP/pj/skills/pj-cleanup/scripts/cleanup.sh" "$TMP/pj/skills/workflow/scripts/worktree.sh" "$TMP/pj/skills/workflow/scripts/panel.sh" \
           "$TMP/pj/skills/pj1-plan/scripts/project.sh"
  CLEANUP="$TMP/pj/skills/pj-cleanup/scripts/cleanup.sh"
  git init -q --bare "$TMP/pj/origin.git"
  git init -q -b main "$TMP/pj/work"
  MAIN="$(cd "$TMP/pj/work" && pwd -P)"
  (
    cd "$MAIN"
    echo 'work-reports/' > .gitignore
    echo '.claude/worktrees/' >> .gitignore
    echo readme > README.md
    git add .gitignore README.md
    git commit -q -m init
    git remote add origin "$TMP/pj/origin.git"
    git push -q origin main
    git worktree add -q --detach .claude/worktrees/pj-1 HEAD
  )
  WT="$MAIN/.claude/worktrees/pj-1"
  R="$MAIN/work-reports"
  seed_reports
  cd "$MAIN"
}

count() { ls -A "$R" | wc -l | tr -d ' '; }

setup
out="$("$SCRIPT" check wf-test)"
[ "$(echo "$out" | json 'd["oldReports"]["names"]')" = "['$OLDEST']" ] || fail "check names: $out"
[ "$(echo "$out" | json 'd["oldReports"]["keep"]')" = 100 ] || fail "check keep: $out"
[ "$(echo "$out" | json 'd["oldReports"]["path"]')" = "$R" ] || fail "check path: $out"
[ "$(echo "$out" | json '"deleted" in d["oldReports"]')" = False ] || fail "check carries deleted: $out"
[ "$(count)" = 105 ] || fail "check deleted something"
echo "ok: check lists the reports beyond the 100 newest by stamp and deletes nothing"

setup
incoming "$WT"
out="$("$SCRIPT" check wf-test)"
listed="$(echo "$out" | json 'd["oldReports"]["names"]')"
[ "$listed" = "['$OLD_IN', '$OLDEST', '$OLDEST-wf-test', '$SECOND']" ] || fail "check with incoming names: $out"
out="$("$SCRIPT" cleanup wf-test)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "cleanup status: $out"
[ "$(echo "$out" | json 'd["oldReports"]["deleted"]')" = "$listed" ] || fail "cleanup deleted what check did not list: $out"
[ "$(echo "$out" | json 'd["errors"]')" = "[]" ] || fail "cleanup errors: $out"
exists "$R/$OLD_IN" && fail "old incoming report kept"
exists "$R/$OLDEST" && fail "oldest report kept"
exists "$R/$OLDEST-wf-test" && fail "incoming report renamed on a collision kept"
exists "$R/$SECOND" && fail "second oldest report kept"
exists "$R/$NEW_IN" || fail "new incoming report deleted"
exists "$R/$NEWEST" || fail "newest report deleted"
exists "$R/notes" || fail "unstamped directory deleted"
exists "$R/.DS_Store" || fail "file deleted"
exists "$R/2099-01-01-0000-file" || fail "stamped file deleted"
exists "$R/2000-01-01-0000-link" || fail "symlink deleted"
[ -d "$TMP/elsewhere" ] || fail "symlink target deleted"
[ "$(ls -d "$R"/2*-r* "$R"/*-incoming | wc -l | tr -d ' ')" = 100 ] || fail "not 100 reports left"
echo "ok: cleanup deletes what check listed, an incoming report past the cut included, under the name a collision gives it"

setup
out="$("$SCRIPT" check wf-test)"
[ "$(echo "$out" | json 'd["oldReports"]["names"]')" = "['$OLDEST']" ] || fail "mtime check names: $out"
out="$("$SCRIPT" cleanup wf-test)"
exists "$R/$NEWEST" || fail "newest-stamped report with an old mtime deleted"
exists "$R/$OLDEST" && fail "oldest-stamped report with a new mtime kept"
echo "ok: mtime does not decide"

setup
echo dirty > "$WT/untracked.txt"
out="$("$SCRIPT" cleanup wf-test)"
[ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "refused status: $out"
[ "$(echo "$out" | json 'd["reason"]')" = discard ] || fail "refused reason: $out"
[ "$(count)" = 105 ] || fail "refused cleanup deleted something"
echo "ok: worktree.sh cleanup refused for discard deletes nothing"

setup
incoming "$WT"
out="$("$SCRIPT" old-reports)"
[ "$(echo "$out" | json 'd["status"]')" = ok ] || fail "old-reports status: $out"
[ "$(echo "$out" | json 'd["oldReports"]["names"]')" = "['$OLDEST']" ] || fail "old-reports names: $out"
out="$("$SCRIPT" old-reports --from "$WT")"
[ "$(echo "$out" | json 'd["status"]')" = ok ] || fail "old-reports --from status: $out"
[ "$(echo "$out" | json 'd["oldReports"]["names"]')" = "['$OLD_IN', '$OLDEST', '$OLDEST-wf-test', '$SECOND']" ] || fail "old-reports --from names: $out"
[ "$(count)" = 105 ] || fail "old-reports without --delete deleted"
out="$("$SCRIPT" old-reports --delete)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "old-reports --delete status: $out"
[ "$(echo "$out" | json 'd["oldReports"]["deleted"]')" = "['$OLDEST']" ] || fail "old-reports --delete deleted: $out"
[ "$(echo "$out" | json 'd["errors"]')" = "[]" ] || fail "old-reports --delete errors: $out"
exists "$R/$OLDEST" && fail "old-reports --delete kept the oldest report"
exists "$R/$SECOND" || fail "old-reports --delete deleted one of the 100 newest"
"$SCRIPT" old-reports --from 2>/dev/null && fail "old-reports --from without a path accepted"
"$SCRIPT" old-reports --keep 2>/dev/null && fail "old-reports with an unknown flag accepted"
echo "ok: worktree.sh old-reports lists, --from counts a worktree's reports in, and --delete deletes"

setup
mkdir "$R/2000-01-02-0000-locked"
echo x > "$R/2000-01-02-0000-locked/f"
chmod 555 "$R/2000-01-02-0000-locked"
out="$("$SCRIPT" old-reports --delete)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "locked status: $out"
[ "$(echo "$out" | json '[e["step"] for e in d["errors"]]')" = "['old-reports']" ] || fail "locked errors: $out"
[ "$(echo "$out" | json 'd["oldReports"]["deleted"]')" = "['$OLDEST']" ] || fail "locked deleted: $out"
exists "$R/$OLDEST" && fail "other old report kept"
exists "$R/2000-01-02-0000-locked" || fail "locked report vanished"
chmod 755 "$R/2000-01-02-0000-locked"
echo "ok: worktree.sh old-reports --delete records a report it cannot delete in errors and deletes the others"

setup_pj
incoming "$WT"
out="$("$CLEANUP" check 1)"
[ "$(echo "$out" | json 'd["status"]')" = ok ] || fail "pj check status: $out"
listed="$(echo "$out" | json 'd["oldReports"]["names"]')"
[ "$listed" = "['$OLD_IN', '$OLDEST', '$OLDEST-pj-1', '$SECOND']" ] || fail "pj check names: $out"
[ "$(echo "$out" | json 'd["oldReports"]["keep"]')" = 100 ] || fail "pj check keep: $out"
[ "$(echo "$out" | json 'd["oldReports"]["path"]')" = "$R" ] || fail "pj check path: $out"
[ "$(echo "$out" | json '"deleted" in d["oldReports"]')" = False ] || fail "pj check carries deleted: $out"
[ "$(count)" = 105 ] || fail "pj check deleted something"
out="$("$CLEANUP" run 1)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "pj run status: $out"
[ "$(echo "$out" | json 'd["worktree"]["action"]')" = removed ] || fail "pj run worktree: $out"
[ "$(echo "$out" | json 'd["oldReports"]["deleted"]')" = "$listed" ] || fail "pj run deleted what check did not list: $out"
[ "$(echo "$out" | json 'd["errors"]')" = "[]" ] || fail "pj run errors: $out"
exists "$R/$OLD_IN" && fail "pj old incoming report kept"
exists "$R/$OLDEST-pj-1" && fail "pj incoming report renamed on a collision kept"
[ "$(echo "$out" | json 'd["worktree"]["moved"]')" = "['$R/$OLD_IN', '$R/$OLDEST-pj-1', '$R/$NEW_IN']" ] || fail "pj run moved: $out"
exists "$R/$NEW_IN" || fail "pj new incoming report deleted"
exists "$R/notes" || fail "pj unstamped directory deleted"
exists "$R/.DS_Store" || fail "pj file deleted"
exists "$R/2000-01-01-0000-link" || fail "pj symlink deleted"
echo "ok: pj-cleanup check lists what run deletes"

setup_pj
echo dirty > "$WT/untracked.txt"
out="$("$CLEANUP" run 1)"
[ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "pj refused status: $out"
[ "$(echo "$out" | json 'd["reason"]')" = discard ] || fail "pj refused reason: $out"
[ "$(count)" = 105 ] || fail "pj refused run deleted something"
echo "ok: cleanup.sh run refused for discard deletes nothing"
