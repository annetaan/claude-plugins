#!/usr/bin/env bash
# Keeps exactly one difit review server per repository.
# State lives in $(git rev-parse --git-dir)/annetaan-workflow.json, which sits under .git and stays untracked.
set -euo pipefail

die() { echo "difit-session: $*" >&2; exit 1; }

git rev-parse --git-dir >/dev/null 2>&1 || die "run this inside a git repository"
STATE="$(git rev-parse --absolute-git-dir)/annetaan-workflow.json"

# Decide once how to launch difit. Use a plain difit when that works, and fall back to
# mise only where it does not (calling difit through a mise shim fails on some setups).
# command -v can succeed and the binary still fail, so try running it.
DIFIT_RUNNER=""
resolve_difit() {
  [ -n "$DIFIT_RUNNER" ] && return 0
  if command -v difit >/dev/null 2>&1 && difit --version >/dev/null 2>&1; then
    DIFIT_RUNNER="difit"
  elif command -v mise >/dev/null 2>&1 && mise x node@24 -- difit --version >/dev/null 2>&1; then
    DIFIT_RUNNER="mise x node@24 -- difit"
  else
    DIFIT_RUNNER="npx --yes difit"
  fi
}

difit_cmd() {
  resolve_difit
  # shellcheck disable=SC2086  # DIFIT_RUNNER is a command word list and has to split
  $DIFIT_RUNNER "$@"
}

state_field() {
  [ -f "$STATE" ] || die "no session is running. run start first."
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$STATE" "$1"
}

do_start() {
  [ $# -ge 2 ] || die "usage: start <target-ref> <base-ref> [port]"
  target="$1"; base="$2"; port="${3:-}"
  if [ -f "$STATE" ]; then
    pid="$(state_field pid)"
    if kill -0 "$pid" 2>/dev/null; then
      die "a server is already running (pid $pid, $(state_field url)). use refresh or stop."
    fi
  fi
  set -- "$target" "$base" --merge-base --background --no-open
  # Working tree mode (target ".") pulls untracked files into the diff too, so that a new
  # file never drops out of the review.
  [ "$target" = "." ] && set -- "$@" --include-untracked
  [ -n "$port" ] && set -- "$@" --port "$port"
  out="$(difit_cmd "$@" 2>&1 | tail -1)"
  case "$out" in *'"port"'*) ;; *) die "failed to start: $out" ;; esac
  printf '%s' "$out" | python3 -c '
import json, sys
info = json.load(sys.stdin)
info["target"], info["base"] = sys.argv[1], sys.argv[2]
open(sys.argv[3], "w").write(json.dumps(info, ensure_ascii=False))
print(json.dumps(info, ensure_ascii=False))
' "$target" "$base" "$STATE"
}

do_stop() {
  [ -f "$STATE" ] || { echo "not running"; return 0; }
  pid="$(state_field pid)"
  kill "$pid" 2>/dev/null || true
  sleep 1
  rm -f "$STATE"
  echo "stopped (pid $pid)"
}

# The diff is pinned at start-up, working tree mode included. Edits and commits that follow
# leave the review target stale until a refresh.
# A restart drops the comments on the server, so unresolved threads carry over by default.
# A carried thread gets a new id and its conversation is folded into one body. Who said what
# is folded in as an [author] label. Comments from the browser UI get author "User" from difit
# itself, which is how a human's writing stays recognisable.
do_refresh() {
  carry=1
  [ "${1:-}" = "--no-carry" ] && carry=0
  target="$(state_field target)"; base="$(state_field base)"; port="$(state_field port)"
  payload=""
  if [ "$carry" = 1 ]; then
    payload="$(difit_cmd comment get --port "$port" --format json 2>/dev/null | python3 -c '
import json, sys
try:
    threads = json.load(sys.stdin).get("threads", [])
except Exception:
    threads = []
HDR = "(carried over from the previous round, still unresolved. line positions may have shifted)\n\n"
CARRIED = "carried"  # already-folded body. the marker that keeps labels from doubling
out = []
for t in threads:
    segments = []
    for m in t.get("messages", []):
        body = m.get("body", "")
        if body.startswith(HDR):
            body = body[len(HDR):]
        author = (m.get("author") or "").strip()
        segments.append(body if author == CARRIED else "[%s] %s" % (author or "?", body))
    out.append({
        "type": "thread",
        "filePath": t["filePath"],
        "position": t["position"],
        "author": CARRIED,
        "body": HDR + "\n\n---\n\n".join(segments),
    })
print(json.dumps(out, ensure_ascii=False))
' || echo "[]")"
  fi
  do_stop >/dev/null
  do_start "$target" "$base" "$port"
  if [ -n "$payload" ] && [ "$payload" != "[]" ]; then
    difit_cmd comment add --port "$port" "$payload" >/dev/null
    echo "carried over $(printf '%s' "$payload" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))') unresolved thread(s)" >&2
  fi
}

# Who is speaking follows from the caller's role, so it is injected with --as rather than
# written into the JSON. do_refresh folds this author into the body label when it carries a thread.
do_add() {
  as=""
  if [ "${1:-}" = "--as" ]; then
    shift; as="${1:-}"; shift || true
    [ -n "$as" ] || die "usage: add --as <review|work> '<json>'"
  fi
  [ $# -ge 1 ] || die "usage: add [--as <author>] '<json>'"
  payload="$1"
  if [ -n "$as" ]; then
    payload="$(printf '%s' "$payload" | python3 -c '
import json, sys
author = sys.argv[1]
data = json.load(sys.stdin)
items = data if isinstance(data, list) else [data]
for item in items:
    item["author"] = author
print(json.dumps(items, ensure_ascii=False))
' "$as")"
  fi
  difit_cmd comment add --port "$(state_field port)" "$payload"
}

do_open() {
  url="$(state_field url)"
  if command -v open >/dev/null 2>&1; then open "$url"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"
  else echo "$url"; fi
}

cmd="${1:-}"; shift || true
case "$cmd" in
  start)    do_start "$@" ;;
  stop)     do_stop ;;
  refresh)  do_refresh "$@" ;;
  open)     do_open ;;
  port)     state_field port ;;
  url)      state_field url ;;
  status)   [ -f "$STATE" ] && cat "$STATE" && echo || echo "not running" ;;
  comments) difit_cmd comment get --port "$(state_field port)" --format "${1:-json}" ;;
  add)      do_add "$@" ;;
  resolve)  [ $# -ge 1 ] || die "usage: resolve <threadId...>"; difit_cmd comment resolve "$@" --port "$(state_field port)" ;;
  *) cat >&2 <<'USAGE'
usage: difit-session.sh <command>
  start <target-ref> <base-ref> [port]  start the review server in the background
                                        target "." compares the working tree (everything uncommitted) against base
  refresh                               restart on the same port and pin the diff to the current state
  comments [json|text]                  read the comments (json by default)
  add --as <review|work> '<json>'       post a comment or a reply (--as records who spoke)
  resolve <threadId...>                 resolve threads
  open | url | port | status | stop
USAGE
     exit 1 ;;
esac
