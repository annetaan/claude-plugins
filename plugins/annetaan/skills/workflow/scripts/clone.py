import contextlib, fcntl, os, subprocess

@contextlib.contextmanager
def clone_lock(where):
    common = subprocess.run(["git", "-C", where, "rev-parse", "--path-format=absolute", "--git-common-dir"],
                            capture_output=True, text=True, check=True).stdout.strip()
    with open(os.path.join(common, "annetaan-clone.lock"), "a") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        yield

def fetch(where, *refspecs):
    with clone_lock(where):
        return subprocess.run(["git", "-C", where, "fetch", "--quiet", "origin", *refspecs],
                              capture_output=True, text=True, encoding="utf-8", errors="replace")

def fetch_branch(where, branch):
    return fetch(where, "+refs/heads/%s:refs/remotes/origin/%s" % (branch, branch))
