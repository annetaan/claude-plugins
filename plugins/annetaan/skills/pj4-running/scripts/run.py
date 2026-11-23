import json, os, re, shutil, subprocess, sys, time

PROJECT_SH, SUB, P = sys.argv[1], sys.argv[2], int(sys.argv[3])
ARGS = sys.argv[4:]

sys.path.insert(0, os.path.dirname(PROJECT_SH))
from issue import check_marker
ISSUE_SH = os.path.join(os.path.dirname(PROJECT_SH), "issue.sh")

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
    r = run("git", "-C", where, *args)
    if r.returncode != 0:
        die("git %s failed: %s" % (" ".join(args), r.stderr.strip()))
    return r.stdout

def locate(p):
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

def read_project(p):
    r = run(PROJECT_SH, str(p))
    return json.loads(r.stdout) if r.returncode == 0 else None

def repo_view():
    r = run("gh", "repo", "view", "--json", "nameWithOwner,hasIssuesEnabled,defaultBranchRef,viewerPermission,"
            "squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed")
    if r.returncode != 0:
        die("cannot read the repository: " + r.stderr.strip())
    return json.loads(r.stdout)

def fetch(main, base):
    return run("git", "-C", main, "fetch", "--quiet", "origin",
               "+refs/heads/%s:refs/remotes/origin/%s" % (base, base)).returncode == 0

def api_json(*args):
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

TRIGGER = re.compile(r"""^(\s*)(?:-\s*)?["']?(pull_request(?:_target)?)["']?\s*(:|$)""")
ON = re.compile(r"""^["']?on["']?\s*:(.*)$""")
FILTER = re.compile(r"""^(\s*)(branches|branches-ignore)\s*:\s*(.*)$""")

def glob(pattern):
    out, i = "", 0
    while i < len(pattern):
        c = pattern[i]
        if pattern.startswith("**", i):
            out, i = out + ".*", i + 2
            continue
        if c == "*":
            out += "[^/]*"
        elif c in "?+":
            out += c
        elif c == "[" and "]" in pattern[i:]:
            j = pattern.index("]", i)
            out, i = out + pattern[i:j + 1], j
        elif c == "\\" and i + 1 < len(pattern):
            i += 1
            out += re.escape(pattern[i])
        else:
            out += re.escape(c)
        i += 1
    return out

def flow_list(text):
    items, item, quote, depth = [], "", None, 0
    for c in text:
        if quote:
            if c == quote:
                quote = None
            else:
                item += c
            continue
        if c in "'\"":
            quote = c
            continue
        if c == "[":
            depth += 1
            if depth == 1:
                continue
        elif c == "]":
            depth -= 1
            if depth == 0:
                return [s.strip() for s in items + [item] if s.strip()], True
        elif c == "," and depth == 1:
            items, item = items + [item], ""
            continue
        item += c
    return [], False

def lets_through(kind, patterns, base):
    hits = [not p.startswith("!") for p in patterns if re.fullmatch(glob(p.lstrip("!")), base)]
    if kind == "branches-ignore":
        return not hits
    return bool(hits) and hits[-1]

def uncommented(line):
    quote = None
    for i, c in enumerate(line):
        if quote:
            if c == quote:
                quote = None
        elif c in "'\"":
            quote = c
        elif c == "#" and (i == 0 or line[i - 1].isspace()):
            return line[:i].rstrip()
    return line.rstrip()

def triggers(text, base):
    lines = [uncommented(l) for l in text.splitlines()]
    for n, line in enumerate(lines):
        m = ON.match(line)
        if m and re.search(r"\bpull_request(_target)?\b", m.group(1)):
            return True
        m = TRIGGER.match(line)
        if not m:
            continue
        indent = len(m.group(1))
        kind, patterns, child, collecting, flow = None, [], None, False, None
        for below in lines[n + 1:]:
            if not below.strip():
                continue
            depth = len(below) - len(below.lstrip())
            if depth <= indent:
                break
            if flow is not None:
                flow += " " + below.strip()
                patterns, closed = flow_list(flow)
                if closed:
                    flow = None
                continue
            if child is None:
                child = depth
            f = FILTER.match(below)
            if f and depth == child:
                kind, value = f.group(2), f.group(3).strip()
                patterns, collecting = [value.strip("'\"")] if value else [], not value
                if value.startswith("["):
                    patterns, closed = flow_list(value)
                    flow = None if closed else value
                continue
            if collecting and depth >= child and below.strip().startswith("- "):
                patterns.append(below.strip()[2:].strip().strip("'\""))
                continue
            collecting = False
        if kind is None or lets_through(kind, patterns, base):
            return True
    return False

