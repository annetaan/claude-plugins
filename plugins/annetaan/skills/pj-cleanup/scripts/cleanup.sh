#!/usr/bin/env bash
# Cleans up the clone after a project's pull request has merged, and prints each result as one JSON object.
# The judgment and the questions stay in the skill. --discard carries the user's answer back.
# Writes on GitHub: run deletes the project's base branch on origin. Writes in git: run moves the work reports out of
# the run's worktree into <MAIN>/work-reports/, removes the worktree, deletes the local base branch when origin holds
# its tip, and fast-forwards the local <from> to origin/<from>. It never switches a branch, stashes, commits or resets.
# It reads the project with ../../pj1-plan/scripts/project.sh, and refuses a project that is not merged.
set -euo pipefail

die() { echo "cleanup: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: cleanup.sh list                  the projects that have a worktree in this clone
       cleanup.sh check <P>             what run would do for project <P>, which must be merged
       cleanup.sh run <P> [--discard]   move the work reports out, remove the worktree, delete the base branch,
                                        fast-forward <from>. --discard removes a worktree with uncommitted work
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
USAGE
  exit 1
}

number() { case "$2" in ''|*[!0-9]*) die "$1 must be a number: $2" ;; esac; }

[ $# -ge 1 ] || usage
case "$1" in
  list)  [ $# -eq 1 ] || usage ;;
  check) [ $# -eq 2 ] || usage
         number "the project" "$2" ;;
  run)   [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$3" = "--discard" ]; } || usage
         number "the project" "$2" ;;
  *)     usage ;;
esac

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

PROJECT_SH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../pj1-plan/scripts/project.sh"

read -r -d '' PY <<'PY' || true
import json, os, re, shutil, subprocess, sys

PROJECT_SH, SUB = sys.argv[1], sys.argv[2]
P = int(sys.argv[3]) if len(sys.argv) > 3 else None
ARGS = sys.argv[4:]

def run(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True)

def emit(**obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)

def stop(reason, message, **extra):
    emit(status="stop", reason=reason, message=message, **extra)

def die(msg):
    print("cleanup: " + msg, file=sys.stderr)
    sys.exit(1)

def git(where, *args):
    """Run git in where, and die when it fails."""
    r = run("git", "-C", where, *args)
    if r.returncode != 0:
        die("git %s failed: %s" % (" ".join(args), r.stderr.strip()))
    return r.stdout

def worktrees():
    """The worktrees of the clone as [(path, prunable, branch)]. branch is None on a detached HEAD.
    The first one is the main working tree. None outside a clone."""
    r = run("git", "worktree", "list", "--porcelain")
    if r.returncode != 0:
        return None
    out = []
    for block in r.stdout.split("\n\n"):
        lines = block.splitlines()
        if lines and lines[0].startswith("worktree "):
            heads = [l[len("branch refs/heads/"):] for l in lines[1:] if l.startswith("branch refs/heads/")]
            out.append((lines[0][len("worktree "):], any(l.startswith("prunable") for l in lines[1:]),
                        heads[0] if heads else None))
    return out

def located():
    trees = worktrees()
    if not trees:
        stop("not-a-repo", "not inside a git repository")
    return trees[0][0], trees

def wt_of(main, p):
    return os.path.join(main, ".claude/worktrees/pj-%d" % p)

def listed(trees, path):
    """None when path is no worktree of the clone, otherwise whether it is prunable."""
    real = os.path.realpath(path)
    for where, prunable, _ in trees:
        if os.path.realpath(where) == real:
            return prunable
    return None

def checked_out_in(trees, branch):
    for where, _, head in trees:
        if head == branch:
            return where
    return None

def has_ref(main, ref):
    return run("git", "-C", main, "rev-parse", "--verify", "--quiet", ref).returncode == 0

def sha(main, ref):
    return git(main, "rev-parse", ref).strip()

def contains(main, ancestor, ref):
    return run("git", "-C", main, "merge-base", "--is-ancestor", ancestor, ref).returncode == 0

def read_project(p):
    r = run(PROJECT_SH, str(p))
    if r.returncode != 0:
        stop("project", r.stderr.strip())
    return json.loads(r.stdout)["parent"]

def fetch(main, branch):
    """Move origin/<branch> in main and nothing else. The explicit refspec works in a single-branch clone too."""
    return run("git", "-C", main, "fetch", "--quiet", "origin",
               "+refs/heads/%s:refs/remotes/origin/%s" % (branch, branch)).returncode == 0

def on_origin(main, branch):
    """Whether origin has branch, or None when origin cannot be read."""
    r = run("git", "-C", main, "ls-remote", "--exit-code", "--heads", "origin", "refs/heads/" + branch)
    if r.returncode == 0:
        return True
    return False if r.returncode == 2 else None

def reports(wt):
    """The work report directories in the worktree."""
    root = os.path.join(wt, "work-reports")
    if not os.path.isdir(root):
        return []
    return sorted(e for e in os.listdir(root) if os.path.isdir(os.path.join(root, e)))

