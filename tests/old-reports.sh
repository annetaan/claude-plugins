#!/usr/bin/env bash
# Test: worktree.sh deletes the work reports in <MAIN>/work-reports/ that arrived 14 days ago or more,
# in check, cleanup and old-reports, and never deletes anything else.
#
# Run: bash tests/old-reports.sh   (exit 0 is success, anything else is failure)
# Runs offline: the clone has no remote, and the worktree is detached, so worktree.sh calls neither gh nor origin.
# WORKTREE_SH=<path> tests another copy of worktree.sh.
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/workflow/scripts/worktree.sh"
SCRIPT="${WORKTREE_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'chmod -R u+rwx "$TMP" 2>/dev/null || true; rm -rf "$TMP"' EXIT

# Cut off the user's git configuration (signing, hooks, templates).
export HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

fail() { echo "FAIL: $*" >&2; exit 1; }

# json <expression over d>: evaluate against the JSON on stdin and print the result.
json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }

# age <days> <path>: set the mtime of path to that many days ago.
age() { python3 -c 'import os,sys,time; t=time.time()-float(sys.argv[1])*86400; os.utime(sys.argv[2],(t,t))' "$1" "$2"; }

# mtime_age <path>: how many days ago the mtime of path is.
mtime_age() { python3 -c 'import os,sys,time; print((time.time()-os.lstat(sys.argv[1]).st_mtime)/86400)' "$1"; }

exists() { [ -e "$1" ] || [ -L "$1" ]; }

# A clone with work-reports/ ignored and a detached worktree wf-test.
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
  mkdir -p "$R"
  mkdir "$R/2026-01-01-0000-aaaaaaa" "$R/2026-01-02-0000-bbbbbbb" "$R/2026-01-03-0000-discarded" \
        "$R/2026-01-04-0000-ccccccc-wf-test" "$R/2026-02-01-0000-ddddddd" "$R/notes"
  echo x > "$R/2026-01-01-0000-aaaaaaa/log.md"
  : > "$R/.DS_Store"
  mkdir -p "$TMP/elsewhere"
  ln -s "$TMP/elsewhere" "$R/2026-01-05-0000-link"
  age 20 "$R/2026-01-01-0000-aaaaaaa"
  age 14 "$R/2026-01-02-0000-bbbbbbb"
  age 30 "$R/2026-01-03-0000-discarded"
  age 15 "$R/2026-01-04-0000-ccccccc-wf-test"
  age 13 "$R/2026-02-01-0000-ddddddd"
  age 40 "$R/notes"
  age 40 "$R/.DS_Store"
  cd "$MAIN"
}


setup
out="$("$SCRIPT" check wf-test)"
[ "$(echo "$out" | json 'd["oldReports"]["names"]')" = "['2026-01-01-0000-aaaaaaa', '2026-01-02-0000-bbbbbbb', '2026-01-03-0000-discarded', '2026-01-04-0000-ccccccc-wf-test']" ] \
  || fail "check names: $out"
[ "$(echo "$out" | json 'd["oldReports"]["days"]')" = 14 ] || fail "check days: $out"
[ "$(echo "$out" | json 'd["oldReports"]["path"]')" = "$R" ] || fail "check path: $out"
[ "$(echo "$out" | json '"deleted" in d["oldReports"]')" = False ] || fail "check carries deleted: $out"
[ "$(ls "$R" | wc -l | tr -d ' ')" = 7 ] || fail "check deleted something"
echo "ok: worktree.sh check lists the reports whose mtime is 14 days old or more and deletes nothing"

setup
out="$("$SCRIPT" cleanup wf-test)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "cleanup status: $out"
exists "$R/2026-01-01-0000-aaaaaaa" && fail "old report kept"
exists "$R/2026-01-02-0000-bbbbbbb" && fail "14-day-old report kept"
exists "$R/2026-02-01-0000-ddddddd" || fail "13-day-old report deleted"
exists "$R/notes" || fail "unstamped directory deleted"
exists "$R/.DS_Store" || fail "file deleted"
exists "$R/2026-01-05-0000-link" || fail "symlink deleted"
[ -d "$TMP/elsewhere" ] || fail "symlink target deleted"
[ "$(echo "$out" | json 'd["oldReports"]["deleted"]')" = "['2026-01-01-0000-aaaaaaa', '2026-01-02-0000-bbbbbbb', '2026-01-03-0000-discarded', '2026-01-04-0000-ccccccc-wf-test']" ] \
  || fail "cleanup deleted: $out"