def pull_request_workflow(main, ref, base):
    r = run("git", "-C", main, "ls-tree", "--name-only", ref, "--", ".github/workflows/")
    if r.returncode != 0:
        return None
    for path in r.stdout.splitlines():
        if not path.endswith((".yml", ".yaml")):
            continue
        shown = run("git", "-C", main, "show", "%s:%s" % (ref, path))
        if shown.returncode != 0:
            return None
        if triggers(shown.stdout, base):
            return True
    return False

def due(proj, n):
    parent = proj["parent"]
    if n == parent["number"]:
        return "already" if parent["state"] == "CLOSED" else "due" if parent["merged"] else "not-due"
    for d in parent["waitsOn"]:
        if d["number"] == n:
            return "already" if d["state"] == "CLOSED" else "due" if d["merged"] else "not-due"
    for i in proj["issues"]:
        if i["number"] == n:
            if i["state"] == "CLOSED":
                return "already"
            return "due" if i["pr"] and i["pr"]["state"] == "MERGED" else "not-due"
    return "unknown"

def issue_write(*args):
    r = run(ISSUE_SH, *args)
    if r.returncode != 0:
        return {"status": "stop", "reason": "issue-failed", "message": r.stderr.strip()}
    return json.loads(r.stdout)

def require_marker(path):
    msg = check_marker(path)
    if msg:
        stop("no-marker", msg)

def close_issue(n, comment_file):
    out = issue_write("close", str(n), "--reason", "completed", "--comment", comment_file)
    return out["message"] if out["status"] == "stop" else None

def startable_after(n, proj):
    source = proj if n == P else read_project(n)
    if source is None:
        return []
    found = []
    for m in source["parent"]["waitedOnBy"]:
        q = read_project(m)
        if q is not None and q["parent"]["startable"]:
            found.append({"number": m, "title": q["parent"]["title"]})
    return sorted(found, key=lambda e: e["number"])

def worktrees(main):
    out = []
    for block in git(main, "worktree", "list", "--porcelain").split("\n\n"):
        lines = block.splitlines()
        if lines and lines[0].startswith("worktree "):
            heads = [l[len("branch refs/heads/"):] for l in lines[1:] if l.startswith("branch refs/heads/")]
            out.append((lines[0][len("worktree "):], any(l.startswith("prunable") for l in lines[1:]),
                        heads[0] if heads else None))
    return out

def listed(main, wt):
    real = os.path.realpath(wt)
    for path, prunable, _ in worktrees(main):
        if os.path.realpath(path) == real:
            return prunable
    return None

def checked_out_in(main, branch):
    for path, _, head in worktrees(main):
        if head == branch:
            return path
    return None

def has_branch(where, branch):
    return run("git", "-C", where, "rev-parse", "--verify", "--quiet", "refs/heads/" + branch).returncode == 0

NO_CHECKS = "no checks reported on the"

def registered(m):
    r = run("gh", "pr", "checks", str(m), "--json", "name")
    if r.returncode != 0:
        if NO_CHECKS in r.stdout + r.stderr:
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
                    for d in parent["waitsOn"] if d["state"] == "OPEN" and d["merged"]]
    if not issues:
        emit(status="empty", **out)

    out["created"] = None
    if not parent["baseExists"]:
        if any(i["pr"] and i["pr"]["state"] == "MERGED" for i in issues):
            stop("base-gone", "%s is gone from origin, and a pull request into it has merged" % base, **out)
        waits = [{k: d[k] for k in ("number", "title", "state", "base")}
                 for d in parent["waitsOn"] if not d["merged"]]
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
        stop("self-merge", "%s needs a review that pj4-running cannot give itself" % base,
             blockedBy=found["blockedBy"], **out)
    if found["mergeMethod"] is None:
        stop("no-merge-method", "the rules on %s leave no merge method that %s allows" % (base, repo), **out)
    emit(status="run", rules={k: found[k] for k in ("selfMerge", "mergeMethod")}, **out)

