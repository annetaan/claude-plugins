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

"$TMP/skills/pj-auto/scripts/auto.sh" --rules | python3 -I -c '
import json, sys
e = json.loads(sys.stdin.read())
rules = [b["rule"] for b in e["base"]]
assert len(rules) == 8, rules
assert "Bash(" + sys.argv[1] + "/workflow/scripts/panel.sh:*)" in rules, rules
assert "Bash(" + sys.argv[1] + "/workflow/scripts/level.sh:*)" in rules, rules
assert "Bash(" + sys.argv[1] + "/workflow/scripts/comments.sh:*)" in rules, rules
' "$TMP/skills" || fail "auto.sh --rules does not list eight base rules with panel.sh, level.sh and comments.sh"
echo "ok: auto.sh --rules lists eight base rules, panel.sh, level.sh and comments.sh among them"

"$TMP/skills/pj-auto/scripts/auto.sh" --rules | python3 -I -c '
import json, os, re, sys
skills, root = sys.argv[1], sys.argv[2]
e = json.loads(sys.stdin.read())
prefix, suffix = "Bash(" + skills + "/", ":*)"
covered = {b["rule"][len(prefix):-len(suffix)] for b in e["base"] if b["rule"].startswith(prefix) and b["rule"].endswith(suffix)}
call = re.compile(r"\$[A-Z]+(?:/\.\./([a-z0-9-]+))?/scripts/([A-Za-z0-9_-]+\.[a-z]+)")
missing = set()
for skill in ("pj1-plan", "pj3-doctor", "pj4-running", "workflow"):
    for here, _, files in os.walk(os.path.join(root, "plugins/annetaan/skills", skill)):
        for name in files:
            if not name.endswith(".md"):
                continue
            for other, script in call.findall(open(os.path.join(here, name)).read()):
                needed = (other or skill) + "/scripts/" + script
                if needed not in covered and needed != "workflow/scripts/worktree.sh":
                    missing.add(needed)
assert not missing, "no base rule for: " + ", ".join(sorted(missing))
' "$TMP/skills" "$ROOT" || fail "a script the pj skills or the workflow skill call has no base rule"
echo "ok: every script the pj skills and the workflow skill call has a base rule, worktree.sh aside"
