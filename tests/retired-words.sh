#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

RETIRED="$(cat <<'EOF'
design review |
Breaking changes: |
breaking changes are welcome |
breaking-changes.md |
minimal change |
the two review seats |
both seats |
both review seats |
the other seat |
those last three |
level 1 |
level 2 |
level 3 |
levels 1 |
panel.sh |
panel.py |
EOF
)"

check() {
  python3 -I - "$1" "$2" <<'EOF'
import os, re, subprocess, sys

root, table = sys.argv[1], sys.argv[2]
SCOPE = ["plugins/annetaan", "README.md", ".claude-plugin/marketplace.json"]
GAP = r"(?:[\s>*`-]|<br\s*/?>)+"

retired = {}
for row in table.split("\n"):
    if row.strip():
        words, _, allowed = row.partition("|")
        retired[words.strip()] = {a.strip() for a in allowed.split(",") if a.strip()}

patterns = {
    words: re.compile(GAP.join(re.escape(w) for w in re.split(r"[\s-]+", words)), re.I)
    for words in retired
}

listed = [p for p in subprocess.run(
    ["git", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "--", *SCOPE],
    check=True, capture_output=True, text=True).stdout.split("\n")
    if p.endswith((".md", ".json")) and os.path.isfile(os.path.join(root, p))]

findings = []
for p in sorted(listed):
    with open(os.path.join(root, p)) as f:
        text = f.read()
    for words, pattern in patterns.items():
        if p in retired[words]:
            continue
        for m in pattern.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            findings.append(f'{p}:{line}: "{re.sub(GAP, " ", m.group(0))}" is retired ({words})')

if findings:
    print("\n".join(findings), file=sys.stderr)
    sys.exit(1)
print(f"ok: {len(listed)} files, {len(retired)} retired phrases, none found")
EOF
}

check "$ROOT" "$RETIRED" || fail "retired wording under plugins/annetaan, README.md or .claude-plugin/marketplace.json"

GOOD="$TMP/good"
mkdir -p "$GOOD/plugins/annetaan/.claude-plugin" "$GOOD/plugins/annetaan/skills/workflow" "$GOOD/.claude-plugin" "$GOOD/tests" "$GOOD/.claude"
printf '# Annetaan\n\nA plugin with two review seats at `high`.\n' > "$GOOD/plugins/annetaan/README.md"
printf '# Workflow\n\nDesign, implement, review.\nThe design is read, then the review runs.\n' > "$GOOD/plugins/annetaan/skills/workflow/README.md"
printf '{\n  "name": "annetaan",\n  "description": "Design and review skills"\n}\n' > "$GOOD/plugins/annetaan/.claude-plugin/plugin.json"
printf '# Root\n\nBreaking changes need a decision.\n' > "$GOOD/README.md"
printf '{\n  "plugins": []\n}\n' > "$GOOD/.claude-plugin/marketplace.json"
git -C "$GOOD" init -q
git -C "$GOOD" add -A

check "$GOOD" "$RETIRED" > /dev/null 2> "$TMP/err" || { cat "$TMP/err" >&2; fail "the good tree fails"; }
echo "ok: good"

expect_hit() {
  local case="$1" rc="$2" expect="$3"
  [ "$rc" -eq 1 ] || { cat "$TMP/err" >&2; fail "$case: exit $rc, not 1"; }
  grep -qF "$expect" "$TMP/err" || { cat "$TMP/err" >&2; fail "$case: no line $expect"; }
  echo "ok: $case"
}

broken() {
  local case="$1" file="$2" text="$3" joined="$4"
  cp -R "$GOOD" "$TMP/$case"
  local n rc=0
  n="$(($(wc -l < "$TMP/$case/$file") + 1))"
  printf '%s\n' "$text" >> "$TMP/$case/$file"
  check "$TMP/$case" "$RETIRED" > /dev/null 2> "$TMP/err" || rc=$?
  expect_hit "$case" "$rc" "$file:$n: \"$joined\" is retired"
}

W=plugins/annetaan/skills/workflow/README.md
P=plugins/annetaan/README.md

broken wrapped "$W" 'That run has no design
review, no approval.' 'design review'
broken indented "$P" 'Those last
  three are new for every task.' 'Those last three'
broken hyphen "$P" 'Read `design-review.md`.' 'design review'
broken br "$P" 'seats<br/>Design<br/>review' 'Design review'
broken quote "$W" '> no design
> review' 'design review'

cp -R "$GOOD" "$TMP/json"
printf '{\n  "name": "annetaan",\n  "description": "Runs both seats on every task"\n}\n' > "$TMP/json/plugins/annetaan/.claude-plugin/plugin.json"
rc=0
check "$TMP/json" "$RETIRED" > /dev/null 2> "$TMP/err" || rc=$?
expect_hit json "$rc" 'plugins/annetaan/.claude-plugin/plugin.json:3: "both seats" is retired'

cp -R "$GOOD" "$TMP/untracked"
printf 'No design\nreview here.\n' > "$TMP/untracked/plugins/annetaan/new.md"
rc=0
check "$TMP/untracked" "$RETIRED" > /dev/null 2> "$TMP/err" || rc=$?
expect_hit untracked "$rc" 'plugins/annetaan/new.md:1: "design review" is retired'

ALLOWED="both seats | $P, plugins/annetaan/other.md"
cp -R "$GOOD" "$TMP/allowed"
printf 'Both\nseats run.\n' >> "$TMP/allowed/$P"
check "$TMP/allowed" "$ALLOWED" > /dev/null 2> "$TMP/err" || { cat "$TMP/err" >&2; fail "allowed: a path in the table still fails"; }
printf 'Both\nseats run.\n' >> "$TMP/allowed/$W"
rc=0
check "$TMP/allowed" "$ALLOWED" > /dev/null 2> "$TMP/err" || rc=$?
expect_hit allowed "$rc" "$W:5: \"Both seats\" is retired"
! grep -qF "$P" "$TMP/err" || { cat "$TMP/err" >&2; fail "allowed: the allowed path is reported"; }

cp -R "$GOOD" "$TMP/outside"
printf 'Both seats, design\nreview.\n' > "$TMP/outside/tests/x.md"
printf 'Both seats, design\nreview.\n' > "$TMP/outside/.claude/annetaan-level.md"
printf 'Both seats, design\nreview.\n' > "$TMP/outside/CLAUDE.md"
check "$TMP/outside" "$RETIRED" > /dev/null 2> "$TMP/err" || { cat "$TMP/err" >&2; fail "outside: a file out of scope fails"; }
echo "ok: outside"
