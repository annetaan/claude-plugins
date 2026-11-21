#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="plugins/annetaan"
MANIFEST="$PLUGIN/.claude-plugin/plugin.json"

fail() { echo "FAIL: $*" >&2; exit 1; }

BUMP=0
case "$#:${1:-}" in
  0:) ;;
  1:--bump) BUMP=1 ;;
  *) fail "usage: bash tests/plugin-version.sh [--bump]" ;;
esac

cd "$ROOT"
DEFAULT="$(git symbolic-ref -q --short refs/remotes/origin/HEAD || echo origin/main)"
git rev-parse -q --verify "$DEFAULT^{commit}" >/dev/null || fail "$DEFAULT does not name a commit"
BASE="$(git merge-base HEAD "$DEFAULT")" || fail "HEAD has no merge base with $DEFAULT"

CHANGED="$(git diff --name-only "$BASE" -- "$PLUGIN"; git ls-files --others --exclude-standard -- "$PLUGIN")"
if [ -z "$CHANGED" ]; then
  echo "ok: nothing under $PLUGIN differs from $DEFAULT"
  exit 0
fi

read_version() {
  python3 -I -c '
import json, re, sys
v = json.load(sys.stdin).get("version")
if not isinstance(v, str) or not re.fullmatch(r"\d+\.\d+\.\d+", v):
    sys.exit("not three integers: %r" % (v,))
print(v)'
}

BASE_VERSION="$(git show "$BASE:$MANIFEST" | read_version)" || fail "$MANIFEST at the merge base has no usable version"
DEFAULT_VERSION="$(git show "$DEFAULT:$MANIFEST" | read_version)" || fail "$MANIFEST on $DEFAULT has no usable version"
VERSION="$(read_version < "$MANIFEST")" || fail "$MANIFEST in the working tree has no usable version"

VERDICT="$(python3 -I - "$BASE_VERSION" "$DEFAULT_VERSION" "$VERSION" <<'PY'
import sys
base, default, current = (tuple(int(p) for p in v.split(".")) for v in sys.argv[1:])
floor = max(base, default)
print(".".join(map(str, floor)), "above" if current > floor else "not", "%d.%d.0" % (floor[0], floor[1] + 1))
PY
)"
read -r FLOOR STATE NEXT <<<"$VERDICT"

if [ "$STATE" = above ]; then
  echo "ok: $MANIFEST is $VERSION, above $FLOOR"
  exit 0
fi
if [ "$BUMP" -eq 0 ]; then
  fail "$MANIFEST is $VERSION, not above $FLOOR; run bash tests/plugin-version.sh --bump"
fi
python3 -I - "$MANIFEST" "$NEXT" <<'PY'
import re, sys
path, nxt = sys.argv[1:]
with open(path, encoding="utf-8", newline="") as f:
    text = f.read()
text = re.sub(r'("version"\s*:\s*")[^"]*(")', lambda m: m.group(1) + nxt + m.group(2), text, count=1)
with open(path, "w", encoding="utf-8", newline="") as f:
    f.write(text)
PY
echo "bumped: $MANIFEST is $NEXT"
