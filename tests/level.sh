#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/workflow/scripts/level.sh"
SCRIPT="${LEVEL_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

fail() { echo "FAIL: $*" >&2; exit 1; }

json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }

ORIGIN="$TMP/origin.git"
SEED="$TMP/seed"
CLONE="$TMP/clone"
FILE=.claude/annetaan-level.md

git init -q --bare -b trunk "$ORIGIN"
git clone -q "$ORIGIN" "$SEED" 2>/dev/null
(
  cd "$SEED"
  git checkout -q -b trunk
  echo readme > README.md
  git add README.md
  git commit -q -m init
  git push -q origin trunk
)
git clone -q "$ORIGIN" "$CLONE"
git -C "$CLONE" checkout -q -b feat

publish() {
  mkdir -p "$SEED/.claude"
  printf '%s\n' "$1" > "$SEED/$FILE"
  git -C "$SEED" add "$FILE"
  git -C "$SEED" commit -q -m "level"
  git -C "$SEED" push -q origin trunk
}

level_file() { printf -- '---\nlevel: %s\nevaluated: %s\nreview-by: %s\n---\nrationale' "$1" "$2" "$3"; }

show() { OUT="$("$SCRIPT" show "$CLONE" "$@")" || fail "show $* exited non-zero"; }

one_warning_line() { [ "$(field '"warning"' | wc -l | tr -d ' ')" = 1 ] || fail "$1: the warning is not one line: $OUT"; }

field() { printf '%s\n' "$OUT" | json "d[$1]"; }

show
[ "$(field '"level"')" = 3 ] || fail "no file: level is not 3: $OUT"
[ "$(field '"source"')" = default ] || fail "no file: source is not default: $OUT"
[ "$(field '"warning"')" = None ] || fail "no file: a warning was printed: $OUT"
[ "$(field '"ref"')" = origin/trunk ] || fail "no file: ref is not origin/trunk: $OUT"
echo "ok: show: no file on origin gives level 3 from default with no warning"

publish "$(level_file 2 2026-11-20 2099-02-18)"
show
[ "$(field '"level"') $(field '"source"')" = "2 file" ] || fail "file: expected level 2 from file: $OUT"
[ "$(field '"evaluated"') $(field '"reviewBy"')" = "2026-11-20 2099-02-18" ] || fail "file: dates are wrong: $OUT"
[ "$(field '"warning"')" = None ] || fail "file: a warning was printed: $OUT"
echo "ok: show: the file on origin's default branch gives its level from file"

mkdir -p "$CLONE/.claude"
level_file 1 2026-11-20 2099-02-18 > "$CLONE/$FILE"
git -C "$CLONE" add "$FILE"
git -C "$CLONE" commit -q -m "local level"
show
[ "$(field '"level"') $(field '"source"')" = "2 file" ] || fail "a feature-branch copy was read: $OUT"
echo "ok: show: a working-tree or feature-branch copy is ignored"

show 1
[ "$(field '"level"') $(field '"source"')" = "1 override" ] || fail "override: expected level 1 from override: $OUT"
echo "ok: show: <n> overrides with source override"

publish "$(level_file 1 2020-01-01 2020-03-31)"
show
[ "$(field '"level"') $(field '"source"')" = "1 file" ] || fail "past review-by: the level was not kept: $OUT"
field '"warning"' | grep -qF "review-by 2020-03-31 has passed" || fail "past review-by: no warning: $OUT"
echo "ok: show: a past review-by warns and keeps the level"

publish "$(level_file 5 2026-11-20 2099-02-18)"
show
[ "$(field '"level"') $(field '"source"')" = "3 default" ] || fail "invalid file: expected level 3 from default: $OUT"
field '"warning"' | grep -qF "origin/trunk:$FILE: level is not 1, 2 or 3; ignored" || fail "invalid file: no warning: $OUT"
publish "$(level_file 2 yesterday 2099-02-18)"
show
[ "$(field '"level"') $(field '"source"')" = "3 default" ] || fail "invalid date: expected level 3 from default: $OUT"
field '"warning"' | grep -qF "ignored" || fail "invalid date: no warning: $OUT"
publish "$(level_file $'2\xe9' 2026-11-20 2099-02-18)"
show
[ "$(field '"level"') $(field '"source"')" = "3 default" ] || fail "non-UTF-8 level: expected level 3 from default: $OUT"
one_warning_line "non-UTF-8 level"
echo "ok: show: an invalid file falls back to 3 with a warning"

publish "$(level_file 2 2026-11-20 2099-02-18)"$'\nRationale: caf\xe9 in latin-1'
show
[ "$(field '"level"') $(field '"source"')" = "2 file" ] || fail "non-UTF-8 rationale: expected level 2 from file: $OUT"
echo "ok: show: a byte that is not UTF-8 in the rationale keeps the file's level"

git -C "$CLONE" remote set-url origin "$TMP/gone.git"
show
[ "$(field '"level"') $(field '"source"')" = "3 default" ] || fail "unreachable origin: expected level 3 from default: $OUT"
field '"warning"' | grep -qF "cannot read origin's default branch" || fail "unreachable origin: no warning: $OUT"
one_warning_line "unreachable origin"
show 2
[ "$(field '"level"') $(field '"source"')" = "2 override" ] || fail "unreachable origin: the override was lost: $OUT"
git -C "$CLONE" remote set-url origin "$ORIGIN"
git init -q "$TMP/no-origin"
OUT="$("$SCRIPT" show "$TMP/no-origin")" || fail "a clone with no origin exited non-zero"
[ "$(field '"level"') $(field '"source"')" = "3 default" ] || fail "no origin: expected level 3 from default: $OUT"
one_warning_line "no origin"
echo "ok: show: an unreachable origin falls back to 3 with a one-line warning"

if "$SCRIPT" show "$CLONE" 4 >/dev/null 2>&1; then fail "show <dir> 4 exited 0"; fi
mkdir -p "$TMP/plain"
if "$SCRIPT" show "$TMP/plain" >/dev/null 2>&1; then fail "show outside a clone exited 0"; fi
echo "ok: show: level 4 and a directory outside a clone exit 1"

for n in 1 2 3; do
  show "$n"
  printf '%s\n' "$OUT" | python3 -c '
import json, sys
want = {
    "1": {"workflow-worker": ("sonnet", "high"), "pj-issue-writer": ("sonnet", "high"),
          "workflow-reviewer-a": ("opus", "medium"), "workflow-reviewer-b": ("fable", "medium")},
    "2": {"workflow-worker": ("opus", "medium"), "pj-issue-writer": ("opus", "medium"),
          "workflow-reviewer-a": ("opus", "high"), "workflow-reviewer-b": ("fable", "medium")},
    "3": {"workflow-worker": ("opus", "high"), "pj-issue-writer": ("opus", "high"),
          "workflow-reviewer-a": ("opus", "high"), "workflow-reviewer-b": ("fable", "medium")},
}[sys.argv[1]]
got = {k: (v["model"], v["effort"]) for k, v in json.load(sys.stdin)["agents"].items()}
assert got == want, got
' "$n" || fail "agents at level $n: $OUT"
done
echo "ok: show: agents holds the four levelled agents with the table's values at each level"
