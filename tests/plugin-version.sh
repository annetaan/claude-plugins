#!/usr/bin/env bash
exec "$(dirname "${BASH_SOURCE[0]}")/../plugins/annetaan/scripts/ts.sh" "$(dirname "${BASH_SOURCE[0]}")/plugin-version.ts" "$@"