def plan(p):
    """Everything check prints and run acts on."""
    main, trees = located()
    parent = read_project(p)
    if not parent["merged"]:
        stop("not-merged", "#%d is not merged: its pull request into %s has not merged yet" % (p, parent["from"]),
             projectPr=parent.get("projectPr"))
    base, frm, wt = parent["base"], parent["from"], wt_of(main, p)

    prunable = listed(trees, wt)
    if prunable is None:
        tree = {"path": wt, "state": "foreign" if os.path.lexists(wt) else "absent"}
    elif prunable:
        tree = {"path": wt, "state": "prunable"}
    else:
        changes = git(wt, "status", "--porcelain").splitlines()
        tree = {"path": wt, "state": "dirty" if changes else "clean", "changes": changes[:20],
                "reports": reports(wt)}

    if not fetch(main, frm):
        stop("fetch-failed", "cannot fetch %s from origin" % frm)
    remote = on_origin(main, base)
    if remote is None:
        stop("fetch-failed", "cannot read the branches on origin")

    # The local base branch goes when nothing on it would be lost: origin/<base> or origin/<from> holds its tip.
    local = None
    if has_ref(main, "refs/heads/" + base):
        holder = checked_out_in(trees, base)
        held = ["origin/" + frm]
        if remote and fetch(main, base):
            held.append("origin/" + base)
        if holder and os.path.realpath(holder) != os.path.realpath(wt):
            local = {"action": "keep", "why": "checked-out", "worktree": holder}
        elif any(contains(main, base, h) for h in held):
            local = {"action": "delete"}
        else:
            local = {"action": "keep", "why": "unpushed"}

    target = sha(main, "origin/" + frm)
    holder = checked_out_in(trees, frm)
    if holder and os.path.realpath(holder) == os.path.realpath(wt):
        holder = None
    if not has_ref(main, "refs/heads/" + frm):
        update = {"action": "absent"}
    else:
        current = sha(main, "refs/heads/" + frm)
        if current == target:
            update = {"action": "current", "sha": current}
        elif contains(main, current, target):
            update = {"action": "fast-forward", "from": current, "to": target, "worktree": holder}
        else:
            update = {"action": "diverged", "sha": current, "to": target, "worktree": holder}

    return main, {"project": {k: parent[k] for k in ("number", "title", "state", "base", "from")},
                  "main": main, "worktree": tree, "localBase": local,
                  "remoteBase": "present" if remote else "absent", "update": update}

def list_projects():
    main, trees = located()
    found = []
    for where, _, _ in trees[1:]:
        m = re.fullmatch(re.escape(os.path.join(main, ".claude/worktrees/pj-")) + r"(\d+)", where)
        if m:
            found.append(int(m.group(1)))
    projects = []
    for p in sorted(found):
        r = run(PROJECT_SH, str(p))
        if r.returncode != 0:
            projects.append({"number": p, "error": r.stderr.strip()})
            continue
        parent = json.loads(r.stdout)["parent"]
        projects.append({k: parent[k] for k in ("number", "title", "state", "merged")})
    emit(status="ok", main=main, projects=projects)

def check():
    _, out = plan(P)
    emit(status="ok", **out)

def move_reports(main, wt):
    """Move each work report out of wt into <main>/work-reports/. A name taken there gets -pj<P> on the end."""
    moved = []
    dest_root = os.path.join(main, "work-reports")
    for name in reports(wt):
        os.makedirs(dest_root, exist_ok=True)
        dest = os.path.join(dest_root, name)
        if os.path.lexists(dest):
            dest = os.path.join(dest_root, "%s-pj%d" % (name, P))
        if os.path.lexists(dest):
            die("cannot move %s: %s exists" % (name, dest))
        shutil.move(os.path.join(wt, "work-reports", name), dest)
        moved.append(dest)
    return moved

def cleanup():
    main, out = plan(P)
    tree, errors = out["worktree"], []
    base, frm = out["project"]["base"], out["project"]["from"]

    if tree["state"] == "foreign":
        stop("foreign", "%s exists and is not a worktree of this clone" % tree["path"], **out)
    if tree["state"] == "dirty" and "--discard" not in ARGS:
        stop("dirty", "%s has uncommitted changes" % tree["path"], **out)

    if tree["state"] in ("clean", "dirty"):
        tree["moved"] = move_reports(main, tree["path"])
        # The work reports are ignored files, which git worktree remove deletes without --force. Uncommitted and
        # untracked files need it, and --discard is the user's word for that.
        force = ["--force"] if tree["state"] == "dirty" else []
        git(main, "worktree", "remove", *force, tree["path"])
        tree["action"] = "removed"
    elif tree["state"] == "prunable":
        git(main, "worktree", "prune")
        tree["action"] = "pruned"
    else:
        tree["action"] = "none"

    local = out["localBase"]
    if local and local["action"] == "delete":
        r = run("git", "-C", main, "branch", "-D", base)
        local["action"] = "deleted" if r.returncode == 0 else "keep"
        if r.returncode != 0:
            errors.append({"step": "local-base", "message": r.stderr.strip()})

    if out["remoteBase"] == "present":
        r = run("git", "-C", main, "push", "--quiet", "origin", "--delete", base)
        if r.returncode == 0:
            out["remoteBase"] = "deleted"
        else:
            errors.append({"step": "remote-base", "message": r.stderr.strip()})
    run("git", "-C", main, "update-ref", "-d", "refs/remotes/origin/" + base)

    update = out["update"]
    if update["action"] == "fast-forward":
        if update["worktree"]:
            # merge --ff-only refuses, and changes nothing, when it would overwrite a local change.
            r = run("git", "-C", update["worktree"], "merge", "--ff-only", "--quiet", "origin/" + frm)
        else:
            r = run("git", "-C", main, "update-ref", "refs/heads/" + frm, update["to"], update["from"])
        if r.returncode == 0:
            update["action"] = "updated"
        else:
            update["action"] = "not-updated"
            errors.append({"step": "update", "message": (r.stderr or r.stdout).strip()})

    emit(status="done", errors=errors, **out)

{"list": list_projects, "check": check, "run": cleanup}[SUB]()
PY

exec python3 -c "$PY" "$PROJECT_SH" "$@"
