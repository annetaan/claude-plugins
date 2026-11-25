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
  case "$(node -p process.features.typescript 2>/dev/null || true)" in
    strip | transform)
      if [ "${1-}" = "--test" ]; then
        shift
        exec node --test "$@"
      fi
      exec node "$@"
      ;;
  esac
fi

echo 'annetaan: needs Bun, or Node.js 22.18 or later (https://bun.com, https://nodejs.org)' >&2
exit 1
