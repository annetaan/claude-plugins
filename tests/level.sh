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
[ "$(field '"level"')" = standard ] || fail "no file: level is not standard: $OUT"
[ "$(field '"source"')" = default ] || fail "no file: source is not default: $OUT"
[ "$(field '"warning"')" = None ] || fail "no file: a warning was printed: $OUT"
[ "$(field '"ref"')" = origin/trunk ] || fail "no file: ref is not origin/trunk: $OUT"
echo "ok: show: no file on origin gives standard from default with no warning"

publish "$(level_file high 2026-11-20 2099-02-18)"
show
[ "$(field '"level"') $(field '"source"')" = "high file" ] || fail "file: expected high from file: $OUT"
[ "$(field '"evaluated"') $(field '"reviewBy"')" = "2026-11-20 2099-02-18" ] || fail "file: dates are wrong: $OUT"
[ "$(field '"warning"')" = None ] || fail "file: a warning was printed: $OUT"
echo "ok: show: the file on origin's default branch gives its level from file"

mkdir -p "$CLONE/.claude"
level_file standard 2026-11-20 2099-02-18 > "$CLONE/$FILE"
git -C "$CLONE" add "$FILE"
git -C "$CLONE" commit -q -m "local level"
show
[ "$(field '"level"') $(field '"source"')" = "high file" ] || fail "a feature-branch copy was read: $OUT"
echo "ok: show: a working-tree or feature-branch copy is ignored"

show standard
[ "$(field '"level"') $(field '"source"')" = "standard override" ] || fail "override: expected standard from override: $OUT"
echo "ok: show: <level> overrides with source override"

publish "$(level_file standard 2020-01-01 2020-03-31)"
show
[ "$(field '"level"') $(field '"source"')" = "standard file" ] || fail "past review-by: the level was not kept: $OUT"
field '"warning"' | grep -qF "review-by 2020-03-31 has passed" || fail "past review-by: no warning: $OUT"
echo "ok: show: a past review-by warns and keeps the level"

publish "$(level_file 2 2026-11-20 2099-02-18)"
show
[ "$(field '"level"') $(field '"source"')" = "standard default" ] || fail "invalid file: expected standard from default: $OUT"
field '"warning"' | grep -qF "origin/trunk:$FILE: level is not standard or high; ignored" || fail "invalid file: no warning: $OUT"
publish "$(level_file high yesterday 2099-02-18)"
show
[ "$(field '"level"') $(field '"source"')" = "standard default" ] || fail "invalid date: expected standard from default: $OUT"
field '"warning"' | grep -qF "ignored" || fail "invalid date: no warning: $OUT"
publish "$(level_file $'high\xe9' 2026-11-20 2099-02-18)"
show
[ "$(field '"level"') $(field '"source"')" = "standard default" ] || fail "non-UTF-8 level: expected standard from default: $OUT"
one_warning_line "non-UTF-8 level"
echo "ok: show: an invalid file, a numeric level included, falls back to standard with a warning"

publish "$(level_file standard 2026-11-20 2099-02-18)"$'\nRationale: caf\xe9 in latin-1'
show
[ "$(field '"level"') $(field '"source"')" = "standard file" ] || fail "non-UTF-8 rationale: expected standard from file: $OUT"
echo "ok: show: a byte that is not UTF-8 in the rationale keeps the file's level"

git -C "$CLONE" remote set-url origin "$TMP/gone.git"
show
[ "$(field '"level"') $(field '"source"')" = "standard default" ] || fail "unreachable origin: expected standard from default: $OUT"
field '"warning"' | grep -qF "cannot read origin's default branch" || fail "unreachable origin: no warning: $OUT"
field '"warning"' | grep -qF "; level standard unless overridden" || fail "unreachable origin: the warning does not name standard: $OUT"
one_warning_line "unreachable origin"
show standard
[ "$(field '"level"') $(field '"source"')" = "standard override" ] || fail "unreachable origin: the override was lost: $OUT"
git -C "$CLONE" remote set-url origin "$ORIGIN"
git init -q "$TMP/no-origin"
OUT="$("$SCRIPT" show "$TMP/no-origin")" || fail "a clone with no origin exited non-zero"
[ "$(field '"level"') $(field '"source"')" = "standard default" ] || fail "no origin: expected standard from default: $OUT"
one_warning_line "no origin"
echo "ok: show: an unreachable origin falls back to standard with a one-line warning"

