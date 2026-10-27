#!/usr/bin/env bash
# Reads one project (a parent issue and its sub-issues) from GitHub and prints it as JSON.
# Read-only on GitHub. --check also fetches the branch the base was made from, and the base branch once it exists,
# with `git fetch origin`, which moves local refs only.
# It derives the projects a project waits on from the parents of its sub-issues' blockers (dependsOn), whether its
# base branch exists on origin (baseExists), and whether a project is merged into the branch it was made from.
# The shape it reads is described in ../format.md.
# This script is the only place that parses a sub-issue body (## Design, ## Acceptance criteria, ## Decisions),
# the parent's Base: line (the base branch and the branch it was made from) and its ## Order list, and the Implements
# head of a pull request.
# It also derives the title a sub-issue should carry, with its decision count (wantedTitle).
set -euo pipefail

die() { echo "project: $*" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
usage: project.sh [-R <owner/repo>] <parent>               the whole project, as JSON
       project.sh [-R <owner/repo>] <parent> --order       the run order, and the ## Order list to write, as JSON
       project.sh [-R <owner/repo>] <parent> --check <n>   whether sub-issue <n> can be implemented from its body now
       project.sh --lint <file|->                          lint one sub-issue body, read from a file or standard input
  -R <owner/repo>   read another repository (default: the repository of the current directory)
--order exits non-zero and names the cycle when the blocked-by relationships have one,
        or when the projects wait on each other.
--check runs inside a clone of the repository. It fetches the branch the base was made from,
        and the base branch once it exists.
--lint touches neither GitHub nor git and always exits 0.
USAGE
  exit 1
}

REPO=""; MODE="project"; PARENT=""; TARGET=""; LINT_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    -R|--repo) [ $# -ge 2 ] || usage; REPO="$2"; shift 2 ;;
    --order)   MODE="order"; shift ;;
    --check)   [ $# -ge 2 ] || usage; MODE="check"; TARGET="$2"; shift 2 ;;
    --lint)    [ $# -ge 2 ] || usage; MODE="lint"; LINT_FILE="$2"; shift 2 ;;
    -h|--help) usage ;;
    -?*)       die "unknown option: $1" ;;
    *)         [ -z "$PARENT" ] || die "one parent issue at a time"; PARENT="$1"; shift ;;
  esac
done

command -v python3 >/dev/null 2>&1 || die "python3 is not installed"

read -r -d '' PY <<'PY' || true
import json, re, subprocess, sys

MODE = sys.argv[1]

SECTIONS = ["Goal", "Design", "Acceptance criteria", "Decisions", "Out of scope"]
ENTRY_RE = re.compile(r"^\s*[-*]\s+`([^`]+)`\s+\((added|changed|deleted)\):\s*(.+)$")
IDENT_RE = re.compile(r"^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$")
OPTION_RE = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s")
BASE_RE = re.compile(r"^Base:\s*`?([^`\s]+)`?\s+from\s+`?([^`\s]+)`?\s*$")
ORDER_RE = re.compile(r"^\s*\d+\.\s+#(\d+)\b")
IMPLEMENTS_RE = re.compile(r"^Implements #(\d+)\s*$")
COUNT_RE = re.compile(r"(\s*\(\d+/\d+\))+\s*$")

def die(msg):
    print("project: " + msg, file=sys.stderr)
    sys.exit(1)

def unfenced(text):
    """The lines of text outside code fences."""
    fence = False
    for line in (text or "").replace("\r\n", "\n").split("\n"):
        if line.lstrip().startswith("```"):
            fence = not fence
            continue
        if not fence:
            yield line

def base_of(body):
    """The base branch and the branch it was made from, as the Base: line among the unfenced lines before the
    first ## heading names them, or None."""
    for line in unfenced(body):
        if line.startswith("## "):
            break
        m = BASE_RE.match(line)
        if m:
            return m.group(1), m.group(2)
    return None

def order_of(body):
    """The issue numbers of the numbered list under the parent's ## Order, in the order written."""
    _, secs = split_sections(body)
    out = []
    for line in secs.get("Order", "").split("\n"):
        m = ORDER_RE.match(line)
        if m:
            out.append(int(m.group(1)))
    return out

