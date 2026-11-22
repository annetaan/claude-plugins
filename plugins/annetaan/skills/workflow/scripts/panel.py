import fcntl, json, os, shutil, subprocess, sys, tempfile

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

def seat_path(wt, seat):
    return os.path.join(os.path.dirname(wt), "review-%s-%s" % (os.path.basename(wt), seat))

def lock_path(wt, where, seat):
    common = git(where, "rev-parse", "--git-common-dir").strip()
    if not os.path.isabs(common):
        common = os.path.join(where, common)
    return os.path.join(common, "panel-%s-%s.lock" % (os.path.basename(wt), seat))

def nearest_clone_dir(wt):
    where = wt
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

def require_live_wt(wt):
    where = nearest_clone_dir(wt)
    if where is None or where != wt or worktrees_by_path(wt).get(os.path.realpath(wt)) is not False:
        stop("unknown", "%s is no worktree of a clone" % wt)

def snapshot(wt):
    head = git(wt, "rev-parse", "HEAD").strip()
    fd, index = tempfile.mkstemp(prefix="panel-index-", dir=git(wt, "rev-parse", "--absolute-git-dir").strip())
    os.close(fd)
    os.unlink(index)
    env = dict(os.environ, GIT_INDEX_FILE=index)
    try:
        git(wt, "read-tree", "HEAD", env=env)
        r = run("git", "-C", wt, "add", "-A", env=env)
        if r.returncode != 0:
            stop("snapshot", "cannot snapshot %s: %s" % (wt, r.stderr.strip()))
        tree = git(wt, "write-tree", env=env).strip()
    finally:
        if os.path.exists(index):
            os.unlink(index)
    ident = dict(os.environ, GIT_AUTHOR_NAME="panel", GIT_AUTHOR_EMAIL="panel@localhost",
                 GIT_COMMITTER_NAME="panel", GIT_COMMITTER_EMAIL="panel@localhost",
                 GIT_AUTHOR_DATE="2000-01-01T00:00:00Z", GIT_COMMITTER_DATE="2000-01-01T00:00:00Z")
    return git(wt, "commit-tree", tree, "-p", head, "-m", "review snapshot", env=ident).strip()

def take_lock(path, seat):
    fd = os.open(path, os.O_CREAT | os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        stop("busy", "seat %s is held by another run" % seat)
    return fd

def prepare(wt, seat, snap):
    path = seat_path(wt, seat)
    known = worktrees_by_path(wt).get(os.path.realpath(path))
    if known:
        git(wt, "worktree", "prune")
        known = None
    if known is False:
        git(path, "checkout", "--quiet", "--force", "--detach", snap)
        git(path, "clean", "-fd", "--quiet")
    elif os.path.lexists(path):
        die("%s exists and is no worktree of this clone" % path)
    else:
        git(wt, "worktree", "add", "--quiet", "--detach", path, snap)
    return path

def run_probe(wt, seat, probe):
    probe = os.path.realpath(probe)
    if seat not in SEATS:
        die("no such seat: " + seat)
    require_live_wt(wt)
    reports = os.path.realpath(os.path.join(wt, "work-reports")) + os.sep
    if not probe.startswith(reports):
        stop("outside", "%s is not under %s" % (probe, reports))
    script = os.path.join(probe, "run.sh")
    if not os.path.isfile(script):
        stop("no-script", "%s has no run.sh" % probe)
    lock = lock_path(wt, wt, seat)
    held = take_lock(lock, seat)
    try:
        snap = snapshot(wt)
        path = prepare(wt, seat, snap)
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

def close(wt):
    where = nearest_clone_dir(wt)
    removed = []
    if where is not None:
        for seat in SEATS:
            path = seat_path(wt, seat)
            known = worktrees_by_path(where).get(os.path.realpath(path))
            if known is None:
                continue
            if known:
                git(where, "worktree", "prune")
            else:
                git(where, "worktree", "remove", "--force", path)
            removed.append(path)
            lock = lock_path(wt, where, seat)
            if os.path.exists(lock):
                os.unlink(lock)
    emit(status="closed", removed=removed)

def main(sub, wt, *args):
    {"run": run_probe, "close": close}[sub](os.path.normpath(wt), *args)

if __name__ == "__main__":
    main(*sys.argv[1:])
