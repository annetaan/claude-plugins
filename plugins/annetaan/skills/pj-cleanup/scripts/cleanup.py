import json, os, re, subprocess, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "workflow", "scripts"))
from clone import fetch_branch

PROJECT_SH, WORKTREE_SH, FLOW_SH, SUB = sys.argv[1:5]
P = int(sys.argv[5]) if len(sys.argv) > 5 else None
ARGS = sys.argv[6:]

def run(*cmd, cwd=None):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)

def emit(**obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)

def stop(reason, message, **extra):
    emit(status="stop", reason=reason, message=message, **extra)

def die(msg):
    print("cleanup: " + msg, file=sys.stderr)
    sys.exit(1)

def git(where, *args):
    r = run("git", "-C", where, *args)
    if r.returncode != 0:
        die("git %s failed: %s" % (" ".join(args), r.stderr.strip()))
    return r.stdout

def worktrees():
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

def on_origin(main, branch):
    r = run("git", "-C", main, "ls-remote", "--exit-code", "--heads", "origin", "refs/heads/" + branch)
    if r.returncode == 0:
        return True
    return False if r.returncode == 2 else None

def reports(wt):
    root = os.path.join(wt, "work-reports")
    if not os.path.isdir(root):
        return []
    return sorted(e for e in os.listdir(root) if os.path.isdir(os.path.join(root, e)))

def read_old_reports(main, *flags):
    r = run(WORKTREE_SH, "old-reports", *flags, cwd=main)
    message = r.stderr.strip() or r.stdout.strip()
    if r.returncode != 0:
        return None, message
    try:
        return json.loads(r.stdout), message
    except ValueError:
        return None, message

def read_submodules(main, wt):
    r = run(WORKTREE_SH, "submodules", wt, cwd=main)
    message = r.stderr.strip() or r.stdout.strip()
    if r.returncode != 0:
        return None, message
    try:
        return json.loads(r.stdout), message
    except ValueError:
        return None, message

def incoming(tree):
    return ("--from", tree["path"]) if tree["state"] in ("clean", "dirty") else ()

def plan(p):
    main, trees = located()
    parent = read_project(p)
    if not parent["merged"]:
        stop("not-merged", "#%d is not merged: its pull request into %s has not merged yet" % (p, parent["from"]),
             projectPr=parent.get("projectPr"))
    base, frm, wt = parent["base"], parent["from"], wt_of(main, p)

    loses = []
    prunable = listed(trees, wt)
    if prunable is None:
        tree = {"path": wt, "state": "foreign" if os.path.lexists(wt) else "absent"}
    elif prunable:
        tree = {"path": wt, "state": "prunable"}
    else:
        changes = git(wt, "status", "--porcelain").splitlines()
        tree = {"path": wt, "state": "dirty" if changes else "clean", "changes": changes[:20],
                "reports": reports(wt)}
        found, message = read_submodules(main, wt)
        if found is None or found.get("status") != "ok":
            die("worktree.sh submodules failed: " + message)
        tree["submodules"], tree["hasSubmodules"] = found["submodules"], found["present"]
        if tree["state"] == "dirty":
            loses.append("uncommitted")
        if tree["submodules"]:
            loses.append("submodules")

    if fetch_branch(main, frm).returncode != 0:
        stop("fetch-failed", "cannot fetch %s from origin" % frm)
    remote = on_origin(main, base)
    if remote is None:
        stop("fetch-failed", "cannot read the branches on origin")

    local = None
    if has_ref(main, "refs/heads/" + base):
        holder = checked_out_in(trees, base)
        held = ["origin/" + frm]
        if remote and fetch_branch(main, base).returncode == 0:
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

    result, message = read_old_reports(main, *incoming(tree))
    if result is None or result.get("status") != "ok":
        die("worktree.sh old-reports failed: " + message)

    return main, {"project": {k: parent[k] for k in ("number", "title", "state", "base", "from")},
                  "main": main, "worktree": tree, "loses": loses, "localBase": local,
                  "remoteBase": "present" if remote else "absent", "update": update,
                  "oldReports": result["oldReports"]}

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

def cleanup():
    main, out = plan(P)
    tree, errors = out["worktree"], []
    base, frm = out["project"]["base"], out["project"]["from"]

    if tree["state"] == "foreign":
        stop("foreign", "%s exists and is not a worktree of this clone" % tree["path"], **out)
    if out["loses"] and "--discard" not in ARGS:
        stop("discard", "%s holds work that nothing else holds: %s" % (tree["path"], ", ".join(out["loses"])), **out)

    r = run(FLOW_SH, "close", tree["path"], cwd=main)
    try:
        tree["seats"] = json.loads(r.stdout)["removed"] if r.returncode == 0 else []
    except (ValueError, KeyError):
        tree["seats"] = []
        r.returncode = 1
    if r.returncode != 0:
        errors.append({"step": "seats", "message": r.stderr.strip() or r.stdout.strip()})

    result, message = read_old_reports(main, *incoming(tree), "--delete")
    if result is None or result.get("status") != "done":
        die("worktree.sh old-reports failed: " + message)
    out["oldReports"] = result["oldReports"]
    errors.extend(result["errors"])

    if tree["state"] in ("clean", "dirty"):
        tree["moved"] = result["moved"]
        force = ["--force"] if tree["state"] == "dirty" or tree["hasSubmodules"] else []
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
