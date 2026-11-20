#!/usr/bin/env bash
set -euo pipefail

die() { echo "level: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: level.sh show <dir> [<n>]                    the level of the clone at <dir>, read from .claude/annetaan-level.md on
                                                    origin's default branch, and the model and effort it gives each levelled
                                                    agent. <n>, 1, 2 or 3, overrides it
       level.sh record <WORKDIR> <level> <source>   append the line that records the run's level and its review counts to
                                                    <WORKDIR>/log.md. <level> is 1, 2 or 3, <source> is file, override or default
       level.sh history <dir>                       the Level: lines of the pull requests merged since the level file's
                                                    evaluated date, grouped by level and source
Every subcommand prints one JSON object with "status" and exits 0.
Exit 1 means a usage error, or <dir> is not inside a git clone.
USAGE
  exit 1
}

[ $# -ge 1 ] || usage
case "$1" in
  show)
    case $# in
      2) ;;
      3) case "$3" in 1|2|3) ;; *) usage ;; esac ;;
      *) usage ;;
    esac ;;
  record)
    [ $# -eq 4 ] || usage
    case "$3" in 1|2|3) ;; *) usage ;; esac
    case "$4" in file|override|default) ;; *) usage ;; esac ;;
  history)
    [ $# -eq 2 ] || usage ;;
  *) usage ;;
esac

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec python3 "$SCRIPT_DIR/level.py" "$@"
