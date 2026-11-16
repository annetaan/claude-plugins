#!/usr/bin/env python3
"""pr-humans.py: gather what the pr-humans skill needs, and post its comment.

Subcommands (each prints one JSON object on stdout; exit 2 is a usage error, 1 an unexpected failure):

  targets [N | A-B ...] [--project P] [--search Q] [--all] [--unrecorded]
      Resolve pull requests. Numbers and ranges name them directly. --project P takes the pull requests that close
      the sub-issues of parent issue P, and those from its base branch pj/P. --search Q passes Q to the GitHub
      search (for example "author:@me created:>=2026-10-01"). --all takes every pull request. --unrecorded keeps
      only those with no pr-humans comment, and alone it means --all --unrecorded.

  gather N --out DIR
      Write DIR/github.json (the pull request, its commits, reviews and comments, the issues it closes with their
      parents and the checkbox ticks in their edit history, each tick with the heading it sits under),
      DIR/sessions.json (the Claude Code sessions on this machine that touch it, with their working directories,
      the pull requests they linked in order, and what the human said and answered in each), DIR/reports.json (work
      report files that name it) and, only when this account already recorded the pull request, DIR/previous.md
      (that comment without its marker line). Runs of pr-humans itself are left out of the sessions' turns. Prints
      a summary, with "previous": true or false.

  sessions-of FILE
      Print the human turns of one session log, as gather does. For tests and for a look by hand.

  post N DIR
      Create the pr-humans comment on pull request N with the body in DIR/comment.md, or rewrite this account's own
      when there is one. Refuses (exit 3, status stop, problems named) a body that holds a local path, a session id
      or an @mention, or any path or id that DIR/sessions.json, DIR/reports.json, DIR itself or $HOME holds
      (local-path, session-id, mention), and when only another account recorded the pull request
      (recorded-by-other), and a DIR with no comment.md or an empty one (no-draft). In each case nothing is written.

Each pull request that targets lists comes with "recordedBy": "me", "other" or null (who left the marker comment);
"recorded" stays and means recordedBy is "me". --unrecorded keeps those with recordedBy null.

Environment: PR_HUMANS_PROJECTS overrides ~/.claude/projects (tests).
"""

import glob
import json
import os
import re
import subprocess
import sys

MARKER = "<!-- annetaan:pr-humans -->"
MARKER_LINE = re.compile(r"^[ \t]*" + re.escape(MARKER) + r"[ \t]*\r?\n?", re.M)
CLAUDE_TRAILER = re.compile(r"^Co-Authored-By:\s*Claude\b", re.I | re.M)
CLAUDE_FOOTER = re.compile(r"Generated with \[?Claude Code", re.I)
CHECKBOX = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s+(.*\S)\s*$")
HEADING = re.compile(r" {0,3}#{1,6}(\s|$)")
TEXT_CAP = 1500


def die(msg, code=2):
    print(msg, file=sys.stderr)
    sys.exit(code)


def out(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=1))


def run(args, check=True):
    p = subprocess.run(args, capture_output=True, text=True)
    if check and p.returncode != 0:
        die(f"{' '.join(args[:3])}: {p.stderr.strip()}", 1)
    return p.stdout


def gh_json(args):
    return json.loads(run(["gh"] + args) or "null")


def graphql(query, tolerate=False, **variables):
    """Run a GraphQL query. With tolerate, a NOT_FOUND error leaves its field null instead of stopping."""
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for k, v in variables.items():
        args += ["-F" if isinstance(v, int) else "-f", f"{k}={v}"]
    p = subprocess.run(args, capture_output=True, text=True)
    try:
        d = json.loads(p.stdout or "{}")
    except ValueError:
        die(f"gh api graphql: {p.stderr.strip()}", 1)
    errors = d.get("errors") or []
    if tolerate:
        errors = [e for e in errors if e.get("type") != "NOT_FOUND"]
    if errors or (p.returncode != 0 and not d.get("data")):
        die(json.dumps(errors, ensure_ascii=False) if errors else p.stderr.strip(), 1)
    return d.get("data")


