#!/usr/bin/env bash
set -uo pipefail

TESTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PYTHONDONTWRITEBYTECODE=1

ERR="$(mktemp)"
trap 'rm -f "$ERR"' EXIT

failed=0
for test in "$TESTS"/*.sh; do
  name="$(basename "$test")"
  [ "$name" = "run.sh" ] && continue
  start=$SECONDS
  if bash "$test" </dev/null >/dev/null 2>"$ERR"; then
    echo "ok $name $((SECONDS - start))s"
  else
    echo "FAIL $name"
    cat "$ERR"
    failed=1
  fi
done
exit "$failed"
