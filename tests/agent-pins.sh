#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="${PLUGIN:-$ROOT/plugins/annetaan}"
README="$PLUGIN/README.md"
LEVEL="$PLUGIN/skills/workflow/scripts/level.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

fail() { echo "FAIL: $*" >&2; exit 1; }

front() { awk -v k="$2" '/^---$/{n++; next} n==1 && index($0,k": ")==1 {print substr($0,length(k)+3); exit}' "$1"; }

git init -q --bare -b main "$TMP/origin.git"
git clone -q "$TMP/origin.git" "$TMP/clone" 2>/dev/null
(
  cd "$TMP/clone"
  git checkout -q -b main
  echo readme > README.md
  git add README.md
  git commit -q -m init
  git push -q origin main
)
for n in 1 2 3; do
  "$LEVEL" show "$TMP/clone" "$n" > "$TMP/level-$n.json" || fail "level.sh show $n exited non-zero"
done
"$LEVEL" show "$TMP/clone" > "$TMP/level-none.json" || fail "level.sh show exited non-zero"

levelled() {
  python3 -c '
import json, sys
tmp, name = sys.argv[1], sys.argv[2]
values = {(d["agents"][name]["model"], d["agents"][name]["effort"]) if name in d["agents"] else None
          for d in (json.load(open("%s/level-%d.json" % (tmp, n))) for n in (1, 2, 3))}
print("yes" if len(values) > 1 else "no")
' "$TMP" "$1"
}

at_level() {
  python3 -c '
import json, sys
a = json.load(open(sys.argv[1]))["agents"].get(sys.argv[2])
print("" if a is None else a["model"] + " " + a["effort"])
' "$TMP/level-$1.json" "$2"
}

agents=0
for f in "$PLUGIN"/agents/*.md; do
  name="$(basename "$f" .md)"
  model="$(front "$f" model)"
  effort="$(front "$f" effort)"
  [ -n "$model" ] || fail "$name has no model"
  [ -n "$effort" ] || fail "$name has no effort"
  if [ "$(levelled "$name")" = yes ]; then
    front "$f" description | grep -qF "(level 3: $model / effort $effort" \
      || fail "$name: the description does not hold (level 3: $model / effort $effort"
  else
    front "$f" description | grep -qF "($model / effort $effort)" \
      || fail "$name: the description does not hold ($model / effort $effort)"
  fi
  agents=$((agents + 1))
done
echo "ok: $agents agents have a model, an effort and a matching description, levelled ones as level 3"

python3 -c '
import json, sys
for n in ("3", "none"):
    d = json.load(open("%s/level-%s.json" % (sys.argv[1], n)))
    assert d["level"] == 3, d
' "$TMP" || fail "level.sh show without a file or with 3 is not level 3"
for name in $(python3 -c 'import json,sys; print(" ".join(json.load(open(sys.argv[1]))["agents"]))' "$TMP/level-3.json"); do
  f="$PLUGIN/agents/$name.md"
  [ -f "$f" ] || fail "level.sh names $name, which has no file under agents/"
  want="$(front "$f" model) $(front "$f" effort)"
  for n in 3 none; do
    [ "$(at_level "$n" "$name")" = "$want" ] || fail "$name: level.sh show ($n) gives '$(at_level "$n" "$name")', the frontmatter says '$want'"
  done
done
echo "ok: every agent level.sh names has a file, and its level-3 values are its frontmatter"

rows=0
for f in "$PLUGIN"/agents/*.md; do
  name="$(basename "$f" .md)"
  row="$(grep -F "| \`annetaan:$name\` |" "$README" || true)"
  [ "$(printf '%s\n' "$row" | grep -c .)" = 1 ] || fail "$name has not exactly one row in the README table"
  cells="$(printf '%s\n' "$row" | awk -F'|' '{gsub(/ /,"",$3); gsub(/ /,"",$4); print $3 " " $4}')"
  want="$(front "$f" model) $(front "$f" effort)"
  [ "$cells" = "$want" ] || fail "$name: the README row says '$cells', the frontmatter says '$want'"
  rows=$((rows + 1))
done
table="$(grep -c '^| `annetaan:' "$README")"
[ "$table" = "$rows" ] || fail "the README table has $table rows for $rows agents"
echo "ok: $rows README rows match the frontmatter"

python3 -c '
import json, re, sys
readme, tmp = sys.argv[1], sys.argv[2]
rows = {}
for line in open(readme):
    m = re.match(r"^\| `([a-z-]+)` \| (\w+) / (\w+) \| (\w+) / (\w+) \| (\w+) / (\w+) \|$", line.rstrip("\n"))
    if m:
        assert m.group(1) not in rows, "two README level rows for " + m.group(1)
        g = m.groups()
        rows[g[0]] = [(g[1], g[2]), (g[3], g[4]), (g[5], g[6])]
want = {}
for n in (1, 2, 3):
    for name, a in json.load(open("%s/level-%d.json" % (tmp, n)))["agents"].items():
        want.setdefault(name, []).append((a["model"], a["effort"]))
assert rows == want, (rows, want)
' "$README" "$TMP" || fail "the README level table does not match level.sh show 1, 2 and 3"
echo "ok: the README level table matches level.sh show at each level"

review="$(front "$PLUGIN/agents/workflow-design-review.md" model)"
for other in workflow-design pj-planner; do
  [ "$review" != "$(front "$PLUGIN/agents/$other.md" model)" ] || fail "workflow-design-review runs on the model of $other"
done
echo "ok: the design review runs on another model than the design and the planner"

for n in 1 2 3; do
  a="$(at_level "$n" workflow-reviewer-a)"
  b="$(at_level "$n" workflow-reviewer-b)"
  [ -n "$a" ] && [ -n "$b" ] || fail "level $n does not name both review seats"
  [ "${a%% *}" != "${b%% *}" ] || fail "at level $n workflow-reviewer-a and workflow-reviewer-b run on the same model"
done
echo "ok: the two review seats run on different models at every level"

if grep -rnE '(opus|sonnet|fable|haiku) / (low|medium|high|xhigh|max)|pinned to (Fable|fable|opus|sonnet|haiku) at' "$PLUGIN/skills"; then
  fail "a skill states a pin"
fi
echo "ok: no skill states a pin"
