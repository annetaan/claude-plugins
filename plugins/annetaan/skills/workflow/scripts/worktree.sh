#!/usr/bin/env bash
set -euo pipefail

die() { echo "worktree: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: worktree.sh start                          check the clone, gh and the repository
       worktree.sh create <base>                  fetch origin/<base> and add a detached worktree wf-<stamp> on its tip
       worktree.sh ignore <name> [--add]          whether .claude/worktrees/ and work-reports/ are ignored; --add writes them to info/exclude
       worktree.sh sync <name> <base>             whether HEAD of the worktree <name> conflicts with origin/<base>; on a conflict, start the merge
       worktree.sh pr [<number>]                  the open pull request <number>, or the open pull requests of the user that conflict
       worktree.sh list                           the wf-* worktrees of this clone with the state of their pull request
       worktree.sh check <name>                   what cleanup would do for the worktree <name>
       worktree.sh old-reports [--from <path>] [--delete]
                                                  the work reports in <MAIN>/work-reports/ beyond the 100 newest by their stamp.
                                                  --from counts in the reports of <path>/work-reports/ under the names they move in as;
                                                  --delete moves those in first, then removes the old ones. Used by pj-cleanup
       worktree.sh submodules <path>              whether the worktree at <path> has submodules, and which of them hold work of their own.
                                                  Used by pj-cleanup
       worktree.sh cleanup <name> [--discard]     move the work reports out, remove the worktree, delete the branch, fast-forward the base.
                                                  --discard removes work that nothing else holds. It also deletes the old reports
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
USAGE
  exit 1
}

[ $# -ge 1 ] || usage
case "$1" in
  start|list) [ $# -eq 1 ] || usage ;;
  create)     [ $# -eq 2 ] || usage ;;
  check)      [ $# -eq 2 ] || usage ;;
  submodules) [ $# -eq 2 ] || usage ;;
  ignore)     [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$3" = "--add" ]; } || usage ;;
  sync)       [ $# -eq 3 ] || usage ;;
  pr)         [ $# -le 2 ] || usage ;;
  old-reports) [ $# -eq 1 ] || { [ $# -eq 2 ] && [ "$2" = "--delete" ]; } || { [ $# -eq 3 ] && [ "$2" = "--from" ]; } \
                || { [ $# -eq 4 ] && [ "$2" = "--from" ] && [ "$4" = "--delete" ]; } || usage ;;
  cleanup)    [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$3" = "--discard" ]; } || usage ;;
  *)          usage ;;
esac

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec python3 "$SCRIPT_DIR/worktree.py" "$SCRIPT_DIR/flow.sh" "$@"