def repo():
    r = gh_json(["repo", "view", "--json", "nameWithOwner"])["nameWithOwner"]
    owner, name = r.split("/", 1)
    return owner, name


def cap(s, n=TEXT_CAP):
    s = s or ""
    return s if len(s) <= n else s[:n] + f" …[{len(s) - n} more chars]"


# ---------------------------------------------------------------- targets


def recorded_by(comments, me):
    """Who left the pr-humans comment: "me" when this account did (also when another did too), "other" when only
    others did, None when nobody did. comments are GraphQL nodes {author{login} body}; the login alone decides."""
    marked = [c for c in comments if MARKER in (c.get("body") or "")]
    if any(((c.get("author") or {}).get("login")) == me for c in marked):
        return "me"
    return "other" if marked else None


def recorded_map(owner, name, numbers=None):
    """number -> {number, title, state, url, recordedBy, recorded}."""
    me = None
    q = """query($owner:String!,$name:String!,$after:String){viewer{login} repository(owner:$owner,name:$name){
      pullRequests(first:50,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){
        pageInfo{hasNextPage endCursor}
        nodes{number title state url comments(last:100){nodes{author{login} body}}}}}}"""
    if numbers is not None:
        res = {}
        for n in numbers:  # issueOrPullRequest, so that an issue number inside a range is no error
            d = graphql("""query($owner:String!,$name:String!,$n:Int!){viewer{login}
              repository(owner:$owner,name:$name){
              issueOrPullRequest(number:$n){__typename ... on PullRequest{
                number title state url comments(last:100){nodes{author{login} body}}}}}}""",
                        owner=owner, name=name, n=n, tolerate=True)
            me = ((d or {}).get("viewer") or {}).get("login") or me
            d = ((d or {}).get("repository") or {}).get("issueOrPullRequest") or {}
            if d.get("__typename") == "PullRequest":
                res[n] = d
        nodes = res.values()
    else:
        nodes, after = [], None
        while True:
            vars_ = dict(owner=owner, name=name)
            if after:
                vars_["after"] = after
            data = graphql(q, **vars_)
            me = (data.get("viewer") or {}).get("login") or me
            page = data["repository"]["pullRequests"]
            nodes += page["nodes"]
            if not page["pageInfo"]["hasNextPage"]:
                break
            after = page["pageInfo"]["endCursor"]
    res = {}
    for p in nodes:
        by = recorded_by(p["comments"]["nodes"], me)
        res[p["number"]] = {"number": p["number"], "title": p["title"], "state": p["state"], "url": p["url"],
                            "recordedBy": by, "recorded": by == "me"}
    return res


def project_prs(owner, name, parent):
    """The pull requests of project P: into and out of its base branch pj/P (pj4-running), and those that close one
    of its sub-issues."""
    d = graphql("""query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){
      issue(number:$n){subIssues(first:50){nodes{number
        closedByPullRequestsReferences(first:10,includeClosedPrs:true){nodes{number}}}}}}}""",
                owner=owner, name=name, n=parent, tolerate=True)
    issue = ((d or {}).get("repository") or {}).get("issue")
    if issue is None:
        die(f"#{parent} is not an issue", 1)
    nums = set()
    for sub in issue["subIssues"]["nodes"]:
        nums |= {p["number"] for p in sub["closedByPullRequestsReferences"]["nodes"]}
    for flag in ("--base", "--head"):
        for p in gh_json(["pr", "list", "--state", "all", "--limit", "200", flag, f"pj/{parent}",
                          "--json", "number"]) or []:
            nums.add(p["number"])
    return nums


