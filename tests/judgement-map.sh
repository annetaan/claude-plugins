#!/usr/bin/env bash
# Test: the table in judgement.md ("Where each section applies") agrees with the sections of judgement.md and with
# the role files. Every section has a row, every cell that is not `-` is backed by a bold citation of the section
# in a role file of that column, and every bold section name cited "in `.../judgement.md`" is a real section.
#
# Run: bash tests/judgement-map.sh   (exit 0 is success, anything else is failure)
# Runs offline: reads files only.
# SKILLS=<path> tests another copy of plugins/annetaan/skills.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS="${SKILLS:-$ROOT/plugins/annetaan/skills}"
JUDGEMENT="$SKILLS/workflow/judgement.md"
TABLE_HEADING="Where each section applies"

fail() { echo "FAIL: $*" >&2; exit 1; }

[ -f "$JUDGEMENT" ] || fail "missing $JUDGEMENT"

# The role files of each column of the table.
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

# The table: the lines that start with `|`, without the header and the separator.
TABLE="$(grep '^|' "$JUDGEMENT" | sed '1,2d')"
[ -n "$TABLE" ] || fail "judgement.md has no table under \"$TABLE_HEADING\""
HEADER="$(grep '^|' "$JUDGEMENT" | sed -n 1p)"

# 1. The headings of judgement.md, except the table's own, are the first column of the table.
HEADINGS="$(grep '^## ' "$JUDGEMENT" | sed 's/^## //' | grep -vxF "$TABLE_HEADING" | sort)"
ROWS="$(printf '%s\n' "$TABLE" | awk -F'|' '{print $2}' | trim | sort)"
if [ "$HEADINGS" != "$ROWS" ]; then
  echo "headings of judgement.md (<) against rows of the table (>):" >&2
  diff <(printf '%s\n' "$HEADINGS") <(printf '%s\n' "$ROWS") >&2 || true
  fail "the sections of judgement.md and the first column of its table differ"
fi

# 2. Every cell that is not `-` is backed by **<Section>** in a role file of its column.
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

# 3. Every bold name followed by ` in ` and a backticked judgement.md path is a section of judgement.md.
CITED="$(grep -rhoE '\*\*[^*]+\*\* in `[^`]*judgement\.md`' "$SKILLS" | sed -E 's/^\*\*([^*]+)\*\* in .*/\1/' | sort -u || true)"
while IFS= read -r name; do
  [ -n "$name" ] || continue
  printf '%s\n' "$HEADINGS" | grep -qxF "$name" || fail "a role file cites **$name** in judgement.md, which has no such section"
done <<EOF
$CITED
EOF

echo "ok: $COUNT sections mapped"