def close():
    n, comment_file = int(ARGS[0]), ARGS[2]
    require_marker(comment_file)
    proj = project(P)
    state = due(proj, n)
    is_parent = n == P or any(d["number"] == n for d in proj["parent"]["waitsOn"])
    if state == "unknown":
        stop("unknown-issue", "#%d is neither #%d, a project it waits on, nor one of its sub-issues" % (n, P),
             number=n)
    if state == "not-due":
        stop("not-due", "#%d is not due to close" % n, number=n)
    if state == "already":
        emit(status="closed", number=n, already=True, startable=startable_after(n, proj) if is_parent else [])
    failed = close_issue(n, comment_file)
    if failed:
        die("cannot close #%d: %s" % (n, failed))
    emit(status="closed", number=n, already=False, startable=startable_after(n, proj) if is_parent else [])

def discard(wt):
    errors = []
    for step, args in (("reset", ("reset", "--hard")), ("clean", ("clean", "-fd"))):
        r = run("git", "-C", wt, *args)
        if r.returncode != 0:
            errors.append({"step": step, "message": r.stderr.strip()})
    return errors

def claim(wt):
    def assignees(repo, me=None):
        r = api_json("repos/%s/issues/%d" % (repo, P))
        if r is None:
            extra = {"assignee": {"login": me, "added": True}} if me else {}
            stop("assign-failed", "cannot read the assignees of #%d" % P, step="read", worktree=wt, **extra)
        return [a["login"] for a in r.get("assignees") or []]

    def others(me, logins, added=False):
        found = [l for l in logins if l.lower() != me.lower()]
        if found:
            stop("assigned", "#%d is assigned to %s" % (P, ", ".join(found)), login=me, assignees=found,
                 self=added or len(found) < len(logins), worktree=wt)

    u = api_json("user")
    if u is None or not u.get("login"):
        stop("assign-failed", "cannot read the user's login from GitHub", step="login", worktree=wt)
    me = u["login"]
    repo = repo_view()["nameWithOwner"]
    logins = assignees(repo)
    others(me, logins)
    added = False
    if not logins:
        r = run("gh", "issue", "edit", str(P), "--add-assignee", me)
        if r.returncode != 0:
            stop("assign-failed", "cannot assign %s to #%d: %s" % (me, P, r.stderr.strip()), step="add", worktree=wt)
        others(me, assignees(repo, me), added=True)
        added = True
    return {"login": me, "added": added}

def worktree():
    main, wt = located()
    base = project(P)["parent"]["base"]
    if not fetch(main, base):
        stop("fetch-failed", "cannot fetch %s from origin" % base, worktree=wt)
    assignee = claim(wt)
    tip = "origin/" + base
    prunable = listed(main, wt)
    saved = None
    if prunable:
        git(main, "worktree", "prune")
        git(main, "worktree", "add", "--detach", wt, tip)
        action = "recreated"
    elif prunable is False:
        changes = git(wt, *STATUS).splitlines()
        if not changes:
            action = "moved"
        else:
            if run("git", "-C", wt, "check-ignore", "-q", "work-reports/").returncode != 0:
                stop("not-ignored", "work-reports/ is not ignored in %s, and %s has uncommitted changes"
                     % (wt, wt), worktree=wt, assignee=assignee, changes=changes[:20])
            stamp = time.strftime("%Y-%m-%d-%H%M")
            os.makedirs(os.path.join(wt, "work-reports"), exist_ok=True)
            n, name = 1, "%s-discarded" % stamp
            while True:
                try:
                    os.mkdir(os.path.join(wt, "work-reports", name))
                    break
                except FileExistsError:
                    n += 1
                    name = "%s-discarded-%d" % (stamp, n)
            done = save_work(wt, os.path.join(wt, "work-reports", name, "stopped.diff"))
            saved = {k: done[k] for k in ("file", "head", "changes", "merge")}
            if done["left"] or done["errors"]:
                stop("not-clean", "%s is not clean after the save and the discard" % wt, worktree=wt, assignee=assignee, saved=saved,
                     left=done["left"], errors=done["errors"])
            action = "discarded"
        git(wt, "switch", "--detach", tip)
    elif os.path.lexists(wt):
        stop("foreign", "%s exists and is not a worktree of this clone" % wt, worktree=wt,
             assignee=assignee)
    else:
        git(main, "worktree", "add", "--detach", wt, tip)
        action = "created"
    emit(status="ready", worktree=wt, action=action, head=git(wt, "rev-parse", "HEAD").strip(),
         assignee=assignee, saved=saved)

