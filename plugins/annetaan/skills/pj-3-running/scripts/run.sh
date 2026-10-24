#!/usr/bin/env bash
# Runs the mechanical steps of pj-3-running for one project and prints each result as one JSON object.
# The judgment and the questions stay in the skill. --discard and --add carry the user's answers back.
# Writes on GitHub: start creates the project's base branch through the API when it is due, and close comments on an
# issue and closes it as completed. Writes in git: start and worktree fetch the base branch into origin/<base>,
# worktree creates and moves the run's worktree, and ignore --add appends to the clone's info/exclude.
# It reads the project with ../../pj-1-plan/scripts/project.sh, and never parses an issue body itself.
set -euo pipefail

die() { echo "run: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: run.sh start <P>                       check the clone, gh and the repository, read the project, create its base branch when due, fetch it, read the merge rules
       run.sh close <P> <n> --comment <file>  comment on and close #<n> as completed, when it is due
       run.sh worktree <P> [--discard]        put the run's worktree on the tip of origin/<base>
       run.sh ignore <P> [--add]              whether .claude/worktrees/ and work-reports/ are ignored; --add writes them to info/exclude
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
USAGE
  exit 1
}

number() { case "$2" in ''|*[!0-9]*) die "$1 must be an issue number: $2" ;; esac; }

[ $# -ge 2 ] || usage
number "the project" "$2"
case "$1" in
  start)    [ $# -eq 2 ] || usage ;;
  close)    [ $# -eq 5 ] && [ "$4" = "--comment" ] || usage
            number "the issue" "$3"
            [ -f "$5" ] || die "no such file: $5" ;;
  worktree) [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$3" = "--discard" ]; } || usage ;;
  ignore)   [ $# -eq 2 ] || { [ $# -eq 3 ] && [ "$3" = "--add" ]; } || usage ;;
  *)        usage ;;
esac

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

PROJECT_SH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../pj-1-plan/scripts/project.sh"

read -r -d '' PY <<'PY' || true
import json, os, re, shutil, subprocess, sys

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
    """Whether pj-3-running can merge its own pull requests into base, whether base requires status checks, and the
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
    """The worktrees of the clone as [(path, prunable)]."""
    out = []
    for block in git(main, "worktree", "list", "--porcelain").split("\n\n"):
        lines = block.splitlines()
        if lines and lines[0].startswith("worktree "):
            out.append((lines[0][len("worktree "):], any(l.startswith("prunable") for l in lines[1:])))
    return out

def listed(main, wt):
    """None when wt is no worktree of the clone, otherwise whether it is prunable."""
    real = os.path.realpath(wt)
    for path, prunable in worktrees(main):
        if os.path.realpath(path) == real:
            return prunable
    return None

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
        stop("self-merge", "%s needs a review that pj-3-running cannot give itself" % base,
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

{"start": start, "close": close, "worktree": worktree, "ignore": ignore}[SUB]()
PY

exec python3 -c "$PY" "$PROJECT_SH" "$@"
