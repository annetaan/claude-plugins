import fcntl, json, os, re, shutil, subprocess, sys, tempfile, time

SEATS = ("a", "b")
LEVEL_SEATS = {"standard": ("a",), "high": SEATS}
TAIL = 40
STAMP = re.compile(r"\d{4}-\d{2}-\d{2}-\d{4}(-|$)")
SCOPE = r"task-[1-9]\d*|integration|merge"
ROUND_NAME = re.compile(r"(%s)-round-([1-9]\d*)(?:-(a|b|reply|evidence))?\.md" % SCOPE)
FIRST_EVIDENCE_NAME = re.compile(r"(task-[1-9]\d*|merge)-evidence\.md")
CAP = 5
FENCE = re.compile(r"\s*```")
FINDING_SECTIONS = ("Findings", "New findings")
ROUND_SECTIONS = ["Earlier findings", "New findings", "Dropped", "Not run", "Verdict"]
FREE_SECTIONS = ("Not run", "Dropped")
ENTRY_SECTIONS = ("Acceptance criteria", "Flows", "Reproduced first", "Walk")
NO_SECTION = {"heading": None, "lines": [], "blocks": [], "loose": []}
FOUND_BY = ("a", "b", "a, b")
FINDING_ID = r"R[1-9]\d*\.[1-9]\d*"
EARLIER_ID = re.compile(r"- (%s)\b" % FINDING_ID)
MARK = re.compile(r"- (%s) (?:resolved(?:: \S.*)?|(stands again|stands): \S.*)" % FINDING_ID)
DISAGREE = "; reply: disagree"
ANSWER = re.compile(r"- (%s) (fixed|disagree): \S" % FINDING_ID)
SUB_BULLET = re.compile(r"\s+- (ran|saw|not run):")
FORBIDDEN = set("$\"';&|<>()`")
REASONS = ("sections", "id", "finding", "command", "entry", "seats", "no-round", "mark", "earlier-missing", "verdict",
           "approve-open", "approve-no-evidence", "draft", "line", "missing", "ran", "assumed", "no-evidence",
           "area", "parts", "landed", "overturn")
RECORD_RE = re.compile(
    (r"^Level: (%s) \((file|override|default)\) · tasks (\d+) · task rounds (\d+)"
     r" · integration rounds (\d+) · findings (\d+)$") % "|".join(LEVEL_SEATS))
HEAD_LINE = re.compile(r"(Implements|Part of) #\d+\s*")
DECISIONS = "decisions.md"
DECISIONS_RECORD = "decisions.json"
AREAS = ("technology", "infrastructure", "database", "delivery")
PARTS = ("What was decided", "Other options and why this one", "Where it landed", "To overturn it")
DECISION_LABEL = ("decision", "FBCA04", "A design decision a workflow run made on its own. Read it, then close it.")
LANDED = re.compile(r"- `[^`]+`")
OVERTURN = re.compile(r"/annetaan:workflow \S")

def run(*cmd, cwd=None, env=None, input=None):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, env=env, input=input)

def emit(**obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)

class Stop(Exception):
    def __init__(self, reason, message):
        super().__init__(message)
        self.reason, self.message = reason, message

def stop(reason, message):
    raise Stop(reason, message)

def die(msg):
    print("panel: " + msg, file=sys.stderr)
    sys.exit(1)

def git(where, *args, env=None):
    r = run("git", "-C", where, *args, env=env)
    if r.returncode != 0:
        die("git %s failed: %s" % (" ".join(args), r.stderr.strip()))
    return r.stdout

def stamped(root):
    if not os.path.isdir(root):
        return []
    return [e for e in os.listdir(root) if STAMP.match(e)
            and os.path.isdir(os.path.join(root, e)) and not os.path.islink(os.path.join(root, e))]

def seat_path(wt, seat):
    return os.path.join(os.path.dirname(wt), "review-%s-%s" % (os.path.basename(wt), seat))

def lock_path(wt, where, seat):
    common = git(where, "rev-parse", "--git-common-dir").strip()
    if not os.path.isabs(common):
        common = os.path.join(where, common)
    return os.path.join(common, "panel-%s-%s.lock" % (os.path.basename(wt), seat))

