#!/usr/bin/env bash
set -uo pipefail

TESTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$TESTS/.." && pwd)"

for tool in tsc oxlint tsgolint oxfmt; do
  if [ ! -x "$ROOT/node_modules/.bin/$tool" ]; then
    echo "tests/run.sh: $tool is missing; run pnpm install in $ROOT" >&2
    exit 1
  fi
done

OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

failed=0
check() {
  local name="$1"
  shift
  local start=$SECONDS
  if (cd "$ROOT" && "$@") </dev/null >"$OUT" 2>&1; then
    echo "ok $name $((SECONDS - start))s"
  else
    echo "FAIL $name"
    cat "$OUT"
    failed=1
  fi
}

check tsc node_modules/.bin/tsc -p .
check oxlint node_modules/.bin/oxlint --type-aware --deny-warnings
check oxfmt node_modules/.bin/oxfmt --check
for test in "$TESTS"/*.test.ts; do
  check "$(basename "$test")" "$ROOT/plugins/annetaan/scripts/ts.sh" --test "$test"
done
for test in "$TESTS"/*.sh; do
  name="$(basename "$test")"
  [ "$name" = "run.sh" ] && continue
  check "$name" bash "$test"
done
exit "$failed"
