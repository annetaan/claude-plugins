#!/usr/bin/env bash
set -euo pipefail

die() { echo "project: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: project.sh [-R <owner/repo>] <parent>               the whole project, as JSON
       project.sh [-R <owner/repo>] <parent> --order       the run order, and the ## Order list to write, as JSON
       project.sh [-R <owner/repo>] <parent> --next        what to run next on the project, as JSON
       project.sh [-R <owner/repo>] <parent> --check <n> [<n>...]
                                                           whether each sub-issue can be implemented from its body now,
                                                           one JSON object per line
       project.sh [-R <owner/repo>] <parent> --order-body  the parent body with its ## Order list replaced, as text
       project.sh --lint <file|->                          lint one sub-issue body, read from a file or standard input
       project.sh --same-words <before> <after>            whether two bodies differ in backticks and whitespace only
       project.sh --roadmap [<ref>]                        check the roadmap file, in the work tree or at <ref>, as JSON
  -R <owner/repo>   read another repository (default: the repository of the current directory)
--order exits non-zero and names the cycle when the blocked-by relationships have one,
        or when the projects wait on each other.
--next reads only. It prints what to run next (doctor, running, user or done), why, and a fingerprint of the state.
--check runs inside a work tree of a clone of the repository, from any directory in it. It fetches the branch the base was made from,
        and the base branch once it exists. The parent comes before --check. It reads GitHub and fetches once whatever
        the count, and dies before printing anything when a number is no sub-issue.
--order-body prints the parent body as GitHub has it now, with the lines under ## Order replaced by the list --order
        writes. It fails like --order when the blocked-by relationships have a cycle.
--lint touches neither GitHub nor git and always exits 0.
--same-words touches neither GitHub nor git and always exits 0 on two readable files, printing {"ok", "lint"}: ok is
        true when the two bodies have the same words once backticks are gone and whitespace is one space, and lint is
        the lint of <after>.
--roadmap runs inside a work tree, reads no parent and touches no GitHub, and always exits 0 on a readable roadmap,
        printing {"ok", "files", "path", "entries", "reasons"}. It dies outside a work tree and on a ref git cannot read.
USAGE
  exit 1
}

REPO=""; MODE="project"; PARENT=""; TARGETS=""; LINT_FILE=""
SAME_BEFORE=""; SAME_AFTER=""
ROADMAP_REF=""
while [ $# -gt 0 ]; do
  case "$1" in
    -R|--repo) [ $# -ge 2 ] || usage; REPO="$2"; shift 2 ;;
    --order)   MODE="order"; shift ;;
    --order-body) MODE="order-body"; shift ;;
    --next)    MODE="next"; shift ;;
    --check)   MODE="check"; shift
               while [ $# -gt 0 ] && [ -n "$1" ] && [ -z "${1//[0-9]/}" ]; do TARGETS="$TARGETS $1"; shift; done
               [ -n "$TARGETS" ] || die "--check takes issue numbers" ;;
    --lint)    [ $# -ge 2 ] || usage; MODE="lint"; LINT_FILE="$2"; shift 2 ;;
    --same-words) [ $# -ge 3 ] || usage; MODE="same-words"; SAME_BEFORE="$2"; SAME_AFTER="$3"; shift 3 ;;
    --roadmap) MODE="roadmap"; shift
               if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then ROADMAP_REF="$1"; shift; fi ;;
    -h|--help) usage ;;
    -?*)       die "unknown option: $1" ;;
    *)         [ -z "$PARENT" ] || die "one parent issue at a time"; PARENT="$1"; shift ;;
  esac
done

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

PY_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/project.py"

if [ "$MODE" = "lint" ]; then
  [ -z "$PARENT" ] || die "--lint takes no parent"
  [ "$LINT_FILE" = "-" ] || [ -f "$LINT_FILE" ] || die "no such file: $LINT_FILE"
  exec python3 "$PY_FILE" lint "$LINT_FILE"
fi

if [ "$MODE" = "same-words" ]; then
  [ -z "$PARENT" ] || die "--same-words takes no parent"
  [ -f "$SAME_BEFORE" ] || die "no such file: $SAME_BEFORE"
  [ -f "$SAME_AFTER" ] || die "no such file: $SAME_AFTER"
  exec python3 "$PY_FILE" same-words "$SAME_BEFORE" "$SAME_AFTER"
fi

if [ "$MODE" = "roadmap" ]; then
  [ -z "$PARENT" ] || die "--roadmap takes no parent"
  exec python3 "$PY_FILE" roadmap "$ROADMAP_REF"
fi

[ -n "$PARENT" ] || usage
case "$PARENT" in *[!0-9]*) die "the parent must be an issue number: $PARENT" ;; esac

command -v gh >/dev/null 2>&1 || die "gh is not installed"

if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)" || die "cannot tell the repository. run this inside a clone or pass -R <owner/repo>"
fi
case "$REPO" in */*) ;; *) die "the repository must read <owner/repo>: $REPO" ;; esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

gh api graphql -F owner="${REPO%%/*}" -F name="${REPO#*/}" -F n="$PARENT" -f query='
query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $n) {
      number title state stateReason updatedAt body
      labels(first: 50) { nodes { name } }
      blockedBy(first: 50) { nodes { number title state stateReason body } }
      blocking(first: 50) { nodes { number body } }
      subIssues(first: 100) {
        totalCount
        nodes {
          number title state stateReason updatedAt body
          labels(first: 50) { nodes { name } }
          blockedBy(first: 50) { nodes { number state parent { number } } }
          blocking(first: 50) { nodes { number } }
        }
      }
    }
  }
}' > "$TMP/issues.json" || die "cannot read issue #$PARENT in $REPO"

if [ "$MODE" = "check" ]; then
  python3 "$PY_FILE" check "$TMP/issues.json" "$REPO" $TARGETS
  exit 0
fi

python3 "$PY_FILE" "$MODE" "$TMP/issues.json" "$REPO"