def implements(body):
    """The issue number in a pull request's head, the first line with any text on it, or None."""
    for line in (body or "").replace("\r\n", "\n").split("\n"):
        if line.strip():
            m = IMPLEMENTS_RE.match(line)
            return int(m.group(1)) if m else None
    return None

def run(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True)

def graphql(fields, ints=None, strs=None, what="read the repository"):
    """Run one GraphQL query on the repository and return its repository object. ints and strs are the variables,
    passed with gh's -F and -f, and declared as Int! and String!. Dies when the query fails."""
    ints, strs = ints or {}, strs or {}
    decls = ["$owner: String!", "$name: String!"]
    decls += ["$%s: Int!" % k for k in ints] + ["$%s: String!" % k for k in strs]
    cmd = ["gh", "api", "graphql", "-f", "owner=" + owner, "-f", "name=" + name]
    for k, v in ints.items():
        cmd += ["-F", "%s=%d" % (k, v)]
    for k, v in strs.items():
        cmd += ["-f", "%s=%s" % (k, v)]
    cmd += ["-f", "query=query(%s) { repository(owner: $owner, name: $name) { %s } }" % (", ".join(decls), fields)]
    q = run(*cmd)
    if q.returncode != 0:
        die("cannot %s: %s" % (what, q.stderr.strip()))
    return json.loads(q.stdout)["data"]["repository"]

def split_sections(body):
    """The ## headings in order, and the text under each."""
    order, out, name = [], {}, None
    for line in unfenced(body):
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m and not line.startswith("###"):
            name = m.group(1)
            order.append(name)
            out[name] = []
            continue
        if name is not None:
            out[name].append(line)
    return order, {k: "\n".join(v).strip() for k, v in out.items()}

def symbols_of(desc):
    """Backticked identifiers in an entry's description. foo() counts as foo, A.b as b."""
    out = []
    for span in re.findall(r"`([^`\n]+)`", desc):
        span = re.sub(r"\(.*\)$", "", span.strip())
        if IDENT_RE.match(span):
            sym = span.split(".")[-1]
            if sym not in out:
                out.append(sym)
    return out

def file_list(design):
    """The bullet list that opens ## Design. Returns (files, malformed entry count).
    Blank lines between entries are allowed, and an indented line continues the entry above it.
    The list ends at the first line that is neither, which is where the prose starts."""
    entries = []
    for line in design.split("\n"):
        if not line.strip():
            continue
        if re.match(r"^\s*[-*]\s", line):
            entries.append(line.strip())
        elif entries and line[0].isspace():
            entries[-1] += " " + line.strip()
        else:
            break
    files, bad = [], 0
    for entry in entries:
        m = ENTRY_RE.match(entry)
        if not m:
            bad += 1
            continue
        path = m.group(1).strip()
        if path.startswith("./"):
            path = path[2:]
        files.append({"path": path, "kind": m.group(2), "symbols": symbols_of(m.group(3))})
    return files, bad

def decisions(text):
    """Each ### D<n>. decision as {checked, options, recommended}."""
    out = []
    for line in text.split("\n"):
        if re.match(r"^###\s+D\d+\.", line):
            out.append({"checked": 0, "options": 0, "recommended": 0})
            continue
        m = OPTION_RE.match(line)
        if m and out:
            d = out[-1]
            d["options"] += 1
            d["checked"] += m.group(1) in "xX"
            d["recommended"] += "(recommended)" in line
    return out

def decision_counts(decs):
    """The decisions by how many boxes each has checked: exactly one is settled, none is open, more is contradictory."""
    return {
        "total": len(decs),
        "settled": sum(d["checked"] == 1 for d in decs),
        "open": sum(d["checked"] == 0 for d in decs),
        "contradictory": sum(d["checked"] > 1 for d in decs),
    }

def parse(body):
    order, secs = split_sections(body)
    design = secs.get("Design", "")
    files, bad = file_list(design)
    decs = decisions("\n".join(unfenced(secs.get("Decisions", ""))))
    return {
        "order": order, "secs": secs, "files": files, "bad_entries": bad, "decs": decs,
        "stub": design == "To be drawn.",
    }

