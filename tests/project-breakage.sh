#!/usr/bin/env bash
# Test: a sub-issue may declare a check it leaves broken (### Left broken), and project.sh reads it. --check fails
# for a breakage no sub-issue closes, and the project view reports each declared breakage as unclosed, planned, open
# or closed.
#
# Run: bash tests/project-breakage.sh   (exit 0 is success, anything else is failure)
# Runs offline: a fake `gh` answers the GitHub queries from a JSON file each case writes, and the "remote" is a bare
# repository in a temp dir.
# PROJECT_SH=<path> tests another copy of project.sh.
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj1-plan/scripts/project.sh"
SCRIPT="${PROJECT_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Cut off the user's git configuration (signing, hooks, templates).
export HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

fail() { echo "FAIL: $*" >&2; exit 1; }

# A clone with one source file and a pj/1 branch on origin.
cd "$TMP"
git init -q -b main work
git init -q --bare origin.git
(
  cd work
  mkdir src
  echo 'export function foo() {}' > src/app.ts
  git add src/app.ts
  git commit -q -m "init"
  git remote add origin ../origin.git
  git push -q origin main main:refs/heads/pj/1
)

# A fake gh. The sub-issues of the project are read from the file named by ISSUES_JSON.
mkdir bin
cat > bin/gh <<'PYEOF'
#!/usr/bin/env python3
import json, os, re, sys
args = sys.argv[1:]
if args[:2] == ["pr", "list"]:
    print("[]")
    sys.exit(0)
if args[:2] == ["api", "graphql"]:
    query = next(a[len("query="):] for a in args if a.startswith("query="))
    if "updatedAt body" in query:
        subs = json.load(open(os.environ["ISSUES_JSON"]))
        parent = {"number": 1, "title": "Project", "state": "OPEN", "stateReason": None,
                  "updatedAt": "2000-01-01T00:00:00Z",
                  "body": "Base: `pj/1` from `main`\n\n## Goal\n\nx\n",
                  "labels": {"nodes": []}, "blockedBy": {"nodes": []}, "blocking": {"nodes": []},
                  "subIssues": {"totalCount": len(subs), "nodes": subs}}
        print(json.dumps({"data": {"repository": {"issue": parent}}}))
    elif "ro: ref(" in query:
        print(json.dumps({"data": {"repository": {"ro": {"compare": {"status": "IDENTICAL"}},
                                                  "mo": {"totalCount": 0}, "po": {"nodes": []}}}}))
    else:
        sys.stderr.write("fake gh: unexpected query\n")
        sys.exit(1)
    sys.exit(0)
sys.stderr.write("fake gh: unexpected call: %s\n" % " ".join(args))
sys.exit(1)
PYEOF
chmod +x bin/gh
export PATH="$TMP/bin:$PATH"
export ISSUES_JSON="$TMP/issues.json"

# issues <breaker state> <closer state> <closer blocked by breaker?> <closer carries the check?> <breaker declares?>
# writes the two sub-issues. #2 is the breaker, #3 the closer. A state is OPEN, COMPLETED or NOT_PLANNED.
issues() {
  python3 - "$@" <<'PY' >"$ISSUES_JSON"
import json, sys
breaker, closer, blocked, carries, declares = sys.argv[1:6]
check = "bash tests/signin.sh"
def body(declare, criterion):
    left = "\n### Left broken\n\n- `%s`: fails until the callers move\n" % check if declare else ""
    crit = "- `%s` passes\n" % check if criterion else "- `foo` is renamed.\n"
    return ("## Goal\n\nRename foo.\n\n## Design\n\n- `src/app.ts` (changed): rename `foo`.\n%s\n"
            "## Acceptance criteria\n\n%s\n## Decisions\n\nNone.\n\n## Out of scope\n\nNothing.\n" % (left, crit))
def node(number, state, blockers, text):
    return {"number": number, "title": "Task %d" % number,
            "state": "OPEN" if state == "OPEN" else "CLOSED",
            "stateReason": None if state == "OPEN" else state,
            "updatedAt": "2000-01-01T00:00:00Z", "body": text,
            "labels": {"nodes": [{"name": "ready"}]},
            "blockedBy": {"nodes": [{"number": b, "state": "OPEN", "parent": {"number": 1}} for b in blockers]},
            "blocking": {"nodes": []}}
print(json.dumps([
    node(2, breaker, [], body(declares == "yes", False)),
    node(3, closer, [2] if blocked == "yes" else [], body(False, carries == "yes")),
]))
PY
}

