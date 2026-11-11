#!/usr/bin/env bash
# Owns the whole life of a workflow run's worktree, .claude/worktrees/wf-<stamp> under the main working tree, and
# prints each result as one JSON object. The judgment and the questions stay in the skills. --add and --discard carry
# the user's answers back.
# Writes on GitHub: cleanup deletes the run's branch on origin. Writes in git: create fetches the base branch into
# origin/<base>, check and cleanup fetch the base of a merged pull request and, when the clone lacks it, the pull
# request's head (refs/pull/<n>/head, object only, no ref), create adds the detached worktree, ignore --add appends to the clone's info/exclude, and cleanup
# moves the work reports into <MAIN>/work-reports/, removes the worktree, deletes the run's branch locally and on
# origin, and fast-forwards the local base branch when the pull request merged. It never switches a branch, stashes,
# commits or resets in the main working tree. cleanup and old-reports --delete delete the work reports in
# <MAIN>/work-reports/ that arrived there 14 days ago or more. sync fetches origin/<base> and, on a conflict, starts a merge in the
# worktree and leaves it in progress. Nothing is recorded in git config or in files.
set -euo pipefail

die() { echo "worktree: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: worktree.sh start                          check the clone, gh and the repository
       worktree.sh create <base>                  fetch origin/<base> and add a detached worktree wf-<stamp> on its tip
       worktree.sh ignore <name> [--add]          whether .claude/worktrees/ and work-reports/ are ignored; --add writes them to info/exclude
       worktree.sh sync <name> <base>             whether HEAD of the worktree <name> conflicts with origin/<base>; on a conflict, start the merge
       worktree.sh pr [<number>]                  the open pull request <number>, or the open pull requests of the user that conflict
       worktree.sh list                           the wf-* worktrees of this clone with the state of their pull request
       worktree.sh check <name>                   what cleanup would do for the worktree <name>
       worktree.sh old-reports [--delete]         the work reports in <MAIN>/work-reports/ that arrived 14 days ago or more; --delete removes them.
                                                  Used by pj-cleanup
       worktree.sh cleanup <name> [--discard]     move the work reports out, remove the worktree, delete the branch, fast-forward the base.
                                                  --discard removes work that nothing else holds. It also deletes the old reports
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
USAGE
  exit 1
}

[ $# -ge 1 ] || usage
case "$1" in
  start|list) [ $# -eq 1 ] || usage ;;
  create)     [ $# -eq 2 ] || usage ;;
  check)      [ $# -eq 2 ] || usage ;;
  ignore)     [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$3" = "--add" ]; } || usage ;;
  sync)       [ $# -eq 3 ] || usage ;;
  pr)         [ $# -le 2 ] || usage ;;
  old-reports) [ $# -eq 1 ] || { [ $# -eq 2 ] && [ "$2" = "--delete" ]; } || usage ;;
  cleanup)    [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$3" = "--discard" ]; } || usage ;;
  *)          usage ;;
esac

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

read -r -d '' PY <<'PY' || true
import json, os, re, shutil, subprocess, sys, time

SUB = sys.argv[1]
ARGS = sys.argv[2:]

def run(*cmd, cwd=None):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)

def emit(**obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)

def stop(reason, message, **extra):
    emit(status="stop", reason=reason, message=message, **extra)

def die(msg):
    print("worktree: " + msg, file=sys.stderr)
    sys.exit(1)

def git(where, *args):
    """Run git in where, and die when it fails."""
    r = run("git", "-C", where, *args)
    if r.returncode != 0:
        die("git %s failed: %s" % (" ".join(args), r.stderr.strip()))
    return r.stdout

def fetch(main, base):
    """Move origin/<base> in main and nothing else. The explicit refspec works in a single-branch clone too."""
    return run("git", "-C", main, "fetch", "--quiet", "origin",
               "+refs/heads/%s:refs/remotes/origin/%s" % (base, base)).returncode == 0

