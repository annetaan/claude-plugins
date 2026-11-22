#!/usr/bin/env bash
set -euo pipefail

die() { echo "panel: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: panel.sh run <WT> <seat> <probe dir>   snapshot the working tree of <WT>, put seat a or b at it, copy <probe dir>/tree over it,
                                              run <probe dir>/run.sh there and print its exit and its last 40 lines
       panel.sh close <WT>                    remove the seats; safe when there is none, and when <WT> is already gone
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
<probe dir> has to be under <WT>/work-reports/. Exit 1 means a usage error or an unexpected failure.
USAGE
  exit 1
}

[ $# -ge 1 ] || usage
case "$1" in
  run) [ $# -eq 4 ] || usage ;;
  close) [ $# -eq 2 ] || usage ;;
  *) usage ;;
esac

case "$2" in /*) ;; *) die "<WT> must be an absolute path: $2" ;; esac

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec python3 "$SCRIPT_DIR/panel.py" "$@"