def nearest_clone_dir(wt):
    where = wt
    while not os.path.isdir(where):
        parent = os.path.dirname(where)
        if parent == where:
            return None
        where = parent
    return where if run("git", "-C", where, "rev-parse", "--git-dir").returncode == 0 else None

def worktrees_by_path(where):
    out = {}
    for block in git(where, "worktree", "list", "--porcelain").split("\n\n"):
        lines = block.splitlines()
        if lines and lines[0].startswith("worktree "):
            out[os.path.realpath(lines[0][len("worktree "):])] = any(l.startswith("prunable") for l in lines[1:])
    return out

def require_live_wt(wt):
    where = nearest_clone_dir(wt)
    if where is None or where != wt or worktrees_by_path(wt).get(os.path.realpath(wt)) is not False:
        stop("unknown", "%s is no worktree of a clone" % wt)

def snapshot(wt):
    head = git(wt, "rev-parse", "HEAD").strip()
    fd, index = tempfile.mkstemp(prefix="panel-index-", dir=git(wt, "rev-parse", "--absolute-git-dir").strip())
    os.close(fd)
    os.unlink(index)
    env = dict(os.environ, GIT_INDEX_FILE=index)
    try:
        git(wt, "read-tree", "HEAD", env=env)
        r = run("git", "-C", wt, "add", "-A", env=env)
        if r.returncode != 0:
            stop("snapshot", "cannot snapshot %s: %s" % (wt, r.stderr.strip()))
        tree = git(wt, "write-tree", env=env).strip()
    finally:
        if os.path.exists(index):
            os.unlink(index)
    ident = dict(os.environ, GIT_AUTHOR_NAME="panel", GIT_AUTHOR_EMAIL="panel@localhost",
                 GIT_COMMITTER_NAME="panel", GIT_COMMITTER_EMAIL="panel@localhost",
                 GIT_AUTHOR_DATE="2000-01-01T00:00:00Z", GIT_COMMITTER_DATE="2000-01-01T00:00:00Z")
    return git(wt, "commit-tree", tree, "-p", head, "-m", "review snapshot", env=ident).strip()

