#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj1-plan/scripts/project.sh"
SCRIPT="${PROJECT_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

fail() { echo "FAIL: $*" >&2; exit 1; }

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
        parent = {"number": 1, "url": "https://github.com/test/repo/issues/1", "title": "Project", "state": "OPEN", "stateReason": None,
                  "updatedAt": "2000-01-01T00:00:00Z",
                  "body": open(os.environ["PARENT_BODY"]).read(),
                  "labels": {"nodes": []}, "blockedBy": {"nodes": json.loads(os.environ.get("PARENT_BLOCKED_BY", "[]"))},
                  "blocking": {"nodes": []},
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
export PARENT_BODY="$TMP/parent.md"

project() {
  {
    printf 'Base: `pj/1` from `main`\n\n## Goal\n\nx\n\n## Order\n\n'
    local i=1
    for n in "$@"; do printf '%d. #%s\n' "$i" "$n"; i=$((i + 1)); done
  } > "$PARENT_BODY"
}

issue() {
  local number="$1" labels="$2" decision="$3"
  shift 3
  python3 - "$number" "$labels" "$decision" "$@" <<'PY' >>"$TMP/issues.list"
import json, sys
number, labels, decision, blockers = int(sys.argv[1]), sys.argv[2], sys.argv[3], [int(b) for b in sys.argv[4:]]
box = {"open": " ", "ticked": "x"}.get(decision)
if box is None:
    decisions = "None.\n"
else:
    decisions = ("### D1. Which name?\n\nIt changes the export.\n\nOnly you know: the name the callers use.\n\n"
                "- [%s] `bar` (recommended)\n  - the export is `bar`\n- [ ] `baz`\n  - the export is `baz`\n" % box)
body = ("## Goal\n\nRename foo.\n\n## Design\n\n- `src/app.ts` (changed): rename `foo`.\n\n"
        "## Acceptance criteria\n\n- `foo` is renamed.\n\n## Decisions\n\n%s\n## Out of scope\n\nNothing.\n" % decisions)
print(json.dumps({"number": number, "url": "https://github.com/test/repo/issues/%d" % number, "title": "Task %d" % number, "state": "OPEN", "stateReason": None,
                  "updatedAt": "2000-01-01T00:00:00Z", "body": body,
                  "labels": {"nodes": [{"name": l} for l in labels.split(",") if l != "none"]},
                  "blockedBy": {"nodes": [{"number": b, "state": "OPEN", "parent": {"number": 1}} for b in blockers]},
                  "blocking": {"nodes": []}}))
PY
}

flush() {
  python3 -c 'import json, sys; print(json.dumps([json.loads(l) for l in sys.stdin if l.strip()]))' \
    < "$TMP/issues.list" > "$ISSUES_JSON"
  rm -f "$TMP/issues.list"
}

next() { bash "$SCRIPT" -R test/repo 1 --next; }
assert() { printf '%s' "$1" | python3 -c "import json, sys; d = json.load(sys.stdin); assert $2, d" || fail "$3: $1"; }

cd "$TMP/work"

project 2 3
issue 2 none open
issue 3 ready none 2
flush
assert "$(next)" 'd["next"] == "user" and d["why"] == "decisions" and d["issue"] == 2' "an open decision"
project 2 3
issue 2 none ticked
issue 3 ready none 2
flush
assert "$(next)" 'd["next"] == "doctor" and d["why"] == "not-ready" and d["issue"] == 2' "the box ticked"
echo "ok: an issue stopped on a decision goes to the user, then to the doctor"

project 2 3
issue 2 blocker none
issue 3 ready none 2
flush
assert "$(next)" 'd["next"] == "doctor" and d["why"] == "blocker" and d["issue"] == 2' "a detail stop"
echo "ok: an issue stopped on a detail goes to the doctor"

project 2 3
issue 2 ready none
issue 3 ready none 2
flush
assert "$(next)" 'd["next"] == "running" and d["why"] == "workable" and d["issue"] == 2' "a workable issue"
echo "ok: a ready issue with its decisions settled is workable"

project 2
issue 2 ready none
flush
printf 'Base: `pj/1` from `main`\n\n## Order\n\n1. #2\n\n## Goal\n\nx\n\n## Design\n\ny\n\n## Decisions\n\nNone.\n' > "$PARENT_BODY"
view="$(bash "$SCRIPT" -R test/repo 1)"
want="$(bash "$SCRIPT" --parent-lint "$PARENT_BODY")"
assert "$view" "d['parent']['lint'] == json.loads('$want') and d['parent']['lint']['reasons'] == ['sections']" "parent.lint"
echo "ok: the parent carries its lint"

project 2 3
issue 2 ready none
issue 3 ready none 2
flush
earlier='[{"number": 9, "url": "https://github.com/test/repo/issues/9", "title": "Earlier", "state": "CLOSED",
           "stateReason": "COMPLETED", "body": "Base: `pj/9` from `main`\n\n## Goal\n\nx\n"}]'
view="$(PARENT_BLOCKED_BY="$earlier" bash "$SCRIPT" -R test/repo 1)"
assert "$view" "d['parent']['url'] == 'https://github.com/test/repo/issues/1'" "the parent's url"
assert "$view" "[i['url'] for i in d['issues']] == ['https://github.com/test/repo/issues/2', 'https://github.com/test/repo/issues/3']" "each issue's url"
assert "$view" "d['parent']['waitsOn'][0]['url'] == 'https://github.com/test/repo/issues/9' and d['parent']['waitsOn'][0]['merged']" "waitsOn[0]"
echo "ok: the parent, each issue and each project it waits on carry a url"
