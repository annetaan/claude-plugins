#!/usr/bin/env bash
set -euo pipefail

die() { echo "flow: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: flow.sh run <WT> <seat> <probe dir>   snapshot the working tree of <WT>, put seat a or b at it, copy <probe dir>/tree over it,
                                              run <probe dir>/run.sh there and print its exit and its last 40 lines
       flow.sh close <WT>                    remove the seats; safe when there is none, and when <WT> is already gone
       flow.sh begin <WT> --level <level> --source <source> [--issue <n> --parent <P>]
                                              make the run's work directory under <WT>/work-reports/ with review/ and seats/,
                                              take HEAD as the start, and write the start, the level, its source, the issue
                                              and the parent to run.json
       flow.sh status <WT> [<scope>]         print the start, the work directory, the level, its source, the issue and the
                                              parent of the run whose run.json was written last; with a scope (task-<k>,
                                              integration or merge) also its next round, whether the cap is reached, the
                                              last verdict, the open findings and whether approve is allowed
       flow.sh lint <file>                   check one review file or a decisions.md against review-files.md and print ok,
                                              kind and reasons; it reads the file, the files beside it and, for a round
                                              file, its draft under drafts/
       flow.sh verify <WT> <scope>           run again every command of the scope's next round, the open earlier findings
                                              and the findings of each seat the run's level runs, sort them by the
                                              probe's exit, and write drafts/<scope>-round-<r>.md in the run's work
                                              directory
       flow.sh record <WT>                   write the pull request head, when the run comes from an issue, and the Level:
                                              line into log.md of the newest work directory, from its run.json
       flow.sh prompt <WT> <kind> [<scope>] [<seat>]
                                              write the prompt of one sub-agent call from prompts/<kind>.md to
                                              prompts/ of the run's work directory, and print its path, agent, model
                                              and effort; report, design and decisions take no scope, work, seat, again,
                                              respond, commit and detail take one, and seat also a seat, a or b
       flow.sh decisions <WT> <pr>           file one issue labelled decision per entry of decisions.md in the newest work
                                              directory, each pointing at pull request #<pr>, skip the entries decisions.json
                                              lists as filed, and print every issue filed for the file
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
<probe dir> has to be under <WT>/work-reports/. Exit 1 means a usage error or an unexpected failure.
USAGE
  exit 1
}

[ $# -ge 1 ] || usage
case "$1" in
  run) [ $# -eq 4 ] || usage ;;
  close) [ $# -eq 2 ] || usage ;;
  begin)
    [ $# -eq 6 ] || [ $# -eq 10 ] || usage
    [ "$3" = --level ] || usage
    case "$4" in standard|high) ;; *) usage ;; esac
    [ "$5" = --source ] || usage
    case "$6" in file|override|default) ;; *) usage ;; esac
    if [ $# -eq 10 ]; then
      [ "$7" = --issue ] && [ "$9" = --parent ] || usage
      case "$8" in ''|*[!0-9]*) usage ;; esac
      case "${10}" in ''|*[!0-9]*) usage ;; esac
    fi
    ;;
  status) [ $# -eq 2 ] || [ $# -eq 3 ] || usage ;;
  lint) [ $# -eq 2 ] || usage ;;
  verify) [ $# -eq 3 ] || usage ;;
  record) [ $# -eq 2 ] || usage ;;
  prompt)
    case "${3:-}" in
      report|design|decisions) [ $# -eq 3 ] || usage ;;
      work|again|respond|commit|detail) [ $# -eq 4 ] || usage ;;
      seat)
        [ $# -eq 5 ] || usage
        case "$5" in a|b) ;; *) usage ;; esac
        ;;
      *) usage ;;
    esac
    ;;
  decisions)
    [ $# -eq 3 ] || usage
    case "$3" in ''|0*|*[!0-9]*) usage ;; esac
    ;;
  *) usage ;;
esac

case "$2" in /*) ;; *) die "<WT> and <file> must be absolute paths: $2" ;; esac

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec python3 "$SCRIPT_DIR/flow.py" "$@"