def lint(p):
    if p["stub"]:
        return {"ok": False, "reasons": ["stub"]}
    reasons = []
    if p["order"] != SECTIONS:
        reasons.append("sections")
    if not p["files"]:
        reasons.append("no-files")
    if p["bad_entries"]:
        reasons.append("file-entry")
    if any(f["kind"] == "changed" and not f["symbols"] for f in p["files"]):
        reasons.append("no-symbols")
    criteria = [l for l in p["secs"].get("Acceptance criteria", "").split("\n") if re.match(r"^\s*[-*]\s", l)]
    if not criteria or any("`" not in l for l in criteria):
        reasons.append("criteria")
    decs, dtext = p["decs"], p["secs"].get("Decisions", "")
    if (not decs and dtext != "None.") or any(not 2 <= d["options"] <= 4 or d["recommended"] != 1 for d in decs):
        reasons.append("decision-shape")
    if any(d["checked"] == 0 for d in decs):
        reasons.append("decisions-open")
    if any(d["checked"] > 1 for d in decs):
        reasons.append("decisions-contradictory")
    return {"ok": not reasons, "reasons": reasons}

def titled(title, counts):
    """The title a sub-issue should carry: every trailing (<n>/<m>) stripped, then (<settled>/<total>) appended while
    a decision is not settled."""
    bare = COUNT_RE.sub("", title)
    if counts["settled"] < counts["total"]:
        return bare + " (%d/%d)" % (counts["settled"], counts["total"])
    return bare

if MODE == "lint":
    src = sys.argv[2]
    body = sys.stdin.read() if src == "-" else open(src).read()
    print(json.dumps(lint(parse(body)), ensure_ascii=False))
    sys.exit(0)

issues_file, repo = sys.argv[2], sys.argv[3]
owner, name = repo.split("/", 1)

data = json.load(open(issues_file))
parent = ((data.get("data") or {}).get("repository") or {}).get("issue")
if parent is None:
    die("no such issue")
if parent["subIssues"]["totalCount"] > len(parent["subIssues"]["nodes"]):
    die("more than 100 sub-issues. this script reads the first 100 only")

named = base_of(parent["body"])
if named is None:
    die("#%d has no Base: line" % parent["number"])
base, made_from = named

# One call for the pull requests into the base branch, to find the one whose head names each sub-issue.
listed = run("gh", "pr", "list", "-R", repo, "--base", base, "--state", "all", "--limit", "500",
            "--json", "number,state,isDraft,url,body")
if listed.returncode != 0:
    die("cannot list the pull requests into %s in %s: %s" % (base, repo, listed.stderr.strip()))
# Open wins over merged, and the lower number wins within a state. Closed without a merge never counts.
pr_of, rank = {}, {}
for pr in json.loads(listed.stdout):
    n = implements(pr.get("body"))
    if n is None or pr["state"] not in ("OPEN", "MERGED"):
        continue
    key = (pr["state"] != "OPEN", pr["number"])
    if n not in rank or key < rank[n]:
        rank[n] = key
        pr_of[n] = {"number": pr["number"], "state": pr["state"], "isDraft": pr["isDraft"], "url": pr["url"]}

issues = []
for node in parent["subIssues"]["nodes"]:
    p = parse(node["body"])
    counts = decision_counts(p["decs"])
    ready_events = [e["createdAt"] for e in node["timelineItems"]["nodes"]
                    if e and (e.get("label") or {}).get("name") == "ready"]
    issues.append({
        "number": node["number"],
        "title": node["title"],
        "wantedTitle": titled(node["title"], counts),
        "state": node["state"],
        "stateReason": node.get("stateReason"),
        "updatedAt": node["updatedAt"],
        "readyAt": max(ready_events) if ready_events else None,
        "labels": [l["name"] for l in node["labels"]["nodes"]],
        "blockedBy": [{"number": b["number"], "state": b["state"], "parent": (b.get("parent") or {}).get("number")}
                      for b in node["blockedBy"]["nodes"]],
        "blocking": [b["number"] for b in node["blocking"]["nodes"]],
        "pr": pr_of.get(node["number"]),
        "stub": p["stub"],
        "files": p["files"],
        "designPaths": [f["path"] for f in p["files"]],
        "decisions": counts,
        "lint": lint(p),
    })
