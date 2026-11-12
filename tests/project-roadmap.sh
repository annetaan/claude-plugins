#!/usr/bin/env bash
# Test: project.sh --roadmap reads the roadmap file of the work tree or of a ref and checks it against the format.
#
# Run: bash tests/project-roadmap.sh   (exit 0 is success, anything else is failure)
# Runs offline: --roadmap needs no gh, and a fake `gh` answers the GitHub queries for the cases that read a parent.
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

cd "$TMP"
git init -q -b main work
git init -q --bare origin.git
cd work
echo readme > README.md
git add README.md
git commit -q -m init
git remote add origin ../origin.git
git push -q origin main

# j <expression over the parsed JSON d> prints it for the output of project.sh --roadmap [args]
j() {
  local expr="$1"; shift
  bash "$SCRIPT" --roadmap "$@" | python3 -c "import json,sys; d=json.load(sys.stdin); print($expr)"
}
codes() { j "','.join(r['code'] for r in d['reasons'])" "$@"; }

# 1
[ "$(codes)" = "no-file" ] || fail "no file: $(codes)"
[ "$(j "d['ok']")" = "False" ] || fail "no file is ok"
echo "ok: no roadmap file reads as no-file"

# 2
printf '## A\n' > roadmap.md
mkdir doc
printf '## B\n' > doc/ROADMAP.md
[ "$(codes)" = "several-files" ] || fail "several files: $(codes)"
[ "$(j "d['files']")" = "['roadmap.md', 'doc/ROADMAP.md']" ] || fail "files: $(j "d['files']")"
[ "$(j "d['path']")" = "None" ] || fail "path set with two files"
echo "ok: two roadmap files read as several-files"
rm -r doc

# 3
cat > roadmap.md <<'MD'
# Roadmap

Some words.

## First

body

## Second
last line
MD
[ "$(j "d['ok']")" = "True" ] || fail "in-format roadmap: $(codes)"
[ "$(j "d['path']")" = "roadmap.md" ] || fail "path"
[ "$(j "[(e['heading'], e['start'], e['end']) for e in d['entries']]")" = "[('First', 5, 8), ('Second', 9, 10)]" ] \
  || fail "entries: $(j "d['entries']")"
echo "ok: a roadmap in the format lists its entries with their extents"

# 4
cat > roadmap.md <<'MD'
## First

```
## not an entry
```

text
MD
[ "$(j "[e['heading'] for e in d['entries']]")" = "['First']" ] || fail "fence: $(j "d['entries']")"
[ "$(j "d['entries'][0]['end']")" = "7" ] || fail "fence extent"
echo "ok: a ## line inside a code fence is no entry"

# 5
cat > roadmap.md <<'MD'
## First

### Sub

more

## Second
MD
[ "$(j "[(e['heading'], e['end']) for e in d['entries']]")" = "[('First', 6), ('Second', 7)]" ] || fail "sub heading: $(j "d['entries']")"
[ "$(j "d['ok']")" = "True" ] || fail "sub heading not ok"
echo "ok: a ### heading stays inside its entry"

# 6
printf '## A\n\n## B\n\n##   A  \n' > roadmap.md
[ "$(codes)" = "duplicate-heading" ] || fail "duplicate: $(codes)"
[ "$(j "(d['reasons'][0]['line'], d['reasons'][0]['heading'])")" = "(5, 'A')" ] || fail "duplicate detail"
printf '## A\n\n##\n\n##   \nx\n' > roadmap.md
[ "$(codes)" = "empty-heading,empty-heading" ] || fail "empty heading: $(codes)"
[ "$(j "len(d['entries'])")" = "1" ] || fail "empty heading made an entry"
echo "ok: a duplicate heading is reported"

# 7
printf '## A\n\n# Late title\n' > roadmap.md
[ "$(codes)" = "title-after-entry" ] || fail "late title: $(codes)"
printf '# T\n\n# U\n\n## A\n' > roadmap.md
[ "$(codes)" = "several-titles" ] || fail "several titles: $(codes)"
[ "$(j "d['reasons'][0]['line']")" = "3" ] || fail "several titles line"
echo "ok: a # heading after the first entry is reported"