check() { (cd "$TMP/work" && bash "$SCRIPT" -R test/repo 1 --check "$1"); }
view() { bash "$SCRIPT" -R test/repo 1; }
# assert <json> <python expression over d> <what>
assert() { printf '%s' "$1" | python3 -c "import json, sys; d = json.load(sys.stdin); assert $2, d" || fail "$3: $1"; }

cd "$TMP/work"

# Case 1: a breaker, a closer blocked by it and carrying the check. --check passes for both.
issues OPEN OPEN yes yes yes
for n in 2 3; do
  out="$(check $n)"
  assert "$out" 'd["ok"] is True and d["breakage"] == {"unclosed": []}' "a declared breakage with a closer, #$n"
done
echo "ok: a declared breakage with a closer passes --check"

# Case 2: no closer. --check fails and names the issue and the check.
issues OPEN OPEN yes no yes
out="$(check 2)"
assert "$out" 'd["ok"] is False and d["breakage"]["unclosed"] == [{"issue": 2, "check": "bash tests/signin.sh"}]' \
  "a breakage with no closer"
echo "ok: a breakage with no closer fails --check with breakage.unclosed"

# Case 3: a task that carries the check but is not blocked by the breaker does not count.
issues OPEN OPEN no yes yes
out="$(check 2)"
assert "$out" 'd["ok"] is False and len(d["breakage"]["unclosed"]) == 1' "a closer not blocked by the breaker"
echo "ok: a closer not blocked by the breaker does not count"

# Case 4: the closer lost the check. The entry is unclosed for every issue of the project, the closer's --check too.
issues OPEN OPEN yes no yes
for n in 2 3; do
  out="$(check $n)"
  assert "$out" 'd["ok"] is False and d["breakage"]["unclosed"] == [{"issue": 2, "check": "bash tests/signin.sh"}]' \
    "a closer without the check, #$n"
done
echo "ok: a closer whose body lost the check leaves the entry unclosed for every issue of the project"

# Case 5: the closer is closed as completed with no pull request behind it. It still closes.
issues OPEN COMPLETED yes yes yes
out="$(check 2)"
assert "$out" 'd["ok"] is True and d["breakage"]["unclosed"] == []' "a closer closed as completed"
echo "ok: a closer closed as completed with no pull request still closes"

# Case 6: parent.breakage reports planned, open and closed.
issues OPEN OPEN yes yes yes
assert "$(view)" 'd["parent"]["breakage"] == [{"issue": 2, "check": "bash tests/signin.sh", "closedBy": [3], "state": "planned"}]' "planned"
issues COMPLETED OPEN yes yes yes
assert "$(view)" '[b["state"] for b in d["parent"]["breakage"]] == ["open"]' "open"
issues COMPLETED COMPLETED yes yes yes
assert "$(view)" '[b["state"] for b in d["parent"]["breakage"]] == ["closed"]' "closed"
issues OPEN OPEN yes no yes
assert "$(view)" '[b["state"] for b in d["parent"]["breakage"]] == ["unclosed"] and all("criteria" not in i for i in d["issues"])' "unclosed"
issues NOT_PLANNED OPEN yes yes yes
assert "$(view)" 'd["parent"]["breakage"] == []' "a breaker closed as not planned"
echo "ok: parent.breakage reports planned, open and closed"

# The next step is still answered.
issues OPEN OPEN yes yes yes
out="$(bash "$SCRIPT" -R test/repo 1 --next)"
assert "$out" 'd["next"] in ("doctor", "running", "user", "done")' "--next"
echo "ok: --next still answers"
