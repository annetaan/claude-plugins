#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS="plugins/annetaan/skills"
README="README.md"
MARKETPLACE=".claude-plugin/marketplace.json"
PLUGIN_README="plugins/annetaan/README.md"

fail() { echo "FAIL: $*" >&2; exit 1; }

front() { awk -v k="$2" '/^---$/{n++; next} n==1 && index($0,k": ")==1 {print substr($0,length(k)+3); exit}' "$1"; }

entries() { sed -e 's/, /,/g' -e 's/ and /,/g' | tr ',' '\n'; }

cd "$ROOT"
skills="$(git ls-files --cached --others --exclude-standard -- "$SKILLS" \
  | grep -E "^$SKILLS/[^/]+/SKILL\.md\$" | sort -u \
  | while read -r f; do if [ -f "$f" ]; then basename "$(dirname "$f")"; fi; done)"
count="$(printf '%s' "$skills" | grep -c .)" || fail "no skill under $SKILLS"

links="$(grep -oE '\[[^]]*\]\([^)]*\)' "$README" | sed -E 's/^\[([^]]*)\].*/\1/' | entries)"
description="$(jq -r '.plugins[] | select(.name == "annetaan") | .description' "$MARKETPLACE")"
listed="$(sed -nE 's/.*(^|[.] )Skills: ([^.]*)[.]$/\2/p' <<<"$description" | entries)"
[ -n "$listed" ] || fail "$MARKETPLACE: the description of annetaan does not end with the sentence Skills: <name>, <name>."
headings="$(awk '/^```/{fence=!fence; next} fence{next} /^## /{inside=($0=="## Skills"); next} inside && /^### / {print substr($0,5)}' "$PLUGIN_README" | entries)"

grep -qF "[$count skills]" "$README" || fail "$README does not give the count as [$count skills]"

for skill in $skills; do
  file="$SKILLS/$skill/SKILL.md"
  [ "$(front "$file" name)" = "$skill" ] || fail "$file has name '$(front "$file" name)', not $skill"
  grep -qF 'Use it only when' <<<"$(front "$file" description)" || fail "$file has a description without 'Use it only when'"
  grep -qxF "$skill" <<<"$links" || fail "$README links no text naming $skill"
  grep -qxF "$skill" <<<"$listed" || fail "$MARKETPLACE: the Skills: sentence of the annetaan description does not name $skill"
  grep -qxF "$skill" <<<"$headings" || fail "$PLUGIN_README has no ### heading under ## Skills naming $skill"
done
echo "ok: $count skills listed everywhere"