def ignore():
    main, wt = located()
    if listed(main, wt) is not False:
        die("%s is no worktree of this clone. run.sh worktree %d first" % (wt, P))
    def missing():
        return [path for where, path in ((main, ".claude/worktrees/"), (wt, "work-reports/"))
                if run("git", "-C", where, "check-ignore", "-q", path).returncode != 0]
    not_ignored = missing()
    if not not_ignored:
        emit(status="ok", notIgnored=[], added=[])
    if "--add" not in ARGS:
        emit(status="ask", notIgnored=not_ignored)
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

STATUS = ("status", "--porcelain", "--untracked-files=normal")

def save_work(wt, target, since=None):
    if not os.path.isdir(os.path.dirname(target)):
        die("no such directory: " + os.path.dirname(target))
    if os.path.lexists(target):
        die("%s already exists" % target)
    real = os.path.join(os.path.realpath(os.path.dirname(target)), os.path.basename(target))
    if real.startswith(os.path.realpath(wt) + os.sep) \
            and run("git", "-C", wt, "check-ignore", "-q", real).returncode != 0:
        die("%s is inside %s and git does not ignore it there, so saving it would change the work it saves"
            % (target, wt))
    before = git(wt, *STATUS).splitlines()
    if not before and (since is None or int(git(wt, "rev-list", "--count", since + "..HEAD").strip()) == 0):
        return None
    head = since or git(wt, "rev-parse", "HEAD").strip()
    r = run("git", "-C", wt, "rev-parse", "--verify", "--quiet", "MERGE_HEAD")
    merge = r.stdout.strip() if r.returncode == 0 else None
    nested = []
    for entry in git(wt, "ls-files", "-z", "--others", "--exclude-standard", "--directory").split("\0"):
        if entry.endswith("/"):
            for root, dirs, _ in os.walk(os.path.join(wt, entry)):
                if ".git" in dirs or os.path.exists(os.path.join(root, ".git")):
                    nested.append(os.path.relpath(root, wt))
                    dirs[:] = []
                dirs[:] = [d for d in dirs if d != ".git"]
    excludes = [":(exclude,literal)" + d for d in nested]
    for args in (("add", "-A", "--", ".", *excludes),
                 ("diff-index", "--cached", "--binary", "-p", head, "--output=" + target)):
        r = run("git", "-C", wt, *args)
        if r.returncode != 0:
            run("git", "-C", wt, "reset")
            die("git %s failed: %s" % (" ".join(args[:2]), r.stderr.strip()))
    errors = discard(wt)
    left = git(wt, *STATUS).splitlines()
    return {"file": target, "head": head, "changes": before[:20], "merge": merge, "left": left[:20], "errors": errors}

def save():
    main, wt = located()
    if listed(main, wt) is not False:
        die("%s is no worktree of this clone. run.sh worktree %d first" % (wt, P))
    since = ARGS[3]
    if run("git", "-C", wt, "merge-base", "--is-ancestor", since + "^{commit}", "HEAD").returncode != 0:
        die("%s is no commit, or no ancestor of HEAD in %s" % (since, wt))
    since = git(wt, "rev-parse", since + "^{commit}").strip()
    commits = int(git(wt, "rev-list", "--count", since + "..HEAD").strip())
    r = run("git", "-C", wt, "symbolic-ref", "--quiet", "--short", "HEAD")
    branch = r.stdout.strip() if r.returncode == 0 else None
    done = save_work(wt, os.path.abspath(ARGS[1]), since)
    errors = done["errors"] if done else []
    for step, args in (("detach", ("switch", "--detach", since)),
                       ("branch", ("branch", "-D", branch) if branch else None)):
        if args is None:
            continue
        r = run("git", "-C", wt, *args)
        if r.returncode != 0:
            errors.append({"step": step, "message": r.stderr.strip()})
    if done is None:
        emit(status="clean", worktree=wt, branch=branch, commits=commits, errors=errors)
    emit(status="saved", worktree=wt, branch=branch, commits=commits, **{**done, "errors": errors})

