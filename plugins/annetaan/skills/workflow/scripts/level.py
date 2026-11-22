import datetime, json, os, re, subprocess, sys

SUB = sys.argv[1]
ARGS = sys.argv[2:]

PATH_IN_REPO = ".claude/annetaan-level.md"

DEFAULT_LEVEL = 2

AGENTS = {
    "workflow-design": [("sonnet", "high"), ("opus", "medium"), ("fable", "medium")],
    "pj-planner": [("sonnet", "high"), ("opus", "medium"), ("fable", "medium")],
    "pj-reviewer": [("sonnet", "high"), ("opus", "medium"), ("fable", "medium")],
    "workflow-worker": [("sonnet", "medium"), ("sonnet", "high"), ("opus", "medium")],
    "pj-issue-writer": [("sonnet", "medium"), ("sonnet", "high"), ("opus", "medium")],
    "workflow-reviewer-a": [("sonnet", "medium"), ("opus", "medium"), ("opus", "high")],
    "workflow-reviewer-b": [None, None, ("fable", "medium")],
}

RECORD_RE = re.compile(
    r"^Level: ([123]) \((file|override|default)\) · tasks (\d+) · task rounds (\d+)"
    r" · integration rounds (\d+) · findings (\d+)$")

TASK_ROUND_RE = re.compile(r"^task-(\d+)-round-(\d+)\.md$")
INTEGRATION_ROUND_RE = re.compile(r"^integration-round-(\d+)\.md$")
FINDING_RE = re.compile(r"^### R\d+\.\d+ ")

SOURCE_ORDER = ("file", "default", "override")

def record_line(level, source, tasks, task_rounds, integration_rounds, findings):
    return "Level: %d (%s) · tasks %d · task rounds %d · integration rounds %d · findings %d" % (
        level, source, tasks, task_rounds, integration_rounds, findings)

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
    r = run("git", "-C", where, "fetch", "--quiet", "origin",
            "+refs/heads/%s:refs/remotes/origin/%s" % (branch, branch))
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
    if fields.get("level") not in ("1", "2", "3"):
        return None, None, None, "level is not 1, 2 or 3"
    try:
        evaluated = datetime.date.fromisoformat(fields.get("evaluated", ""))
        review_by = datetime.date.fromisoformat(fields.get("review-by", ""))
    except ValueError:
        return None, None, None, "evaluated and review-by are not both dates as YYYY-MM-DD"
    return int(fields["level"]), evaluated, review_by, None

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
        warning = "cannot read origin's default branch: %s; level %d unless overridden" % (problem, DEFAULT_LEVEL)
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
        level, source = int(ARGS[1]), "override"
    agents = {name: {"model": levels[level - 1][0], "effort": levels[level - 1][1]}
              for name, levels in AGENTS.items() if levels[level - 1] is not None}
    emit(status="ok", level=level, source=source, ref=ref,
         evaluated=evaluated and evaluated.isoformat(), reviewBy=review_by and review_by.isoformat(),
         warning=warning, agents=agents,
         seats=[name[len("workflow-reviewer-"):] for name in agents if name.startswith("workflow-reviewer-")])

def new_findings(path):
    found, inside = 0, False
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("## "):
                inside = line.rstrip() == "## New findings"
            elif inside and FINDING_RE.match(line):
                found += 1
    return found

def counts(review_dir):
    tasks, task_rounds, integration_rounds, findings = set(), 0, 0, 0
    for name in os.listdir(review_dir):
        task = TASK_ROUND_RE.match(name)
        if task:
            tasks.add(task.group(1))
            task_rounds += 1
        elif INTEGRATION_ROUND_RE.match(name):
            integration_rounds += 1
        else:
            continue
        findings += new_findings(os.path.join(review_dir, name))
    return len(tasks), task_rounds, integration_rounds, findings

def record():
    workdir, level, source = ARGS
    log = os.path.join(workdir, "log.md")
    review = os.path.join(workdir, "review")
    if not os.path.isfile(log):
        stop("no-log", "no log.md in " + workdir)
    if not os.path.isdir(review):
        stop("no-review", "no review/ in " + workdir)
    entry = record_line(int(level), source, *counts(review))
    with open(log, encoding="utf-8", errors="replace", newline="") as f:
        kept = [line for line in f.read().split("\n") if not RECORD_RE.match(line.rstrip("\r"))]
    text = "\n".join(kept).rstrip("\r\n")
    with open(log, "w", encoding="utf-8", newline="") as f:
        f.write(text + "\n\n" + entry + "\n")
    emit(status="ok", line=entry)

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
    for pr in prs:
        found = [m for m in (RECORD_RE.match(line.rstrip("\r")) for line in pr["body"].split("\n")) if m]
        if not found:
            continue
        level, source, tasks, task_rounds, integration_rounds, findings = found[-1].groups()
        runs.append({"pr": pr["number"], "url": pr["url"], "mergedAt": pr["mergedAt"],
                     "level": int(level), "source": source, "tasks": int(tasks),
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
    for key in sorted(groups, key=lambda k: (k[0], SOURCE_ORDER.index(k[1]))):
        g = groups[key]
        g["sendBacks"] = g["taskRounds"] - g["tasks"]
        g["sendBacksPerTask"] = per_task(g["sendBacks"], g["tasks"])
        g["findingsPerTask"] = per_task(g["findings"], g["tasks"])
        ordered.append(g)
    emit(status="ok", since=since, prs=len(prs), runs=runs, groups=ordered)

{"show": show, "record": record, "history": history}[SUB]()