def cmd_targets(argv):
    numbers, project, search, all_, unrecorded = set(), None, None, False, False
    it = iter(argv)
    for a in it:
        if a == "--project":
            project = int(next(it, "0").lstrip("#") or 0) or die("--project needs a number")
        elif a == "--search":
            search = next(it, None) or die("--search needs a query")
        elif a == "--all":
            all_ = True
        elif a == "--unrecorded":
            unrecorded = True
        elif re.fullmatch(r"#?\d+", a):
            numbers.add(int(a.lstrip("#")))
        elif re.fullmatch(r"#?\d+-#?\d+", a):
            lo, hi = (int(x.lstrip("#")) for x in a.split("-"))
            numbers |= set(range(min(lo, hi), max(lo, hi) + 1))
        else:
            die(f"unknown argument: {a}")
    if not (numbers or project or search or all_):
        if not unrecorded:
            die("name pull requests, --project, --search, --all or --unrecorded")
        all_ = True
    owner, name = repo()
    if project:
        numbers |= project_prs(owner, name, project)
    if search:
        found = gh_json(["pr", "list", "--state", "all", "--limit", "1000", "--search", search, "--json", "number"])
        numbers |= {p["number"] for p in found or []}
    info = recorded_map(owner, name, None if all_ else sorted(numbers))
    if all_:
        chosen = info
    else:
        chosen = {n: info[n] for n in numbers if n in info}
    missing = sorted(n for n in numbers if n not in info)  # issues inside a range, or numbers that do not exist
    prs = sorted(chosen.values(), key=lambda p: p["number"])
    if unrecorded:
        prs = [p for p in prs if p["recordedBy"] is None]
    out({"repo": f"{owner}/{name}", "prs": prs, "notPullRequests": missing})


# ---------------------------------------------------------------- github


def boxes_of(body):
    """(nearest heading above, box text) -> checked, for each box in a body. The heading is the last line that
    starts with # above the box, without the # and the space."""
    res, heading = {}, ""
    for line in body.splitlines():
        if HEADING.match(line):
            heading = re.sub(r"^\s*#+\s*", "", line).strip()
            continue
        m = CHECKBOX.match(line)
        if m:
            res[(heading, m.group(2))] = m.group(1) != " "
    return res


def checkbox_events(edits):
    """From the full-body revisions of an issue (newest first), the boxes that changed between two revisions. A box is
    told by its heading and its text, so the same option under two decisions is two boxes, and each changed or
    addedChecked entry says which decision it sits under. onlyBoxes is true when nothing but box states changed: an
    edit like that is a tick in the GitHub UI."""
    revs = list(reversed(edits))
    events = []
    for prev, cur in zip(revs, revs[1:]):
        a, b = prev.get("diff") or "", cur.get("diff") or ""
        ba, bb = boxes_of(a), boxes_of(b)
        changed = [{"box": t, "checked": v, "under": h} for (h, t), v in bb.items() if (h, t) in ba and ba[(h, t)] != v]
        added_checked = [{"box": t, "checked": True, "under": h} for (h, t), v in bb.items() if (h, t) not in ba and v]
        if not changed and not added_checked:
            continue
        def strip(s):
            return re.sub(r"^(\s*[-*]\s+)\[[ xX]\]", r"\1[]", s, flags=re.M)
        events.append({"editor": (cur.get("editor") or {}).get("login"), "at": cur.get("editedAt"),
                       "onlyBoxes": strip(a) == strip(b), "changed": changed, "addedChecked": added_checked})
    return events


ISSUE_FIELDS = """number title url state author{login} body
  labels(first:10){nodes{name}}
  userContentEdits(first:100){nodes{editor{login} editedAt diff}}
  comments(first:50){nodes{author{login} body createdAt}}"""


def issue_view(i):
    edits = i["userContentEdits"]["nodes"]
    return {"number": i["number"], "title": i["title"], "url": i["url"], "state": i["state"],
            "author": (i["author"] or {}).get("login"), "labels": [l["name"] for l in i["labels"]["nodes"]],
            "body": cap(i["body"], 30000), "edits": len(edits),
            "checkboxEvents": checkbox_events(edits),
            "comments": [{"author": (c["author"] or {}).get("login"), "at": c["createdAt"], "body": cap(c["body"]),
                          "claude": bool(CLAUDE_FOOTER.search(c["body"] or ""))} for c in i["comments"]["nodes"]]}


LINK = re.compile(r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|implements?|part of|refs?)\s*:?\s+#(\d+)", re.I)


