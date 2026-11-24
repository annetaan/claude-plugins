#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj1-plan/scripts/project.sh"
SCRIPT="${PROJECT_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

mkdir "$TMP/bin"
cat > "$TMP/bin/gh" <<'PYEOF'
#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
with open(os.environ["GH_LOG"], "a") as log:
    log.write(" ".join(args[:2]) + "\n")
if args[:2] == ["pr", "list"]:
    print("[]")
    sys.exit(0)
if args[:2] == ["api", "graphql"]:
    sys.stdout.write(open(os.environ["ISSUES_JSON"]).read())
    sys.exit(0)
sys.stderr.write("fake gh: unexpected call: %s\n" % " ".join(args))
sys.exit(1)
PYEOF
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH"
export ISSUES_JSON="$TMP/issues.json"
export GH_LOG="$TMP/gh.log"

python3 - "$ISSUES_JSON" <<'PYEOF'
import json, sys

def body(design, criteria, decisions="None."):
    return "## Goal\n\nA goal.\n\n## Design\n\n%s\n\n## Acceptance criteria\n\n%s\n\n## Decisions\n\n%s\n\n## Out of scope\n\n- Nothing.\n" % (
        design, criteria, decisions)

def sub(n, title, text, state="OPEN", reason=None, blocked=()):
    return {"number": n, "url": "https://example.com/%d" % n, "title": title, "state": state, "stateReason": reason,
            "updatedAt": "2000-01-01T00:00:00Z", "body": text, "labels": {"nodes": []},
            "blockedBy": {"nodes": [{"number": b, "state": "OPEN", "parent": {"number": 1}} for b in blocked]},
            "blocking": {"nodes": []}}

def project(n, design):
    return {"number": n, "url": "https://example.com/%d" % n, "title": "Project %d" % n, "state": "CLOSED",
            "stateReason": "COMPLETED",
            "body": "Base: `pj/%d` from `main`\n\n## Goal\n\ng\n\n## Design\n\n%s\n\n## Decisions\n\nNone.\n" % (n, design)}

target = "\n".join([
    "## Goal", "", "The target goal.", "",
    "## Design", "", "- `a.txt` (changed): `x`.", "",
    "## Acceptance criteria", "", "- `check-a` passes.", "",
    "## Decisions", "",
    "### D1. First", "", "Only you know: the first.", "",
    "- [ ] Option one (recommended)", "  under one",
    "- [x] Option two", "  under two", "", "  more two",
    "- [ ] Option three", "",
    "Decided: two, because.", "",
    "### D2. Second", "", "Only you know: the second.", "",
    "```", "### D9. fenced", "- [x] fenced option", "```", "",
    "- [x] Only option (recommended)",
    "- [ ] Other", "",
    "## Out of scope", "", "- Nothing.", "",
]).replace("\n", "\r\n")

open_decision = body("- `a.txt` (changed): `x`.", "- `t` passes.",
                     "### D1. Open\n\nOnly you know: x.\n\n- [ ] A (recommended)\n- [ ] B")
contradictory = body("- `a.txt` (changed): `x`.", "- `t` passes.",
                     "### D1. Both\n\nOnly you know: x.\n\n- [x] A (recommended)\n- [x] B")

