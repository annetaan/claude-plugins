#!/usr/bin/env bash
# Owns the seats of the review panel, one git worktree per seat beside the run's worktree, and prints each result as
# one JSON object. The seats are a and b. Seat <s> of the worktree <WT> lives at <dirname of WT>/review-<basename of WT>-<s>,
# detached. Every subcommand takes <WT>, the absolute path of the run's worktree, and never reads the cwd.
# Writes in git: open and sync build a snapshot commit, one parent (HEAD of <WT>), whose tree is the working tree of
# <WT>: tracked changes plus untracked files that are not ignored. It is built through a temporary index inside the git
# dir of <WT>, so the index, the working tree and MERGE_HEAD of <WT> are untouched, and no ref points at the commit.
# open adds the missing seats at the snapshot, and re-points an existing seat and removes its untracked files, which
# keeps its ignored files. sync re-points each seat and removes nothing. close removes the seats.
# Run: panel.sh open|sync|close <WT>
set -euo pipefail

die() { echo "panel: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: panel.sh open <WT>     snapshot the working tree of <WT>, add the missing seats at it, re-point the others and clean them
       panel.sh sync <WT>     re-point each seat at a new snapshot and keep what the seat holds; stops with no-seat when a seat is missing
       panel.sh close <WT>    remove the seats; safe when there is none, and when <WT> is already gone
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
USAGE
  exit 1
}

[ $# -eq 2 ] || usage
case "$1" in
  open|sync|close) ;;
  *) usage ;;
esac

case "$2" in /*) ;; *) die "<WT> must be an absolute path: $2" ;; esac

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

read -r -d '' PY <<'PY' || true
import json, os, subprocess, sys, tempfile

SUB = sys.argv[1]
WT = os.path.normpath(sys.argv[2])
SEATS = ("a", "b")

def run(*cmd, cwd=None, env=None):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, env=env)

def emit(**obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)

def stop(reason, message, **extra):
    emit(status="stop", reason=reason, message=message, **extra)

def die(msg):
    print("panel: " + msg, file=sys.stderr)
    sys.exit(1)

def git(where, *args, env=None):
    r = run("git", "-C", where, *args, env=env)
    if r.returncode != 0:
        die("git %s failed: %s" % (" ".join(args), r.stderr.strip()))
    return r.stdout

def seat_path(seat):
    return os.path.join(os.path.dirname(WT), "review-%s-%s" % (os.path.basename(WT), seat))

def nearest_clone_dir():
    where = WT
    while not os.path.isdir(where):
        parent = os.path.dirname(where)
        if parent == where:
            return None
        where = parent
    return where if run("git", "-C", where, "rev-parse", "--git-dir").returncode == 0 else None

def worktrees_by_path(where):
    out = {}
    for block in git(where, "worktree", "list", "--porcelain").split("\n\n"):
        lines = block.splitlines()
        if lines and lines[0].startswith("worktree "):
            out[os.path.realpath(lines[0][len("worktree "):])] = any(l.startswith("prunable") for l in lines[1:])
    return out

def require_live_wt():
    where = nearest_clone_dir()
    if where is None or where != WT or worktrees_by_path(WT).get(os.path.realpath(WT)) is not False:
        stop("unknown", "%s is no worktree of a clone" % WT)

def snapshot():
    head = git(WT, "rev-parse", "HEAD").strip()
    r = run("git", "-C", WT, "rev-parse", "--verify", "--quiet", "MERGE_HEAD")
    merge = r.stdout.strip() if r.returncode == 0 else None
    fd, index = tempfile.mkstemp(prefix="panel-index-", dir=git(WT, "rev-parse", "--absolute-git-dir").strip())
    os.close(fd)
    os.unlink(index)
    env = dict(os.environ, GIT_INDEX_FILE=index)
    try:
        git(WT, "read-tree", "HEAD", env=env)
        r = run("git", "-C", WT, "add", "-A", env=env)
        if r.returncode != 0:
            stop("snapshot", "cannot snapshot %s: %s" % (WT, r.stderr.strip()))
        tree = git(WT, "write-tree", env=env).strip()
    finally:
        if os.path.exists(index):
            os.unlink(index)
    ident = dict(os.environ, GIT_AUTHOR_NAME="panel", GIT_AUTHOR_EMAIL="panel@localhost",
                 GIT_COMMITTER_NAME="panel", GIT_COMMITTER_EMAIL="panel@localhost")
    snap = git(WT, "commit-tree", tree, "-p", head, "-m", "review snapshot", env=ident).strip()
    return head, merge, snap

def seats_object(status, head, merge, snap):
    return dict(status=status, head=head, mergeHead=merge, snapshot=snap,
                seats=[{"seat": s, "worktree": seat_path(s)} for s in SEATS])

def open_():
    require_live_wt()
    head, merge, snap = snapshot()
    for seat in SEATS:
        path = seat_path(seat)
        known = worktrees_by_path(WT).get(os.path.realpath(path))
        if known:
            git(WT, "worktree", "prune")
            known = None
        if known is False:
            git(path, "checkout", "--quiet", "--force", "--detach", snap)
            git(path, "clean", "-fd", "--quiet")
        elif os.path.lexists(path):
            die("%s exists and is no worktree of this clone" % path)
        else:
            git(WT, "worktree", "add", "--quiet", "--detach", path, snap)
    emit(**seats_object("open", head, merge, snap))

def sync():
    require_live_wt()
    known = worktrees_by_path(WT)
    missing = [s for s in SEATS if known.get(os.path.realpath(seat_path(s))) is not False]
    if missing:
        stop("no-seat", "no seat worktree for: " + ", ".join(missing))
    head, merge, snap = snapshot()
    for seat in SEATS:
        git(seat_path(seat), "checkout", "--quiet", "--force", "--detach", snap)
    emit(**seats_object("synced", head, merge, snap))

def close():
    where = nearest_clone_dir()
    removed = []
    if where is not None:
        for seat in SEATS:
            path = seat_path(seat)
            known = worktrees_by_path(where).get(os.path.realpath(path))
            if known is None:
                continue
            if known:
                git(where, "worktree", "prune")
            else:
                git(where, "worktree", "remove", "--force", path)
            removed.append(path)
    emit(status="closed", removed=removed)

{"open": open_, "sync": sync, "close": close}[SUB]()
PY

exec python3 -c "$PY" "$@"