def merge():
    k, m, comment = int(ARGS[0]), int(ARGS[1]), ARGS[3]
    wait = int(ARGS[5]) if ARGS[4:5] == ["--wait"] else 300
    require_marker(comment)
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
        if not fetch(main, b):
            stop("checks-unreadable", "cannot fetch %s from origin to read its workflows" % b, pr=m)
        workflow = pull_request_workflow(main, "origin/" + b, base)
        if workflow is None:
            stop("checks-unreadable", "cannot read the workflows on origin/%s" % b, pr=m)
        if found["requiredChecks"] != "no" or workflow:
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
                stop("no-checks", "%s requires a check, and none registered on #%d within %d seconds"
                     % (base, m, wait), pr=m)
        r = run("gh", "pr", "checks", str(m), "--watch", "--fail-fast")
        text = r.stdout + r.stderr
        if r.returncode != 0 and NO_CHECKS not in text:
            stop("checks-failed", "\n".join(text.strip().splitlines()[-5:]), pr=m)
        if pv.get("isDraft"):
            r = run("gh", "pr", "ready", str(m))
            if r.returncode != 0:
                stop("merge-failed", "cannot mark #%d ready: %s" % (m, r.stderr.strip()), pr=m)
        r = run("gh", "pr", "merge", str(m), "--" + method)
        if r.returncode != 0:
            stop("merge-failed", "cannot merge #%d: %s" % (m, r.stderr.strip()), pr=m)

    errors = []
    if issue["state"] == "CLOSED":
        closed = "already-closed"
    else:
        failed = close_issue(k, comment)
        if failed:
            errors.append({"step": "close", "message": failed})
            closed = "open"
        else:
            closed = "closed"

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

def stop_issue():
    k, why, comment = int(ARGS[0]), ARGS[1], ARGS[3]
    require_marker(comment)
    proj = project(P)
    if not any(i["number"] == k for i in proj["issues"]):
        stop("unknown-issue", "#%d is not a sub-issue of #%d" % (k, P), number=k)
    if why == "blocking":
        writes = [("sub", str(P), "--title", ARGS[7], "--blocking", str(k), "--label", "blocker", "--body", ARGS[5])]
    else:
        writes = {"decision": [("label", str(k), "--remove", "ready"), ("titles", str(P))],
                  "detail": [("label", str(k), "--add", "blocker", "--remove", "ready")],
                  "round-cap": []}[why]
    writes.append(("comment", str(k), "--body", comment))
    found = {}
    for write in writes:
        out = issue_write(*write)
        if write[0] == "sub" and "number" in out:
            found["stub"] = {"number": out["number"], "url": out["url"]}
        if out["status"] == "stop":
            if "reasons" in out:
                found["reasons"] = out["reasons"]
            stop(out["reason"], out["message"], step=write[0], **found)
    emit(status="stopped", number=k, **found)

def contains(where, ref, other):
    return run("git", "-C", where, "merge-base", "--is-ancestor", other, ref).returncode == 0

