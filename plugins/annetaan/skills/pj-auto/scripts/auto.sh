#!/usr/bin/env bash
# Drives pj3-doctor and pj4-running on one project until the project needs the user, and prints each step as one JSON line.
# Each step is a fresh `claude -p` run of one skill in unattended mode, started in the main working tree.
# It writes nothing to GitHub itself (the children do), and it decides the next step only from
# ../../pj1-plan/scripts/project.sh --next. It never reads a child's report beyond the last line of its result.
# It writes the files of one drive into the log directory: drive.jsonl (every line it prints), <i>-<run>.json and
# <i>-<run>.err of each child. It reads <dir>/stop before every step, and ends when the file exists.
# It never kills a child, and it always ends with an "ended" line and exit 0, once it has started.
set -uo pipefail

die() { echo "auto: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: auto.sh <P> --log <dir>   drive project <P> until it needs the user, logging into the existing directory <dir>
Every line on standard output is one JSON object with "status": started, step or ended.
Create <dir>/stop to end the drive after the current step.
Exit 1 means a usage error. Otherwise it exits 0.
USAGE
  exit 1
}

[ $# -eq 3 ] && [ "$2" = "--log" ] || usage
P="$1"
LOG="$3"
case "$P" in ''|*[!0-9]*) die "the project must be a number: $P" ;; esac
[ -d "$LOG" ] || die "no such directory: $LOG"
LOG="$(cd "$LOG" && pwd)"

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

PROJECT="$(cd "$(dirname "$0")/../../pj1-plan/scripts" && pwd)/project.sh"
[ -x "$PROJECT" ] || die "no such script: $PROJECT"

# emit status key=value ... prints one JSON line and appends it to drive.jsonl.
# key=value is a string, key:=value is raw JSON.
emit() {
  python3 -I -c '
import json, re, sys
obj = {}
for a in sys.argv[2:]:
    m = re.match(r"([^=:]+)(:?)=(.*)", a, re.S)
    obj[m.group(1)] = json.loads(m.group(3)) if m.group(2) else m.group(3)
line = json.dumps(obj, ensure_ascii=False)
print(line)
with open(sys.argv[1], "a") as f:
    f.write(line + "\n")
' "$LOG/drive.jsonl" "$@"
}

# jget <json> <key> prints the value, or nothing for null.
jget() {
  python3 -I -c '
import json, sys
v = json.loads(sys.argv[1]).get(sys.argv[2])
print("" if v is None else v)
' "$1" "$2"
}

MAIN=""
NOLINE=""
FINISHED=0

# end <reason> <next-json> <message>
end() {
  local nolist
  nolist="[$(echo "$NOLINE" | tr -s ' ' ',' | sed 's/^,//; s/,$//')]"
  emit status=ended reason="$1" next:="$2" message="$3" noLine:="$nolist" log="$LOG"
  exit 0
}

MAIN="$(git worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | head -n 1)"
if [ -z "$MAIN" ]; then
  emit status=started log="$LOG" main="" project:="$P"
  end not-a-repo null "not inside a git repository"
fi
if ! command -v claude >/dev/null 2>&1; then
  emit status=started log="$LOG" main="$MAIN" project:="$P"
  end no-claude null "the claude CLI is not installed"
fi

emit status=started log="$LOG" main="$MAIN" project:="$P"

# next_step sets NEXT_JSON, or ends the drive when project.sh fails.
next_step() {
  local err
  NEXT_JSON="$(cd "$MAIN" && "$PROJECT" "$P" --next 2>"$LOG/project.err")"
  if [ $? -ne 0 ] || [ -z "$NEXT_JSON" ]; then
    err="$(cat "$LOG/project.err" 2>/dev/null)"
    end project null "${err:-project.sh failed}"
  fi
}

DOCTOR_KEYS=""
I=0

next_step
CUR="$NEXT_JSON"
while :; do
  [ -e "$LOG/stop" ] && end stop-requested "$CUR" "stopped at the user's word"

  NEXT="$(jget "$CUR" next)"
  WHY="$(jget "$CUR" why)"
  ISSUE="$(jget "$CUR" issue)"
  case "$NEXT" in
    user|done) end "$NEXT" "$CUR" "$WHY" ;;
    doctor|running) ;;
    *) end project "$CUR" "unknown next: $NEXT" ;;
  esac

  if [ "$NEXT" = "doctor" ]; then
    KEY="${ISSUE:-order}"
    case "$DOCTOR_KEYS" in
      *"|$KEY|"*"|$KEY|"*) end doctor-cap "$CUR" "pj3-doctor already ran twice on $KEY" ;;
    esac
    DOCTOR_KEYS="$DOCTOR_KEYS|$KEY|"
    SKILL="pj3-doctor"
    RUN="doctor"
  else
    SKILL="pj4-running"
    RUN="running"
  fi

  I=$((I + 1))
  OUT="$LOG/$I-$RUN.json"
  ERR="$LOG/$I-$RUN.err"
  (cd "$MAIN" && claude -p "/annetaan:$SKILL $P unattended" --output-format json < /dev/null > "$OUT" 2> "$ERR")
  CODE=$?

  VERDICT="$(python3 -I -c '
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("failed")
    sys.exit(0)
if not isinstance(d, dict) or d.get("is_error"):
    print("failed")
    sys.exit(0)
lines = [l.strip() for l in str(d.get("result") or "").splitlines() if l.strip()]
last = lines[-1] if lines else ""
if last.startswith("unattended: needs-user"):
    print("needs-user\t" + last)
elif last == "unattended: done":
    print("done")
else:
    print("no-line")
' "$OUT")"

  if [ "$CODE" -ne 0 ] || [ "$VERDICT" = "failed" ]; then
    end child-failed "$CUR" "$SKILL failed: see $ERR and $OUT"
  fi

  case "$VERDICT" in
    needs-user*)
      end needs-user "$CUR" "${VERDICT#needs-user	}" ;;
    done) RESULT=done ;;
    *) RESULT=no-line; NOLINE="$NOLINE $I" ;;
  esac
  emit status=step i:="$I" run="$RUN" why="$WHY" issue:="${ISSUE:-null}" log="$LOG" result="$RESULT"

  next_step
  if [ "$(jget "$NEXT_JSON" fingerprint)" = "$(jget "$CUR" fingerprint)" ]; then
    end no-progress "$NEXT_JSON" "the state did not change after step $I"
  fi
  CUR="$NEXT_JSON"
done