def linked_issues(owner, name, pr):
    """The issues a pull request works on: those it closes, those its body names after Implements, Part of, Closes,
    Fixes, Resolves or Refs, and a (#N) in its title. A pull request into a base branch pj/P closes nothing on
    GitHub, so the body is what links it. Each issue comes with its parent; an issue that is the parent of
    another one in the list is not listed again."""
    nums = {i["number"] for i in pr["closingIssuesReferences"]["nodes"]}
    nums |= {int(m) for m in LINK.findall(pr["body"] or "")}
    nums |= {int(m) for m in re.findall(r"\(#(\d+)\)", pr["title"] or "")}
    nums.discard(pr["number"])
    issues = []
    for n in sorted(nums):
        d = graphql(f"""query($owner:String!,$name:String!,$n:Int!){{repository(owner:$owner,name:$name){{
          issue(number:$n){{{ISSUE_FIELDS} parent{{{ISSUE_FIELDS}}}}}}}}}""", owner=owner, name=name, n=n,
                    tolerate=True)
        i = ((d or {}).get("repository") or {}).get("issue")
        if not i:
            continue
        v = issue_view(i)
        v["parent"] = issue_view(i["parent"]) if i.get("parent") else None
        issues.append(v)
    parents = {i["parent"]["number"] for i in issues if i["parent"]}
    return [i for i in issues if i["number"] not in parents]


def github(owner, name, n):
    """The pull request as the record's input, and with it the raw comments (marker comments too) and the login of
    this account, which write_previous needs."""
    data = graphql(f"""query($owner:String!,$name:String!,$n:Int!){{viewer{{login}} repository(owner:$owner,name:$name){{
      pullRequest(number:$n){{number title url state merged mergedAt closedAt createdAt
        author{{login}} mergedBy{{login}} headRefName baseRefName body
        commits(first:100){{nodes{{commit{{oid messageHeadline message committedDate parents{{totalCount}}
          authors(first:5){{nodes{{name user{{login}}}}}}}}}}}}
        reviews(first:50){{nodes{{author{{login}} state body submittedAt
          comments(first:50){{nodes{{path body}}}}}}}}
        comments(first:100){{nodes{{author{{login}} body createdAt}}}}
        closingIssuesReferences(first:10){{nodes{{number}}}}
        timelineItems(first:100,itemTypes:[CLOSED_EVENT,MERGED_EVENT,REOPENED_EVENT,READY_FOR_REVIEW_EVENT,
          REVIEW_REQUESTED_EVENT,LABELED_EVENT]){{nodes{{__typename
          ... on ClosedEvent{{actor{{login}} createdAt}} ... on MergedEvent{{actor{{login}} createdAt}}
          ... on ReopenedEvent{{actor{{login}} createdAt}} ... on ReadyForReviewEvent{{actor{{login}} createdAt}}
          ... on LabeledEvent{{actor{{login}} createdAt label{{name}}}}}}}}}}}}}}""",
                 owner=owner, name=name, n=n)
    pr, me = data["repository"]["pullRequest"], (data.get("viewer") or {}).get("login")
    if pr is None:
        die(f"#{n} is not a pull request", 1)
    commits = []
    for c in pr["commits"]["nodes"]:
        c = c["commit"]
        commits.append({"oid": c["oid"][:7], "headline": c["messageHeadline"], "at": c["committedDate"],
                        "authors": [a["name"] for a in c["authors"]["nodes"]],
                        "merge": c["parents"]["totalCount"] > 1,
                        "claude": bool(CLAUDE_TRAILER.search(c["message"] or ""))})
    issues = linked_issues(owner, name, pr)
    view = {
        "number": pr["number"], "title": pr["title"], "url": pr["url"], "state": pr["state"],
        "merged": pr["merged"], "createdAt": pr["createdAt"], "mergedAt": pr["mergedAt"], "closedAt": pr["closedAt"],
        "author": (pr["author"] or {}).get("login"), "mergedBy": (pr["mergedBy"] or {}).get("login"),
        "head": pr["headRefName"], "base": pr["baseRefName"], "body": cap(pr["body"], 30000),
        "commits": commits,
        # A merge commit carries no trailer whoever made it (workflow merges the base to resolve a conflict), so it
        # is never counted as a human's commit on its own.
        "humanCommits": [c for c in commits if not c["claude"] and not c["merge"]],
        "reviews": [{"author": (r["author"] or {}).get("login"), "state": r["state"], "at": r["submittedAt"],
                     "body": cap(r["body"]), "claude": bool(CLAUDE_FOOTER.search(r["body"] or "")),
                     "comments": [{"path": c["path"], "body": cap(c["body"], 600)} for c in r["comments"]["nodes"]]}
                    for r in pr["reviews"]["nodes"]],
        "comments": [{"author": (c["author"] or {}).get("login"), "at": c["createdAt"], "body": cap(c["body"]),
                      "claude": bool(CLAUDE_FOOTER.search(c["body"] or ""))}
                     for c in pr["comments"]["nodes"] if MARKER not in (c["body"] or "")],
        "events": [{k: (v.get("login") if isinstance(v, dict) and "login" in v else
                        v.get("name") if isinstance(v, dict) else v) for k, v in e.items()}
                   for e in pr["timelineItems"]["nodes"]],
        "issues": issues,
    }
    return view, pr["comments"]["nodes"], me


