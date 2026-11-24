#!/usr/bin/env bash
set -euo pipefail

die() { echo "include: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: include.sh remember <worktree> [--copy <path>]... [--never <path>]...
                                  append /<path> for each --copy and !/<path> for each --never to <MAIN>/.worktreeinclude,
                                  then copy the listed ignored files into <worktree>. Every <path> has to be one of the
                                  worktree's unlisted files, and at least one is given
Prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
USAGE
  exit 1
}

[ $# -ge 4 ] && [ "$1" = remember ] && [ $(( $# % 2 )) -eq 0 ] || usage
for ((i = 3; i <= $#; i += 2)); do
  case "${!i}" in
    --copy|--never) ;;
    *) usage ;;
  esac
done

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec python3 "$SCRIPT_DIR/include.py" "$@"
