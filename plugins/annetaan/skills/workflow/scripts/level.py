import datetime, json, re, subprocess, sys
from clone import fetch_branch
from flow import LEVEL_SEATS, RECORD_RE

SUB = sys.argv[1]
ARGS = sys.argv[2:]

PATH_IN_REPO = ".claude/annetaan-level.md"

DEFAULT_LEVEL = "standard"

AGENTS = {
    "workflow-design": {"standard": ("opus", "medium"), "high": ("fable", "medium")},
    "pj-planner": {"standard": ("opus", "medium"), "high": ("fable", "medium")},
    "pj-reviewer": {"standard": ("opus", "medium"), "high": ("fable", "medium")},
    "workflow-worker": {"standard": ("opus", "medium"), "high": ("opus", "high")},
    "pj-issue-writer": {"standard": ("opus", "medium"), "high": ("opus", "high")},
    "workflow-reviewer-a": {"standard": ("opus", "high"), "high": ("opus", "high")},
    "workflow-reviewer-b": {"high": ("fable", "medium")},
}

SOURCE_ORDER = ("file", "default", "override")

def run(*cmd, cwd=None):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=cwd)

def one_line(text, fallback):
    return " ".join(text.split()) or fallback

def emit(**obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)

def stop(reason, message, **extra):
    emit(status="stop", reason=reason, message=message, **extra)

def die(msg):
    print("level: " + msg, file=sys.stderr)
    sys.exit(1)

def read_file(where):
    r = run("git", "-C", where, "ls-remote", "--symref", "origin", "HEAD")
    if r.returncode != 0:
        return None, None, one_line(r.stderr, "git ls-remote failed")
    m = re.search(r"^ref: refs/heads/(\S+)\tHEAD$", r.stdout, re.M)
    if m is None:
        return None, None, "origin names no default branch"
    branch = m.group(1)
    r = fetch_branch(where, branch)
    if r.returncode != 0:
        return None, None, one_line(r.stderr, "git fetch failed")
    ref = "origin/" + branch
    r = run("git", "-C", where, "show", "%s:%s" % (ref, PATH_IN_REPO))
    return ref, (r.stdout if r.returncode == 0 else None), None

def parse(text):
    lines = text.splitlines()
    if not lines or lines[0] != "---" or "---" not in lines[1:]:
        return None, None, None, "no front matter between two --- lines"
    fields = {}
    for line in lines[1:lines.index("---", 1)]:
        key, sep, value = line.partition(":")
        if sep:
            fields[key.strip()] = value.strip()
    if fields.get("level") not in LEVEL_SEATS:
        return None, None, None, "level is not standard or high"
    try:
        evaluated = datetime.date.fromisoformat(fields.get("evaluated", ""))
        review_by = datetime.date.fromisoformat(fields.get("review-by", ""))
    except ValueError:
        return None, None, None, "evaluated and review-by are not both dates as YYYY-MM-DD"
    return fields["level"], evaluated, review_by, None

def clone_dir():
    where = ARGS[0]
    if run("git", "-C", where, "rev-parse", "--git-dir").returncode != 0:
        die("not inside a git clone: " + where)
    return where

def show():
    where = clone_dir()
    ref, text, problem = read_file(where)
    level, source, evaluated, review_by, warning = DEFAULT_LEVEL, "default", None, None, None
    if problem is not None:
        warning = "cannot read origin's default branch: %s; level %s unless overridden" % (problem, DEFAULT_LEVEL)
    elif text is not None:
        found, evaluated, review_by, invalid = parse(text)
        if invalid is not None:
            warning = "%s:%s: %s; ignored" % (ref, PATH_IN_REPO, invalid)
        else:
            level, source = found, "file"
            if review_by < datetime.date.today():
                warning = "%s:%s: review-by %s has passed; /annetaan:level re-evaluates it" % (
                    ref, PATH_IN_REPO, review_by.isoformat())
    if len(ARGS) > 1:
        level, source = ARGS[1], "override"
    agents = {name: {"model": levels[level][0], "effort": levels[level][1]}
              for name, levels in AGENTS.items() if level in levels}
    emit(status="ok", level=level, source=source, ref=ref,
         evaluated=evaluated and evaluated.isoformat(), reviewBy=review_by and review_by.isoformat(),
         warning=warning, agents=agents,
         seats=list(LEVEL_SEATS[level]))

def per_task(value, tasks):
    return round(value / tasks, 2) if tasks else None

def history():
    where = clone_dir()
    _, text, _ = read_file(where)
    since = None
    if text is not None:
        _, evaluated, _, invalid = parse(text)
        if invalid is None:
            since = evaluated.isoformat()
    cmd = ["gh", "pr", "list", "--state", "merged", "--limit", "1000", "--json", "number,url,body,mergedAt"]
    if since is not None:
        cmd += ["--search", "merged:>" + since]
    listed = run(*cmd, cwd=where)
    if listed.returncode != 0:
        stop("gh", one_line(listed.stderr, "gh pr list failed"))
    try:
        prs = json.loads(listed.stdout)
    except ValueError:
        stop("gh", "gh pr list printed no JSON: " + one_line(listed.stdout, "empty output"))
    runs = []
    unread = []
    for pr in prs:
        found = []
        for line in (line.rstrip("\r") for line in pr["body"].split("\n")):
            m = RECORD_RE.match(line)
            if m:
                found.append(m)
            elif line.startswith("Level: "):
                unread.append({"pr": pr["number"], "line": line})
        if not found:
            continue
        level, source, tasks, task_rounds, integration_rounds, findings = found[-1].groups()
        runs.append({"pr": pr["number"], "url": pr["url"], "mergedAt": pr["mergedAt"],
                     "level": level, "source": source, "tasks": int(tasks),
                     "taskRounds": int(task_rounds), "integrationRounds": int(integration_rounds),
                     "findings": int(findings)})
    runs.sort(key=lambda entry: entry["mergedAt"])
    groups = {}
    for entry in runs:
        g = groups.setdefault((entry["level"], entry["source"]), {
            "level": entry["level"], "source": entry["source"], "runs": 0, "tasks": 0, "taskRounds": 0,
            "integrationRounds": 0, "findings": 0})
        g["runs"] += 1
        for key in ("tasks", "taskRounds", "integrationRounds", "findings"):
            g[key] += entry[key]
    ordered = []
    for key in sorted(groups, key=lambda k: (list(LEVEL_SEATS).index(k[0]), SOURCE_ORDER.index(k[1]))):
        g = groups[key]
        g["sendBacks"] = g["taskRounds"] - g["tasks"]
        g["sendBacksPerTask"] = per_task(g["sendBacks"], g["tasks"])
        g["findingsPerTask"] = per_task(g["findings"], g["tasks"])
        ordered.append(g)
    emit(status="ok", since=since, prs=len(prs), runs=runs, groups=ordered, unread=unread)

{"show": show, "history": history}[SUB]()