# 8
printf '## A\n\nSetext\n------\n' > roadmap.md
[ "$(codes)" = "setext-heading" ] || fail "setext: $(codes)"
printf '# T\n\nA preamble\n===\n\n## A\n' > roadmap.md
[ "$(codes)" = "setext-heading" ] || fail "setext =: $(codes)"
printf -- '---\ntitle: x\n---\n\n## A\n' > roadmap.md
[ "$(codes)" = "" ] || fail "front matter: $(codes)"
printf -- '---\n## X\n# c1\n# c2\n---\n\n## A\n' > roadmap.md
[ "$(codes)" = "" ] || fail "inside front matter: $(codes)"
[ "$(j "[e['heading'] for e in d['entries']]")" = "['A']" ] || fail "front matter entry"
printf '## A\n\n1. step\n---\n\n2) step\n---\n' > roadmap.md
[ "$(codes)" = "" ] || fail "list over rule: $(codes)"
echo "ok: a setext heading is reported"

# 9
printf '# Roadmap\n\nNothing left.\n' > roadmap.md
[ "$(j "d['ok']")" = "True" ] || fail "no entry: $(codes)"
[ "$(j "d['entries']")" = "[]" ] || fail "no entry list"
echo "ok: a roadmap with no entry is in the format"

# 10
printf '## Committed\n' > roadmap.md
git add roadmap.md
git commit -q -m roadmap
printf '## One\n\n## One\n' > roadmap.md
[ "$(codes)" = "duplicate-heading" ] || fail "working tree: $(codes)"
[ "$(codes HEAD)" = "" ] || fail "at ref: $(codes HEAD)"
[ "$(j "d['entries'][0]['heading']" HEAD)" = "Committed" ] || fail "ref entries"
[ "$(codes HEAD~1)" = "no-file" ] || fail "older ref: $(codes HEAD~1)"
if bash "$SCRIPT" --roadmap no-such-ref >/dev/null 2>&1; then fail "a bad ref was accepted"; fi
echo "ok: --roadmap at a ref reads that ref and not the working tree"

# 11
mkdir "$TMP/plain"
cd "$TMP/plain"
if GIT_CEILING_DIRECTORIES="$TMP" bash "$SCRIPT" --roadmap >/dev/null 2>&1; then fail "ran outside a work tree"; fi
echo "ok: --roadmap outside a work tree is refused"

# From here on a parent is read, so a fake gh answers the GitHub queries project.sh sends. The fixture is set by
# environment variables the fake reads: FX_PARENT_BODY, and FX_SUBS, a JSON list of
# {"n", "state", "reason", "files", "blockedBy"} that the fake turns into sub-issues with bodies.
cd "$TMP/work"
git checkout -q roadmap.md
mkdir "$TMP/bin"
cat > "$TMP/bin/gh" <<'PYEOF'
#!/usr/bin/env python3
import json, os, re, sys
args = sys.argv[1:]
if args[:2] == ["pr", "list"]:
    print("[]")
    sys.exit(0)
if args[:2] == ["api", "graphql"]:
    query = next(a[len("query="):] for a in args if a.startswith("query="))
    if "timelineItems" in query:
        specs = json.loads(os.environ["FX_SUBS"])
        state_of = {s["n"]: s["state"] for s in specs}
        nodes = []
        for s in specs:
            lines = []
            for f in s["files"]:
                lines.append("- `%s` (changed): %s" % (f, "delete the entry." if f.endswith("roadmap.md") else "rename `foo`."))
            body = ("## Goal\n\nx\n\n## Design\n\n" + "\n".join(lines) + "\n\n"
                    "## Acceptance criteria\n\n- `foo` is renamed.\n\n"
                    "## Decisions\n\nNone.\n\n## Out of scope\n\nNothing.\n")
            nodes.append({"number": s["n"], "title": "Task %d" % s["n"], "state": s["state"],
                          "stateReason": s.get("reason"), "updatedAt": "2000-01-01T00:00:00Z", "body": body,
                          "labels": {"nodes": [{"name": "ready"}]},
                          "blockedBy": {"nodes": [{"number": b, "state": state_of[b], "parent": None}
                                                  for b in s.get("blockedBy", [])]},
                          "blocking": {"nodes": []}, "timelineItems": {"nodes": []}})
        parent = {"number": 1, "title": "Project", "state": "OPEN", "stateReason": None,
                  "updatedAt": "2000-01-01T00:00:00Z", "body": os.environ["FX_PARENT_BODY"],
                  "labels": {"nodes": []}, "blockedBy": {"nodes": []}, "blocking": {"nodes": []},
                  "subIssues": {"totalCount": len(nodes), "nodes": nodes}}
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
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH"

