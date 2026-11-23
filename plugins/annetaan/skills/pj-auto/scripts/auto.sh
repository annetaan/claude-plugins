#!/usr/bin/env bash
set -uo pipefail

die() { echo "auto: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: auto.sh <P> --log <dir> [--level <n>]   drive project <P> until it needs the user, logging into the existing directory <dir>;
                                               --level passes level=<n>, 1, 2 or 3, to every run
usage: auto.sh --rules                         print the rules every drive needs, with real paths, and the allow, deny and ask rules of the user's settings
In the drive form, every line on standard output is one JSON object with "status": started, begin, step or ended.
Create <dir>/stop to end the drive after the current step.
Exit 1 means a usage error. Otherwise it exits 0.
USAGE
  exit 1
}

rules() {
  local main skills
  main="$(git worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | head -n 1)"
  [ -n "$main" ] || die "not inside a git repository"
  skills="$(cd "$(dirname "$0")/../.." && pwd)"
  python3 -I -c '
import json, os, sys
main, skills = sys.argv[1], sys.argv[2]
files = [
    os.path.join(os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude"), "settings.json"),
    os.path.join(main, ".claude", "settings.json"),
    os.path.join(main, ".claude", "settings.local.json"),
]
settings = []
for f in files:
    e = {"file": f, "exists": False, "error": None, "allow": [], "deny": [], "ask": []}
    if os.path.exists(f):
        e["exists"] = True
        try:
            with open(f) as fh:
                d = json.load(fh)
            perms = d.get("permissions") if isinstance(d, dict) else None
            if isinstance(perms, dict):
                for k in ("allow", "deny", "ask"):
                    v = perms.get(k)
                    if isinstance(v, list):
                        e[k] = [x for x in v if isinstance(x, str)]
        except Exception as ex:
            e["error"] = str(ex)
    settings.append(e)
names = [
    "Bash(gh:*)",
    "Bash(git:*)",
    "Bash(" + skills + "/pj1-plan/scripts/project.sh:*)",
    "Bash(" + skills + "/pj4-running/scripts/run.sh:*)",
    "Bash(" + skills + "/workflow/scripts/panel.sh:*)",
    "Bash(" + skills + "/workflow/scripts/level.sh:*)",
    "Bash(" + skills + "/workflow/scripts/comments.sh:*)",
    "Read(/" + skills + "/**)",
]
base = [{"rule": r, "in": [e["file"] for e in settings if r in e["allow"]]} for r in names]
print(json.dumps({"status": "rules", "main": main, "base": base, "settings": settings}, ensure_ascii=False))
' "$main" "$skills"
  exit 0
}

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

if [ $# -eq 1 ] && [ "$1" = "--rules" ]; then rules; fi

[ $# -eq 3 ] || [ $# -eq 5 ] || usage
[ "$2" = "--log" ] || usage
P="$1"
LOG="$3"
LEVEL_ARG=""
if [ $# -eq 5 ]; then
  [ "$4" = "--level" ] || usage
  case "$5" in 1|2|3) LEVEL_ARG=" level=$5" ;; *) usage ;; esac
fi
case "$P" in ''|*[!0-9]*) die "the project must be a number: $P" ;; esac
[ -d "$LOG" ] || die "no such directory: $LOG"
LOG="$(cd "$LOG" && pwd)"

PROJECT="$(cd "$(dirname "$0")/../../pj1-plan/scripts" && pwd)/project.sh"
[ -x "$PROJECT" ] || die "no such script: $PROJECT"

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
STEP_I=null

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

end() {
  local nolist
  nolist="[$(echo "$NOLINE" | tr -s ' ' ',' | sed 's/^,//; s/,$//')]"
  emit status=ended reason="$1" next:="$2" message="$3" noLine:="$nolist" i:="$STEP_I" log="$LOG"
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

command -v caffeinate >/dev/null 2>&1 && caffeinate -i -w $$ >/dev/null 2>&1 &

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
  STEP_I="$I"
  OUT="$LOG/$I-$RUN.json"
  ERR="$LOG/$I-$RUN.err"
  DIR="$LOG/$I-$RUN"
  mkdir "$DIR" || end child-failed "$CUR" "cannot create $DIR"
  emit status=begin i:="$I" run="$RUN" why="$WHY" issue:="${ISSUE:-null}" at="$(now)" dir="$DIR" out="$OUT" err="$ERR" log="$LOG"
  (cd "$MAIN" && CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=3600000 claude -p "/annetaan:$SKILL $P unattended tmp=$DIR$LEVEL_ARG" --permission-mode acceptEdits --add-dir "$DIR" --output-format json < /dev/null > "$OUT" 2> "$ERR")
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

  BG="$(python3 -I -c '
import re, sys
found = ""
try:
    with open(sys.argv[1], errors="replace") as f:
        for line in f:
            m = re.match(r"Background tasks still running .+ after the last turn \((.*)\); stopping them\.", line)
            if m:
                found = m.group(1)
except Exception:
    found = ""
print(found)
' "$ERR")"

  case "$VERDICT" in
    needs-user*)
      end needs-user "$CUR" "${VERDICT#needs-user	}" ;;
    done) RESULT=done ;;
    *)
      [ -n "$BG" ] && end bg-killed "$CUR" "claude -p stopped the background tasks of step $I, still running after its wait: $BG"
      RESULT=no-line; NOLINE="$NOLINE $I" ;;
  esac
  emit status=step i:="$I" run="$RUN" why="$WHY" issue:="${ISSUE:-null}" at="$(now)" log="$LOG" result="$RESULT"
  STEP_I=null

  next_step
  if [ "$(jget "$NEXT_JSON" fingerprint)" = "$(jget "$CUR" fingerprint)" ]; then
    end no-progress "$NEXT_JSON" "the state did not change after step $I"
  fi
  CUR="$NEXT_JSON"
done
