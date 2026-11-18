#!/usr/bin/env bash
set -euo pipefail

die() { echo "run: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: run.sh start <P>                       check the clone, gh and the repository, read the project, create its base branch when due, fetch it, read the merge rules
       run.sh close <P> <n> --comment <file>  comment on and close #<n> as completed, when it is due. For a parent it also lists the projects that can be split now (startable)
       run.sh worktree <P>                    put the run's worktree on the tip of origin/<base>; a dirty one is saved to work-reports/<stamp>-discarded/stopped.diff and discarded; assigns you to the parent, and stops when someone else is assigned
       run.sh ignore <P> [--add]              whether .claude/worktrees/ and work-reports/ are ignored; --add writes them to info/exclude
       run.sh branch <P> <branch>             create <branch> in the run's worktree from the tip of origin/<base>
       run.sh merge <P> <k> <m> --comment <file> [--wait <seconds>]
                                              wait for the required checks, merge #<m> into the base branch, close #<k>, delete the head branch
       run.sh sync <P> [--push]               merge origin/<from> into the base branch in the run's worktree and push it; --push pushes a merge committed after a conflict
       run.sh pr <P> --body <file>            open the pull request from the base branch into <from>, once every sub-issue is closed and the base contains <from>
       run.sh save <P> --to <file> --since <sha>
                                              save everything in the run's worktree since <sha>, commits and uncommitted work (tracked changes plus untracked files), to <file> as one binary diff, then put the worktree back on <sha> and delete the run's branch, keeping ignored files
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
USAGE
  exit 1
}

number() { case "$2" in ''|*[!0-9]*) die "$1 must be a number: $2" ;; esac; }

[ $# -ge 2 ] || usage
number "the project" "$2"
case "$1" in
  start)    [ $# -eq 2 ] || usage ;;
  close)    [ $# -eq 5 ] && [ "$4" = "--comment" ] || usage
            number "the issue" "$3"
            [ -f "$5" ] || die "no such file: $5" ;;
  worktree) [ $# -eq 2 ] || usage ;;
  ignore)   [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$3" = "--add" ]; } || usage ;;
  branch)   [ $# -eq 3 ] || usage ;;
  merge)    { [ $# -eq 6 ] || [ $# -eq 8 ]; } && [ "$5" = "--comment" ] || usage
            number "the issue" "$3"
            number "the pull request" "$4"
            [ -f "$6" ] || die "no such file: $6"
            if [ $# -eq 8 ]; then
              [ "$7" = "--wait" ] || usage
              number "the wait in seconds" "$8"
            fi ;;
  sync)     [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$3" = "--push" ]; } || usage ;;
  pr)       [ $# -eq 4 ] && [ "$3" = "--body" ] || usage
            [ -f "$4" ] || die "no such file: $4" ;;
  save)     [ $# -eq 6 ] && [ "$3" = "--to" ] && [ "$5" = "--since" ] || usage ;;
  *)        usage ;;
esac

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

PROJECT_SH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../pj1-plan/scripts/project.sh"

PY_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run.py"

exec python3 "$PY_FILE" "$PROJECT_SH" "$@"