for n in 1 2 3 4; do
  if "$SCRIPT" show "$CLONE" "$n" >/dev/null 2>&1; then fail "show <dir> $n exited 0"; fi
done
mkdir -p "$TMP/plain"
if "$SCRIPT" show "$TMP/plain" >/dev/null 2>&1; then fail "show outside a clone exited 0"; fi
echo "ok: show: a numeric level and a directory outside a clone exit 1"

for level in standard high; do
  show "$level"
  printf '%s\n' "$OUT" | python3 -c '
import json, sys
want = {
    "standard": {"workflow-design": ("opus", "medium"), "pj-planner": ("opus", "medium"),
                 "pj-reviewer": ("opus", "medium"), "workflow-worker": ("opus", "medium"),
                 "pj-issue-writer": ("opus", "medium"), "workflow-reviewer-a": ("opus", "high")},
    "high": {"workflow-design": ("fable", "medium"), "pj-planner": ("fable", "medium"),
             "pj-reviewer": ("fable", "medium"), "workflow-worker": ("opus", "high"),
             "pj-issue-writer": ("opus", "high"), "workflow-reviewer-a": ("opus", "high"),
             "workflow-reviewer-b": ("fable", "medium")},
}[sys.argv[1]]
got = {k: (v["model"], v["effort"]) for k, v in json.load(sys.stdin)["agents"].items()}
assert got == want, got
' "$level" || fail "agents at $level: $OUT"
  printf '%s\n' "$OUT" | python3 -c '
import json, sys
assert ("workflow-reviewer-b" in json.load(sys.stdin)["agents"]) == (sys.argv[1] == "high")
' "$level" || fail "seat b in agents at $level: $OUT"
  printf '%s\n' "$OUT" | python3 -c '
import json, sys
assert json.load(sys.stdin)["seats"] == (["a", "b"] if sys.argv[1] == "high" else ["a"])
' "$level" || fail "seats at $level: $OUT"
done
echo "ok: show: agents holds the levelled agents with the table's values at standard and high"
echo "ok: show: seat b is in agents only at high"
echo "ok: show: seats is a at standard and a, b at high"

mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'GH'
#!/usr/bin/env bash
printf '%s\n' "$*" > "$FX_GH_ARGS"
if [ -n "${FX_GH_FAIL:-}" ]; then echo "gh: not logged in" >&2; exit 1; fi
printf '%s\n' "$FX_GH_JSON"
GH
chmod +x "$TMP/bin/gh"
export FX_GH_ARGS="$TMP/gh-args" FX_GH_JSON='[]'

list_history() { OUT="$(PATH="$TMP/bin:$PATH" "$SCRIPT" history "$CLONE")" || fail "history exited non-zero"; }

git -C "$SEED" rm -q "$FILE"
git -C "$SEED" commit -q -m "no level"
git -C "$SEED" push -q origin trunk
list_history
[ "$(field '"status"')" = ok ] || fail "history without a file: status is not ok: $OUT"
[ "$(field '"since"')" = None ] || fail "history without a file: since is not null: $OUT"
if grep -qF -- "--search" "$FX_GH_ARGS"; then fail "history without a file: gh got --search: $(cat "$FX_GH_ARGS")"; fi
grep -qxF "pr list --state merged --limit 1000 --json number,url,body,mergedAt" "$FX_GH_ARGS" \
  || fail "history: gh got other arguments: $(cat "$FX_GH_ARGS")"
echo "ok: history: no file on origin gives since null and no --search"

publish "$(level_file standard 2026-11-01 2099-02-18)"
list_history
[ "$(field '"since"')" = 2026-11-01 ] || fail "history with a file: since is not 2026-11-01: $OUT"
grep -qF -- "--search merged:>2026-11-01" "$FX_GH_ARGS" || fail "history with a file: no --search: $(cat "$FX_GH_ARGS")"
echo "ok: history: evaluated on origin gives --search merged:>2026-11-01 and since"

FX_GH_JSON="$(python3 -c '
import json
dot = "·"
def line(level, source, t, tr, ir, f):
    return "Level: %s (%s) %s tasks %d %s task rounds %d %s integration rounds %d %s findings %d" % (
        level, source, dot, t, dot, tr, dot, ir, dot, f)