[ "$(echo "$out" | json 'd["errors"]')" = "[]" ] || fail "cleanup errors: $out"
echo "ok: worktree.sh cleanup deletes the old reports and keeps a 13-day-old one, an unstamped directory, a file and a symlink"

# The -discarded and the suffixed reports of the run above are gone.
exists "$R/2026-01-03-0000-discarded" && fail "old -discarded report kept"
exists "$R/2026-01-04-0000-ccccccc-wf-test" && fail "old suffixed report kept"
echo "ok: worktree.sh cleanup deletes an old -discarded report and an old suffixed one"

setup
mkdir -p "$WT/work-reports/2020-01-01-0000-eeeeeee"
age 100 "$WT/work-reports/2020-01-01-0000-eeeeeee"
out="$("$SCRIPT" cleanup wf-test)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "cleanup status: $out"
exists "$R/2020-01-01-0000-eeeeeee" || fail "moved report deleted"
python3 - "$R/2020-01-01-0000-eeeeeee" <<'PY' || fail "moved report mtime is not now"
import os, sys, time
sys.exit(0 if time.time() - os.lstat(sys.argv[1]).st_mtime < 3600 else 1)
PY
[ "$(echo "$out" | json '"2020-01-01-0000-eeeeeee" in d["oldReports"]["deleted"]')" = False ] || fail "moved report listed as deleted"
echo "ok: worktree.sh cleanup keeps a report it moved in whose name stamp is old, and sets its mtime to now"

setup
echo dirty > "$WT/untracked.txt"
out="$("$SCRIPT" cleanup wf-test)"
[ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "refused status: $out"
[ "$(echo "$out" | json 'd["reason"]')" = discard ] || fail "refused reason: $out"
[ "$(ls "$R" | wc -l | tr -d ' ')" = 7 ] || fail "refused cleanup deleted something"
exists "$R/2026-01-01-0000-aaaaaaa" || fail "refused cleanup deleted an old report"
echo "ok: worktree.sh cleanup refused for discard deletes nothing"

setup
out="$("$SCRIPT" old-reports)"
[ "$(echo "$out" | json 'd["status"]')" = ok ] || fail "old-reports status: $out"
[ "$(echo "$out" | json 'len(d["oldReports"]["names"])')" = 4 ] || fail "old-reports names: $out"
exists "$R/2026-01-01-0000-aaaaaaa" || fail "old-reports without --delete deleted"
out="$("$SCRIPT" old-reports --delete)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "old-reports --delete status: $out"
[ "$(echo "$out" | json 'len(d["oldReports"]["deleted"])')" = 4 ] || fail "old-reports --delete deleted: $out"
[ "$(echo "$out" | json 'd["errors"]')" = "[]" ] || fail "old-reports --delete errors: $out"
exists "$R/2026-01-01-0000-aaaaaaa" && fail "old-reports --delete kept an old report"
exists "$R/2026-02-01-0000-ddddddd" || fail "old-reports --delete deleted a young report"
echo "ok: worktree.sh old-reports lists, and old-reports --delete deletes and reports deleted"

setup
mkdir "$R/2026-01-06-0000-locked"
echo x > "$R/2026-01-06-0000-locked/f"
age 20 "$R/2026-01-06-0000-locked"
chmod 555 "$R/2026-01-06-0000-locked"
out="$("$SCRIPT" old-reports --delete)"
[ "$(echo "$out" | json 'd["status"]')" = done ] || fail "locked status: $out"
[ "$(echo "$out" | json '[e["step"] for e in d["errors"]]')" = "['old-reports']" ] || fail "locked errors: $out"
[ "$(echo "$out" | json '"2026-01-06-0000-locked" in d["oldReports"]["deleted"]')" = False ] || fail "locked listed as deleted: $out"
[ "$(echo "$out" | json '"2026-01-01-0000-aaaaaaa" in d["oldReports"]["deleted"]')" = True ] || fail "other not deleted: $out"
exists "$R/2026-01-01-0000-aaaaaaa" && fail "other old report kept"
exists "$R/2026-01-06-0000-locked" || fail "locked report vanished"
chmod 755 "$R/2026-01-06-0000-locked"
echo "ok: worktree.sh old-reports --delete records a report it cannot delete in errors and deletes the others"