issues.sort(key=lambda i: i["number"])
by_number = {i["number"]: i for i in issues}

# The run order: the open sub-issues, blockers first. Only edges between open sub-issues count.
# A closed blocker is done, and a blocker outside the project is not this script's to order.
# Among the issues free to go next, the one written earlier under the parent's ## Order goes first,
# then the one more open issues wait on, then the lower number.
written = order_of(parent["body"])
position = {}
for k, n in enumerate(written):
    position.setdefault(n, k)
open_ = {i["number"]: i for i in issues if i["state"] == "OPEN"}
waits_on = {n: sorted({b["number"] for b in i["blockedBy"] if b["number"] in open_}) for n, i in open_.items()}
unblocks = {n: [] for n in open_}
for n, deps in waits_on.items():
    for d in deps:
        unblocks[d].append(n)

def find_cycle(nodes):
    """Return one cycle among nodes as a list of numbers, the first one repeated at the end."""
    state = {}
    for start in sorted(nodes):
        if start in state:
            continue
        stack = [(start, iter(waits_on[start]))]
        path = [start]
        state[start] = 1
        while stack:
            n, it = stack[-1]
            nxt = next((d for d in it if d in nodes), None)
            if nxt is None:
                state[n] = 2
                stack.pop()
                path.pop()
            elif state.get(nxt) == 1:
                return path[path.index(nxt):] + [nxt]
            elif nxt not in state:
                state[nxt] = 1
                stack.append((nxt, iter(waits_on[nxt])))
                path.append(nxt)
    return []

def waiting_count(n, seen=None):
    """How many open issues wait on n, directly or not."""
    seen = set() if seen is None else seen
    for m in unblocks[n]:
        if m not in seen:
            seen.add(m)
            waiting_count(m, seen)
    return len(seen)

def run_order():
    """The open sub-issues in run order, and a cycle among them (empty when there is none)."""
    left = {n: len(deps) for n, deps in waits_on.items()}
    result = []
    free = [n for n, c in left.items() if c == 0]
    while free:
        free.sort(key=lambda n: (position.get(n, len(written)), -waiting_count(n), n))
        n = free.pop(0)
        result.append(n)
        for m in unblocks[n]:
            left[m] -= 1
            if left[m] == 0:
                free.append(m)
    if len(result) < len(open_):
        return result, find_cycle({n for n in open_ if n not in result})
    return result, []

def order_check():
    """Whether the ## Order list can be run as written. unknown: a number that is no sub-issue. duplicate: a number
    written twice. early: an open issue written before an open blocker of the same project. missing: an open
    sub-issue not written, which does not make the list wrong."""
    early = [{"number": n, "blocker": b} for n in open_ if n in position
             for b in waits_on[n] if b in position and position[b] > position[n]]
    unknown = sorted({n for n in written if n not in by_number})
    duplicate = sorted({n for n in written if written.count(n) > 1})
    return {"ok": not unknown and not duplicate and not early, "unknown": unknown, "duplicate": duplicate,
            "early": early, "missing": [n for n in sorted(open_) if n not in position]}

def waits_on_parents(number, subs):
    """The projects project <number> waits on, as {parent number: parent}: the parents of the blockers of its open
    sub-issues, other than itself, whose body has a Base: line. A blocker with no parent is ignored."""
    out = {}
    for s in subs:
        if s["state"] != "OPEN":
            continue
        for b in s["blockedBy"]["nodes"]:
            par = b.get("parent")
            if par and par["number"] != number and base_of(par["body"]):
                out[par["number"]] = par
    return out

project_bases = {parent["number"]: base}
# The parent of every blocker of a sub-issue, open or closed, that has a Base: line, by the blocker's number.
blocker_project = {}
for s in parent["subIssues"]["nodes"]:
    for b in s["blockedBy"]["nodes"]:
        par = b.get("parent")
        if par and base_of(par["body"]):
            blocker_project[b["number"]] = par["number"]
            project_bases[par["number"]] = base_of(par["body"])[0]
