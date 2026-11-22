import fcntl, json, os, re, shutil, subprocess, sys, tempfile, time

SEATS = ("a", "b")
TAIL = 40
STAMP = re.compile(r"\d{4}-\d{2}-\d{2}-\d{4}(-|$)")
ROUND_NAME = re.compile(r"(task-[1-9]\d*|integration|merge)-round-([1-9]\d*)(?:-(a|b|reply|evidence))?\.md")
FIRST_EVIDENCE_NAME = re.compile(r"(task-[1-9]\d*|merge)-evidence\.md")
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
ANSWER = re.compile(r"- (%s) (fixed|disagree): \S" % FINDING_ID)
SUB_BULLET = re.compile(r"\s+- (ran|saw|not run):")
FORBIDDEN = set("$\"';&|<>()`")
REASONS = ("sections", "id", "finding", "command", "entry", "seats", "no-round", "mark", "earlier-missing", "verdict",
           "approve-open", "approve-no-evidence", "line", "missing", "ran", "assumed", "no-evidence")

def run(*cmd, cwd=None, env=None):
    return subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, env=env)

def emit(**obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)

def stop(reason, message, **extra):
    emit(status="stop", reason=reason, message=message, **extra)

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
    require_live_wt(wt)
    reports = os.path.realpath(os.path.join(wt, "work-reports")) + os.sep
    if not probe.startswith(reports):
        stop("outside", "%s is not under %s" % (probe, reports))
    script = os.path.join(probe, "run.sh")
    if not os.path.isfile(script):
        stop("no-script", "%s has no run.sh" % probe)
    lock = lock_path(wt, wt, seat)
    held = take_lock(lock, seat)
    try:
        snap = snapshot(wt)
        path = prepare(wt, seat, snap)
        overlay = os.path.join(probe, "tree")
        if os.path.isdir(overlay):
            shutil.copytree(overlay, path, symlinks=True, dirs_exist_ok=True)
        r = subprocess.run(["bash", script], cwd=path, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, text=True, errors="replace")
        lines = r.stdout.splitlines()
        emit(status="ran", seat=seat, snapshot=snap, exit=r.returncode, lines=len(lines),
             output="\n".join(lines[-TAIL:]))
    finally:
        os.close(held)

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
    record = {"start": start, "level": int(opts["--level"]), "source": opts["--source"],
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

def status(wt):
    workdir, record = current_run(wt)
    emit(status="ok", start=record["start"], workdir=workdir, level=record["level"], source=record["source"],
         issue=record["issue"], parent=record["parent"])

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

def run_args(line):
    words = line.split()
    if len(words) != 5 or FORBIDDEN & set(line):
        return None
    script, sub, wt, seat, probe = words
    if (os.path.isabs(script) and script.endswith("/panel.sh") and sub == "run" and os.path.isabs(wt)
            and seat in SEATS and probe.startswith(wt.rstrip("/") + "/work-reports/")):
        return script, wt, seat, probe
    return None

def finding_reasons(block, names):
    got = {name: [text[len(name) + 1:].strip() for text in block[1:] if text.startswith(name + ":")] for name in names}
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
        listed = set()
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
        if before is not None and set(before) - listed:
            found.add("earlier-missing")
        for n, block in enumerate(section(parsed, "New findings")["blocks"], 1):
            if not re.match(r"### R%d\.%d \S" % (r, n), block[0]):
                found.add("id")
            found |= finding_reasons(block, ("Found by", "Command", "Printed", "Required", "Breaks"))
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

def lint(path):
    if not os.path.isfile(path):
        stop("no-file", "%s is no file" % path)
    kind, reasons = lint_reasons(path)
    emit(status="ok", ok=not reasons, kind=kind, reasons=reasons)

def main(sub, path, *args):
    {"run": run_probe, "close": close, "begin": begin, "status": status, "lint": lint}[sub](os.path.normpath(path), *args)

if __name__ == "__main__":
    main(*sys.argv[1:])
