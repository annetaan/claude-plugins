#!/usr/bin/env bash
exec "$(dirname "${BASH_SOURCE[0]}")/../../../scripts/ts.sh" "$(dirname "${BASH_SOURCE[0]}")/auto.ts" "$@"
