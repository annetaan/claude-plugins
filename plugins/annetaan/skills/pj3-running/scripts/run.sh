#!/usr/bin/env bash
# Runs the mechanical steps of pj3-running for one project and prints each result as one JSON object.
# The judgment and the questions stay in the skill. --discard and --add carry the user's answers back.
# Writes on GitHub: start creates the project's base branch through the API when it is due, and close comments on an
# issue and closes it as completed. merge marks the pull request ready, merges it, comments on and closes the issue,
# and deletes the head branch on origin. Writes in git: start and worktree fetch the base branch into origin/<base>,
# worktree creates and moves the run's worktree, branch creates the issue's branch in <WT>, merge moves <WT> onto the
# merged base and deletes the local head branch, and ignore --add appends to the clone's info/exclude.
# It reads the project with ../../pj1-plan/scripts/project.sh, and never parses an issue body itself.
set -euo pipefail

die() { echo "run: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: run.sh start <P>                       check the clone, gh and the repository, read the project, create its base branch when due, fetch it, read the merge rules
       run.sh close <P> <n> --comment <file>  comment on and close #<n> as completed, when it is due
       run.sh worktree <P> [--discard]        put the run's worktree on the tip of origin/<base>
       run.sh ignore <P> [--add]              whether .claude/worktrees/ and work-reports/ are ignored; --add writes them to info/exclude
       run.sh branch <P> <branch>             create <branch> in the run's worktree from the tip of origin/<base>
       run.sh merge <P> <k> <m> --comment <file> [--wait <seconds>]
                                              wait for the required checks, merge #<m> into the base branch, close #<k>, delete the head branch
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
USAGE
  exit 1
}

number() { case "$2" in ''|*[!0-9]*) die "$1 must be a number: $2" ;; esac; }

