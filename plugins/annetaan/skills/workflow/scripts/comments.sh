#!/usr/bin/env bash
set -euo pipefail

die() { echo "comments: $*" >&2; exit 2; }

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec python3 "$SCRIPT_DIR/comments.py" "$@"