git push -q origin main main:refs/heads/pj/1

HEAD_LINES=$'Base: `pj/1` from `main`\n'
RM_LINE=$'Roadmap: `roadmap.md` Committed\n'
TAIL=$'\n## Goal\n\nx\n\n## Order\n\n1. #2\n2. #3\n'
export FX_PARENT_BODY="$HEAD_LINES$RM_LINE$TAIL"

# pj <expression over the parsed JSON d> [project.sh args] prints it for the output of project.sh -R test/repo 1 [args]
pj() {
  local expr="$1"; shift
  bash "$SCRIPT" -R test/repo 1 "$@" | python3 -c "import json,sys; d=json.load(sys.stdin); print($expr)"
}

# 12
export FX_PARENT_BODY="$HEAD_LINES$TAIL"
export FX_SUBS='[{"n":2,"state":"OPEN","files":["src/app.ts"]},{"n":3,"state":"OPEN","files":["roadmap.md"]}]'
[ "$(pj "d['parent']['roadmap']")" = "None" ] || fail "roadmap without a line: $(pj "d['parent']['roadmap']")"
echo "ok: a parent without a Roadmap: line reads roadmap as null"

# 13
export FX_PARENT_BODY="$HEAD_LINES$RM_LINE$TAIL"
[ "$(pj "(d['parent']['roadmap']['path'], d['parent']['roadmap']['entry'])")" = "('roadmap.md', 'Committed')" ] \
  || fail "roadmap line: $(pj "d['parent']['roadmap']")"
[ "$(pj "(d['parent']['base'], d['parent']['from'])")" = "('pj/1', 'main')" ] || fail "Base: line"
echo "ok: the Roadmap: line gives path and entry, and Base: still reads"

# 14
[ "$(pj "(d['parent']['roadmap']['task'], d['parent']['roadmap']['tasks'])")" = "(3, [3])" ] \
  || fail "task: $(pj "d['parent']['roadmap']")"
echo "ok: the roadmap task is the one sub-issue that lists the roadmap file"

# 15
export FX_SUBS='[{"n":2,"state":"OPEN","files":["roadmap.md"]},{"n":3,"state":"OPEN","files":["roadmap.md"]}]'
[ "$(pj "(d['parent']['roadmap']['task'], d['parent']['roadmap']['tasks'])")" = "(None, [2, 3])" ] \
  || fail "two tasks: $(pj "d['parent']['roadmap']")"
echo "ok: two sub-issues that list the roadmap file give task null and both in tasks"

# 16
export FX_SUBS='[{"n":2,"state":"OPEN","files":["src/app.ts"]},{"n":3,"state":"OPEN","files":["roadmap.md"]},{"n":4,"state":"OPEN","files":["src/b.ts"]},{"n":5,"state":"OPEN","files":["src/c.ts"]}]'
[ "$(pj "d['parent']['roadmap']['missing']")" = "[2, 4, 5]" ] || fail "missing: $(pj "d['parent']['roadmap']")"
export FX_SUBS='[{"n":2,"state":"OPEN","files":["src/app.ts"]},{"n":3,"state":"OPEN","files":["roadmap.md"],"blockedBy":[2]},{"n":4,"state":"OPEN","files":["src/b.ts"]}]'
[ "$(pj "d['parent']['roadmap']['missing']")" = "[4]" ] || fail "missing with an edge: $(pj "d['parent']['roadmap']")"
echo "ok: missing names the open sub-issues the roadmap task is not blocked by"

# 17
export FX_PARENT_BODY="$HEAD_LINES$RM_LINE"$'\n## Goal\n\nx\n\n## Order\n\n1. #3\n2. #2\n'
export FX_SUBS='[{"n":2,"state":"OPEN","files":["src/app.ts"]},{"n":3,"state":"OPEN","files":["roadmap.md"]}]'
[ "$(pj "(d['next'], d['why'], d['issue'])" --next)" = "('doctor', 'roadmap-edges', 3)" ] \
  || fail "next with missing: $(pj "d" --next)"
