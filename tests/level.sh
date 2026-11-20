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

WD="$TMP/wd"
mkdir -p "$WD/review"
printf '## New findings\n\n### R1.1 a\n\n### R1.2 b\n\n## Dropped\n\n### R9.9 z\n' > "$WD/review/task-1-round-1.md"
printf '## New findings\n\nNone.\n' > "$WD/review/task-1-round-2.md"
printf '## New findings\n\n### R1.1 c\n' > "$WD/review/task-2-round-1.md"
printf '## New findings\n\n### R1.1 d\n' > "$WD/review/integration-round-1.md"
printf '## New findings\n\nNone.\n' > "$WD/review/integration-round-2.md"
printf '## New findings\n\n### R1.1 merge\n' > "$WD/review/merge-round-1.md"
printf '## New findings\n\n### R5.5 seat\n' > "$WD/review/task-1-round-1-a.md"
printf '## New findings\n\n### R5.6 reply\n' > "$WD/review/task-1-round-1-reply.md"
printf '## New findings\n\n### R5.7 evidence\n' > "$WD/review/task-1-round-1-evidence.md"
printf '## New findings\n\n### R5.8 evidence\n' > "$WD/review/task-1-evidence.md"
printf 'Implements #3\nPart of #1\n\n## What changed\n\nthe body\n\n\n' > "$WD/log.md"
LINE="Level: 2 (file) · tasks 2 · task rounds 3 · integration rounds 2 · findings 4"

OUT="$("$SCRIPT" record "$WD" 2 file)" || fail "record exited non-zero"
[ "$(field '"status"')" = ok ] || fail "record: status is not ok: $OUT"
[ "$(field '"line"')" = "$LINE" ] || fail "record: the line is wrong: $OUT"
[ "$(tail -n 1 "$WD/log.md")" = "$LINE" ] || fail "record: log.md does not end with the line: $(cat "$WD/log.md")"
[ "$(tail -n 2 "$WD/log.md" | head -n 1)" = "" ] || fail "record: no blank line before the line: $(cat "$WD/log.md")"
[ "$(tail -n 3 "$WD/log.md" | head -n 1)" = "the body" ] || fail "record: the trailing blank lines were not stripped: $(cat "$WD/log.md")"
[ "$(head -n 1 "$WD/log.md")" = "Implements #3" ] || fail "record: the head moved: $(cat "$WD/log.md")"
echo "ok: record: writes the line at the end of log.md"

"$SCRIPT" record "$WD" 2 file > /dev/null || fail "record a second time exited non-zero"
[ "$(grep -c '^Level: ' "$WD/log.md")" = 1 ] || fail "record twice: not exactly one line: $(cat "$WD/log.md")"
[ "$(tail -n 1 "$WD/log.md")" = "$LINE" ] || fail "record twice: log.md does not end with the line: $(cat "$WD/log.md")"
cp "$WD/log.md" "$TMP/recorded-log.md"
echo "ok: record: run twice leaves one line"

mkdir -p "$TMP/no-log/review"
OUT="$("$SCRIPT" record "$TMP/no-log" 2 file)" || fail "record without log.md exited non-zero"
[ "$(field '"status"') $(field '"reason"')" = "stop no-log" ] || fail "record without log.md: expected stop no-log: $OUT"
[ -n "$(field '"message"')" ] || fail "record without log.md: no message: $OUT"
echo "ok: record: no log.md gives stop no-log"

mkdir -p "$TMP/no-review"
echo body > "$TMP/no-review/log.md"
OUT="$("$SCRIPT" record "$TMP/no-review" 2 file)" || fail "record without review/ exited non-zero"
[ "$(field '"status"') $(field '"reason"')" = "stop no-review" ] || fail "record without review/: expected stop no-review: $OUT"
[ -n "$(field '"message"')" ] || fail "record without review/: no message: $OUT"
[ "$(cat "$TMP/no-review/log.md")" = body ] || fail "record without review/: log.md changed"
echo "ok: record: no review/ gives stop no-review"

if "$SCRIPT" record "$WD" 4 file >/dev/null 2>&1; then fail "record with level 4 exited 0"; fi
if "$SCRIPT" record "$WD" 2 other >/dev/null 2>&1; then fail "record with source other exited 0"; fi
if "$SCRIPT" record "$WD" 2 >/dev/null 2>&1; then fail "record with no source exited 0"; fi
echo "ok: record: level 4 or source other exits 1"

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

publish "$(level_file 2 2026-11-01 2099-02-18)"
list_history
[ "$(field '"since"')" = 2026-11-01 ] || fail "history with a file: since is not 2026-11-01: $OUT"
grep -qF -- "--search merged:>2026-11-01" "$FX_GH_ARGS" || fail "history with a file: no --search: $(cat "$FX_GH_ARGS")"
echo "ok: history: evaluated on origin gives --search merged:>2026-11-01 and since"

