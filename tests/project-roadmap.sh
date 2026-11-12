#!/usr/bin/env bash
# Test: project.sh --roadmap reads the roadmap file of the work tree or of a ref and checks it against the format.
#
# Run: bash tests/project-roadmap.sh   (exit 0 is success, anything else is failure)
# Runs offline and needs no gh. PROJECT_SH=<path> tests another copy of project.sh.
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