def previous_body(comments, me):
    """The last pr-humans comment of this account, without its marker line; None when there is none."""
    mine = [c for c in comments if MARKER in (c.get("body") or "") and (c.get("author") or {}).get("login") == me]
    return MARKER_LINE.sub("", mine[-1]["body"], count=1).strip() + "\n" if mine else None


def write_previous(comments, me, out_dir):
    """Write out_dir/previous.md from comments (GraphQL nodes) and say whether there was one. A previous.md left by
    an earlier gather is removed when there is none now."""
    path = os.path.join(out_dir, "previous.md")
    body = previous_body(comments, me)
    if body is None:
        if os.path.exists(path):
            os.remove(path)
        return False
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return True


# ---------------------------------------------------------------- sessions

SKIP_PREFIXES = ("Another Claude session sent a message", "<task-notification>", "<local-command-",
                 "Caveat: The messages below", "This session is being continued from a previous conversation")


def strip_reminders(s):
    return re.sub(r"<system-reminder>.*?</system-reminder>", "", s, flags=re.S).strip()


def human_turns(path):
    """What the human did in one session: messages typed, commands invoked, questions answered, tool calls refused.
    A run of pr-humans is no part of a pull request's history: from the command (or from the Skill call that answers a
    plain request for it, which also takes back the message that asked) until the next message typed or the next
    command of another kind, nothing is added to turns or talk."""
    turns, meta = [], {"entrypoint": None, "cwd": None, "branches": set(), "prLinks": [], "first": None,
                       "last": None, "cwds": set()}
    talk, in_run = [], False  # talk is the conversation's own text
    last_msg = None  # (position in turns, position in talk) of the last message turn
    try:
        f = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return meta, turns
    with f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if not isinstance(e, dict):
                continue
            t = e.get("type")
            if t == "pr-link":
                meta["prLinks"].append({"repo": e.get("prRepository"), "number": e.get("prNumber"),
                                        "at": e.get("timestamp")})
                continue
            if t not in ("user", "assistant") or e.get("isSidechain"):
                continue
            ts = e.get("timestamp")
            meta["first"] = meta["first"] or ts
            meta["last"] = ts or meta["last"]
            meta["entrypoint"] = meta["entrypoint"] or e.get("entrypoint")
            meta["cwd"] = meta["cwd"] or e.get("cwd")
            if not in_run:  # a run of pr-humans says nothing of where the work was done
                if e.get("cwd"):
                    meta["cwds"].add(e["cwd"])
                if e.get("gitBranch"):
                    meta["branches"].add(e["gitBranch"])
            content = (e.get("message") or {}).get("content")
            if t == "assistant":
                if not isinstance(content, list):
                    continue
                if any(isinstance(p, dict) and p.get("type") == "tool_use" and p.get("name") == "Skill"
                       and "pr-humans" in str((p.get("input") or {}).get("skill")) for p in content):
                    if not in_run and last_msg:  # the request that started this run is no part of the history
                        del turns[last_msg[0]]
                        del talk[last_msg[1]]
                        last_msg = None
                    in_run = True
                if not in_run:
                    talk += [p.get("text") or "" for p in content if isinstance(p, dict) and p.get("type") == "text"]
                continue
            if e.get("isMeta"):
                continue
            tur = e.get("toolUseResult")
            if isinstance(tur, dict) and isinstance(tur.get("answers"), dict):
                if in_run:
                    continue
                turns.append({"at": ts, "kind": "answer",
                              "answers": [{"question": cap(q, 400), "answer": cap(a, 400)}
                                          for q, a in tur["answers"].items()],
                              "notes": {cap(k, 200): cap(v.get("notes"), 400) for k, v in
                                        (tur.get("annotations") or {}).items() if isinstance(v, dict) and v.get("notes")}})
                continue
            if isinstance(content, list):
                texts = []
                for part in content:
                    if not isinstance(part, dict):
                        continue
                    if part.get("type") == "text":
                        texts.append(part.get("text") or "")
                    elif part.get("type") == "tool_result":
                        body = part.get("content")
                        body = body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)
                        if not in_run and ("doesn't want to proceed" in body or "user rejected" in body.lower()
                                           or "the user said:" in body.lower()):
                            turns.append({"at": ts, "kind": "refusal", "text": cap(strip_reminders(body), 800)})
                text = strip_reminders("\n".join(texts))
            elif isinstance(content, str):
                text = strip_reminders(content)
            else:
                continue
            if not text or text.startswith(SKIP_PREFIXES):
                continue
            m = re.search(r"<command-name>(.*?)</command-name>", text, re.S)
            if m:
                in_run = "pr-humans" in m.group(1)
                if not in_run:
                    args = re.search(r"<command-args>(.*?)</command-args>", text, re.S)
                    turns.append({"at": ts, "kind": "command", "command": m.group(1).strip(),
                                  "args": cap((args.group(1) if args else "").strip(), 800)})
                    talk.append(args.group(1) if args else "")
                    last_msg = None  # a command since: a later Skill call no longer takes that message back
                continue
            if text.startswith("[Request interrupted"):
                if not in_run:
                    turns.append({"at": ts, "kind": "interrupt"})
                continue
            if text.startswith("<") and re.match(r"<[a-z-]+>", text) and not re.search(r"[^\s<>]", re.sub(
                    r"<[^>]+>.*?</[^>]+>", "", text, flags=re.S)):
                continue  # only harness tags
            in_run = False
            last_msg = (len(turns), len(talk))
            talk.append(text)
            turns.append({"at": ts, "kind": "message", "text": cap(text)})
    meta["talk"] = "\n".join(talk)
    meta["cwds"] = sorted(meta["cwds"])
    meta["branches"] = sorted(meta["branches"])
    return meta, turns