parent = {
    "number": 1, "url": "https://example.com/1", "title": "Parent", "state": "OPEN", "stateReason": None,
    "updatedAt": "2000-01-01T00:00:00Z",
    "body": "Base: `pj/1` from `main`\n\n## Order\n\n1. #3\n\n## Goal\n\nParent goal.\n\n## Design\n\nParent design.\n\n"
            "```\n## not a heading\n```\n\n### Model decisions\n\n- A model decision.\n\n## Decisions\n\nNone.\n\n"
            "## Out of scope\n\n- None.\n",
    "labels": {"nodes": []},
    "blockedBy": {"nodes": [project(30, "Design thirty."), project(20, "Design twenty.")]},
    "blocking": {"nodes": []},
    "subIssues": {"totalCount": 7, "nodes": [
        sub(2, "Breaker", body("- `a.txt` (changed): `x`.\n\n### Left broken\n\n- `check-a`: why.\n- `check-b`: why.",
                               "- `t` passes."), state="CLOSED", reason="COMPLETED"),
        sub(3, "Target (1/2)", target, blocked=[2]),
        sub(4, "Closer of b", body("- `a.txt` (changed): `x`.", "- `check-b` passes."), blocked=[2]),
        sub(5, "Open breaker", body("- `a.txt` (changed): `x`.\n\n### Left broken\n\n- `check-c`: why.",
                                    "- `t` passes.")),
        sub(6, "Closer of all", body("- `a.txt` (changed): `x`.",
                                     "- `check-a`, `check-b` and `check-c` pass."), blocked=[2, 5]),
        sub(7, "Open decision", open_decision),
        sub(8, "Contradictory", contradictory),
    ]},
}
json.dump({"data": {"repository": {"issue": parent}}}, open(sys.argv[1], "w"))
PYEOF

design() { bash "$SCRIPT" -R test/repo 1 --design "$@"; }

cat > "$TMP/want.md" <<'EOF'
# Issue #3: Target

## Goal

The target goal.

## Design

- `a.txt` (changed): `x`.

## Acceptance criteria

- `check-a` passes.

## Decisions

### D1. First

- [x] Option two
  under two

  more two

Decided: two, because.

### D2. Second

- [x] Only option (recommended)

## Out of scope

- Nothing.

# Parent #1: Parent

## Design

Parent design.

```
## not a heading
```

### Model decisions

- A model decision.

# Waited-on project #20: Project 20

## Design

Design twenty.

# Waited-on project #30: Project 30

## Design

Design thirty.

# Left broken on the base branch

- `check-b` (left by #2)
EOF

: > "$GH_LOG"
design 3 > "$TMP/out.md"
cmp -s "$TMP/out.md" "$TMP/want.md" || fail "the target: $(diff "$TMP/want.md" "$TMP/out.md")"
echo "ok: the target's approved design, with decisions cut, the parents' designs and the open breakage"

[ "$(cat "$GH_LOG")" = "api graphql" ] || fail "--design called gh beyond the query: $(cat "$GH_LOG")"
echo "ok: --design reads the one query and lists no pull request"

design 6 > "$TMP/out.md"
[ "$(tail -n 3 "$TMP/out.md")" = "$(printf '# Left broken on the base branch\n\nNone.')" ] \
  || fail "the closer of every check: $(tail -n 3 "$TMP/out.md")"
for n in 3 6; do
  if design "$n" | sed -n '/^# Left broken on the base branch$/,$p' | grep -q -F 'check-c'; then
    fail "the open breaker's check appeared for #$n"
  fi
done
echo "ok: the closer of every check reads None., and an open breaker's check never appears"

refused() {
  local want="$1"; shift
  if design "$@" > "$TMP/out.md" 2> "$TMP/err"; then fail "--design $* exited 0"; fi
  [ ! -s "$TMP/out.md" ] || fail "--design $* printed: $(cat "$TMP/out.md")"
  grep -q -x -F "$want" "$TMP/err" || fail "--design $*: $(cat "$TMP/err")"
}
refused 'project: #7 has decisions not settled: 1 open, 0 contradictory' 7
refused 'project: #8 has decisions not settled: 0 open, 1 contradictory' 8
refused 'project: #9 is not a sub-issue of #1' 9
echo "ok: an open decision, a contradictory decision and a number that is no sub-issue are refused"

if bash "$SCRIPT" -R test/repo 1 --design > /dev/null 2> "$TMP/err"; then fail "--design with no number exited 0"; fi
grep -q -x -F 'project: --design takes one issue number' "$TMP/err" || fail "--design with no number: $(cat "$TMP/err")"
refused 'project: --design takes one issue number' x
echo "ok: --design with no number or with x is refused"