deps_of = {parent["number"]: {}}
for n, par in waits_on_parents(parent["number"], parent["subIssues"]["nodes"]).items():
    project_bases[n] = base_of(par["body"])[0]
    deps_of[parent["number"]][n] = par

def project_deps(n):
    """The projects project n waits on, as {parent number: base}. One query per project, cached."""
    if n not in deps_of:
        r = graphql("p: issue(number: $n) { subIssues(first: 100) { totalCount nodes { state "
                    "blockedBy(first: 50) { nodes { parent { number body } } } } } }",
                    ints={"n": n}, what="read project #%d" % n)
        subs = (r.get("p") or {}).get("subIssues") or {"totalCount": 0, "nodes": []}
        if subs["totalCount"] > len(subs["nodes"]):
            die("#%d has more than 100 sub-issues. this script reads the first 100 only" % n)
        deps_of[n] = waits_on_parents(n, subs["nodes"])
        for m, par in deps_of[n].items():
            project_bases[m] = base_of(par["body"])[0]
    return {m: project_bases[m] for m in deps_of[n]}

def walk_projects(start):
    """The base branches of every project start waits on, directly or not. Dies on a cycle between projects."""
    done, path = set(), []
    def visit(n):
        path.append(n)
        for m in sorted(project_deps(n)):
            if m in path:
                cycle = path[path.index(m):] + [m]
                die("the projects have a cycle: " + " waits on ".join("#%d" % k for k in cycle))
            if m not in done:
                visit(m)
        path.pop()
        done.add(n)
    visit(start)
    return {project_bases[n] for n in done if n != start}

def branches(own, deps):
    """One query for where the branches stand. own is (base, from) of this project, deps a list of
    (number, base, from) of the open projects it waits on. Returns (own, {number: dep}), each with
    exists (the base is on origin) and reached (the base has reached its from: a merged pull request from the base
    into from, or from contains the base), and for a dep the states and the count of its sub-issues."""
    fields, strs, ints = [], {}, {}
    def ref_fields(k, b, f):
        strs.update({"q%s" % k: "refs/heads/" + b, "b%s" % k: b, "f%s" % k: f})
        fields.append("r%s: ref(qualifiedName: $q%s) { compare(headRef: $f%s) { status } }" % (k, k, k))
        fields.append("m%s: pullRequests(headRefName: $b%s, baseRefName: $f%s, states: [MERGED], first: 1) "
                      "{ totalCount }" % (k, k, k))
    ref_fields("o", *own)
    for k, (n, b, f) in enumerate(deps):
        ints["n%d" % k] = n
        fields.append("d%d: issue(number: $n%d) { subIssues(first: 100) { totalCount nodes { state } } }" % (k, k))
        ref_fields(str(k), b, f)
    r = graphql(" ".join(fields), ints, strs, what="read the branches of the projects")
    def stand(k):
        ref = r.get("r%s" % k)
        status = ((ref or {}).get("compare") or {}).get("status")
        return {"exists": ref is not None,
                "reached": r["m%s" % k]["totalCount"] > 0 or status in ("AHEAD", "IDENTICAL")}
    out = {}
    for k, (n, b, f) in enumerate(deps):
        subs = (r.get("d%d" % k) or {}).get("subIssues") or {"totalCount": 0, "nodes": []}
        if subs["totalCount"] > len(subs["nodes"]):
            die("#%d has more than 100 sub-issues. this script reads the first 100 only" % n)
        out[n] = dict(stand(str(k)), states=[s["state"] for s in subs["nodes"]])
    return stand("o"), out

def merged(issue, states, reached):
    """A project is merged when its parent is closed as completed, or when it is open, every sub-issue is closed and
    its base has reached its from. A fresh base is identical to from, so the sub-issues have to be closed too."""
    if issue["state"] == "CLOSED":
        return issue.get("stateReason") == "COMPLETED"
    return bool(states) and all(s == "CLOSED" for s in states) and reached

