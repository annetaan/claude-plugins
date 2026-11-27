#!/usr/bin/env bash
set -euo pipefail

if command -v bun >/dev/null; then
  if [ "${1-}" = "--test" ]; then
    shift
    exec bun test --timeout 600000 "$@"
  fi
  exec bun "$@"
fi

if command -v node >/dev/null; then
  read -r major typescript <<<"$(node -p '`${process.versions.node.split(".")[0]} ${process.features.typescript}`' 2>/dev/null || true)"
  if [ "$major" -ge 24 ] 2>/dev/null; then
    case "$typescript" in
      strip | transform)
        if [ "${1-}" = "--test" ]; then
          shift
          exec node --test "$@"
        fi
        exec node "$@"
        ;;
    esac
  fi
fi

echo 'annetaan: needs Bun, or Node.js 24 or later (https://bun.com, https://nodejs.org)' >&2
exit 1
