#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPTS="$ROOT/plugins/annetaan/skills/workflow/scripts"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

fail() { echo "FAIL: $*" >&2; exit 1; }

json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }

python3 -I - "$ROOT/plugins/annetaan/skills" > "$TMP/hits" <<'PYEOF'
import ast, glob, os, re, sys
KEPT = {("pj4-running/scripts/run.py", '"step": "fetch"'),
        ("workflow/scripts/level.py", '"git fetch failed"')}
py_word = re.compile(r"^\s*fetch(\s|$)|\bgit\b.*\bfetch(\s|$)")
sh_line = re.compile(r"""\bgit\b.*\bfetch\b|\bfetch\b.*\bgit\b|["']fetch["']""")

def python_lines(text):
    lines = text.splitlines()
    for node in ast.walk(ast.parse(text)):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and py_word.search(node.value):
            yield node.lineno, lines[node.lineno - 1]

def shell_lines(text):
    n = 1
    for line in re.split(r"(?<!\\)\n", text):
        joined = line.replace("\\\n", " ")
        if sh_line.search(joined):
            yield n, joined
        n += line.count("\n") + 1

for path in sorted(glob.glob(os.path.join(sys.argv[1], "*", "scripts", "*"))):
    if not path.endswith((".py", ".sh")) or os.path.basename(path) == "clone.py":
        continue
    rel = os.path.relpath(path, sys.argv[1])
    with open(path, encoding="utf-8") as f:
        text = f.read()
    for n, line in (python_lines(text) if path.endswith(".py") else shell_lines(text)):
        if not any(rel == k and kept in line for k, kept in KEPT):
            print("%s:%d: %s" % (rel, n, line.strip()))
PYEOF
[ ! -s "$TMP/hits" ] || fail "git fetch outside clone.py:
$(cat "$TMP/hits")"
echo "ok: no script but clone.py runs git fetch"

RUNS=6

git init -q --bare -b main "$TMP/origin.git"
git init -q -b main "$TMP/work"
MAIN="$(cd "$TMP/work" && pwd -P)"
(
  cd "$MAIN"
  echo '.claude/worktrees/' > .gitignore
  git add .gitignore
  git commit -q -m init
  git remote add origin "$TMP/origin.git"
  git push -q origin main
  for i in $(seq "$RUNS"); do git worktree add -q --detach "$TMP/linked-$i"; done
)
git clone -q "$TMP/origin.git" "$TMP/other"
(
  cd "$TMP/other"
  git commit -q --allow-empty -m more
  git push -q origin main
)
TIP="$(git -C "$TMP/other" rev-parse HEAD)"

cd "$MAIN"
for i in $(seq "$RUNS"); do
  bash "$SCRIPTS/worktree.sh" create main > "$TMP/create-$i" 2>&1 &
  bash "$SCRIPTS/level.sh" show "$TMP/linked-$i" > "$TMP/show-$i" 2>&1 &
done
wait

bad=""
for i in $(seq "$RUNS"); do
  out="$(cat "$TMP/create-$i")"
  { [ "$(echo "$out" | json 'd["status"]')" = ready ] && [ "$(echo "$out" | json 'd["head"]')" = "$TIP" ]; } 2>/dev/null \
    || bad="$bad
create $i: $out"
  out="$(cat "$TMP/show-$i")"
  { [ "$(echo "$out" | json 'd["warning"]')" = None ] && [ "$(echo "$out" | json 'd["ref"]')" = origin/main ]; } 2>/dev/null \
    || bad="$bad
show $i: $out"
done
[ -z "$bad" ] || fail "parallel creates and shows in one clone:$bad"
echo "ok: $RUNS creates and $RUNS level shows from linked worktrees, all at once, fetch without a ref lock failure"