def find_sessions(pr, repo_full, root):
    base = os.environ.get("PR_HUMANS_PROJECTS") or os.path.expanduser("~/.claude/projects")
    pr_url = pr["url"]
    issue_urls = []
    for i in pr["issues"]:
        issue_urls.append(i["url"])
        if i.get("parent"):
            issue_urls.append(i["parent"]["url"])
    found = []
    for path in glob.glob(os.path.join(base, "*", "*.jsonl")):
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                raw = f.read()
        except OSError:
            continue
        named = [u for u in [pr_url] + issue_urls if re.search(re.escape(u) + r"(?!\d)", raw)]
        if not named and not re.search(r'"prNumber":\s*%d\b' % pr["number"], raw) \
                and not (pr["head"] and pr["head"] in raw):
            continue
        meta, turns = human_turns(path)
        talk, cwds = meta.pop("talk"), meta["cwds"]
        why = []
        if any(l["repo"] == repo_full and l["number"] == pr["number"] for l in meta["prLinks"]):
            why.append("created-pr")
        if root and pr["head"] in meta["branches"] and any(c == root or c.startswith(root + "/") for c in cwds):
            why.append("on-branch")
        # A URL counts only where the human or Claude wrote it in the conversation outside a pr-humans run, so that
        # a session that only records this pull request, or only read it in a tool, is not taken for its history.
        for u in named:
            if re.search(re.escape(u) + r"(?!\d)", talk):
                why.append("names-pr" if u == pr_url else "names-issue " + u.rsplit("/", 1)[-1])
        if not why:
            continue
        if why == ["on-branch"] and not turns:  # only a run of pr-humans was there (its command line counts as a row)
            continue
        found.append({"file": path, "session": os.path.basename(path)[:-6], "why": why, **meta,
                      "turns": turns})
    found.sort(key=lambda s: s["first"] or "")
    return found


