#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/plugins/annetaan/skills/pj-auto/scripts/auto.sh"
SCRIPT="${AUTO_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

fail() { echo "FAIL: $*" >&2; exit 1; }

mkdir -p "$TMP/skills/pj-auto/scripts" "$TMP/skills/pj1-plan/scripts" "$TMP/bin" "$TMP/repo"
cp "$SCRIPT" "$TMP/skills/pj-auto/scripts/auto.sh"
chmod +x "$TMP/skills/pj-auto/scripts/auto.sh"

cat > "$TMP/skills/pj1-plan/scripts/project.sh" <<'EOS'
#!/usr/bin/env bash
n=$(cat "$COUNTER" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$COUNTER"
if [ "$n" -le 2 ]; then
  echo "{\"next\":\"running\",\"why\":\"step $n\",\"issue\":$n,\"fingerprint\":\"f$n\"}"
else
  echo "{\"next\":\"done\",\"why\":\"all closed\",\"issue\":null,\"fingerprint\":\"f$n\"}"
fi
EOS
chmod +x "$TMP/skills/pj1-plan/scripts/project.sh"

cat > "$TMP/bin/claude" <<'EOS'
#!/usr/bin/env bash
echo "${CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS-unset}" >> "$FAKE_LOG/ceiling"
echo "$*" >> "$FAKE_LOG/args"
printf '%s\n' "$@" > "$FAKE_LOG/argv"
[ -n "${FX_STDERR:-}" ] && echo "$FX_STDERR" >&2
if [ -n "${FX_RESULT:-}" ]; then
  echo "$FX_RESULT"
else
  echo '{"is_error":false,"result":"all good\nunattended: done"}'
fi
exit 0
EOS
cat > "$TMP/bin/caffeinate" <<'EOS'
#!/usr/bin/env bash
ps -o command= -p "$3" >> "$FAKE_LOG/caffeinate-target"
echo "$*" >> "$FAKE_LOG/caffeinate"
EOS
chmod +x "$TMP/bin/claude" "$TMP/bin/caffeinate"

export FAKE_LOG="$TMP/fake"
export COUNTER="$TMP/counter"
export PATH="$TMP/bin:$PATH"

git init -q -b main "$TMP/repo"
cd "$TMP/repo"

RUNS=0
run_drive() {
  RUNS=$((RUNS + 1))
  rm -rf "$FAKE_LOG" "$COUNTER"
  mkdir -p "$FAKE_LOG" "$TMP/log$RUNS"
  OUT="$("$TMP/skills/pj-auto/scripts/auto.sh" 7 --log "$TMP/log$RUNS" "$@")" || fail "auto.sh exited non-zero"
}

statuses() { printf '%s\n' "$OUT" | python3 -I -c 'import json,sys; print(" ".join(json.loads(l)["status"] for l in sys.stdin))'; }

run_drive

for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$FAKE_LOG/caffeinate" ] && break; sleep 0.2; done

[ "$(sort -u "$FAKE_LOG/ceiling")" = "3600000" ] || fail "the child did not get 3600000: $(cat "$FAKE_LOG/ceiling")"
[ "$(wc -l < "$FAKE_LOG/ceiling" | tr -d ' ')" = "2" ] || fail "expected two child runs"
echo "ok: the child runs with a 60 minute background wait"

grep -Eq '^-i -w [0-9]+$' "$FAKE_LOG/caffeinate" || fail "caffeinate was not called with -i -w <pid>: $(cat "$FAKE_LOG/caffeinate" 2>/dev/null)"
grep -q 'pj-auto/scripts/auto.sh' "$FAKE_LOG/caffeinate-target" || fail "caffeinate -w does not name auto.sh: $(cat "$FAKE_LOG/caffeinate-target")"
echo "ok: the drive holds caffeinate -i on its own pid"

STATUSES="$(statuses)"
[ "$STATUSES" = "started begin step begin step ended" ] || fail "unexpected statuses: $STATUSES"
printf '%s\n' "$OUT" | tail -n 1 | grep -q '"reason": "done"' || fail "the drive did not end as done"
echo "ok: a drive of done steps ends as before"

"$TMP/skills/pj-auto/scripts/auto.sh" --rules > "$TMP/base.json" || fail "auto.sh --rules exited non-zero"
python3 -I -c '
import json, sys
base = [b["rule"] for b in json.load(open(sys.argv[1]))["base"]]
argv = open(sys.argv[2]).read().split("\n")[:-1]
mode = argv.index("--permission-mode")
assert argv[mode + 1] == "auto", argv
granted = argv[argv.index("--allowedTools") + 1:argv.index("--add-dir")]
assert len(base) == 9, base
assert granted == base, (granted, base)
' "$TMP/base.json" "$FAKE_LOG/argv" || fail "the child did not run in auto mode with the base rules granted: $(cat "$FAKE_LOG/argv")"
echo "ok: the child runs in auto mode with the base rules of --rules granted by --allowedTools"

if grep -q "level=" "$FAKE_LOG/args"; then fail "a drive without --level passed a level: $(cat "$FAKE_LOG/args")"; fi
run_drive --level high
[ "$(grep -c " tmp=[^ ]* level=high " "$FAKE_LOG/args")" = 2 ] || fail "--level high did not reach every run: $(cat "$FAKE_LOG/args")"
echo "ok: --level high passes level=high to every claude -p, and no --level passes none"

if "$TMP/skills/pj-auto/scripts/auto.sh" 7 --log "$TMP" --level 4 >/dev/null 2>&1; then fail "--level 4 exited 0"; fi
if "$TMP/skills/pj-auto/scripts/auto.sh" 7 --log "$TMP" --level 2 >/dev/null 2>&1; then fail "--level 2 exited 0"; fi
if "$TMP/skills/pj-auto/scripts/auto.sh" 7 --log "$TMP" --tier 1 >/dev/null 2>&1; then fail "--tier 1 exited 0"; fi
echo "ok: a bad --level exits 1"

NOLAST='{"is_error":false,"result":"working on it"}'
BGLINE='Background tasks still running 10m after the last turn (shell "Check issue 79 against the code"); stopping them. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.'

FX_RESULT="$NOLAST" FX_STDERR="$BGLINE" run_drive
[ "$(statuses)" = "started begin ended" ] || fail "bg-killed: unexpected statuses: $(statuses)"
printf '%s\n' "$OUT" | tail -n 1 | python3 -I -c '
import json, sys
e = json.loads(sys.stdin.read())
assert e["reason"] == "bg-killed", e
assert e["i"] == 1, e
assert e["noLine"] == [], e
assert "shell \"Check issue 79 against the code\"" in e["message"], e
' || fail "bg-killed: the ended line is wrong: $(printf '%s\n' "$OUT" | tail -n 1)"
[ "$(wc -l < "$FAKE_LOG/ceiling" | tr -d ' ')" = "1" ] || fail "bg-killed: expected one child run"
echo "ok: no last line with stopped background tasks ends the drive as bg-killed and names them"

FX_STDERR="$BGLINE" run_drive
[ "$(statuses)" = "started begin step begin step ended" ] || fail "done with bg line: unexpected statuses: $(statuses)"
printf '%s\n' "$OUT" | tail -n 1 | grep -q '"reason": "done"' || fail "done with bg line: the drive did not end as done"
echo "ok: a done run with stopped background tasks goes on"

FX_RESULT="$NOLAST" run_drive
printf '%s\n' "$OUT" | python3 -I -c '
import json, sys
lines = [json.loads(l) for l in sys.stdin]
steps = [l for l in lines if l["status"] == "step"]
assert [s["result"] for s in steps] == ["no-line", "no-line"], steps
assert lines[-1]["reason"] == "done", lines[-1]
assert lines[-1]["noLine"] == [1, 2], lines[-1]
' || fail "no-line: unexpected drive: $OUT"
echo "ok: no last line without the message is still no-line"

DENIED='{"is_error":false,"result":"stuck\nunattended: needs-user make test was refused","permission_denials":[{"tool_name":"Bash","tool_use_id":"t1","tool_input":{"command":"make test","description":"d"}},{"tool_name":"Write","tool_use_id":"t2","tool_input":{"file_path":"/etc/x","content":"c"}},{"tool_name":"WebFetch","tool_use_id":"t3","tool_input":{"url":"https://example.com"}}]}'
FX_RESULT="$DENIED" run_drive
[ "$(statuses)" = "started begin ended" ] || fail "denials: unexpected statuses: $(statuses)"
printf '%s\n' "$OUT" | tail -n 1 | python3 -I -c '
import json, sys
e = json.loads(sys.stdin.read())
assert e["reason"] == "needs-user", e
assert e["i"] == 1, e
assert e["denials"] == [
    {"tool": "Bash", "input": "make test"},
    {"tool": "Write", "input": "/etc/x"},
    {"tool": "WebFetch", "input": "{\"url\":\"https://example.com\"}"},
], e
' || fail "denials: the needs-user ended line is wrong: $(printf '%s\n' "$OUT" | tail -n 1)"

DONE_DENIED='{"is_error":false,"result":"ok\nunattended: done","permission_denials":[{"tool_name":"Bash","tool_use_id":"t1","tool_input":{"command":"make test","description":"d"}}]}'
FX_RESULT="$DONE_DENIED" run_drive
printf '%s\n' "$OUT" | python3 -I -c '
import json, sys
lines = [json.loads(l) for l in sys.stdin]
steps = [l for l in lines if l["status"] == "step"]
assert len(steps) == 2, lines
for s in steps:
    assert s["denials"] == [{"tool": "Bash", "input": "make test"}], s
assert lines[-1]["reason"] == "done", lines[-1]
assert lines[-1]["i"] is None, lines[-1]
assert lines[-1]["denials"] == [], lines[-1]
' || fail "denials: a done drive with a refused call is wrong: $OUT"

FX_RESULT='not json' run_drive
printf '%s\n' "$OUT" | tail -n 1 | python3 -I -c '
import json, sys
e = json.loads(sys.stdin.read())
assert e["reason"] == "child-failed", e
assert e["denials"] == [], e
' || fail "denials: the child-failed ended line is wrong: $(printf '%s\n' "$OUT" | tail -n 1)"

run_drive
printf '%s\n' "$OUT" | python3 -I -c '
import json, sys
lines = [json.loads(l) for l in sys.stdin]
carrying = [l for l in lines if l["status"] in ("step", "ended")]
assert len(carrying) == 3, lines
for l in carrying:
    assert l["denials"] == [], l
' || fail "denials: a clean drive carries a refused call: $OUT"
echo "ok: the step and ended lines carry the tool calls the run was refused, each once"

unset CLAUDE_CONFIG_DIR
USER_SETTINGS="$HOME/.claude/settings.json"
PROJECT_SETTINGS="$TMP/repo/.claude/settings.json"
LOCAL_SETTINGS="$TMP/repo/.claude/settings.local.json"
mkdir -p "$HOME/.claude" "$TMP/repo/.claude"

settings() {
  rm -f "$USER_SETTINGS" "$PROJECT_SETTINGS" "$LOCAL_SETTINGS"
  [ -z "$1" ] || printf '%s\n' "$1" > "$USER_SETTINGS"
  [ -z "$2" ] || printf '%s\n' "$2" > "$PROJECT_SETTINGS"
  [ -z "$3" ] || printf '%s\n' "$3" > "$LOCAL_SETTINGS"
}

judged() {
  RULES="$("$TMP/skills/pj-auto/scripts/auto.sh" --rules)" || fail "auto.sh --rules exited non-zero"
}

expect() {
  printf '%s\n' "$RULES" | python3 -I -c '
import json, os, sys
rule, verdict, where, by = (sys.argv[1:] + [""])[:4]
e = json.loads(sys.stdin.read())
files = {
    "user": os.path.join(os.environ["HOME"], ".claude", "settings.json"),
    "project": os.path.join(e["main"], ".claude", "settings.json"),
    "local": os.path.join(e["main"], ".claude", "settings.local.json"),
    "": None,
}
hit = [j for j in e["base"] if j["rule"] == rule]
assert hit, rule
want = {"rule": rule, "verdict": verdict, "file": files[where], "by": by or None}
assert hit[0] == want, (hit[0], want)
' "$@" || fail "expected $2 for $1 ($3 ${4:-}): $RULES"
}

settings "" "" ""
judged
printf '%s\n' "$RULES" | python3 -I -c '
import json, sys
skills = sys.argv[1]
e = json.loads(sys.stdin.read())
assert sorted(e) == ["base", "main", "settings", "status"], sorted(e)
rules = [b["rule"] for b in e["base"]]
assert len(rules) == 9, rules
for script in ("pj1-plan/scripts/issue.sh", "workflow/scripts/panel.sh", "workflow/scripts/level.sh", "workflow/scripts/comments.sh"):
    assert "Bash(" + skills + "/" + script + ":*)" in rules, (script, rules)
for b in e["base"]:
    assert sorted(b) == ["by", "file", "rule", "verdict"], b
    assert (b["verdict"], b["file"], b["by"]) == ("granted", None, None), b
' "$TMP/skills" || fail "auto.sh --rules does not grant nine base rules with issue.sh, panel.sh, level.sh and comments.sh: $RULES"
echo "ok: auto.sh --rules lists nine base rules, issue.sh, panel.sh, level.sh and comments.sh among them, all granted with no settings"

settings '{"permissions": {"allow": ["Bash(ghx:*)", "Bash(gh:*)"]}}' "" ""
judged
expect 'Bash(gh:*)' granted ""
echo "ok: auto.sh --rules grants every base rule with no settings, and an allow rule changes nothing"

settings '{"permissions": {"deny": ["Bash(gh:*)"]}}' "" ""
judged
expect 'Bash(gh:*)' blocked user 'Bash(gh:*)'
expect 'Bash(git:*)' granted ""
for form in 'Bash(gh *)' 'Bash' 'Bash(*)' 'Bash(gh pr:*)' 'Bash(gh pr merge)'; do
  settings "" "" "{\"permissions\": {\"ask\": [\"$form\"]}}"
  judged
  expect 'Bash(gh:*)' blocked local "$form"
done
settings '{"permissions": {"ask": ["Bash(ghx:*)", "Bash(g:*)"]}}' "" ""
judged
expect 'Bash(gh:*)' granted ""
settings '{"permissions": {"ask": ["Bash(gh pr:*)"]}}' '{"permissions": {"allow": ["Bash(gh:*)"]}}' '{"permissions": {"deny": ["Bash(gh pr merge)"]}}'
judged
expect 'Bash(gh:*)' blocked local 'Bash(gh pr merge)'
echo "ok: auto.sh --rules blocks by a deny or ask rule of the same string, the space form, the tool alone, Bash(*), a narrower one, deny first, local file named"

settings "{\"permissions\": {\"deny\": [\"Read(/$TMP/**)\"]}}" "" ""
judged
expect "Read(/$TMP/skills/**)" blocked user "Read(/$TMP/**)"
settings "{\"permissions\": {\"ask\": [\"Read(/$TMP/skills/pj-auto/**)\"]}}" "" ""
judged
expect "Read(/$TMP/skills/**)" blocked user "Read(/$TMP/skills/pj-auto/**)"
mkdir -p "$HOME/skills/pj-auto/scripts"
cp "$TMP/skills/pj-auto/scripts/auto.sh" "$HOME/skills/pj-auto/scripts/auto.sh"
settings '{"permissions": {"deny": ["Read(~/skills/**)"]}}' "" ""
RULES="$("$HOME/skills/pj-auto/scripts/auto.sh" --rules)" || fail "the copy of auto.sh under HOME exited non-zero"
expect "Read(/$HOME/skills/**)" blocked user 'Read(~/skills/**)'
echo "ok: auto.sh --rules blocks the Read rule by a glob written with ~/ or //, wider or narrower"

settings "" "" '{"permissions": {"deny": ["Bash(gh:*)"]}'
judged
expect 'Bash(gh:*)' granted ""
printf '%s\n' "$RULES" | python3 -I -c '
import json, os, sys
e = json.loads(sys.stdin.read())
local = [s for s in e["settings"] if s["file"] == os.path.join(e["main"], ".claude", "settings.local.json")]
assert len(local) == 1 and local[0]["exists"] and local[0]["error"], e["settings"]
assert [s for s in e["settings"] if s is not local[0] and s["error"]] == [], e["settings"]
assert all(sorted(s) == ["error", "exists", "file"] for s in e["settings"]), e["settings"]
' || fail "the settings file with a JSON error is not named: $RULES"
settings "" "" ""
if "$TMP/skills/pj-auto/scripts/auto.sh" --rules 'Bash(gh:*)' >/dev/null 2>&1; then fail "--rules with an argument exited 0"; fi
echo "ok: auto.sh --rules names a settings file with an error and counts its rules as absent, and takes no argument"

"$TMP/skills/pj-auto/scripts/auto.sh" --rules | python3 -I -c '
import json, os, re, sys
skills, root = sys.argv[1], sys.argv[2]
e = json.loads(sys.stdin.read())
prefix, suffix = "Bash(" + skills + "/", ":*)"
ruled = {b["rule"][len(prefix):-len(suffix)] for b in e["base"] if b["rule"].startswith(prefix) and b["rule"].endswith(suffix)}
call = re.compile(r"\$[A-Z]+(?:/\.\./([a-z0-9-]+))?/scripts/([A-Za-z0-9_-]+\.[a-z]+)")
unruled = set()
for skill in ("pj1-plan", "pj3-doctor", "pj4-running", "workflow"):
    for here, _, files in os.walk(os.path.join(root, "plugins/annetaan/skills", skill)):
        for name in files:
            if not name.endswith(".md"):
                continue
            for other, script in call.findall(open(os.path.join(here, name)).read()):
                needed = (other or skill) + "/scripts/" + script
                if needed not in ruled and needed != "workflow/scripts/worktree.sh":
                    unruled.add(needed)
assert not unruled, "no base rule for: " + ", ".join(sorted(unruled))
' "$TMP/skills" "$ROOT" || fail "a script the pj skills or the workflow skill call has no base rule"
echo "ok: every script the pj skills and the workflow skill call has a base rule, worktree.sh aside"
