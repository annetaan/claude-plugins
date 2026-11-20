import datetime, json, re, subprocess, sys

SUB = sys.argv[1]
ARGS = sys.argv[2:]

PATH_IN_REPO = ".claude/annetaan-level.md"

AGENTS = {
    "workflow-worker": [("sonnet", "high"), ("opus", "medium"), ("opus", "high")],
    "pj-issue-writer": [("sonnet", "high"), ("opus", "medium"), ("opus", "high")],
    "workflow-reviewer-a": [("opus", "medium"), ("opus", "high"), ("opus", "high")],
    "workflow-reviewer-b": [("fable", "medium"), ("fable", "medium"), ("fable", "medium")],
}

def run(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")

def one_line(text, fallback):
    return " ".join(text.split()) or fallback

def emit(**obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)

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

def show():
    where = ARGS[0]
    if run("git", "-C", where, "rev-parse", "--git-dir").returncode != 0:
        die("not inside a git clone: " + where)
    ref, text, problem = read_file(where)
    level, source, evaluated, review_by, warning = 3, "default", None, None, None
    if problem is not None:
        warning = "cannot read origin's default branch: %s; level 3 unless overridden" % problem
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
    emit(status="ok", level=level, source=source, ref=ref,
         evaluated=evaluated and evaluated.isoformat(), reviewBy=review_by and review_by.isoformat(),
         warning=warning,
         agents={name: {"model": levels[level - 1][0], "effort": levels[level - 1][1]}
                 for name, levels in AGENTS.items()})

{"show": show}[SUB]()