def worktrees(main):
    """The worktrees of the clone as [(path, prunable, branch)]. branch is None on a detached HEAD.
    The first one is the main working tree."""
    out = []
    for block in git(main, "worktree", "list", "--porcelain").split("\n\n"):
        lines = block.splitlines()
        if lines and lines[0].startswith("worktree "):
            heads = [l[len("branch refs/heads/"):] for l in lines[1:] if l.startswith("branch refs/heads/")]
            out.append((lines[0][len("worktree "):], any(l.startswith("prunable") for l in lines[1:]),
                        heads[0] if heads else None))
    return out

def locate():
    """The main working tree, the path on the first worktree line. None outside a clone."""
    r = run("git", "worktree", "list", "--porcelain")
    if r.returncode != 0:
        return None
    for line in r.stdout.splitlines():
        if line.startswith("worktree "):
            return line[len("worktree "):]
    return None

def located():
    main = locate()
    if main is None:
        stop("not-a-repo", "not inside a git repository")
    return main

def listed(main, wt):
    """None when wt is no worktree of the clone, otherwise whether it is prunable."""
    real = os.path.realpath(wt)
    for path, prunable, _ in worktrees(main):
        if os.path.realpath(path) == real:
            return prunable
    return None

def checked_out_in(main, branch):
    """The path of the worktree that has branch checked out, or None."""
    for path, _, head in worktrees(main):
        if head == branch:
            return path
    return None

def has_branch(where, branch):
    return run("git", "-C", where, "rev-parse", "--verify", "--quiet", "refs/heads/" + branch).returncode == 0

def has_ref(main, ref):
    return run("git", "-C", main, "rev-parse", "--verify", "--quiet", ref).returncode == 0

def sha(main, ref):
    return git(main, "rev-parse", ref).strip()

def contains(main, ancestor, ref):
    """Whether ref contains ancestor."""
    return run("git", "-C", main, "merge-base", "--is-ancestor", ancestor, ref).returncode == 0

def head_contains(main, tip, pr):
    """Whether the pull request's head contains tip. The head can have moved on GitHub after the run pushed, so
    the clone may lack it: fetch the object GitHub keeps for every pull request, and stop when that fails."""
    head = pr["headSha"]
    if run("git", "-C", main, "cat-file", "-e", head + "^{commit}").returncode != 0:
        r = run("git", "-C", main, "fetch", "--quiet", "origin", "refs/pull/%d/head" % pr["number"])
        if r.returncode != 0:
            stop("fetch-failed", "cannot fetch the head of pull request #%d from origin" % pr["number"])
    return contains(main, tip, head)

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

REPORT_DAYS = 14

def old_reports(main):
    """The names of the work reports in <main>/work-reports/ that arrived REPORT_DAYS days ago or more, sorted.
    A report is a real directory whose name starts with a timestamp. Its own mtime is the clock."""
    root = os.path.join(main, "work-reports")
    if not os.path.isdir(root):
        return []
    limit = time.time() - REPORT_DAYS * 86400
    found = []
    for e in os.listdir(root):
        path = os.path.join(root, e)
        if not re.match(r"\d{4}-\d{2}-\d{2}-\d{4}(-|$)", e):
            continue
        if os.path.islink(path) or not os.path.isdir(path):
            continue
        if os.lstat(path).st_mtime <= limit:
            found.append(e)
    return sorted(found)

def delete_reports(main, names, errors):
    """Remove each named report from <main>/work-reports/. A failure goes into errors and the rest go on."""
    deleted = []
    for n in names:
        try:
            shutil.rmtree(os.path.join(main, "work-reports", n))
            deleted.append(n)
        except OSError as e:
            errors.append({"step": "old-reports", "message": "cannot delete %s: %s" % (n, e)})
    return deleted

def version(text):
    m = re.search(r"gh version (\d+)\.(\d+)\.(\d+)", text)
    return tuple(int(x) for x in m.groups()) if m else None

def repo_view(main):
    r = run("gh", "repo", "view", "--json", "nameWithOwner,defaultBranchRef", cwd=main)
    if r.returncode != 0:
        return None, r.stderr.strip()
    return json.loads(r.stdout), None

def wt_root(main):
    return os.path.join(main, ".claude/worktrees")

