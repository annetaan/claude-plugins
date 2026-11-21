#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS="${SKILLS:-$ROOT/plugins/annetaan/skills}"
JUDGEMENT="$SKILLS/workflow/judgement.md"
TABLE_HEADING="Where each section applies"

fail() { echo "FAIL: $*" >&2; exit 1; }

[ -f "$JUDGEMENT" ] || fail "missing $JUDGEMENT"

column_files() {
  case "$1" in
    Design) echo "workflow/roles/design.md pj1-plan/roles/plan.md pj2-issues/roles/split.md pj2-issues/roles/issue.md" ;;
    "Design review") echo "workflow/roles/design-review.md" ;;
    "Project review") echo "pj3-doctor/roles/review.md" ;;
    Implementation) echo "workflow/roles/work.md" ;;
    Review) echo "workflow/roles/review.md" ;;
    *) fail "the table has a column the test does not know: $1" ;;
  esac
}

trim() { sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

TABLE="$(grep '^|' "$JUDGEMENT" | sed '1,2d')"
[ -n "$TABLE" ] || fail "judgement.md has no table under \"$TABLE_HEADING\""
HEADER="$(grep '^|' "$JUDGEMENT" | sed -n 1p)"

HEADINGS="$(grep '^## ' "$JUDGEMENT" | sed 's/^## //' | grep -vxF "$TABLE_HEADING" | sort)"
ROWS="$(printf '%s\n' "$TABLE" | awk -F'|' '{print $2}' | trim | sort)"
if [ "$HEADINGS" != "$ROWS" ]; then
  echo "headings of judgement.md (<) against rows of the table (>):" >&2
  diff <(printf '%s\n' "$HEADINGS") <(printf '%s\n' "$ROWS") >&2 || true
  fail "the sections of judgement.md and the first column of its table differ"
fi

COUNT=0
while IFS= read -r row; do
  section="$(printf '%s\n' "$row" | awk -F'|' '{print $2}' | trim)"
  COUNT=$((COUNT + 1))
  ncols="$(printf '%s\n' "$HEADER" | awk -F'|' '{print NF - 2}')"
  i=2
  while [ "$i" -le "$ncols" ]; do
    column="$(printf '%s\n' "$HEADER" | awk -F'|' -v n=$((i + 1)) '{print $n}' | trim)"
    cell="$(printf '%s\n' "$row" | awk -F'|' -v n=$((i + 1)) '{print $n}' | trim)"
    i=$((i + 1))
    [ -n "$cell" ] || fail "the row \"$section\" has an empty cell under $column"
    [ "$cell" != "-" ] || continue
    found=0
    for f in $(column_files "$column"); do
      [ -f "$SKILLS/$f" ] || fail "missing role file $f"
      if grep -qF "**$section**" "$SKILLS/$f"; then found=1; break; fi
    done
    [ "$found" -eq 1 ] || fail "\"$section\" applies to $column, but no role file of that column cites **$section**"
  done
done <<EOF
$TABLE
EOF

echo "ok: $COUNT sections mapped"