print(json.dumps([
    {"number": 1, "url": "u1", "mergedAt": "2026-11-10T00:00:00Z",
     "body": "Implements #3\nPart of #1\n\n" + line("high", "default", 9, 9, 9, 9) + "\n\nbody\n\n" + line("standard", "file", 2, 3, 2, 4) + "\n"},
    {"number": 2, "url": "u2", "mergedAt": "2026-11-05T00:00:00Z", "body": "x\n\n" + line("high", "override", 1, 2, 0, 3)},
    {"number": 3, "url": "u3", "mergedAt": "2026-11-06T00:00:00Z", "body": "no line here"},
    {"number": 4, "url": "u4", "mergedAt": "2026-11-08T00:00:00Z", "body": "a\r\n\r\n" + line("standard", "file", 3, 4, 1, 1) + "\r\n"},
    {"number": 5, "url": "u5", "mergedAt": "2026-11-09T00:00:00Z", "body": line("standard", "override", 0, 0, 1, 0)},
    {"number": 6, "url": "u6", "mergedAt": "2026-11-11T00:00:00Z",
     "body": "x\n\nLevel: 2 (file) " + dot + " tasks 1 " + dot + " task rounds 1 " + dot + " integration rounds 0 " + dot + " findings 0\n"},
]))
')"
list_history
printf '%s\n' "$OUT" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["prs"] == 6, d["prs"]
assert [r["pr"] for r in d["runs"]] == [2, 4, 5, 1], d["runs"]
last = d["runs"][-1]
assert last == {"pr": 1, "url": "u1", "mergedAt": "2026-11-10T00:00:00Z", "level": "standard", "source": "file",
                "tasks": 2, "taskRounds": 3, "integrationRounds": 2, "findings": 4}, last
want = [
    {"level": "standard", "source": "file", "runs": 2, "tasks": 5, "taskRounds": 7, "integrationRounds": 3, "findings": 5,
     "sendBacks": 2, "sendBacksPerTask": 0.4, "findingsPerTask": 1.0},
    {"level": "standard", "source": "override", "runs": 1, "tasks": 0, "taskRounds": 0, "integrationRounds": 1, "findings": 0,
     "sendBacks": 0, "sendBacksPerTask": None, "findingsPerTask": None},
    {"level": "high", "source": "override", "runs": 1, "tasks": 1, "taskRounds": 2, "integrationRounds": 0, "findings": 3,
     "sendBacks": 1, "sendBacksPerTask": 1.0, "findingsPerTask": 3.0},
]
assert d["groups"] == want, d["groups"]
assert d["unread"] == [{"pr": 6, "line": "Level: 2 (file) \u00b7 tasks 1 \u00b7 task rounds 1 \u00b7 integration rounds 0 \u00b7 findings 0"}], d["unread"]
' || fail "history: runs or groups are wrong: $OUT"
echo "ok: history: runs and groups split by level and source, standard before high, sendBacks = taskRounds - tasks"
echo "ok: history: a numeric Level: line is in unread and in no run"

OUT="$(PATH="$TMP/bin:$PATH" FX_GH_FAIL=1 "$SCRIPT" history "$CLONE")" || fail "history with gh failing exited non-zero"
[ "$(field '"status"') $(field '"reason"')" = "stop gh" ] || fail "history with gh failing: expected stop gh: $OUT"
field '"message"' | grep -qF "gh: not logged in" || fail "history with gh failing: the message is not gh's: $OUT"
FX_GH_JSON='not json'
list_history
[ "$(field '"status"') $(field '"reason"')" = "stop gh" ] || fail "history with gh printing no JSON: expected stop gh: $OUT"
echo "ok: history: gh failing gives stop gh"

if "$SCRIPT" history >/dev/null 2>&1; then fail "history with no <dir> exited 0"; fi
rm -f "$FX_GH_ARGS"
if PATH="$TMP/bin:$PATH" "$SCRIPT" history "$TMP/plain" >/dev/null 2>&1; then fail "history outside a clone exited 0"; fi
if PATH="$TMP/bin:$PATH" "$SCRIPT" history "$TMP/missing" 2>"$TMP/missing.err" >/dev/null; then fail "history on a missing directory exited 0"; fi
if grep -q Traceback "$TMP/missing.err"; then fail "history on a missing directory ended in a traceback: $(cat "$TMP/missing.err")"; fi
[ ! -e "$FX_GH_ARGS" ] || fail "history outside a clone ran gh: $(cat "$FX_GH_ARGS")"
echo "ok: history: no <dir>, a directory outside a clone or a missing one exits 1 without running gh"