def wf_names(main):
    """The names of the wf-* worktrees of the clone, prunable ones included, sorted."""
    root = os.path.realpath(wt_root(main))
    found = []
    for path, _, _ in worktrees(main)[1:]:
        real = os.path.realpath(path)
        if os.path.dirname(real) == root and os.path.basename(real).startswith("wf-"):
            found.append(os.path.basename(real))
    return sorted(found)

def resolve(main, name):
    """The path of the wf worktree called name, or a stop when the clone has none."""
    if not re.fullmatch(r"wf-[A-Za-z0-9._-]+", name) or name not in wf_names(main):
        stop("unknown", "%s is no wf-* worktree of this clone" % name)
    return os.path.join(wt_root(main), name)

def pull_request(main, branch):
    """The pull request of branch as (pr, error): open wins, else the highest number. (None, None) when it has none."""
    r = run("gh", "pr", "list", "--head", branch, "--state", "all", "--json",
            "number,state,url,title,baseRefName,headRefOid", cwd=main)
    if r.returncode != 0:
        return None, (r.stderr.strip() or r.stdout.strip() or "gh pr list exited %d" % r.returncode)
    try:
        found = json.loads(r.stdout)
    except ValueError:
        return None, "unreadable output from gh pr list"
    if not found:
        return None, None
    found.sort(key=lambda p: (p["state"] == "OPEN", p["number"]), reverse=True)
    p = found[0]
    return {"number": p["number"], "state": p["state"].lower(), "url": p["url"], "title": p["title"],
            "base": p["baseRefName"], "headSha": p["headRefOid"]}, None

def start():
    main = locate()
    if main is None:
        stop("not-a-repo", "not inside a git repository")
    out = {"main": main}
    if run("git", "-C", main, "remote", "get-url", "origin").returncode != 0:
        stop("no-origin", "the clone has no remote named origin", **out)
    if shutil.which("gh") is None:
        stop("gh", "gh is not installed", **out)
    v = version(run("gh", "--version").stdout)
    out["gh"] = ".".join(map(str, v)) if v else None
    out["attach"] = v is not None and v >= (2, 99, 0)
    auth = run("gh", "auth", "status")
    if auth.returncode != 0:
        stop("gh-auth", "gh is not logged in: " + (auth.stderr.strip().splitlines() or [""])[-1], **out)
    view, err = repo_view(main)
    if view is None:
        stop("repo", "cannot read the repository on GitHub: " + err, **out)
    heads = worktrees(main)[0][2]
    emit(status="ok", main=main, mainBranch=heads, defaultBranch=(view.get("defaultBranchRef") or {}).get("name"),
         gh=out["gh"], attach=out["attach"])

def create():
    main = located()
    base = ARGS[0]
    if run("git", "check-ref-format", "--branch", base).returncode != 0:
        die("not a valid branch name: " + base)
    if not fetch(main, base):
        r = run("git", "-C", main, "ls-remote", "--exit-code", "--heads", "origin", "refs/heads/" + base)
        if r.returncode == 2:
            stop("base-missing", "origin has no branch %s" % base, base=base)
        stop("fetch-failed", "cannot fetch %s from origin" % base, base=base)
    stamp = "wf-" + time.strftime("%Y-%m-%d-%H%M")
    name, n = stamp, 1
    while os.path.lexists(os.path.join(wt_root(main), name)) or name in wf_names(main):
        n += 1
        name = "%s-%d" % (stamp, n)
    wt = os.path.join(wt_root(main), name)
    git(main, "worktree", "add", "--quiet", "--detach", wt, "refs/remotes/origin/" + base)
    emit(status="ready", main=main, worktree=wt, name=name, base=base, head=git(wt, "rev-parse", "HEAD").strip())

