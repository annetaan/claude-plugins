#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail() { echo "FAIL: $*" >&2; exit 1; }

cd "$ROOT"
if ! OUTPUT="$(python3 "$ROOT/plugins/annetaan/skills/workflow/scripts/comments.py" --all 2>&1)"; then
  echo "$OUTPUT" >&2
  fail "the repository holds a comment or a silenced check"
fi
echo "ok: the repository holds no comment and no silenced check"