[ $# -ge 2 ] || usage
number "the project" "$2"
case "$1" in
  start)    [ $# -eq 2 ] || usage ;;
  close)    [ $# -eq 5 ] && [ "$4" = "--comment" ] || usage
            number "the issue" "$3"
            [ -f "$5" ] || die "no such file: $5" ;;
  worktree) [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$3" = "--discard" ]; } || usage ;;
  ignore)   [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$3" = "--add" ]; } || usage ;;
  branch)   [ $# -eq 3 ] || usage ;;
  merge)    { [ $# -eq 6 ] || [ $# -eq 8 ]; } && [ "$5" = "--comment" ] || usage
            number "the issue" "$3"
            number "the pull request" "$4"
            [ -f "$6" ] || die "no such file: $6"
            if [ $# -eq 8 ]; then
              [ "$7" = "--wait" ] || usage
              number "the wait in seconds" "$8"
            fi ;;
  *)        usage ;;
esac

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

PROJECT_SH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../pj1-plan/scripts/project.sh"

read -r -d '' PY <<'PY' || true
import json, os, re, shutil, subprocess, sys, time

PROJECT_SH, SUB, P = sys.argv[1], sys.argv[2], int(sys.argv[3])
ARGS = sys.argv[4:]

def run(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True)

def emit(**obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)

def stop(reason, message, **extra):
    emit(status="stop", reason=reason, message=message, **extra)

def die(msg):
    print("run: " + msg, file=sys.stderr)
    sys.exit(1)

def git(where, *args):
    """Run git in where, and die when it fails."""
    r = run("git", "-C", where, *args)
    if r.returncode != 0:
        die("git %s failed: %s" % (" ".join(args), r.stderr.strip()))
    return r.stdout

def locate(p):
    """(main, wt): the main working tree, the path on the first worktree line, and the run's worktree under it.
    None outside a clone."""
    r = run("git", "worktree", "list", "--porcelain")
    if r.returncode != 0:
        return None
    for line in r.stdout.splitlines():
        if line.startswith("worktree "):
            main = line[len("worktree "):]
            return main, os.path.join(main, ".claude/worktrees/pj-%d" % p)
    return None

def located():
    loc = locate(P)
    if loc is None:
        die("not inside a git repository")
    return loc

def project(p, **extra):
    r = run(PROJECT_SH, str(p))
    if r.returncode != 0:
        stop("project", r.stderr.strip(), **extra)
    return json.loads(r.stdout)

def repo_view():
    r = run("gh", "repo", "view", "--json", "nameWithOwner,hasIssuesEnabled,defaultBranchRef,viewerPermission,"
            "squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed")
    if r.returncode != 0:
        die("cannot read the repository: " + r.stderr.strip())
    return json.loads(r.stdout)

def fetch(main, base):
    """Move origin/<base> in main and nothing else. The explicit refspec works in a single-branch clone too."""
    return run("git", "-C", main, "fetch", "--quiet", "origin",
               "+refs/heads/%s:refs/remotes/origin/%s" % (base, base)).returncode == 0

def api_json(*args):
    """gh api, parsed. None when the call fails."""
    r = run("gh", "api", *args)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout)
    except ValueError:
        return None

CLASSIC_QUERY = ("query($owner: String!, $name: String!, $q: String!) { repository(owner: $owner, name: $name) { "
                 "ref(qualifiedName: $q) { branchProtectionRule { requiredApprovingReviewCount "
                 "requiresCodeOwnerReviews requiresStatusChecks } } } }")

def rules(repo, base, view, main):
    """Whether pj3-running can merge its own pull requests into base, whether base requires status checks, and the
    merge method to use."""
    owner, name = repo.split("/", 1)
    ruleset = api_json("repos/%s/rules/branches/%s" % (repo, base))
    rules_read = isinstance(ruleset, list)
    ruleset = ruleset if rules_read else []
    branch = api_json("repos/%s/branches/%s" % (repo, base))
    protected = branch.get("protected") if isinstance(branch, dict) else None
    classic = None
    q = api_json("graphql", "-f", "owner=" + owner, "-f", "name=" + name, "-f", "q=refs/heads/" + base,
                 "-f", "query=" + CLASSIC_QUERY)
    if isinstance(q, dict):
        ref = (((q.get("data") or {}).get("repository") or {}).get("ref") or {})
        classic = ref.get("branchProtectionRule")
    owners = run("git", "-C", main, "ls-tree", "--name-only", "origin/" + base, "--",
                 "CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS")
    codeowners = owners.returncode == 0 and owners.stdout.strip() != ""

    types = [r.get("type") for r in ruleset]
    prs = [r.get("parameters") or {} for r in ruleset if r.get("type") == "pull_request"]
    blocked = []
    if any((p.get("required_approving_review_count") or 0) > 0 for p in prs):
        blocked.append("rule-approvals")
    if codeowners and any(p.get("require_code_owner_review") for p in prs):
        blocked.append("rule-code-owners")
    if "merge_queue" in types:
        blocked.append("merge-queue")
    if classic and (classic.get("requiredApprovingReviewCount") or 0) > 0:
        blocked.append("classic-approvals")
    if classic and codeowners and classic.get("requiresCodeOwnerReviews"):
        blocked.append("classic-code-owners")

    classic_known = protected is False or classic is not None
    self_merge = "ok" if rules_read and classic_known else "unknown"
    if "required_status_checks" in types or (classic and classic.get("requiresStatusChecks")):
        checks = "yes"
    elif rules_read and classic_known:
        checks = "no"
    else:
        checks = "unknown"

    methods = [m for m, flag in (("squash", "squashMergeAllowed"), ("merge", "mergeCommitAllowed"),
                                 ("rebase", "rebaseMergeAllowed")) if view.get(flag)]
    if "required_linear_history" in types:
        methods = [m for m in methods if m != "merge"]
    for p in prs:
        allowed = p.get("allowed_merge_methods")
        if allowed:
            methods = [m for m in methods if m in allowed]
    return {"selfMerge": self_merge, "blockedBy": blocked, "requiredChecks": checks,
            "mergeMethod": methods[0] if methods else None}

def due(proj, n):
    """Whether #n may be closed now: due, already (closed), not-due, or unknown (not in the project)."""
    parent = proj["parent"]
    if n == parent["number"]:
        return "already" if parent["state"] == "CLOSED" else "due" if parent["merged"] else "not-due"
    for d in parent["dependsOn"]:
        if d["number"] == n:
            return "already" if d["state"] == "CLOSED" else "due" if d["merged"] else "not-due"
    for i in proj["issues"]:
        if i["number"] == n:
            if i["state"] == "CLOSED":
                return "already"
            return "due" if i["pr"] and i["pr"]["state"] == "MERGED" else "not-due"
    return "unknown"

def close_issue(n, comment_file):
    """Comment on #n, then close it as completed. None, or the step that failed with its message."""
    r = run("gh", "issue", "comment", str(n), "--body-file", comment_file)
    if r.returncode != 0:
        return {"step": "comment", "message": r.stderr.strip()}
    r = run("gh", "issue", "close", str(n), "--reason", "completed")
    if r.returncode != 0:
        return {"step": "close", "message": r.stderr.strip()}
    return None

def worktrees(main):
    """The worktrees of the clone as [(path, prunable, branch)]. branch is None on a detached HEAD."""
    out = []
    for block in git(main, "worktree", "list", "--porcelain").split("\n\n"):
        lines = block.splitlines()
        if lines and lines[0].startswith("worktree "):
            heads = [l[len("branch refs/heads/"):] for l in lines[1:] if l.startswith("branch refs/heads/")]
            out.append((lines[0][len("worktree "):], any(l.startswith("prunable") for l in lines[1:]),
                        heads[0] if heads else None))
    return out

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

# gh pr checks exits 1 with one of these when it read the pull request and found nothing to report: no check at all on
# the head commit, or checks but none required. Both strings come from gh's populateStatusChecks
# (pkg/cmd/pr/checks/checks.go). The first does not contain the second.
NO_CHECKS = "no checks reported on the"
NO_REQUIRED = "no required checks reported on the"

def nothing_required(text):
    """Whether gh's output says it found no required check, as opposed to failing to read the checks."""
    return NO_CHECKS in text or NO_REQUIRED in text

def registered(m):
    """How many required checks have registered on #m, as a pair (n, error) in which exactly one side is None.

    (n, None) when gh read the pull request: n is the number of required checks, 0 when gh says there is none.
    (None, error) when gh failed for any other reason or printed something other than a JSON list.
    """
    r = run("gh", "pr", "checks", str(m), "--required", "--json", "name")
    if r.returncode != 0:
        text = r.stdout + r.stderr
        if nothing_required(text):
            return 0, None
        return None, r.stderr.strip() or r.stdout.strip() or "gh pr checks exited %d" % r.returncode
    try:
        found = json.loads(r.stdout)
    except ValueError:
        return None, "unreadable output from gh pr checks"
    if not isinstance(found, list):
        return None, "unreadable output from gh pr checks"
    return len(found), None

def version(text):
    m = re.search(r"gh version (\d+)\.(\d+)\.(\d+)", text)
    return tuple(int(x) for x in m.groups()) if m else None

def start():
    loc = locate(P)
    if loc is None:
        stop("not-a-repo", "not inside a git repository")
    main, wt = loc
    out = {"main": main, "worktree": wt}
    r = run("git", "-C", main, "remote", "get-url", "origin")
    if r.returncode != 0:
        stop("no-origin", "the clone has no remote named origin", **out)
    if shutil.which("gh") is None:
        stop("gh", "gh is not installed", **out)
    v = version(run("gh", "--version").stdout)
    if v is None or v < (2, 94, 0):
        stop("gh", "gh 2.94.0 or later is required, found %s" % (".".join(map(str, v)) if v else "an unknown version"),
             **out)
    out["gh"] = ".".join(map(str, v))
    out["attach"] = v >= (2, 99, 0)
    auth = run("gh", "auth", "status")
    if auth.returncode != 0:
        stop("gh-auth", "gh is not logged in: " + (auth.stderr.strip().splitlines() or [""])[-1], **out)
    view = repo_view()
    repo = view["nameWithOwner"]
    out = dict(out, repo=repo, defaultBranch=(view.get("defaultBranchRef") or {}).get("name"))
    if not view.get("hasIssuesEnabled"):
        stop("issues-off", "issues are turned off in %s" % repo, **out)
    if view.get("viewerPermission") not in ("WRITE", "MAINTAIN", "ADMIN"):
        stop("permission", "the permission on %s is %s, and WRITE, MAINTAIN or ADMIN is required"
             % (repo, view.get("viewerPermission")), **out)
    if not any(view.get(f) for f in ("squashMergeAllowed", "mergeCommitAllowed", "rebaseMergeAllowed")):
        stop("no-merge-method", "%s allows no merge method" % repo, **out)

    proj = project(P, **out)
    parent = proj["parent"]
    base = parent["base"]
    summary = {k: parent[k] for k in ("number", "title", "base", "from", "baseExists", "merged")}
    out["project"] = summary
    issues = proj["issues"]
    if all(i["state"] == "CLOSED" for i in issues) and issues:
        close = [{"number": P, "title": parent["title"], "base": base, "self": True}] \
            if parent["merged"] and parent["state"] == "OPEN" else []
        emit(status="done", close=close, **out)
    out["close"] = [{"number": d["number"], "title": d["title"], "base": d["base"], "self": False}
                    for d in parent["dependsOn"] if d["state"] == "OPEN" and d["merged"]]
    if not issues:
        emit(status="empty", **out)

    out["created"] = None
    if not parent["baseExists"]:
        if any(i["pr"] and i["pr"]["state"] == "MERGED" for i in issues):
            stop("base-gone", "%s is gone from origin, and a pull request into it has merged" % base, **out)
        waits = [{k: d[k] for k in ("number", "title", "state", "base")}
                 for d in parent["dependsOn"] if not d["merged"]]
        if waits:
            stop("waits", "#%d waits on %s" % (P, ", ".join("#%d" % d["number"] for d in waits)), waits=waits, **out)
        ref = api_json("repos/%s/git/ref/heads/%s" % (repo, parent["from"]))
        sha = ((ref or {}).get("object") or {}).get("sha") if isinstance(ref, dict) else None
        if not sha:
            stop("create-failed", "cannot read the tip of %s" % parent["from"], **out)
        made = run("gh", "api", "repos/%s/git/refs" % repo, "-f", "ref=refs/heads/" + base, "-f", "sha=" + sha)
        if made.returncode != 0:
            stop("create-failed", "cannot create %s: %s" % (base, made.stderr.strip()), **out)
        out["created"] = {"sha": sha}
        out["project"] = dict(summary, baseExists=True)

    if not fetch(main, base):
        stop("fetch-failed", "cannot fetch %s from origin" % base, **out)

    found = rules(repo, base, view, main)
    if found["blockedBy"]:
        stop("self-merge", "%s needs a review that pj3-running cannot give itself" % base,
             blockedBy=found["blockedBy"], **out)
    if found["mergeMethod"] is None:
        stop("no-merge-method", "the rules on %s leave no merge method that %s allows" % (base, repo), **out)
    emit(status="run", rules={k: found[k] for k in ("selfMerge", "requiredChecks", "mergeMethod")}, **out)

def close():
    n, comment_file = int(ARGS[0]), ARGS[2]
    state = due(project(P), n)
    if state == "unknown":
        stop("unknown-issue", "#%d is neither #%d, a project it waits on, nor one of its sub-issues" % (n, P),
             number=n)
    if state == "not-due":
        stop("not-due", "#%d is not due to close" % n, number=n)
    if state == "already":
        emit(status="closed", number=n, already=True)
    failed = close_issue(n, comment_file)
    if failed:
        die("cannot %s on #%d: %s" % (failed["step"], n, failed["message"]))
    emit(status="closed", number=n, already=False)

def worktree():
    main, wt = located()
    base = project(P)["parent"]["base"]
    if not fetch(main, base):
        stop("fetch-failed", "cannot fetch %s from origin" % base, worktree=wt)
    tip = "origin/" + base
    prunable = listed(main, wt)
    if prunable:
        git(main, "worktree", "prune")
        git(main, "worktree", "add", "--detach", wt, tip)
        action = "recreated"
    elif prunable is False:
        changes = git(wt, "status", "--porcelain").splitlines()
        if not changes:
            action = "moved"
        elif "--discard" not in ARGS:
            emit(status="dirty", worktree=wt, changes=changes[:20])
        else:
            git(wt, "reset", "--hard")
            git(wt, "clean", "-fd")
            action = "discarded"
        git(wt, "switch", "--detach", tip)
    elif os.path.lexists(wt):
        stop("foreign", "%s exists and is not a worktree of this clone" % wt, worktree=wt)
    else:
        git(main, "worktree", "add", "--detach", wt, tip)
        action = "created"
    emit(status="ready", worktree=wt, action=action, head=git(wt, "rev-parse", "HEAD").strip())

def ignore():
    main, wt = located()
    if listed(main, wt) is not False:
        die("%s is no worktree of this clone. run.sh worktree %d first" % (wt, P))
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

def branch():
    main, wt = located()
    if listed(main, wt) is not False:
        die("%s is no worktree of this clone. run.sh worktree %d first" % (wt, P))
    b = ARGS[0]
    base = project(P)["parent"]["base"]
    if run("git", "check-ref-format", "--branch", b).returncode != 0:
        die("not a valid branch name: " + b)
    if not fetch(main, base):
        stop("fetch-failed", "cannot fetch %s from origin" % base, branch=b)
    changes = git(wt, "status", "--porcelain").splitlines()
    if changes:
        stop("dirty", "%s has uncommitted changes" % wt, worktree=wt)
    if has_branch(wt, b):
        holder = checked_out_in(main, b)
        mine = holder is not None and os.path.realpath(holder) == os.path.realpath(wt)
        if holder is not None and not mine:
            stop("checked-out", "%s is checked out in %s" % (b, holder), branch=b, worktree=holder)
        ahead = int(git(wt, "rev-list", "--count", "origin/%s..%s" % (base, b)).strip())
        if ahead > 0:
            stop("unpushed", "%s holds %d commit(s) that origin/%s does not have" % (b, ahead, base),
                 branch=b, commits=ahead)
        if mine:
            git(wt, "switch", "--detach")
        git(wt, "branch", "-D", b)
    git(wt, "switch", "--no-track", "-c", b, "origin/" + base)
    emit(status="ok", branch=b, start=git(wt, "rev-parse", "HEAD").strip())

def merge():
    k, m, comment = int(ARGS[0]), int(ARGS[1]), ARGS[3]
    wait = int(ARGS[5]) if ARGS[4:5] == ["--wait"] else 300
    proj = project(P)
    issue = next((i for i in proj["issues"] if i["number"] == k), None)
    if issue is None:
        die("#%d is not a sub-issue of #%d" % (k, P))
    pr = issue["pr"]
    if pr is None or pr["number"] != m:
        stop("not-the-pr", "#%d is not the pull request project.sh reports for #%d" % (m, k),
             pr=(pr or {}).get("number"))
    main, wt = located()
    base = proj["parent"]["base"]
    view = repo_view()
    found = rules(view["nameWithOwner"], base, view, main)
    r = run("gh", "pr", "view", str(m), "--json", "reviewDecision,mergeStateStatus,isDraft,headRefName,state")
    if r.returncode != 0:
        die("cannot read #%d: %s" % (m, r.stderr.strip()))
    pv = json.loads(r.stdout)
    b = pv["headRefName"]

    merged_earlier = pr["state"] == "MERGED"
    if not merged_earlier:
        if pv.get("reviewDecision") in ("REVIEW_REQUIRED", "CHANGES_REQUESTED"):
            stop("review", "#%d has review decision %s" % (m, pv["reviewDecision"]), pr=m)
        if pv.get("mergeStateStatus") == "DIRTY":
            stop("conflict", "#%d conflicts with %s" % (m, base), pr=m)
        method = found["mergeMethod"]
        if method is None:
            stop("no-merge-method", "the rules on %s leave no merge method that %s allows"
                 % (base, view["nameWithOwner"]), pr=m)
        if found["requiredChecks"] != "no":
            # With no, the base branch requires no checks, so nothing is waited on or watched.
            # A pull request pushed seconds ago may have no check runs yet, and --watch does not wait for a check
            # that has not registered, so the loop polls until one does or the wait runs out. A failed read does
            # not end the loop early; only the last poll counts.
            # unknown waits like yes, but merges when no required check registered: the merge never passes --admin,
            # so GitHub still refuses a merge that a required check blocks. The watch below then doubles as the last
            # look for a check that registered late.
            # A read that failed is reported as checks-unreadable, never taken as zero checks.
            deadline = time.monotonic() + wait
            while True:
                n, error = registered(m)
                left = deadline - time.monotonic()
                if (n is not None and n > 0) or left <= 0:
                    break
                time.sleep(min(10, left))
            if n is None:
                stop("checks-unreadable", "cannot read the checks on #%d: %s" % (m, error), pr=m)
            if n == 0 and found["requiredChecks"] == "yes":
                stop("no-checks", "no required check registered on #%d within %d seconds" % (m, wait), pr=m)
            r = run("gh", "pr", "checks", str(m), "--required", "--watch", "--fail-fast")
            text = r.stdout + r.stderr
            if r.returncode != 0 and not nothing_required(text):
                stop("checks-failed", "\n".join(text.strip().splitlines()[-5:]), pr=m)
        if pv.get("isDraft"):
            r = run("gh", "pr", "ready", str(m))
            if r.returncode != 0:
                stop("merge-failed", "cannot mark #%d ready: %s" % (m, r.stderr.strip()), pr=m)
        # No --delete-branch: to delete it gh switches <WT> to <base>, and git refuses that while <MAIN> has <base>
        # checked out. The cleanup below deletes the branch. No --admin: a rule the user set is never bypassed.
        r = run("gh", "pr", "merge", str(m), "--" + method)
        if r.returncode != 0:
            stop("merge-failed", "cannot merge #%d: %s" % (m, r.stderr.strip()), pr=m)

    errors = []
    if issue["state"] == "CLOSED":
        closed = "already-closed"
    else:
        failed = close_issue(k, comment)
        if failed:
            errors.append({"step": "close", "message": "%s: %s" % (failed["step"], failed["message"])})
            closed = "open"
        else:
            closed = "closed"

    # Every step from here on reports a failure in errors and goes on. The merge has happened.
    if not fetch(main, base):
        errors.append({"step": "fetch", "message": "cannot fetch %s from origin" % base})
    r = run("git", "-C", wt, "switch", "--detach", "origin/" + base)
    if r.returncode != 0:
        errors.append({"step": "switch", "message": r.stderr.strip()})
    local = "absent"
    if has_branch(wt, b):
        r = run("git", "-C", wt, "branch", "-D", b)
        if r.returncode == 0:
            local = "deleted"
        else:
            local = "kept"
            errors.append({"step": "delete-local", "message": r.stderr.strip()})
    r = run("git", "-C", wt, "push", "--quiet", "origin", "--delete", b)
    if r.returncode == 0:
        remote = "deleted"
    elif "remote ref does not exist" in r.stderr:
        remote = "absent"
    else:
        remote = "kept"
        errors.append({"step": "delete-remote", "message": r.stderr.strip()})
    emit(status="merged", pr=m, branch={"name": b, "local": local, "remote": remote},
         method=None if merged_earlier else found["mergeMethod"], mergedEarlier=merged_earlier, issue=closed,
         errors=errors)

{"start": start, "close": close, "worktree": worktree, "ignore": ignore, "branch": branch, "merge": merge}[SUB]()
PY

exec python3 -c "$PY" "$PROJECT_SH" "$@"