if MODE in ("project", "check"):
    dep_list = [deps_of[parent["number"]][n] for n in sorted(deps_of[parent["number"]])]
    open_deps = [(d["number"],) + base_of(d["body"]) for d in dep_list if d["state"] == "OPEN"]
    own, dep_stand = branches((base, made_from), open_deps)
    base_exists = own["exists"]
    depends_on = []
    for d in dep_list:
        st = dep_stand.get(d["number"], {"states": [], "reached": False})
        depends_on.append({
            "number": d["number"], "title": d["title"], "state": d["state"], "stateReason": d.get("stateReason"),
            "base": base_of(d["body"])[0], "merged": merged(d, st["states"], st["reached"]),
        })

if MODE == "project":
    print(json.dumps({
        "parent": dict({k: parent.get(k) for k in ("number", "title", "state", "stateReason", "updatedAt", "body")},
                       base=base, **{"from": made_from},
                       baseExists=base_exists,
                       merged=merged(parent, [i["state"] for i in issues], own["reached"]),
                       dependsOn=depends_on,
                       order=written,
                       orderCheck=order_check()),
        "issues": issues,
    }, ensure_ascii=False))
    sys.exit(0)

if MODE == "check":
    n = int(sys.argv[4])
    issue = by_number.get(n)
    if issue is None:
        die("#%d is not a sub-issue of #%d" % (n, parent["number"]))
    # An explicit refspec, so that a single-branch clone still gets origin/<branch>,
    # and a branch that starts with - is not read as an option.
    # <from> every time, the base only once pj3-running has created it.
    for branch in [made_from] + ([base] if base_exists else []):
        fetch = run("git", "fetch", "--quiet", "origin", "+refs/heads/%s:refs/remotes/origin/%s" % (branch, branch))
        if fetch.returncode != 0:
            die("cannot fetch %s from origin: %s" % (branch, fetch.stderr.strip()))
    # Before the base exists, it is going to be cut from the tip of <from>.
    ref = "origin/" + (base if base_exists else made_from)

    # premises: only once every blocker is closed, and the base exists or will be cut from a <from> that holds every
    # project this one waits on. Before that the blockers are still meant to change these files.
    failures = []
    evaluated = (all(b["state"] == "CLOSED" for b in issue["blockedBy"])
                 and (base_exists or all(d["merged"] for d in depends_on)))
    if evaluated:
        for f in issue["files"]:
            exists = run("git", "cat-file", "-e", "%s:%s" % (ref, f["path"])).returncode == 0
            if f["kind"] == "added" and exists:
                failures.append({"path": f["path"], "why": "added, but already exists"})
            elif f["kind"] != "added" and not exists:
                failures.append({"path": f["path"], "why": "%s, but does not exist" % f["kind"]})
            elif f["kind"] == "changed":
                for sym in f["symbols"]:
                    if run("git", "grep", "-w", "-F", "-q", sym, ref, "--", f["path"]).returncode != 0:
                        failures.append({"path": f["path"], "symbol": sym, "why": "symbol not found"})

    # history: commits on the base branch that touched these files after ready went on, except the ones a blocker's
    # pull request brought, the merge of a project this one waits on, or a pull request into that project's base
    # branch, which reaches <from> when the base branch is fast-forwarded into it. No base, no history.
    stale = []
    if base_exists and issue["readyAt"] and issue["designPaths"]:
        log = run("git", "log", "--first-parent", "--format=%H%x09%s", "--since=" + issue["readyAt"], ref,
                  "--", *issue["designPaths"])
        if log.returncode != 0:
            die("git log failed: " + log.stderr.strip())
        commits = [l.split("\t", 1) for l in log.stdout.splitlines() if l]
        # The transitive blockedBy: walk the project's issues, closed ones included.
        # A blocker in another project counts by its number, and is not walked further.
        anticipated, todo = set(), [b["number"] for b in issue["blockedBy"]]
        while todo:
            m = todo.pop()
            if m in anticipated:
                continue
            anticipated.add(m)
            if m in by_number:
                todo.extend(b["number"] for b in by_number[m]["blockedBy"])
        # The projects this issue's work was drawn against: the ones this project waits on, and the projects of the
        # blockers in its transitive blockedBy, closed ones included, each with the projects it waits on in turn.
        waited = set()
        if commits:
            waited = walk_projects(parent["number"])
            for q in sorted({blocker_project.get(m) for m in anticipated} - {None, parent["number"]}):
                waited |= {project_bases[q]} | walk_projects(q)
        for start in range(0, len(commits), 100):
            chunk = commits[start:start + 100]
            fields = " ".join(
                'c%d: object(oid: "%s") { ... on Commit { associatedPullRequests(first: 5) '
                '{ nodes { number merged body headRefName baseRefName } } } }' % (k, sha)
                for k, (sha, _) in enumerate(chunk))
            repo_data = graphql(fields, what="read the pull requests of the commits")
            for k, (sha, subject) in enumerate(chunk):
                prs = [pr for pr in ((repo_data.get("c%d" % k) or {}).get("associatedPullRequests") or {}).get("nodes", [])
                       if pr["merged"]]
                if not any(implements(pr["body"]) in anticipated
                           or (pr["headRefName"] in waited and pr["baseRefName"] == made_from)
                           or pr["baseRefName"] in waited for pr in prs):
                    stale.append({"sha": sha, "subject": subject, "pr": prs[0]["number"] if prs else None})

    print(json.dumps({
        "number": n,
        "base": base,
        "from": made_from,
        "baseExists": base_exists,
        "ok": issue["lint"]["ok"] and not failures and not stale,
        "lint": issue["lint"],
        "premises": {"evaluated": evaluated, "failures": failures},
        "history": {"stale": stale},
    }, ensure_ascii=False))
    sys.exit(0)