FX_GH_JSON="$(python3 -c '
import json
dot = "·"
def line(level, source, t, tr, ir, f):
    return "Level: %d (%s) %s tasks %d %s task rounds %d %s integration rounds %d %s findings %d" % (
        level, source, dot, t, dot, tr, dot, ir, dot, f)
print(json.dumps([
    {"number": 1, "url": "u1", "mergedAt": "2026-11-10T00:00:00Z",
     "body": "Implements #3\nPart of #1\n\n" + line(3, "default", 9, 9, 9, 9) + "\n\nbody\n\n" + line(2, "file", 2, 3, 2, 4) + "\n"},
    {"number": 2, "url": "u2", "mergedAt": "2026-11-05T00:00:00Z", "body": "x\n\n" + line(1, "override", 1, 2, 0, 3)},
    {"number": 3, "url": "u3", "mergedAt": "2026-11-06T00:00:00Z", "body": "no line here"},
    {"number": 4, "url": "u4", "mergedAt": "2026-11-08T00:00:00Z", "body": "a\r\n\r\n" + line(2, "file", 3, 4, 1, 1) + "\r\n"},
    {"number": 5, "url": "u5", "mergedAt": "2026-11-09T00:00:00Z", "body": line(2, "override", 0, 0, 1, 0)},
]))
')"
list_history
printf '%s\n' "$OUT" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["prs"] == 5, d["prs"]
assert [r["pr"] for r in d["runs"]] == [2, 4, 5, 1], d["runs"]
last = d["runs"][-1]
assert last == {"pr": 1, "url": "u1", "mergedAt": "2026-11-10T00:00:00Z", "level": 2, "source": "file",
                "tasks": 2, "taskRounds": 3, "integrationRounds": 2, "findings": 4}, last
want = [
    {"level": 1, "source": "override", "runs": 1, "tasks": 1, "taskRounds": 2, "integrationRounds": 0, "findings": 3,
     "sendBacks": 1, "sendBacksPerTask": 1.0, "findingsPerTask": 3.0},
    {"level": 2, "source": "file", "runs": 2, "tasks": 5, "taskRounds": 7, "integrationRounds": 3, "findings": 5,
     "sendBacks": 2, "sendBacksPerTask": 0.4, "findingsPerTask": 1.0},
    {"level": 2, "source": "override", "runs": 1, "tasks": 0, "taskRounds": 0, "integrationRounds": 1, "findings": 0,
     "sendBacks": 0, "sendBacksPerTask": None, "findingsPerTask": None},
]
assert d["groups"] == want, d["groups"]
' || fail "history: runs or groups are wrong: $OUT"
echo "ok: history: runs and groups split by level and source, sendBacks = taskRounds - tasks"

OUT="$(PATH="$TMP/bin:$PATH" FX_GH_FAIL=1 "$SCRIPT" history "$CLONE")" || fail "history with gh failing exited non-zero"
[ "$(field '"status"') $(field '"reason"')" = "stop gh" ] || fail "history with gh failing: expected stop gh: $OUT"
field '"message"' | grep -qF "gh: not logged in" || fail "history with gh failing: the message is not gh's: $OUT"
FX_GH_JSON='not json'
list_history
[ "$(field '"status"') $(field '"reason"')" = "stop gh" ] || fail "history with gh printing no JSON: expected stop gh: $OUT"
echo "ok: history: gh failing gives stop gh"

FX_GH_JSON="$(python3 -c '
import json, sys
body = open(sys.argv[1], encoding="utf-8").read()
print(json.dumps([{"number": 9, "url": "u9", "mergedAt": "2026-11-12T00:00:00Z", "body": body}]))
' "$TMP/recorded-log.md")"
list_history
printf '%s\n' "$OUT" | python3 -c '
import json, sys
d = json.load(sys.stdin)
got = [(r["pr"], r["level"], r["source"], r["tasks"], r["taskRounds"], r["integrationRounds"], r["findings"]) for r in d["runs"]]
assert got == [(9, 2, "file", 2, 3, 2, 4)], d["runs"]
' || fail "history: the log.md record wrote was not read back: $OUT"
echo "ok: history: reads a log.md that record wrote"

if "$SCRIPT" history >/dev/null 2>&1; then fail "history with no <dir> exited 0"; fi
rm -f "$FX_GH_ARGS"
if PATH="$TMP/bin:$PATH" "$SCRIPT" history "$TMP/plain" >/dev/null 2>&1; then fail "history outside a clone exited 0"; fi
if PATH="$TMP/bin:$PATH" "$SCRIPT" history "$TMP/missing" 2>"$TMP/missing.err" >/dev/null; then fail "history on a missing directory exited 0"; fi
if grep -q Traceback "$TMP/missing.err"; then fail "history on a missing directory ended in a traceback: $(cat "$TMP/missing.err")"; fi
[ ! -e "$FX_GH_ARGS" ] || fail "history outside a clone ran gh: $(cat "$FX_GH_ARGS")"
echo "ok: history: no <dir>, a directory outside a clone or a missing one exits 1 without running gh"
