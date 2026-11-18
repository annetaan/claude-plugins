#!/usr/bin/env bash
# Test: auto.sh holds caffeinate for the drive and starts each child with a 60 minute background wait.
#
# Run: bash tests/auto-drive.sh   (exit 0 is success, anything else is failure)
# Runs offline: a fake `claude` and `caffeinate` are put on the PATH, and a stub project.sh answers --next.
# AUTO_SH=<path> tests another copy of auto.sh.
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj-auto/scripts/auto.sh"
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

# A stub project.sh: --next answers "running" with a new fingerprint twice, then "done".
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

# A fake claude: records the variable and prints a done result.
cat > "$TMP/bin/claude" <<'EOS'
#!/usr/bin/env bash
echo "${CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS-unset}" >> "$FAKE_LOG/ceiling"
echo '{"is_error":false,"result":"all good\nunattended: done"}'
EOS
# A fake caffeinate: records its arguments and the command of the process its -w names (auto.sh is still running then).
cat > "$TMP/bin/caffeinate" <<'EOS'
#!/usr/bin/env bash
ps -o command= -p "$3" >> "$FAKE_LOG/caffeinate-target"
echo "$*" >> "$FAKE_LOG/caffeinate"
EOS
chmod +x "$TMP/bin/claude" "$TMP/bin/caffeinate"

export FAKE_LOG="$TMP/fake"
export COUNTER="$TMP/counter"
mkdir -p "$FAKE_LOG" "$TMP/log"
export PATH="$TMP/bin:$PATH"

git init -q -b main "$TMP/repo"
cd "$TMP/repo"
OUT="$("$TMP/skills/pj-auto/scripts/auto.sh" 7 --log "$TMP/log")" || fail "auto.sh exited non-zero"

# Let the backgrounded fake caffeinate finish writing.
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$FAKE_LOG/caffeinate" ] && break; sleep 0.2; done

[ "$(sort -u "$FAKE_LOG/ceiling")" = "3600000" ] || fail "the child did not get 3600000: $(cat "$FAKE_LOG/ceiling")"
[ "$(wc -l < "$FAKE_LOG/ceiling" | tr -d ' ')" = "2" ] || fail "expected two child runs"
echo "ok: the child runs with a 60 minute background wait"

grep -Eq '^-i -w [0-9]+$' "$FAKE_LOG/caffeinate" || fail "caffeinate was not called with -i -w <pid>: $(cat "$FAKE_LOG/caffeinate" 2>/dev/null)"
grep -q 'pj-auto/scripts/auto.sh' "$FAKE_LOG/caffeinate-target" || fail "caffeinate -w does not name auto.sh: $(cat "$FAKE_LOG/caffeinate-target")"
echo "ok: the drive holds caffeinate -i on its own pid"

STATUSES="$(printf '%s\n' "$OUT" | python3 -I -c 'import json,sys; print(" ".join(json.loads(l)["status"] for l in sys.stdin))')"
[ "$STATUSES" = "started begin step begin step ended" ] || fail "unexpected statuses: $STATUSES"
printf '%s\n' "$OUT" | tail -n 1 | grep -q '"reason": "done"' || fail "the drive did not end as done"
echo "ok: a drive of done steps ends as before"
