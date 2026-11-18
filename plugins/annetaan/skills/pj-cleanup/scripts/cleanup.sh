#!/usr/bin/env bash
# Cleans up the clone after a project's pull request has merged, and prints each result as one JSON object.
# The judgment and the questions stay in the skill. --discard carries the user's answer back.
# Writes on GitHub: run deletes the project's base branch on origin. Writes in git: run moves the work reports out of
# the run's worktree into <MAIN>/work-reports/, removes the worktree, deletes the local base branch when origin holds
# its tip, and fast-forwards the local <from> to origin/<from>. It never switches a branch, stashes, commits or resets.
# run also deletes the work reports in <MAIN>/work-reports/ that arrived there 14 days ago or more, by calling
# ../../workflow/scripts/worktree.sh old-reports --delete, and check lists them with old-reports.
# It reads the project with ../../pj1-plan/scripts/project.sh, the old reports and the submodules that hold work of
# their own through ../../workflow/scripts/worktree.sh old-reports and submodules, and refuses a project that is not
# merged.
set -euo pipefail

die() { echo "cleanup: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: cleanup.sh list                  the projects that have a worktree in this clone
       cleanup.sh check <P>             what run would do for project <P>, which must be merged
       cleanup.sh run <P> [--discard]   move the work reports out, remove the worktree, delete the base branch,
                                        fast-forward <from>. --discard removes a worktree that holds work nothing else holds.
                                        It also deletes the old reports
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
USAGE
  exit 1
}

number() { case "$2" in ''|*[!0-9]*) die "$1 must be a number: $2" ;; esac; }

[ $# -ge 1 ] || usage
case "$1" in
  list)  [ $# -eq 1 ] || usage ;;
  check) [ $# -eq 2 ] || usage
         number "the project" "$2" ;;
  run)   [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$3" = "--discard" ]; } || usage
         number "the project" "$2" ;;
  *)     usage ;;
esac

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

PROJECT_SH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../pj1-plan/scripts/project.sh"
WORKTREE_SH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../workflow/scripts/worktree.sh"

PY_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cleanup.py"

exec python3 "$PY_FILE" "$PROJECT_SH" "$WORKTREE_SH" "$@"
