#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

check() {
  python3 -I - "$1" <<'EOF'
import bisect, functools, os, re, subprocess, sys

root = sys.argv[1]
PLUGIN = "plugins/annetaan"
SKILLS = PLUGIN + "/skills"
NAME = r"[A-Za-z_][A-Za-z0-9_]*"
PATH = r"[A-Za-z0-9._/-]"
FENCE = re.compile(r"^\s*(```|~~~)")
SPAN = re.compile(r"(`+)(.+?)\1")

listed = [p for p in subprocess.run(
    ["git", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "--", PLUGIN],
    check=True, capture_output=True, text=True).stdout.split("\n") if p and os.path.isfile(os.path.join(root, p))]
files = set(listed)
present = set(listed)
for p in listed:
    d = os.path.dirname(p)
    while d:
        present.add(d)
        d = os.path.dirname(d)

def exists(rel):
    return os.path.normpath(rel) in present

def read(rel):
    with open(os.path.join(root, rel)) as f:
        return f.read()

skills = {p.split("/")[3] for p in listed if re.fullmatch(SKILLS + r"/[^/]+/SKILL\.md", p)}
declares = {}
for s in skills:
    m = re.search(r"`\$(" + NAME + r")` below means `\$\{CLAUDE_SKILL_DIR\}`", read(f"{SKILLS}/{s}/SKILL.md"))
    if m:
        declares[s] = m.group(1)

def skill_of(p):
    m = re.match(SKILLS + r"/([^/]+)/", p)
    return m.group(1) if m and m.group(1) in skills else None

def split_lines(text):
    out, fence = [], None
    for i, line in enumerate(text.split("\n"), 1):
        m = FENCE.match(line)
        if fence:
            out.append((i, line, True))
            if m and m.group(1) == fence:
                fence = None
        elif m:
            fence = m.group(1)
            out.append((i, line, True))
        else:
            out.append((i, line, False))
    return out

def norm(s):
    return re.sub(r"\s+", " ", s.replace("`", "")).strip()

@functools.lru_cache(maxsize=None)
def headings(rel):
    found = []
    for _, line, fenced in split_lines(read(rel)):
        m = None if fenced else re.match(r"^#{1,6}\s+(.*?)\s*#*\s*$", line)
        if m:
            found.append(m.group(1))
    return found

def slug(heading):
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", heading).replace("`", "").lower()
    return re.sub(r"[^\w\- ]", "", s).replace(" ", "-")

def slugs(rel):
    seen, out = {}, set()
    for h in headings(rel):
        s = slug(h)
        seen[s] = seen.get(s, -1) + 1
        out.add(f"{s}-{seen[s]}" if seen[s] else s)
    return out

def resolve(p, target):
    own = skill_of(p)
    m = re.fullmatch(r"\$(" + NAME + r")/(.*)", target)
    if m:
        if not own or declares.get(own) != m.group(1):
            return None
        return os.path.normpath(os.path.join(SKILLS, own, m.group(2)))
    if target.startswith("<skills>/"):
        return os.path.normpath(os.path.join(SKILLS, target[len("<skills>/"):]))
    if "/" in target and target.split("/")[0] in skills:
        return os.path.normpath(os.path.join(SKILLS, target))
    near = [os.path.dirname(p)] + ([os.path.join(SKILLS, own)] if own else [])
    near = [os.path.normpath(os.path.join(d, target)) for d in near]
    return next((c for c in near if exists(c)), near[0])

def others_holding(name, own):
    return sorted({skill_of(q) for q in listed if q.endswith("/" + name)} - {None, own})

findings, count = [], 0

for p in sorted(q for q in listed if q.endswith(".md")):
    own = skill_of(p)
    name = declares.get(own)
    lines = split_lines(read(p))
    first_h2 = next((i for i, line, fenced in lines if not fenced and line.startswith("## ")), len(lines) + 1)
    names_it = name is not None and (p == f"{SKILLS}/{own}/SKILL.md" or f"`${name}`" in "\n".join(line for i, line, _ in lines if i < first_h2))

    def find(i, msg):
        findings.append(f"{p}:{i}: {msg}")

    for i, line, fenced in lines:
        if name:
            for m in re.finditer(r"\$" + name + "/(" + PATH + "*)", line):
                target = m.group(1).rstrip(".")
                count += 1
                if not exists(os.path.join(SKILLS, own, target)):
                    find(i, f"${name}/{target} does not exist")
                if not names_it:
                    find(i, f"uses ${name}/ but its opening lines do not name `${name}`")
        for m in re.finditer(r"<skills>/(" + PATH + "+)", line):
            target = m.group(1).rstrip(".")
            count += 1
            if not exists(os.path.join(SKILLS, target)):
                find(i, f"<skills>/{target} does not exist")
        if fenced:
            continue

        for m in SPAN.finditer(re.sub(r"\[[^\]]*\]\(", "](", line)):
            s = m.group(2).strip()
            if not re.fullmatch(PATH + "+", s):
                continue
            if "/" in s and s.split("/")[0] in skills:
                count += 1
                if not exists(os.path.join(SKILLS, s)):
                    find(i, f"{s} does not exist")
            elif own and s.endswith(".md"):
                if exists(resolve(p, s)):
                    count += 1
                elif others := others_holding(s, own):
                    count += 1
                    find(i, f"{s} is a file of {', '.join(others)}: write it with the skill's name")

        for m in re.finditer(r"\]\(([^)\s]+)\)", SPAN.sub(lambda s: " " * len(s.group(0)), line)):
            target = m.group(1)
            if re.match(r"[a-z]+:", target):
                continue
            path, _, anchor = target.partition("#")
            rel = os.path.normpath(os.path.join(os.path.dirname(p), path)) if path else p
            count += 1
            if not exists(rel):
                find(i, f"link to {target}: no such file")
            elif anchor and (not rel.endswith(".md") or anchor not in slugs(rel)):
                find(i, f"link to {target}: no such anchor")

    paragraphs, run = [], []
    for i, line, fenced in lines + [(0, "", True)]:
        if fenced or not line.strip():
            if run:
                paragraphs.append(run)
            run = []
        else:
            run.append((i, line))
    for run in paragraphs:
        text = "\n".join(line for _, line in run)
        starts = [0]
        for _, line in run:
            starts.append(starts[-1] + len(line) + 1)
        refs, taken = [], set()
        for m in re.finditer(r"\*\*([^*]+)\*\*\s+in\s+`([^`\n]+\.md)`", text):
            refs.append((m.start(), m.group(1), m.group(2)))
            taken.add(m.start())
        for m in re.finditer(r"`([^`\n]+\.md)`,\s+\*\*([^*]+)\*\*", text):
            if m.start(2) - 2 not in taken:
                refs.append((m.start(2) - 2, m.group(2), m.group(1)))
        for at, section, f in refs:
            rel = resolve(p, f)
            if rel is None:
                continue
            count += 1
            i = run[bisect.bisect_right(starts, at) - 1][0]
            if rel not in files:
                find(i, f"{f}: no such file, for **{norm(section)}**")
            elif norm(section) not in {norm(h) for h in headings(rel)}:
                find(i, f"{f} has no section **{norm(section)}**")

if findings:
    print("\n".join(findings), file=sys.stderr)
    print(f"{count} references, {len(findings)} broken", file=sys.stderr)
    sys.exit(1)
print(f"ok: {count} references, none broken")
EOF
}

check "$ROOT" || fail "broken references under plugins/annetaan"

GOOD="$TMP/good"
S="$GOOD/plugins/annetaan/skills"
mkdir -p "$S/one" "$S/two"
cat > "$S/one/SKILL.md" <<'EOF'
---
name: one
---
# One

## Paths: `$ONE`

**`$ONE` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

Read `$ONE/notes.md` and `two/guide.md`, then `<skills>/two/guide.md`. Write `$TMP/out.md`.
Keep the user's `story.md`. Follow **A** in phase 1, in `notes.md`, **Steps** in `two/guide.md`.
See [the `run` step](notes.md#the-run-step) and [`guide.md`](../two/guide.md). Then **The `run`
step** in `notes.md`, and `two/guide.md`,
**Steps**.
EOF
cat > "$S/one/notes.md" <<'EOF'
# Notes

## A

## The `run` step
EOF
cat > "$S/two/SKILL.md" <<'EOF'
---
name: two
---
# Two

## Paths: `$TWO`

**`$TWO` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.

The other skill writes `$ONE/missing.md`, a shell path here.
EOF
cat > "$S/two/guide.md" <<'EOF'
# Guide

## Steps
EOF
printf '*.doc-meta.md\n' > "$GOOD/.gitignore"
printf 'See `missing.md`, **Nope** in `gone.md`.\n' > "$S/one/notes.doc-meta.md"
git -C "$GOOD" init -q

check "$GOOD" > /dev/null 2> "$TMP/err" || { cat "$TMP/err" >&2; fail "the good tree fails"; }
echo "ok: good"

broken() {
  local case="$1" file="plugins/annetaan/skills/$2" line="$3" expect="$4"
  cp -R "$GOOD" "$TMP/$case"
  local n rc=0
  n="$(($(wc -l < "$TMP/$case/$file") + 1))"
  printf '%s\n' "$line" >> "$TMP/$case/$file"
  check "$TMP/$case" > /dev/null 2> "$TMP/err" || rc=$?
  [ "$rc" -eq 1 ] || { cat "$TMP/err" >&2; fail "$case: exit $rc, not 1"; }
  grep -qF "$file:$n: $expect" "$TMP/err" || { cat "$TMP/err" >&2; fail "$case: no line $file:$n: $expect"; }
  echo "ok: $case"
}

broken bare one/SKILL.md 'Read `guide.md`.' "guide.md is a file of two: write it with the skill's name"
broken qualified one/SKILL.md 'Read `two/none.md`.' 'two/none.md does not exist'
broken short one/SKILL.md 'Read `$ONE/none.md`.' '$ONE/none.md does not exist'
broken opening one/notes.md 'Read `$ONE/notes.md`.' 'uses $ONE/ but its opening lines do not name `$ONE`'
broken skills one/SKILL.md 'Read `<skills>/two/none.md`.' '<skills>/two/none.md does not exist'
broken section one/SKILL.md 'Follow **Nope** in `two/guide.md`.' 'two/guide.md has no section **Nope**'
broken wrapped one/SKILL.md 'Follow **No such** in
`two/guide.md`.' 'two/guide.md has no section **No such**'
broken link one/SKILL.md 'See [it](none.md).' 'link to none.md: no such file'
broken anchor one/SKILL.md 'See [it](notes.md#nope).' 'link to notes.md#nope: no such anchor'

cp -R "$GOOD" "$TMP/deleted"
git -C "$TMP/deleted" add -A
rm "$TMP/deleted/plugins/annetaan/skills/two/guide.md"
rc=0
check "$TMP/deleted" > /dev/null 2> "$TMP/err" || rc=$?
[ "$rc" -eq 1 ] || { cat "$TMP/err" >&2; fail "deleted: exit $rc, not 1"; }
grep -qF "plugins/annetaan/skills/one/SKILL.md:10: two/guide.md does not exist" "$TMP/err" || { cat "$TMP/err" >&2; fail "deleted: no line for two/guide.md"; }
echo "ok: deleted"
