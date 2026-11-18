#!/usr/bin/env bash
# Owns the whole life of a workflow run's worktree, .claude/worktrees/wf-<stamp> under the main working tree, and
# prints each result as one JSON object. The judgment and the questions stay in the skills. --add and --discard carry
# the user's answers back.
# Writes on GitHub: cleanup deletes the run's branch on origin. Writes in git: create fetches the base branch into
# origin/<base>, check and cleanup fetch the base of a merged pull request and, when the clone lacks it, the pull
# request's head (refs/pull/<n>/head, object only, no ref), create adds the detached worktree, ignore --add appends to the clone's info/exclude, and cleanup
# moves the work reports into <MAIN>/work-reports/, removes the worktree, deletes the run's branch locally and on
# origin, and fast-forwards the local base branch when the pull request merged. It never switches a branch, stashes,
# commits or resets in the main working tree. list, old-reports without --delete and submodules only read. cleanup and old-reports --delete delete the work reports in
# <MAIN>/work-reports/ that arrived there 14 days ago or more. sync fetches origin/<base> and, on a conflict, starts a merge in the
# worktree and leaves it in progress. Nothing is recorded in git config or in files.
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
       worktree.sh old-reports [--delete]         the work reports in <MAIN>/work-reports/ that arrived 14 days ago or more; --delete removes them.
                                                  Used by pj-cleanup
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
  old-reports) [ $# -eq 1 ] || { [ $# -eq 2 ] && [ "$2" = "--delete" ]; } || usage ;;
  cleanup)    [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$3" = "--discard" ]; } || usage ;;
  *)          usage ;;
esac

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

exec python3 "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/worktree.py" "$@"
