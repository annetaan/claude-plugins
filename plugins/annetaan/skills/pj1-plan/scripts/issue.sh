#!/usr/bin/env bash
set -euo pipefail

die() { echo "issue: $*" >&2; exit 1; }

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

PROJECT_SH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/project.sh"

PY_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/issue.py"

exec python3 "$PY_FILE" "$PROJECT_SH" "$@"