def ignore():
    main = located()
    wt = resolve(main, ARGS[0])
    def missing():
        # The trailing slashes stay: a pattern that ends in / matches only a directory, and work-reports/ may not
        # exist yet.
        return [path for where, path in ((main, ".claude/worktrees/"), (wt, "work-reports/"))
                if run("git", "-C", where, "check-ignore", "-q", path).returncode != 0]
    not_ignored = missing()
    if not not_ignored:
        emit(status="ok", notIgnored=[], added=[])
    if "--add" not in ARGS:
        emit(status="ask", notIgnored=not_ignored)
    # The exclude file git resolves. Every worktree of a clone shares it, so a line written here holds in main too.
    exclude = git(wt, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude").strip()
    os.makedirs(os.path.dirname(exclude), exist_ok=True)
    text = open(exclude).read() if os.path.exists(exclude) else ""
    with open(exclude, "a") as f:
        if text and not text.endswith("\n"):
            f.write("\n")
        for path in not_ignored:
            f.write(path + "\n")
    left = missing()
    if left:
        stop("still-not-ignored", "a .gitignore rule overrides info/exclude for %s" % ", ".join(left),
             notIgnored=left, added=not_ignored)
    emit(status="ok", notIgnored=[], added=not_ignored)

def list_runs():
    main = located()
    trees = {os.path.realpath(p): (pr, b) for p, pr, b in worktrees(main)}
    runs = []
    for name in wf_names(main):
        path = os.path.join(wt_root(main), name)
        _, branch = trees[os.path.realpath(path)]
        entry = {"name": name, "path": path, "branch": branch, "state": "no-pr", "pr": None}
        if branch is not None:
            pr, err = pull_request(main, branch)
            if err is not None:
                entry["state"], entry["error"] = "error", err
            elif pr is not None:
                entry["state"], entry["pr"] = pr["state"], pr
        runs.append(entry)
    emit(status="ok", main=main, worktrees=runs)

def plan(name):
    """Everything check prints and cleanup acts on. Returns (main, out)."""
    main = located()
    wt = resolve(main, name)
    prunable = listed(main, wt)
    branch = dict((os.path.realpath(p), b) for p, _, b in worktrees(main))[os.path.realpath(wt)]

    pr, err = (None, None)
    if branch is not None:
        pr, err = pull_request(main, branch)
        if err is not None:
            stop("gh", "cannot read the pull requests of %s: %s" % (branch, err))
    state = "no-pr" if pr is None else pr["state"]
    if state == "open":
        stop("open", "the pull request #%d of %s is still open" % (pr["number"], branch), pr=pr)
    base = pr["base"] if pr else None

    if prunable:
        tree = {"path": wt, "state": "prunable"}
    else:
        changes = git(wt, "status", "--porcelain").splitlines()
        tree = {"path": wt, "state": "dirty" if changes else "clean", "changes": changes[:20],
                "reports": reports(wt)}

    loses = []
    if tree["state"] == "dirty":
        loses.append("uncommitted")

    br, remote = None, None
    if branch is not None:
        remote = on_origin(main, branch)
        if remote is None:
            stop("fetch-failed", "cannot read the branches on origin")
        local = {"name": branch, "local": "delete", "remote": "present" if remote else "absent"}
        holder = [p for p, _, h in worktrees(main) if h == branch and os.path.realpath(p) != os.path.realpath(wt)]
        tip = sha(main, "refs/heads/" + branch) if has_branch(main, branch) else None
        if holder:
            local.update(local="keep", why="checked-out", worktree=holder[0])
        elif state == "merged" and tip and not head_contains(main, tip, pr):
            local.update(local="keep", why="unpushed")
        br = local
        if state == "closed":
            loses.append("commits")
        elif state == "no-pr" and tip:
            # cleanup deletes origin/<branch>, so a commit counts as kept only when another remote ref holds the tip.
            held = run("git", "-C", main, "for-each-ref", "--format=%(refname)", "--contains", tip,
                       "refs/remotes/origin").stdout.split()
            if not [h for h in held if h != "refs/remotes/origin/" + branch]:
                loses.append("commits")

    update = {"action": "none"}
    if state == "merged":
        if not fetch(main, base):
            stop("fetch-failed", "cannot fetch %s from origin" % base)
        target = sha(main, "refs/remotes/origin/" + base)
        holder = checked_out_in(main, base)
        if holder and os.path.realpath(holder) == os.path.realpath(wt):
            holder = None
        if not has_branch(main, base):
            update = {"action": "absent"}
        else:
            current = sha(main, "refs/heads/" + base)
            if current == target:
                update = {"action": "current", "sha": current}
            elif contains(main, current, target):
                update = {"action": "fast-forward", "from": current, "to": target, "worktree": holder}
            else:
                update = {"action": "diverged", "sha": current, "to": target, "worktree": holder}

    return main, {"main": main, "name": name, "state": state, "pr": pr, "base": base, "worktree": tree,
                  "branch": br, "loses": loses, "update": update,
                  "oldReports": {"path": os.path.join(main, "work-reports"), "days": REPORT_DAYS,
                                 "names": old_reports(main)}}

def check():
    _, out = plan(ARGS[0])
    emit(status="ok", **out)

def move_reports(main, wt, name):
    """Move each work report out of wt into <main>/work-reports/. A name taken there gets -<name> on the end."""
    moved = []
    dest_root = os.path.join(main, "work-reports")
    for report in reports(wt):
        os.makedirs(dest_root, exist_ok=True)
        dest = os.path.join(dest_root, report)
        if os.path.lexists(dest):
            dest = os.path.join(dest_root, "%s-%s" % (report, name))
        if os.path.lexists(dest):
            die("cannot move %s: %s exists" % (report, dest))
        shutil.move(os.path.join(wt, "work-reports", report), dest)
        os.utime(dest)
        moved.append(dest)
    return moved

def cleanup():
    name = ARGS[0]
    main, out = plan(name)
    discard = "--discard" in ARGS
    if out["loses"] and not discard:
        stop("discard", "%s holds work that nothing else holds: %s" % (name, ", ".join(out["loses"])), **{
            k: v for k, v in out.items()})
    tree, errors, br = out["worktree"], [], out["branch"]

    if tree["state"] == "prunable":
        git(main, "worktree", "prune")
        tree["action"] = "pruned"
    else:
        tree["moved"] = move_reports(main, tree["path"], name)
        # The work reports are ignored files, which git worktree remove deletes without --force. Uncommitted and
        # untracked files need it, and --discard is the user's word for that.
        force = ["--force"] if discard and tree["state"] == "dirty" else []
        git(main, "worktree", "remove", *force, tree["path"])
        tree["action"] = "removed"

    if br:
        if br["local"] == "delete":
            r = run("git", "-C", main, "branch", "-D", br["name"])
            if r.returncode == 0:
                br["local"] = "deleted"
            else:
                br["local"] = "keep"
                errors.append({"step": "local-branch", "message": r.stderr.strip()})
        if br["remote"] == "present":
            r = run("git", "-C", main, "push", "--quiet", "origin", "--delete", br["name"])
            if r.returncode == 0 or "remote ref does not exist" in r.stderr:
                br["remote"] = "deleted" if r.returncode == 0 else "absent"
            else:
                errors.append({"step": "remote-branch", "message": r.stderr.strip()})
        run("git", "-C", main, "update-ref", "-d", "refs/remotes/origin/" + br["name"])

    update = out["update"]
    if update["action"] == "fast-forward":
        base = out["base"]
        if update["worktree"]:
            # merge --ff-only refuses, and changes nothing, when it would overwrite a local change.
            r = run("git", "-C", update["worktree"], "merge", "--ff-only", "--quiet", "origin/" + base)
        else:
            r = run("git", "-C", main, "update-ref", "refs/heads/" + base, update["to"], update["from"])
        if r.returncode == 0:
            update["action"] = "updated"
        else:
            update["action"] = "not-updated"
            errors.append({"step": "update", "message": (r.stderr or r.stdout).strip()})

    out["oldReports"]["deleted"] = delete_reports(main, out["oldReports"]["names"], errors)
    emit(status="done", errors=errors, **out)

def old_reports_cmd():
    main = located()
    info = {"path": os.path.join(main, "work-reports"), "days": REPORT_DAYS, "names": old_reports(main)}
    if "--delete" not in ARGS:
        emit(status="ok", main=main, oldReports=info)
    errors = []
    info["deleted"] = delete_reports(main, info["names"], errors)
    emit(status="done", main=main, oldReports=info, errors=errors)

def sync():
    main = located()
    wt, base = resolve(main, ARGS[0]), ARGS[1]
    out = {"base": base}
    if run("git", "-C", wt, "rev-parse", "--verify", "--quiet", "MERGE_HEAD").returncode == 0:
        stop("unfinished", "%s holds an unfinished merge" % wt, **out)
    if git(wt, "status", "--porcelain").strip():
        stop("dirty", "%s has uncommitted changes" % wt, **out)
    if not fetch(main, base):
        stop("fetch-failed", "cannot fetch %s from origin" % base, **out)
    head = git(wt, "rev-parse", "HEAD").strip()
    incoming = "refs/remotes/origin/" + base
    if contains(wt, incoming, "HEAD"):
        emit(status="current", sha=head, **out)
    # merge-tree merges in memory and touches neither the index nor the working tree: exit 0 is clean, 1 conflicts.
    r = run("git", "-C", wt, "merge-tree", "--write-tree", "--name-only", "HEAD", incoming)
    if r.returncode not in (0, 1):
        die("git merge-tree failed: %s" % r.stderr.strip())
    behind = int(git(wt, "rev-list", "--count", "HEAD.." + incoming).strip())
    if r.returncode == 0:
        # A clean merge is left to GitHub. The branch gets no merge commit it does not need.
        emit(status="clean", sha=head, behind=behind, **out)
    r = run("git", "-C", wt, "merge", "--no-ff", "origin/" + base)
    files = git(wt, "diff", "--name-only", "--diff-filter=U").splitlines()
    if r.returncode == 0 or not files:
        run("git", "-C", wt, "merge", "--abort")
        die("git merge origin/%s did not stop on the conflicts merge-tree found: %s"
            % (base, (r.stderr or r.stdout).strip()))
    emit(status="conflict", start=head, files=files, behind=behind, **out)

def pr_info(main, number):
    r = run("gh", "pr", "view", str(number), "--json",
            "number,state,url,title,headRefName,baseRefName,isCrossRepository", cwd=main)
    if r.returncode != 0:
        stop("unknown", "cannot read pull request #%s: %s" % (number, r.stderr.strip()))
    p = json.loads(r.stdout)
    info = {"number": p["number"], "url": p["url"], "title": p["title"], "head": p["headRefName"],
            "base": p["baseRefName"], "project": None}
    if p["state"] != "OPEN":
        stop("not-open", "pull request #%d is %s" % (p["number"], p["state"].lower()), pr=info)
    if p["isCrossRepository"]:
        stop("fork", "pull request #%d comes from a fork, and its branch cannot be pushed from here" % p["number"],
             pr=info)
    m = re.fullmatch(r"pj/(\d+)", p["headRefName"])
    if m:
        r = run("gh", "issue", "view", m.group(1), "--json", "labels", cwd=main)
        if r.returncode == 0 and any(l["name"] == "project" for l in json.loads(r.stdout)["labels"]):
            info["project"] = int(m.group(1))
    return info

def pr():
    main = located()
    if ARGS:
        if not re.fullmatch(r"\d+", ARGS[0]):
            die("not a pull request number: " + ARGS[0])
        emit(status="ok", pr=pr_info(main, int(ARGS[0])))
    r = run("gh", "pr", "list", "--author", "@me", "--state", "open", "--limit", "100", "--json",
            "number,title,url,headRefName,baseRefName,mergeable", cwd=main)
    if r.returncode != 0:
        stop("gh", "cannot list the open pull requests: %s" % r.stderr.strip())
    found = [{"number": p["number"], "title": p["title"], "url": p["url"], "head": p["headRefName"],
              "base": p["baseRefName"]} for p in json.loads(r.stdout) if p["mergeable"] == "CONFLICTING"]
    emit(status="pick", candidates=sorted(found, key=lambda p: p["number"]))

{"start": start, "create": create, "ignore": ignore, "sync": sync, "pr": pr, "list": list_runs, "check": check, "cleanup": cleanup,
 "old-reports": old_reports_cmd}[SUB]()
PY

exec python3 -c "$PY" "$@"
