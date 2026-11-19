#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="${PLUGIN:-$ROOT/plugins/annetaan}"
README="$PLUGIN/README.md"

fail() { echo "FAIL: $*" >&2; exit 1; }

front() { awk -v k="$2" '/^---$/{n++; next} n==1 && index($0,k": ")==1 {print substr($0,length(k)+3); exit}' "$1"; }

agents=0
for f in "$PLUGIN"/agents/*.md; do
  name="$(basename "$f" .md)"
  model="$(front "$f" model)"
  effort="$(front "$f" effort)"
  [ -n "$model" ] || fail "$name has no model"
  [ -n "$effort" ] || fail "$name has no effort"
  front "$f" description | grep -qF "($model / effort $effort)" \
    || fail "$name: the description does not hold ($model / effort $effort)"
  agents=$((agents + 1))
done
echo "ok: $agents agents have a model, an effort and a matching description"

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

review="$(front "$PLUGIN/agents/workflow-design-review.md" model)"
for other in workflow-design pj-planner; do
  [ "$review" != "$(front "$PLUGIN/agents/$other.md" model)" ] || fail "workflow-design-review runs on the model of $other"
done
echo "ok: the design review runs on another model than the design and the planner"

[ "$(front "$PLUGIN/agents/workflow-reviewer-a.md" model)" != "$(front "$PLUGIN/agents/workflow-reviewer-b.md" model)" ] \
  || fail "workflow-reviewer-a and workflow-reviewer-b run on the same model"
echo "ok: the two review seats run on different models"

if grep -rnE '(opus|sonnet|fable|haiku) / (low|medium|high|xhigh|max)|pinned to (Fable|fable|opus|sonnet|haiku) at' "$PLUGIN/skills"; then
  fail "a skill states a pin"
fi
echo "ok: no skill states a pin"