def find_reports(pr, root):
    hits = []
    if not root:
        return hits
    dirs = glob.glob(os.path.join(root, "work-reports", "*")) + \
        glob.glob(os.path.join(root, ".claude", "worktrees", "*", "work-reports", "*"))
    for d in dirs:
        for f in glob.glob(os.path.join(d, "**", "*.md"), recursive=True):
            try:
                text = open(f, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            if pr["url"] in text or (pr["head"] and pr["head"] in text) or re.search(
                    r"(?<![\w/])#%d(?!\d)" % pr["number"], text):
                hits.append({"file": f, "size": len(text)})
    return hits


def cmd_gather(argv):
    if len(argv) != 3 or argv[1] != "--out" or not re.fullmatch(r"#?\d+", argv[0]):
        die("usage: gather N --out DIR")
    n, out_dir = int(argv[0].lstrip("#")), argv[2]
    owner, name = repo()
    root = run(["git", "rev-parse", "--show-toplevel"], check=False).strip() or None
    if root:  # the main working tree, also when run inside a worktree
        common = run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], check=False).strip()
        if common.endswith("/.git"):
            root = common[:-5]
    pr, raw_comments, me = github(owner, name, n)
    sessions = find_sessions(pr, f"{owner}/{name}", root)
    reports = find_reports(pr, root)
    os.makedirs(out_dir, exist_ok=True)
    for fname, data in (("github.json", pr), ("sessions.json", sessions), ("reports.json", reports)):
        with open(os.path.join(out_dir, fname), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
    previous = write_previous(raw_comments, me, out_dir)
    out({"number": n, "title": pr["title"], "state": pr["state"], "url": pr["url"], "dir": out_dir,
         "previous": previous,
         "issues": [i["number"] for i in pr["issues"]],
         "parents": sorted({i["parent"]["number"] for i in pr["issues"] if i.get("parent")}),
         "humanCommits": len(pr["humanCommits"]), "sessions": len(sessions),
         "humanTurns": sum(len(s["turns"]) for s in sessions), "reports": len(reports)})


def cmd_sessions_of(argv):
    if len(argv) != 1:
        die("usage: sessions-of FILE")
    meta, turns = human_turns(argv[0])
    meta.pop("talk")
    meta.pop("cwds")
    out({**meta, "turns": turns})


# ---------------------------------------------------------------- post


GENERIC_PATH = re.compile(r"(/Users/|/home/|~/\.claude|\.claude/projects|[A-Za-z]:\\Users|/var/folders/|/private/var/|"
                          r"/private/tmp/|/tmp/)")


def _load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def known_values(dir_):
    """The values that must not appear in a comment because they came from this machine: {value: problem}. They are
    $HOME, DIR and its realpath, each session's cwd, cwds, file and id, and each report's file and its directory.
    A value shorter than four characters, and "/", say nothing and are left out."""
    known = {}

    def add(v, kind="local-path"):
        if isinstance(v, str) and len(v) >= 4 and v != "/":
            known.setdefault(v, kind)

    add(os.path.expanduser("~"))
    add(os.path.abspath(dir_))
    add(os.path.realpath(dir_))
    sessions = _load(os.path.join(dir_, "sessions.json"))
    for s in sessions if isinstance(sessions, list) else []:
        if not isinstance(s, dict):
            continue
        add(s.get("cwd"))
        for c in s.get("cwds") or []:
            add(c)
        add(s.get("file"))
        add(s.get("session"), "session-id")
    reports = _load(os.path.join(dir_, "reports.json"))
    for r in reports if isinstance(reports, list) else []:
        if isinstance(r, dict) and isinstance(r.get("file"), str):
            add(r["file"])
            add(os.path.dirname(r["file"]))
    return known


def lint(body, known=None):
    """What must never reach a public comment: a local path, a session file or id, and an @mention that notifies
    someone. known is what this machine holds (known_values, or a list of paths); the patterns catch the same
    kinds of thing that are not in it."""
    problems, hit = [], set()
    items = known.items() if isinstance(known, dict) else [(v, "local-path") for v in known or []]
    for v, kind in items:
        if not isinstance(v, str) or len(v) < 4 or v == "/":
            continue
        if kind == "session-id":
            found = re.search(r"(?<![\w-])" + re.escape(v) + r"(?![\w-])", body)
        else:
            found = v in body
        if found:
            hit.add(kind)
    if "local-path" in hit or GENERIC_PATH.search(body):
        problems.append("local-path")
    if "session-id" in hit or re.search(
            r"\.jsonl\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", body):
        problems.append("session-id")
    prose = re.sub(r"`[^`\n]*`", "", body)
    if re.search(r"(?<![\w`/.-])@[A-Za-z0-9][A-Za-z0-9-]*", prose):
        problems.append("mention")
    return problems


def pick_record(comments, me):
    """From the REST comments of a pull request: (mine, others), the pr-humans comments of this account and those of
    others. Comments without the marker are not looked at."""
    marked = [c for c in comments or [] if MARKER in (c.get("body") or "")]
    mine = [c for c in marked if (c.get("user") or {}).get("login") == me]
    return mine, [c for c in marked if c not in mine]


def cmd_post(argv):
    if len(argv) != 2 or not re.fullmatch(r"#?\d+", argv[0]):
        die("usage: post N DIR")
    n = int(argv[0].lstrip("#"))
    dir_ = argv[1]
    if not os.path.isdir(dir_):
        die(f"usage: post N DIR (not a directory: {dir_})")
    try:
        body = open(os.path.join(dir_, "comment.md"), encoding="utf-8").read().strip()
    except OSError:
        body = ""
    if not body:  # the writer did not leave a draft: this pull request is left out, the others go on
        out({"number": n, "status": "stop", "problems": ["no-draft"]})
        sys.exit(3)
    problems = lint(body, known_values(dir_))
    if problems:
        out({"number": n, "status": "stop", "problems": problems})
        sys.exit(3)
    if MARKER not in body:
        body = MARKER + "\n" + body
    owner, name = repo()
    me = gh_json(["api", "user"])["login"]
    comments = gh_json(["api", "--paginate", "--slurp", f"repos/{owner}/{name}/issues/{n}/comments?per_page=100"])
    comments = [c for page in comments for c in page] if comments and isinstance(comments[0], list) else comments
    mine, others = pick_record(comments, me)
    if not mine and others:  # another account's record is theirs to rewrite, not ours to duplicate
        out({"number": n, "status": "stop", "problems": ["recorded-by-other"]})
        sys.exit(3)
    payload = json.dumps({"body": body})
    if mine:
        c = mine[-1]
        res = json.loads(subprocess.run(["gh", "api", "-X", "PATCH", f"repos/{owner}/{name}/issues/comments/{c['id']}",
                                         "--input", "-"], input=payload, capture_output=True, text=True,
                                        check=True).stdout)
        action = "updated"
    else:
        res = json.loads(subprocess.run(["gh", "api", "-X", "POST", f"repos/{owner}/{name}/issues/{n}/comments",
                                         "--input", "-"], input=payload, capture_output=True, text=True,
                                        check=True).stdout)
        action = "created"
    out({"number": n, "action": action, "url": res.get("html_url")})


def main():
    if len(sys.argv) < 2:
        die(__doc__)
    cmd, argv = sys.argv[1], sys.argv[2:]
    fn = {"targets": cmd_targets, "gather": cmd_gather, "sessions-of": cmd_sessions_of, "post": cmd_post}.get(cmd)
    if not fn:
        die(f"unknown subcommand: {cmd}\n{__doc__}")
    try:
        fn(argv)
    except subprocess.CalledProcessError as e:
        die(f"{' '.join(e.cmd[:4])}: {(e.stderr or '').strip()}", 1)


if __name__ == "__main__":
    main()