# --order: the run order and the ## Order list (see run_order).
result, cycle = run_order()
if cycle:
    die("the blocked-by relationships have a cycle: " + " blocked by ".join("#%d" % n for n in cycle))

# The projects this one waits on, directly or not, must not wait on it in turn.
walk_projects(parent["number"])

# The ## Order list: the issues closed as completed first, where the list has them and then by number, then the
# run order. An issue closed as not planned is no work and leaves the list.
done = []
for n in written + [i["number"] for i in issues]:
    i = by_number.get(n)
    if i and i["state"] == "CLOSED" and i["stateReason"] == "COMPLETED" and n not in done:
        done.append(n)
print(json.dumps({"order": [open_[n] for n in result], "list": done + result}, ensure_ascii=False))
PY

if [ "$MODE" = "lint" ]; then
  [ -z "$PARENT" ] || die "--lint takes no parent"
  [ "$LINT_FILE" = "-" ] || [ -f "$LINT_FILE" ] || die "no such file: $LINT_FILE"
  exec python3 -c "$PY" lint "$LINT_FILE"
fi

[ -n "$PARENT" ] || usage
case "$PARENT" in *[!0-9]*) die "the parent must be an issue number: $PARENT" ;; esac
case "$TARGET" in *[!0-9]*) die "--check takes an issue number: $TARGET" ;; esac

command -v gh >/dev/null 2>&1 || die "gh is not installed"

if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)" || die "cannot tell the repository. run this inside a clone or pass -R <owner/repo>"
fi
case "$REPO" in */*) ;; *) die "the repository must read <owner/repo>: $REPO" ;; esac

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# One GraphQL query for the parent and every sub-issue.
gh api graphql -F owner="${REPO%%/*}" -F name="${REPO#*/}" -F n="$PARENT" -f query='
query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $n) {
      number title state stateReason updatedAt body
      subIssues(first: 100) {
        totalCount
        nodes {
          number title state stateReason updatedAt body
          labels(first: 50) { nodes { name } }
          blockedBy(first: 50) { nodes { number state parent { number title state stateReason body } } }
          blocking(first: 50) { nodes { number } }
          timelineItems(itemTypes: [LABELED_EVENT], last: 100) {
            nodes { ... on LabeledEvent { createdAt label { name } } }
          }
        }
      }
    }
  }
}' > "$TMP/issues.json" || die "cannot read issue #$PARENT in $REPO"

if [ "$MODE" = "check" ]; then
  git rev-parse --git-dir >/dev/null 2>&1 || die "--check runs inside a clone of $REPO"
  python3 -c "$PY" check "$TMP/issues.json" "$REPO" "$TARGET"
  exit 0
fi

python3 -c "$PY" "$MODE" "$TMP/issues.json" "$REPO"