echo "ok: --next sends a roadmap task with missing edges to the doctor as roadmap-edges"

# 18
export FX_SUBS='[{"n":2,"state":"CLOSED","reason":"COMPLETED","files":["src/app.ts"]},{"n":3,"state":"OPEN","files":["roadmap.md"]}]'
[ "$(pj "(d['next'], d['why'], d['issue'])" --next)" = "('running', 'workable', 3)" ] \
  || fail "next without missing: $(pj "d" --next)"
echo "ok: --next answers workable for the roadmap task once missing is empty"

# 19
export FX_PARENT_BODY="$HEAD_LINES$RM_LINE$TAIL"
bash "$SCRIPT" -R test/repo 1 --order-body | head -n 2 > "$TMP/order-head"
[ "$(cat "$TMP/order-head")" = "$(printf 'Base: `pj/1` from `main`\nRoadmap: `roadmap.md` Committed')" ] \
  || fail "order-body head: $(cat "$TMP/order-head")"
echo "ok: --order-body keeps the Roadmap: line under Base:"

# 20
export FX_PARENT_BODY="$HEAD_LINES"$'Roadmap: roadmap.md Committed\n'"$TAIL"
[ "$(pj "d['parent']['roadmap']")" = "None" ] || fail "no backticks read as a line"
export FX_PARENT_BODY="$HEAD_LINES"$'Roadmap: `notes.md` Committed\n'"$TAIL"
[ "$(pj "d['parent']['roadmap']")" = "None" ] || fail "a path outside the six read as a line"
export FX_PARENT_BODY="$HEAD_LINES"$'Roadmap: `roadmap.md`\n'"$TAIL"
[ "$(pj "d['parent']['roadmap']")" = "None" ] || fail "a line with no entry read as a line"
echo "ok: a malformed Roadmap: line reads as null (no backticked path; a path outside the six)"

# 21
body_with() {
  printf '## Goal\n\nx\n\n## Design\n\n- `%s` (changed): %s\n\n## Acceptance criteria\n\n- `foo` is renamed.\n\n## Decisions\n\nNone.\n\n## Out of scope\n\nNothing.\n' "$1" "$2" > "$TMP/body.md"
}
body_with roadmap.md "delete the entry."
[ "$(bash "$SCRIPT" --lint "$TMP/body.md" | python3 -c "import json,sys; print(json.load(sys.stdin)['ok'])")" = "True" ] \
  || fail "lint of a roadmap entry: $(bash "$SCRIPT" --lint "$TMP/body.md")"
body_with src/app.ts "delete the entry."
bash "$SCRIPT" --lint "$TMP/body.md" | grep -q no-symbols || fail "lint passed a changed entry with no symbol"
export FX_SUBS='[{"n":3,"state":"OPEN","files":["roadmap.md"]}]'
[ "$(pj "d['issues'][0]['lint']['ok']")" = "True" ] || fail "issues[].lint: $(pj "d['issues'][0]['lint']")"
echo "ok: --lint passes a changed entry on a roadmap path with no symbol"

# 22
export FX_PARENT_BODY="$HEAD_LINES$RM_LINE$TAIL"
export FX_SUBS='[{"n":3,"state":"OPEN","files":["roadmap.md"]}]'
chk() { bash "$SCRIPT" -R test/repo 1 --check 3 | python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
[ "$(chk "(d['premises']['mode'], d['premises']['failures'])")" = "('full', [])" ] \
  || fail "check with the entry: $(chk "d['premises']")"
echo "ok: --check passes the roadmap task while the entry stands at the ref"

# 23
printf '## Other\n' > roadmap.md
git commit -q -am "entry gone"
git push -q origin main:refs/heads/pj/1
[ "$(chk "[(f['path'], f['why']) for f in d['premises']['failures']]")" = "[('roadmap.md', 'roadmap entry not found')]" ] \
  || fail "check without the entry: $(chk "d['premises']")"
echo "ok: --check fails with roadmap entry not found once the entry is gone"
