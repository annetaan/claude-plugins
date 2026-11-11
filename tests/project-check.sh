#!/usr/bin/env bash
# Test: project.sh --check gives the same answer from any directory of the work tree,
# and refuses to run outside a work tree.
#
# Run: bash tests/project-check.sh   (exit 0 is success, anything else is failure)
# Runs offline: a fake `gh` answers the GitHub queries, and the "remote" is a bare repository in a temp dir.
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

# A clone with a root blob, a tracked subdirectory, and a pj/1 branch on origin.
cd "$TMP"
git init -q -b main work
git init -q --bare origin.git
(
  cd work
  echo readme > README.md
  mkdir src
  echo 'export function foo() {}' > src/app.ts
  git add README.md src/app.ts
  GIT_AUTHOR_DATE="1999-01-01T00:00:00Z" GIT_COMMITTER_DATE="1999-01-01T00:00:00Z" git commit -q -m "init"
  git remote add origin ../origin.git
  git push -q origin main main:refs/heads/pj/1
)
mkdir -p work/work-reports/run   # an untracked nested directory

# A fake gh, answering the queries project.sh sends.
mkdir bin
cat > bin/gh <<'PYEOF'
#!/usr/bin/env python3
import json, re, sys
args = sys.argv[1:]
if args[:2] == ["pr", "list"]:
    print("[]")
    sys.exit(0)
if args[:2] == ["api", "graphql"]:
    query = next(a[len("query="):] for a in args if a.startswith("query="))
    if "timelineItems" in query:
        body = ("## Goal\n\nRename foo.\n\n## Design\n\n"
                "- `src/app.ts` (changed): rename `foo`, as `README.md` describes.\n\n"
                "## Acceptance criteria\n\n- `foo` is renamed.\n\n"
                "## Decisions\n\nNone.\n\n## Out of scope\n\nNothing.\n")
        sub = {"number": 2, "title": "Rename foo", "state": "OPEN", "stateReason": None,
               "updatedAt": "2000-01-01T00:00:00Z", "body": body,
               "labels": {"nodes": [{"name": "ready"}]},
               "blockedBy": {"nodes": []}, "blocking": {"nodes": []},
               "timelineItems": {"nodes": [{"createdAt": "2000-01-01T00:00:00Z", "label": {"name": "ready"}}]}}
        parent = {"number": 1, "title": "Project", "state": "OPEN", "stateReason": None,
                  "updatedAt": "2000-01-01T00:00:00Z",
                  "body": "Base: `pj/1` from `main`\n\n## Goal\n\nx\n",
                  "labels": {"nodes": []}, "blockedBy": {"nodes": []}, "blocking": {"nodes": []},
                  "subIssues": {"totalCount": 1, "nodes": [sub]}}
        print(json.dumps({"data": {"repository": {"issue": parent}}}))
    elif "ro: ref(" in query:
        print(json.dumps({"data": {"repository": {"ro": {"compare": {"status": "IDENTICAL"}},
                                                  "mo": {"totalCount": 0}, "po": {"nodes": []}}}}))
    elif "object(oid:" in query:
        repo = {k: {"associatedPullRequests": {"nodes": []}} for k in re.findall(r"\b(c\d+):", query)}
        print(json.dumps({"data": {"repository": repo}}))
    else:
        sys.stderr.write("fake gh: unexpected query\n")
        sys.exit(1)
    sys.exit(0)
sys.stderr.write("fake gh: unexpected call: %s\n" % " ".join(args))
sys.exit(1)
PYEOF
chmod +x bin/gh
export PATH="$TMP/bin:$PATH"

# A commit touching src/app.ts after the issue went ready, with no pull request behind it.
(
  cd work
  echo 'export function foo() { return 1 }' > src/app.ts
  git commit -q -am "touch app"
  git push -q origin main:refs/heads/pj/1
)

check() { (cd "$1" && bash "$SCRIPT" -R test/repo 1 --check 2); }

# Case 1: the same answer from the root, a tracked subdirectory and an untracked nested directory.
root_out="$(check "$TMP/work")" || fail "check from the root exited non-zero"
sub_out="$(check "$TMP/work/src")" || fail "check from a tracked subdirectory exited non-zero"
nested_out="$(check "$TMP/work/work-reports/run")" || fail "check from an untracked nested directory exited non-zero"
[ "$root_out" = "$sub_out" ] || fail "output from work/src differs from the root: $sub_out"
[ "$root_out" = "$nested_out" ] || fail "output from work/work-reports/run differs from the root: $nested_out"
printf '%s' "$root_out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["lint"]["ok"] is True, d["lint"]
assert d["premises"]["mode"] == "full", d["premises"]
assert d["premises"]["failures"] == [], d["premises"]
assert len(d["history"]["stale"]) == 1, d["history"]
' || fail "check from the root gave an unexpected result: $root_out"
echo "ok: check from a subdirectory matches check from the root"

# Case 2: refused outside a work tree.
for dir in "$TMP/origin.git" "$TMP/work/.git"; do
  rc=0
  err="$(check "$dir" 2>&1 >/dev/null)" || rc=$?
  [ "$rc" -ne 0 ] || fail "check in $dir exited 0"
  case "$err" in
    *"inside a work tree of a clone"*) ;;
    *) fail "check in $dir printed: $err" ;;
  esac
done
echo "ok: check outside a work tree is refused"