def take_lock(path, seat):
    fd = os.open(path, os.O_CREAT | os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        stop("busy", "seat %s is held by another run" % seat)
    return fd

def prepare(wt, seat, snap):
    path = seat_path(wt, seat)
    known = worktrees_by_path(wt).get(os.path.realpath(path))
    if known:
        git(wt, "worktree", "prune")
        known = None
    if known is False:
        git(path, "checkout", "--quiet", "--force", "--detach", snap)
        git(path, "clean", "-fd", "--quiet")
    elif os.path.lexists(path):
        die("%s exists and is no worktree of this clone" % path)
    else:
        git(wt, "worktree", "add", "--quiet", "--detach", path, snap)
    return path

def run_probe(wt, seat, probe):
    probe = os.path.realpath(probe)
    if seat not in SEATS:
        die("no such seat: " + seat)
    try:
        require_live_wt(wt)
        reports = os.path.realpath(os.path.join(wt, "work-reports")) + os.sep
        if not probe.startswith(reports):
            stop("outside", "%s is not under %s" % (probe, reports))
        script = os.path.join(probe, "run.sh")
        if not os.path.isfile(script):
            stop("no-script", "%s has no run.sh" % probe)
        held = take_lock(lock_path(wt, wt, seat), seat)
        try:
            snap = snapshot(wt)
            path = prepare(wt, seat, snap)
            overlay = os.path.join(probe, "tree")
            if os.path.isdir(overlay):
                shutil.copytree(overlay, path, symlinks=True, dirs_exist_ok=True)
            r = subprocess.run(["bash", script], cwd=path, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, text=True, errors="replace")
        finally:
            os.close(held)
    except Stop as s:
        return {"status": "stop", "reason": s.reason, "message": s.message}
    lines = r.stdout.splitlines()
    return {"status": "ran", "seat": seat, "snapshot": snap, "exit": r.returncode, "lines": len(lines),
            "output": "\n".join(lines[-TAIL:])}

def close(wt):
    where = nearest_clone_dir(wt)
    removed = []
    if where is not None:
        for seat in SEATS:
            path = seat_path(wt, seat)
            known = worktrees_by_path(where).get(os.path.realpath(path))
            if known is None:
                continue
            if known:
                git(where, "worktree", "prune")
            else:
                git(where, "worktree", "remove", "--force", path)
            removed.append(path)
            lock = lock_path(wt, where, seat)
            if os.path.exists(lock):
                os.unlink(lock)
    emit(status="closed", removed=removed)

def begin(wt, *options):
    require_live_wt(wt)
    ignored = run("git", "-C", wt, "check-ignore", "-q", "work-reports/")
    if ignored.returncode == 1:
        stop("not-ignored", "work-reports/ is not ignored in %s" % wt)
    if ignored.returncode != 0:
        die("git check-ignore failed: %s" % ignored.stderr.strip())
    start = git(wt, "rev-parse", "HEAD").strip()
    stamp = time.strftime("%Y-%m-%d-%H%M") + "-" + start[:7]
    name, n = stamp, 1
    while os.path.lexists(os.path.join(wt, "work-reports", name)):
        n += 1
        name = "%s-%d" % (stamp, n)
    workdir = os.path.join(wt, "work-reports", name)
    for sub in ("review", "seats"):
        os.makedirs(os.path.join(workdir, sub))
    opts = dict(zip(options[::2], options[1::2]))
    issue, parent = opts.get("--issue"), opts.get("--parent")
    record = {"start": start, "level": opts["--level"], "source": opts["--source"],
              "issue": int(issue) if issue is not None else None,
              "parent": int(parent) if parent is not None else None}
    with open(os.path.join(workdir, "run.json"), "w") as f:
        json.dump(record, f)
        f.write("\n")
    emit(status="ok", start=start, workdir=workdir, level=record["level"], source=record["source"])

def current_run(wt):
    root = os.path.join(wt, "work-reports")
    runs = [(os.stat(os.path.join(root, e, "run.json")).st_mtime_ns, e) for e in stamped(root)
            if os.path.isfile(os.path.join(root, e, "run.json"))]
    if not runs:
        stop("no-run", "no work directory under %s holds a run.json" % root)
    workdir = os.path.join(root, max(runs)[1])
    with open(os.path.join(workdir, "run.json")) as f:
        return workdir, json.load(f)

def status(wt, scope=None):
    if scope is not None and not re.fullmatch(SCOPE, scope):
        die("no such scope: " + scope)
    workdir, record = current_run(wt)
    state = scope_state(os.path.join(workdir, "review"), scope) if scope is not None else {}
    emit(status="ok", start=record["start"], workdir=workdir, level=record["level"], source=record["source"],
         issue=record["issue"], parent=record["parent"], **state)

def review_kind(name):
    m = ROUND_NAME.fullmatch(name)
    if m:
        tail = m.group(3)
        return {"kind": "seat" if tail in SEATS else tail or "round", "scope": m.group(1), "round": int(m.group(2)),
                "seat": tail if tail in SEATS else None}
    m = FIRST_EVIDENCE_NAME.fullmatch(name)
    if m:
        return {"kind": "evidence", "scope": m.group(1), "round": None, "seat": None}
    return None

def split_blocks(lines, opener, indented_only):
    blocks, loose = [], []
    for text, fenced in lines:
        if not text.strip():
            continue
        if not fenced and text.startswith(opener):
            blocks.append([text.rstrip()])
        elif blocks and (fenced or not indented_only or text[0] in " \t"):
            if not fenced:
                blocks[-1].append(text.rstrip())
        else:
            loose.append(text.strip())
    return blocks, loose

def parse_review(path):
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    head, sections, fenced = [], [], False
    for text in lines[1:]:
        fence = bool(FENCE.match(text))
        if not (fenced or fence) and text.startswith("## "):
            sections.append((text[3:].strip(), []))
        else:
            (sections[-1][1] if sections else head).append((text, fenced or fence))
        fenced ^= fence
    parsed = dict(review_kind(os.path.basename(path)) or {"kind": None, "scope": None, "round": None, "seat": None})
    parsed["title"] = lines[0] if lines and lines[0].startswith("# ") else None
    parsed["seats"] = [text for text, inside in head if not inside and text.startswith("Seats:")]
    parsed["answers"], parsed["loose"] = split_blocks(head, "- ", True)
    parsed["sections"] = []
    for heading, body in sections:
        blocks, loose = split_blocks(body, "### ", False) if heading in FINDING_SECTIONS else split_blocks(body, "- ", True)
        parsed["sections"].append({"heading": heading, "lines": [text.strip() for text, _ in body if text.strip()],
                                   "blocks": blocks, "loose": loose})
    return parsed

def section(parsed, heading):
    return next((s for s in parsed["sections"] if s["heading"] == heading), NO_SECTION)

def answered(parsed):
    return [(m.group(1), m.group(2), "\n".join(block)) for block in parsed["answers"] for m in [ANSWER.match(block[0])] if m]

def open_after(parsed):
    still = {}
    for block in section(parsed, "Earlier findings")["blocks"]:
        m = MARK.fullmatch(block[0])
        if m and m.group(2):
            still[m.group(1)] = m.group(2)
    r = parsed["round"]
    for n, block in enumerate(section(parsed, "New findings")["blocks"], 1):
        if re.match(r"### R%d\.%d \S" % (r, n), block[0]):
            still["R%d.%d" % (r, n)] = "new"
    return still

def approve_blockers(review, scope, r, open_ids):
    blockers = ["approve-open"] if open_ids else []
    for j in range(r - 1, 0, -1):
        reply = os.path.join(review, "%s-round-%d-reply.md" % (scope, j))
        if os.path.isfile(reply) and any(answer == "fixed" for _, answer, _ in answered(parse_review(reply))):
            evidence = os.path.isfile(os.path.join(review, "%s-round-%d-evidence.md" % (scope, j)))
            break
    else:
        if scope == "integration":
            seat_files = [os.path.join(review, "integration-round-1-%s.md" % seat) for seat in SEATS]
            evidence = any(os.path.isfile(p) and section(parse_review(p), "Walk") is not NO_SECTION for p in seat_files)
        else:
            evidence = os.path.isfile(os.path.join(review, "%s-evidence.md" % scope))
    if not evidence:
        blockers.append("approve-no-evidence")
    return blockers

def scope_state(review, scope):
    kinds = [review_kind(name) for name in os.listdir(review)]
    rounds = sorted(k["round"] for k in kinds if k and k["kind"] == "round" and k["scope"] == scope)
    files = [parse_review(os.path.join(review, "%s-round-%d.md" % (scope, r))) for r in rounds]
    last = rounds[-1] if rounds else 0
    verdict = (section(files[-1], "Verdict")["lines"] or [None])[0] if files else None
    still = list(open_after(files[-1])) if files else []
    marks = [open_after(f) for f in files]
    reply = os.path.join(review, "%s-round-%d-reply.md" % (scope, last))
    answers = {i: answer for i, answer, _ in answered(parse_review(reply))} if os.path.isfile(reply) else {}
    blockers = approve_blockers(review, scope, last + 1, still)
    return {"scope": scope, "round": last + 1, "cap": len(rounds) >= CAP and verdict != "approve", "verdict": verdict,
            "open": [{"id": i, "stood": sum(m.get(i) in ("stands", "stands again") for m in marks),
                      "reply": answers.get(i)} for i in still],
            "approve": {"allowed": not blockers, "why": blockers}}

def run_args(line):
    words = line.split()
    if len(words) != 5 or FORBIDDEN & set(line):
        return None
    script, sub, wt, seat, probe = words
    if (os.path.isabs(script) and script.endswith("/panel.sh") and sub == "run" and os.path.isabs(wt)
            and seat in SEATS and probe.startswith(wt.rstrip("/") + "/work-reports/")):
        return script, wt, seat, probe
    return None

def fields(block, names):
    return {name: [text[len(name) + 1:].strip() for text in block[1:] if text.startswith(name + ":")] for name in names}

def finding_reasons(block, names):
    got = fields(block, names)
    reasons = set()
    if any(len(values) != 1 for values in got.values()) or ("Found by" in got and got["Found by"][0] not in FOUND_BY):
        reasons.add("finding")
    if not all(len(c) > 1 and c[0] == c[-1] == "`" and run_args(c[1:-1]) for c in got["Command"]):
        reasons.add("command")
    return reasons

def entry_ok(block, reproduced):
    subs = {m.group(1) for m in map(SUB_BULLET.match, block[1:]) if m}
    if reproduced:
        return block[0].startswith("- ran:") and "saw" in subs
    return {"ran", "saw"} <= subs or "not run" in subs

def holds(s):
    if s["heading"] == "Verdict":
        return True
    if s["heading"] in FREE_SECTIONS:
        return bool(s["lines"])
    return bool(s["blocks"]) or s["lines"] == ["None."]

def copied(line, want):
    if want is None:
        return False
    disagree = want.endswith(DISAGREE)
    base = want[:-len(DISAGREE)] if disagree else want
    starts = [base]
    status = MARK.fullmatch(base)
    if disagree and status and status.group(2):
        starts.append(base[:status.start(2)] + "resolved" + base[status.end(2):])
    return any(line == start or line.startswith(start + ";") for start in starts)

def draft_reasons(path, earlier, new):
    draft = os.path.join(os.path.dirname(os.path.dirname(path)), "drafts", os.path.basename(path))
    if not os.path.isfile(draft):
        return {"draft"}
    parsed = parse_review(draft)
    lines = {m.group(1): block[0] for block in section(parsed, "Earlier findings")["blocks"]
             for m in [EARLIER_ID.match(block[0])] if m}
    pairs = [fields(block, ("Command", "Printed")) for block in section(parsed, "New findings")["blocks"]]
    if (all(copied(line, lines.get(EARLIER_ID.match(line).group(1))) for line in earlier)
            and all(fields(block, ("Command", "Printed")) in pairs for block in new)):
        return set()
    return {"draft"}

def lint_reasons(path):
    if review_kind(os.path.basename(path)) is None:
        return None, ["name"]
    parsed = parse_review(path)
    kind, scope, r = parsed["kind"], parsed["scope"], parsed["round"]
    review = os.path.dirname(path)
    headings = [s["heading"] for s in parsed["sections"]]
    want = {"seat": ["Findings", "Not run"] + (["Walk"] if scope == "integration" and r == 1 else []),
            "round": ROUND_SECTIONS,
            "evidence": ["Acceptance criteria"] + [h for h in ("Flows", "Reproduced first") if h in headings],
            "reply": []}[kind]
    found = set()
    if parsed["title"] is None or headings != want or not all(holds(s) for s in parsed["sections"]):
        found.add("sections")
    if kind in ("seat", "evidence"):
        for s in parsed["sections"]:
            if s["heading"] in ENTRY_SECTIONS and not all(entry_ok(b, s["heading"] == "Reproduced first") for b in s["blocks"]):
                found.add("entry")
    if kind == "seat":
        for n, block in enumerate(section(parsed, "Findings")["blocks"], 1):
            if not re.match(r"### %d\. \S" % n, block[0]):
                found.add("id")
            found |= finding_reasons(block, ("Command", "Printed", "Required"))
    before = None
    if kind in ("round", "reply") and (kind == "reply" or r > 1):
        prior = os.path.join(review, "%s-round-%d.md" % (scope, r if kind == "reply" else r - 1))
        if os.path.isfile(prior):
            before = open_after(parse_review(prior))
        else:
            found.add("no-round")
    if kind == "round":
        if len(parsed["seats"]) != 1:
            found.add("seats")
        listed, marked, kept = set(), [], []
        for block in section(parsed, "Earlier findings")["blocks"]:
            if r == 1:
                found.add("id")
                continue
            m = EARLIER_ID.match(block[0])
            if m:
                listed.add(m.group(1))
                if before is not None and m.group(1) not in before:
                    found.add("id")
            if not MARK.fullmatch(block[0]):
                found.add("mark")
            elif before is not None and m.group(1) in before:
                marked.append(block[0])
        if before is not None and set(before) - listed:
            found.add("earlier-missing")
        for n, block in enumerate(section(parsed, "New findings")["blocks"], 1):
            numbered = re.match(r"### R%d\.%d \S" % (r, n), block[0])
            if not numbered:
                found.add("id")
            reasons = finding_reasons(block, ("Found by", "Command", "Printed", "Required", "Breaks"))
            found |= reasons
            if numbered and not reasons:
                kept.append(block)
        found |= draft_reasons(path, marked, kept)
        verdict = section(parsed, "Verdict")["lines"]
        if verdict not in (["approve"], ["changes-requested"]):
            found.add("verdict")
        elif verdict == ["approve"]:
            found.update(approve_blockers(review, scope, r, list(open_after(parsed))))
    if kind == "reply":
        got = answered(parsed)
        fixed = [text for _, answer, text in got if answer == "fixed"]
        if parsed["loose"] or len(got) != len(parsed["answers"]):
            found.add("line")
        if any(not ("ran:" in text and "saw:" in text) for text in fixed):
            found.add("ran")
        if before is not None:
            if set(before) - {i for i, _, _ in got}:
                found.add("missing")
            if any(before.get(i) == "stands again" and "assumed:" not in text for i, _, text in got):
                found.add("assumed")
        if fixed and not os.path.isfile(os.path.join(review, "%s-round-%d-evidence.md" % (scope, r))):
            found.add("no-evidence")
    return kind, [reason for reason in REASONS if reason in found]

def split_headings(lines, prefix):
    head, parts, fenced = [], [], False
    for text in lines:
        fence = bool(FENCE.match(text))
        if not (fenced or fence) and text.startswith(prefix):
            parts.append((text[len(prefix):].strip(), []))
        else:
            (parts[-1][1] if parts else head).append(text)
        fenced ^= fence
    return head, parts

def trimmed(lines):
    kept = list(lines)
    while kept and not kept[0].strip():
        kept = kept[1:]
    while kept and not kept[-1].strip():
        kept = kept[:-1]
    return kept

def overturn_ok(lines):
    fences = [n for n, text in enumerate(lines) if FENCE.match(text)]
    return fences == [0, len(lines) - 1] and len(lines) > 2 and bool(OVERTURN.match(lines[1]))

def decision_entry(title, lines):
    found = set()
    head, parts = split_headings(lines, "### ")
    head = trimmed(head)
    area = head[0][len("Area: "):] if head and head[0].startswith("Area: ") else None
    if area not in AREAS:
        found.add("area")
    texts = {name: trimmed(body) for name, body in parts}
    if [name for name, _ in parts] != list(PARTS) or len(head) > 1 or not all(
            texts[name] for name in PARTS[:2] if name in texts):
        found.add("parts")
    landed = texts.get("Where it landed")
    if landed is not None and not (landed and all(LANDED.match(text) for text in landed if text.strip())):
        found.add("landed")
    overturn = texts.get("To overturn it")
    if overturn is not None and not overturn_ok(overturn):
        found.add("overturn")
    return found, {"title": title, "area": area, "parts": texts}

def decision_entries(text):
    lines = text.splitlines()
    head, entries = split_headings(lines[1:], "## ")
    titles = [title for title, _ in entries]
    found = set()
    body_ok = trimmed(head) == ["None."] if not entries else not trimmed(head)
    if lines[:1] != ["# Decisions"] or not body_ok or "" in titles or len(set(titles)) != len(titles):
        found.add("sections")
    parsed = []
    for title, body in entries:
        reasons, entry = decision_entry(title, body)
        found |= reasons
        parsed.append(entry)
    return [reason for reason in REASONS if reason in found], parsed

def decision_body(entry, pr):
    parts = entry["parts"]
    sections = [("What was decided", ["Area: " + entry["area"], ""] + parts["What was decided"]),
                ("Other options and why this one", parts["Other options and why this one"]),
                ("Where it landed", ["Pull request: #%d" % pr, ""] + parts["Where it landed"]),
                ("To overturn it", parts["To overturn it"])]
    return "\n\n".join("## %s\n\n%s" % (name, "\n".join(body)) for name, body in sections) + "\n"

def lint(path):
    if not os.path.isfile(path):
        stop("no-file", "%s is no file" % path)
    if os.path.basename(path) == DECISIONS:
        with open(path, encoding="utf-8") as f:
            kind, reasons = "decisions", decision_entries(f.read())[0]
    else:
        kind, reasons = lint_reasons(path)
    emit(status="ok", ok=not reasons, kind=kind, reasons=reasons)

def command_of(block):
    got = fields(block, ("Command",))["Command"]
    text = got[0] if got else ""
    quoted = len(got) == 1 and len(text) > 1 and text[0] == text[-1] == "`"
    return (text[1:-1], run_args(text[1:-1])) if quoted else (text, None)

def rerun(args):
    _, wt, seat, probe = args
    return run_probe(os.path.normpath(wt), seat, probe)

def code_span(text):
    ticks = "`" * (max(map(len, re.findall(r"`+", text)), default=0) + 1)
    pad = " " if text.startswith("`") or text.endswith("`") else ""
    return ticks + pad + text + pad + ticks

def printed(result):
    shown = [line.strip() for line in result["output"].splitlines() if line.strip()]
    return "exit %d" % result["exit"] + (", " + code_span(shown[-1]) if shown else "")

def dropped_line(seat, why, numbers):
    what = "the command exited 0, so the failure did not show" if why == "exit-0" else "the command could not be run again, " + why
    return "- %s: %d, %s (finding%s %s)" % (seat, len(numbers), what, "s" if len(numbers) > 1 else "", ", ".join(map(str, numbers)))

def verify(wt, scope):
    if not re.fullmatch(SCOPE, scope):
        die("no such scope: " + scope)
    workdir, record = current_run(wt)
    review = os.path.join(workdir, "review")
    state = scope_state(review, scope)
    r = state["round"]
    earlier, new, dropped, dropouts = [], [], [], []
    earlier_lines, new_blocks, dropped_lines = [], [], []
    for finding in state["open"]:
        fid = finding["id"]
        j, n = map(int, fid[1:].split("."))
        raiser = parse_review(os.path.join(review, "%s-round-%d.md" % (scope, j)))
        command, args = command_of(section(raiser, "New findings")["blocks"][n - 1])
        if args is None:
            die("%s could not be run again: its Command is not one panel.sh run line" % fid)
        result = rerun(args)
        if result["status"] == "stop":
            die("%s could not be run again: %s" % (fid, result["message"]))
        word = "resolved" if result["exit"] == 0 else "stands again" if finding["stood"] else "stands"
        earlier_lines.append("- %s %s: ran: `%s`; saw: %s%s" % (fid, word, command, printed(result),
                                                                 DISAGREE if finding["reply"] == "disagree" else ""))
        earlier.append({"id": fid, "command": command, "exit": result["exit"], "output": result["output"],
                        "state": word, "reply": finding["reply"]})
    for seat in LEVEL_SEATS[record["level"]]:
        path = os.path.join(review, "%s-round-%d-%s.md" % (scope, r, seat))
        if not os.path.isfile(path):
            dropouts.append(seat)
            dropped_lines.append("- %s: no seat file" % seat)
            continue
        gone = {}
        for n, block in enumerate(section(parse_review(path), "Findings")["blocks"], 1):
            title = re.sub(r"^### (\d+\. )?", "", block[0])
            command, args = command_of(block)
            if args is None:
                why = "command"
            else:
                result = rerun(args)
                why = result["reason"] if result["status"] == "stop" else "exit-0" if result["exit"] == 0 else None
            if why:
                gone.setdefault(why, []).append(n)
                dropped.append({"seat": seat, "number": n, "title": title, "command": command, "why": why})
                continue
            fid = "R%d.%d" % (r, len(new) + 1)
            new.append({"id": fid, "seat": seat, "number": n, "title": title, "command": command,
                        "exit": result["exit"], "output": result["output"]})
            new_blocks.append("### %s %s\n\nFound by: %s\nCommand: `%s`\nPrinted: %s" % (fid, title, seat, command, printed(result)))
        dropped_lines += [dropped_line(seat, why, numbers) for why, numbers in gone.items()] or ["- %s: none" % seat]
    draft = os.path.join(workdir, "drafts", "%s-round-%d.md" % (scope, r))
    os.makedirs(os.path.dirname(draft), exist_ok=True)
    with open(draft, "w", encoding="utf-8") as out:
        out.write("# %s, round %d, draft\n\n## Earlier findings\n\n%s\n\n## New findings\n\n%s\n\n## Dropped\n\n%s\n" % (
            scope, r, "\n".join(earlier_lines) or "None.", "\n\n".join(new_blocks) or "None.", "\n".join(dropped_lines)))
    emit(status="ok", scope=scope, round=r, draft=draft, dropouts=dropouts, earlier=earlier, new=new, dropped=dropped)

def record_line(level, source, tasks, task_rounds, integration_rounds, findings):
    return "Level: %s (%s) · tasks %d · task rounds %d · integration rounds %d · findings %d" % (
        level, source, tasks, task_rounds, integration_rounds, findings)

def record(wt):
    workdir, run_record = current_run(wt)
    log, review = os.path.join(workdir, "log.md"), os.path.join(workdir, "review")
    if not os.path.isfile(log):
        stop("no-log", "no log.md in " + workdir)
    if not os.path.isdir(review):
        stop("no-review", "no review/ in " + workdir)
    rounds = sorted((k["scope"], k["round"], name) for name in os.listdir(review)
                    for k in [review_kind(name)] if k and k["kind"] == "round")
    failed = ["%s: %s" % (name, ", ".join(reasons)) for _, _, name in rounds
              for reasons in [lint_reasons(os.path.join(review, name))[1]] if reasons]
    if failed:
        stop("malformed", "round files that fail lint: " + "; ".join(failed))
    counted = [(scope, name) for scope, _, name in rounds if scope != "merge"]
    tasks = {scope for scope, _ in counted if scope != "integration"}
    integration_rounds = sum(scope == "integration" for scope, _ in counted)
    findings = sum(len(section(parse_review(os.path.join(review, name)), "New findings")["blocks"]) for _, name in counted)
    entry = record_line(run_record["level"], run_record["source"], len(tasks), len(counted) - integration_rounds,
                        integration_rounds, findings)
    with open(log, encoding="utf-8", errors="replace", newline="") as f:
        lines = [line for line in f.read().split("\n") if not RECORD_RE.match(line.rstrip("\r"))]
    if run_record["issue"] is not None:
        while lines and (not lines[0].strip() or HEAD_LINE.fullmatch(lines[0].rstrip("\r"))):
            lines.pop(0)
        lines = ["Implements #%d" % run_record["issue"], "Part of #%d" % run_record["parent"], ""] + lines
    with open(log, "w", encoding="utf-8", newline="") as f:
        f.write("\n".join(lines).rstrip("\r\n") + "\n\n" + entry + "\n")
    emit(status="ok", line=entry)

def filed_issue(entry, out):
    url = out.strip().splitlines()[-1]
    return {"title": entry["title"], "number": int(url.rstrip("/").rsplit("/", 1)[1]), "url": url}

def filed_names(filed):
    return ", ".join("#%d %s" % (issue["number"], issue["title"]) for issue in filed) or "none"

def decisions(wt, pr):
    workdir, _ = current_run(wt)
    path, kept = os.path.join(workdir, DECISIONS), os.path.join(workdir, DECISIONS_RECORD)
    if not os.path.isfile(path):
        stop("no-decisions", "no %s in %s" % (DECISIONS, workdir))
    with open(path, encoding="utf-8") as f:
        reasons, entries = decision_entries(f.read())
    if reasons:
        stop("malformed", "%s fails the lint: %s" % (path, ", ".join(reasons)))
    filed = []
    if os.path.isfile(kept):
        with open(kept, encoding="utf-8") as f:
            filed = json.load(f)
    done = {issue["title"] for issue in filed}
    todo = [entry for entry in entries if entry["title"] not in done]
    if todo:
        name, color, description = DECISION_LABEL
        r = run("gh", "label", "create", name, "--color", color, "--description", description, cwd=wt)
        if r.returncode != 0 and "already exists" not in r.stderr:
            stop("gh", "cannot create the label %s: %s; filed before: %s" % (name, r.stderr.strip(), filed_names(filed)))
    for entry in todo:
        r = run("gh", "issue", "create", "--title", entry["title"], "--label", DECISION_LABEL[0], "--body-file", "-",
                cwd=wt, input=decision_body(entry, int(pr)))
        if r.returncode != 0:
            stop("gh", "cannot file %s: %s; filed before: %s" % (entry["title"], r.stderr.strip(), filed_names(filed)))
        filed = filed + [filed_issue(entry, r.stdout)]
        with open(kept, "w", encoding="utf-8") as f:
            json.dump(filed, f, ensure_ascii=False)
            f.write("\n")
    emit(status="ok", filed=filed)

def main(sub, path, *args):
    table = {"run": lambda *given: emit(**run_probe(*given)), "close": close, "begin": begin, "status": status,
             "lint": lint, "verify": verify, "record": record, "decisions": decisions}
    try:
        table[sub](os.path.normpath(path), *args)
    except Stop as s:
        emit(status="stop", reason=s.reason, message=s.message)

if __name__ == "__main__":
    main(*sys.argv[1:])
