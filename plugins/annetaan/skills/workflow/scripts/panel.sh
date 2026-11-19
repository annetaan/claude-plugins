#!/usr/bin/env bash
set -euo pipefail

die() { echo "panel: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: panel.sh run <WT> <seat> <probe dir>   snapshot the working tree of <WT>, put seat a or b at it, copy <probe dir>/tree over it,
                                              run <probe dir>/run.sh there and print its exit and its last 40 lines
       panel.sh close <WT>                    remove the seats; safe when there is none, and when <WT> is already gone
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
<probe dir> has to be under <WT>/work-reports/. Exit 1 means a usage error or an unexpected failure.
USAGE
  exit 1
}

[ $# -ge 1 ] || usage
case "$1" in
  run) [ $# -eq 4 ] || usage ;;
  close) [ $# -eq 2 ] || usage ;;
  *) usage ;;
esac

case "$2" in /*) ;; *) die "<WT> must be an absolute path: $2" ;; esac

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

read -r -d '' PY <<'PY' || true
import fcntl, json, os, shutil, subprocess, sys, tempfile

SUB = sys.argv[1]
WT = os.path.normpath(sys.argv[2])
SEATS = ("a", "b")
TAIL = 40

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

def lock_path(where, seat):
    common = git(where, "rev-parse", "--git-common-dir").strip()
    if not os.path.isabs(common):
        common = os.path.join(where, common)
    return os.path.join(common, "panel-%s-%s.lock" % (os.path.basename(WT), seat))

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
                 GIT_COMMITTER_NAME="panel", GIT_COMMITTER_EMAIL="panel@localhost",
                 GIT_AUTHOR_DATE="2000-01-01T00:00:00Z", GIT_COMMITTER_DATE="2000-01-01T00:00:00Z")
    return git(WT, "commit-tree", tree, "-p", head, "-m", "review snapshot", env=ident).strip()

def take_lock(path, seat):
    fd = os.open(path, os.O_CREAT | os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        stop("busy", "seat %s is held by another run" % seat)
    return fd

def prepare(seat, snap):
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
    return path

def run_probe():
    seat, probe = sys.argv[3], os.path.realpath(sys.argv[4])
    if seat not in SEATS:
        die("no such seat: " + seat)
    require_live_wt()
    reports = os.path.realpath(os.path.join(WT, "work-reports")) + os.sep
    if not probe.startswith(reports):
        stop("outside", "%s is not under %s" % (probe, reports))
    script = os.path.join(probe, "run.sh")
    if not os.path.isfile(script):
        stop("no-script", "%s has no run.sh" % probe)
    lock = lock_path(WT, seat)
    held = take_lock(lock, seat)
    try:
        snap = snapshot()
        path = prepare(seat, snap)
        overlay = os.path.join(probe, "tree")
        if os.path.isdir(overlay):
            shutil.copytree(overlay, path, symlinks=True, dirs_exist_ok=True)
        r = subprocess.run(["bash", script], cwd=path, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, text=True, errors="replace")
        lines = r.stdout.splitlines()
        emit(status="ran", seat=seat, snapshot=snap, exit=r.returncode, lines=len(lines),
             output="\n".join(lines[-TAIL:]))
    finally:
        os.close(held)

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
            lock = lock_path(where, seat)
            if os.path.exists(lock):
                os.unlink(lock)
    emit(status="closed", removed=removed)

{"run": run_probe, "close": close}[SUB]()
PY

exec python3 -c "$PY" "$@"