def sync():
    main, wt = located()
    if listed(main, wt) is not False:
        die("%s is no worktree of this clone. run.sh worktree %d first" % (wt, P))
    proj = project(P)
    parent, issues = proj["parent"], proj["issues"]
    base, frm = parent["base"], parent["from"]
    out = {"base": base, "from": frm}
    if parent["merged"]:
        stop("merged", "#%d is merged into %s" % (P, frm), **out)
    if not issues or any(i["state"] == "OPEN" for i in issues):
        stop("not-due", "#%d has open sub-issues, or none at all" % P, **out)
    if not parent["baseExists"]:
        stop("base-gone", "%s is gone from origin" % base, **out)
    if not fetch(main, base) or not fetch(main, frm):
        stop("fetch-failed", "cannot fetch %s and %s from origin" % (base, frm), **out)
    tip = git(wt, "rev-parse", "origin/" + base).strip()
    if "--push" in ARGS:
        if run("git", "-C", wt, "rev-parse", "--verify", "--quiet", "MERGE_HEAD").returncode == 0 \
                or git(wt, "status", "--porcelain").strip():
            stop("unfinished", "%s still holds an unfinished merge or uncommitted changes" % wt, **out)
        parents = git(wt, "rev-list", "--parents", "-n", "1", "HEAD").split()[1:]
        if len(parents) != 2 or parents[0] != tip or not contains(wt, "origin/" + frm, parents[1]):
            stop("not-the-merge", "HEAD is not a merge of origin/%s on the tip of origin/%s" % (frm, base), **out)
    else:
        if contains(wt, "origin/" + base, "origin/" + frm):
            emit(status="current", sha=tip, **out)
        if git(wt, "status", "--porcelain").strip():
            stop("dirty", "%s has uncommitted changes" % wt, worktree=wt, **out)
        git(wt, "switch", "--detach", "origin/" + base)
        r = run("git", "-C", wt, "merge", "--no-ff", "-m", "Merge %s into %s" % (frm, base), "origin/" + frm)
        if r.returncode != 0:
            files = git(wt, "diff", "--name-only", "--diff-filter=U").splitlines()
            if not files:
                run("git", "-C", wt, "merge", "--abort")
                die("git merge origin/%s failed: %s" % (frm, (r.stderr or r.stdout).strip()))
            emit(status="conflict", start=tip, files=files, **out)
    sha = git(wt, "rev-parse", "HEAD").strip()
    r = run("git", "-C", wt, "push", "--quiet", "origin", "HEAD:refs/heads/" + base)
    if r.returncode != 0:
        stop("push-rejected", "cannot push the merge to %s: %s" % (base, r.stderr.strip()), sha=sha, **out)
    fetch(main, base)
    emit(status="merged", sha=sha, **out)

def project_pr():
    body = ARGS[1]
    main, _ = located()
    proj = project(P)
    parent, issues = proj["parent"], proj["issues"]
    base, frm = parent["base"], parent["from"]
    out = {"base": base, "from": frm}
    if parent["merged"]:
        stop("merged", "#%d is merged into %s" % (P, frm), **out)
    if not issues or any(i["state"] == "OPEN" for i in issues):
        stop("not-due", "#%d has open sub-issues, or none at all" % P, **out)
    if not parent["baseExists"]:
        stop("base-gone", "%s is gone from origin" % base, **out)
    if not fetch(main, base) or not fetch(main, frm):
        stop("fetch-failed", "cannot fetch %s and %s from origin" % (base, frm), **out)
    if not contains(main, "origin/" + base, "origin/" + frm):
        stop("behind", "%s does not contain origin/%s. run.sh sync %d first" % (base, frm, P), **out)
    r = run("gh", "pr", "list", "--head", base, "--base", frm, "--state", "open", "--json", "number,url")
    if r.returncode != 0:
        die("cannot list the pull requests from %s: %s" % (base, r.stderr.strip()))
    found = sorted(json.loads(r.stdout), key=lambda p: p["number"])
    if found:
        emit(status="exists", pr=found[0]["number"], url=found[0]["url"], **out)
    r = run("gh", "pr", "create", "--base", frm, "--head", base, "--title", parent["title"], "--body-file", body)
    if r.returncode != 0:
        stop("create-failed", "cannot open the pull request from %s into %s: %s" % (base, frm, r.stderr.strip()),
             **out)
    url = r.stdout.strip().splitlines()[-1]
    m = re.search(r"/pull/(\d+)$", url)
    emit(status="opened", pr=int(m.group(1)) if m else None, url=url, **out)

{"start": start, "close": close, "worktree": worktree, "ignore": ignore, "branch": branch, "merge": merge,
 "sync": sync, "pr": project_pr, "save": save, "stop": stop_issue}[SUB]()
