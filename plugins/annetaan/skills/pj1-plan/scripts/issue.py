import argparse, json, os, subprocess, sys

USAGE = """\
usage: issue.sh label <n> [--add <name>,...] [--remove <name>,...]
                                   add and remove labels on #<n> in one call, at least one of the two; make sure each added label exists
       issue.sh parent --title <t> --from <branch> [--blocked-by <Q>,<R>] [--roadmap <path> <heading>] --body <file>
                                   lint the parent body with its Base: and Roadmap: lines, file it labelled project, write those lines with its number
       issue.sh sub <P> --title <t> [--blocked-by <n>,<m>] [--blocking <k>] [--label <name>] --body <file>
                                   file a sub-issue of #<P> whose lint fails on nothing but decisions-open and stub, then check its edges for a cycle
       issue.sh relate <n> add|remove <m>
                                   add or remove "#<n> blocked by #<m>", and take an added edge back off when it made a cycle
       issue.sh order <P> --since <updatedAt>
                                   write the parent body from project.sh <P> --order-body
       issue.sh titles <P>         bring each open sub-issue's title to wantedTitle, and print the numbers retitled as changed
       issue.sh edit <n> --since <updatedAt> --body <file> [--title <t>]
                                   edit a body; a parent body has to pass the parent lint
       issue.sh comment <n> --body <file>
                                   post a marked comment
       issue.sh handover <P> [--since <updated_at>] --body <file>
                                   rewrite the parent's handover comment; without --since, post it only when there is none
       issue.sh close <n> --reason completed|not-planned --comment <file>
                                   post the marked comment and close #<n> in one write; on a closed issue, write nothing
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message":
moved, closed, no-marker, lint or cycle. Exit 1 means a usage error or an unexpected failure.
"""

MARKERS = ("**[pj3-doctor]**", "**[pj4-running]**", "**[pj-cleanup]**")
HANDOVER = "**[pj4-running]** Handover notes"

LABELS = {
    "ready": ("0E8A16", "Every decision is settled and the body is complete for its day. "
                        "pj4-running details it against the code, then works on it."),
    "blocker": ("B60205", "pj4-running stopped on this. Settle it before anything else."),
    "project": ("5319E7", "The parent issue of a pj project. Its sub-issues are the project's tasks."),
    "doing": ("1D76DB", "A pj project whose sub-issues are filed. It marks the parent issue."),
}

def check_marker(path):
    if text_of(path).startswith(MARKERS):
        return None
    return "%s does not start with a marker" % path

def text_of(path):
    with open(path, encoding="utf-8") as f:
        return f.read()

def run(*cmd, input=None):
    return subprocess.run(cmd, capture_output=True, text=True, input=input)

def emit(**obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)

def stop(reason, message, **extra):
    emit(status="stop", reason=reason, message=message, **extra)

def die(msg):
    print("issue: " + msg, file=sys.stderr)
    sys.exit(1)

class Parser(argparse.ArgumentParser):
    def error(self, message):
        sys.stderr.write(USAGE)
        die(message)

def number(s):
    if not (s.isascii() and s.isdigit() and int(s) > 0):
        raise argparse.ArgumentTypeError("not a positive number: %s" % s)
    return int(s)

def numbers(s):
    return [number(x) for x in s.split(",")]

def label_name(s):
    if s not in LABELS:
        raise argparse.ArgumentTypeError("not a pj label: %s" % s)
    return s

def label_names(s):
    return [label_name(x) for x in s.split(",")]

def existing_file(s):
    if not os.path.isfile(s):
        raise argparse.ArgumentTypeError("no such file: %s" % s)
    return s

def joined(ns):
    return ",".join(str(n) for n in ns)

def gh(*args, input=None):
    r = run("gh", *args, input=input)
    if r.returncode != 0:
        die("gh %s failed: %s" % (" ".join(args), r.stderr.strip()))
    return r.stdout

def view(n):
    v = json.loads(gh("issue", "view", str(n), "--json", "state,updatedAt,labels,parent,body"))
    v["labels"] = [l["name"] for l in v["labels"]]
    return v

def refuse_closed(v, n):
    if v["state"] == "CLOSED":
        stop("closed", "#%d is closed" % n)

def lint(project_sh, flag, text):
    r = run(project_sh, flag, "-", input=text)
    if r.returncode != 0:
        die("project.sh %s failed: %s" % (flag, r.stderr.strip()))
    return json.loads(r.stdout)

def ensure_label(name):
    color, description = LABELS[name]
    r = run("gh", "label", "create", name, "--color", color, "--description", description)
    if r.returncode != 0 and "already exists" not in r.stderr:
        die("cannot create the label %s: %s" % (name, r.stderr.strip()))

def cycle_check(project_sh, p):
    return run(project_sh, str(p), "--order")

def is_cycle(r):
    return "have a cycle" in r.stderr

def moved(message, key, value, file, text):
    extra = {key: value}
    if text is not None:
        extra["github"] = file + ".github"
        with open(extra["github"], "w", encoding="utf-8") as f:
            f.write(text)
    stop("moved", message, **extra)

def filed(out):
    url = out.strip().splitlines()[-1]
    return int(url.rstrip("/").rsplit("/", 1)[1]), url

def label(a):
    if not a.add and not a.remove:
        a.parser.error("label takes --add, --remove or both")
    refuse_closed(view(a.n), a.n)
    edit = []
    if a.add:
        for name in a.add:
            ensure_label(name)
        edit += ["--add-label", ",".join(a.add)]
    if a.remove:
        edit += ["--remove-label", ",".join(a.remove)]
    gh("issue", "edit", str(a.n), *edit)
    emit(status="ok")

def parent(a):
    def body(n):
        head = ["Base: `pj/%d` from `%s`" % (n, a.from_)]
        if a.roadmap:
            head.append("Roadmap: `%s` %s" % tuple(a.roadmap))
        return "\n".join(head) + "\n\n" + text_of(a.body)
    result = lint(a.project_sh, "--parent-lint", body(0))
    if not result["ok"]:
        stop("lint", "the parent body fails the parent lint", reasons=result["reasons"])
    ensure_label("project")
    create = ["issue", "create", "--label", "project", "--title", a.title, "--body-file", a.body]
    if a.blocked_by:
        create += ["--blocked-by", joined(a.blocked_by)]
    n, url = filed(gh(*create))
    r = run("gh", "issue", "edit", str(n), "--body-file", "-", input=body(n))
    if r.returncode != 0:
        die("filed #%d %s but could not write its Base: line: %s" % (n, url, r.stderr.strip()))
    emit(status="ok", number=n, url=url)

def sub(a):
    result = lint(a.project_sh, "--lint", text_of(a.body))
    failing = [x for x in result["reasons"] if x not in ("decisions-open", "stub")]
    if failing:
        stop("lint", "the body fails the lint", reasons=result["reasons"])
    refuse_closed(view(a.p), a.p)
    if a.label:
        ensure_label(a.label)
    create = ["issue", "create", "--parent", str(a.p), "--title", a.title, "--body-file", a.body]
    undo = []
    if a.blocked_by:
        create += ["--blocked-by", joined(a.blocked_by)]
        undo += ["--remove-blocked-by", joined(a.blocked_by)]
    if a.blocking:
        create += ["--blocking", str(a.blocking)]
        undo += ["--remove-blocking", str(a.blocking)]
    if a.label:
        create += ["--label", a.label]
    n, url = filed(gh(*create))
    if undo:
        r = cycle_check(a.project_sh, a.p)
        if r.returncode != 0:
            gh("issue", "edit", str(n), *undo)
            if is_cycle(r):
                stop("cycle", "#%d made a cycle, so its edges are taken back off: %s" % (n, r.stderr.strip()),
                     number=n, url=url)
            die("filed #%d %s, took its edges back off, and project.sh %d --order failed: %s"
                % (n, url, a.p, r.stderr.strip()))
    emit(status="ok", number=n, url=url)

def relate(a):
    v = view(a.n)
    if "project" in v["labels"]:
        x = a.n
    elif v["parent"]:
        x = v["parent"]["number"]
    else:
        die("#%d is neither a parent nor a sub-issue" % a.n)
    refuse_closed(v, a.n)
    gh("issue", "edit", str(a.n), "--%s-blocked-by" % a.action, str(a.m))
    if a.action == "add":
        r = cycle_check(a.project_sh, x)
        if r.returncode != 0:
            gh("issue", "edit", str(a.n), "--remove-blocked-by", str(a.m))
            if is_cycle(r):
                stop("cycle", "#%d blocked by #%d made a cycle, so it is taken back off: %s"
                     % (a.n, a.m, r.stderr.strip()))
            die("took #%d blocked by #%d back off, because project.sh %d --order failed: %s"
                % (a.n, a.m, x, r.stderr.strip()))
    emit(status="ok")

def order(a):
    refuse_closed(view(a.p), a.p)
    r = run(a.project_sh, str(a.p), "--order-body")
    if r.returncode != 0:
        if is_cycle(r):
            stop("cycle", r.stderr.strip())
        die("project.sh %d --order-body failed: %s" % (a.p, r.stderr.strip()))
    now = view(a.p)["updatedAt"]
    if now != a.since:
        moved("#%d changed on GitHub since %s" % (a.p, a.since), "updatedAt", now, None, None)
    gh("issue", "edit", str(a.p), "--body-file", "-", input=r.stdout)
    emit(status="ok")

def titles(a):
    r = run(a.project_sh, str(a.p))
    if r.returncode != 0:
        die("project.sh %d failed: %s" % (a.p, r.stderr.strip()))
    changed = []
    for i in json.loads(r.stdout)["issues"]:
        if i["state"] == "OPEN" and i["wantedTitle"] != i["title"]:
            gh("issue", "edit", str(i["number"]), "--title", i["wantedTitle"])
            changed.append(i["number"])
    emit(status="ok", changed=changed)

def edit(a):
    v = view(a.n)
    if "project" in v["labels"]:
        result = lint(a.project_sh, "--parent-lint", text_of(a.body))
        if not result["ok"]:
            stop("lint", "the parent body fails the parent lint", reasons=result["reasons"])
    refuse_closed(v, a.n)
    v = view(a.n)
    if v["updatedAt"] != a.since:
        moved("#%d changed on GitHub since %s" % (a.n, a.since), "updatedAt", v["updatedAt"], a.body, v["body"])
    gh("issue", "edit", str(a.n), "--body-file", a.body, *(["--title", a.title] if a.title else []))
    emit(status="ok")

def comment(a):
    missing = check_marker(a.body)
    if missing:
        stop("no-marker", missing)
    refuse_closed(view(a.n), a.n)
    gh("issue", "comment", str(a.n), "--body-file", a.body)
    emit(status="ok")

def handover(a):
    if not text_of(a.body).startswith(HANDOVER):
        stop("no-marker", "%s does not start with %s" % (a.body, HANDOVER))
    refuse_closed(view(a.p), a.p)
    out = gh("api", "repos/{owner}/{repo}/issues/%d/comments" % a.p, "--paginate", "--jq",
             '.[] | select(.body | startswith("%s")) | {id, updated_at, body}' % HANDOVER)
    lines = [l for l in out.splitlines() if l.strip()]
    found = json.loads(lines[0]) if lines else None
    if a.since is None:
        if found:
            moved("#%d already has a handover comment" % a.p, "updated_at", found["updated_at"], a.body,
                  found["body"])
        gh("issue", "comment", str(a.p), "--body-file", a.body)
    else:
        if not found:
            moved("the handover comment of #%d is gone" % a.p, "updated_at", None, a.body, None)
        if found["updated_at"] != a.since:
            moved("the handover comment of #%d changed since %s" % (a.p, a.since), "updated_at",
                  found["updated_at"], a.body, found["body"])
        gh("api", "-X", "PATCH", "repos/{owner}/{repo}/issues/comments/%d" % found["id"], "-F", "body=@" + a.body)
    emit(status="ok")

def close(a):
    missing = check_marker(a.comment)
    if missing:
        stop("no-marker", missing)
    if view(a.n)["state"] == "CLOSED":
        emit(status="ok")
    gh("issue", "close", str(a.n), "--reason", "not planned" if a.reason == "not-planned" else a.reason,
       "--comment", text_of(a.comment))
    emit(status="ok")

def main(argv):
    parser = Parser(prog="issue.sh", add_help=False)
    commands = parser.add_subparsers(dest="command", required=True)

    def command(name, func):
        p = commands.add_parser(name, add_help=False)
        p.set_defaults(func=func, parser=p)
        return p

    p = command("label", label)
    p.add_argument("n", type=number)
    p.add_argument("--add", type=label_names)
    p.add_argument("--remove", type=label_names)

    p = command("parent", parent)
    p.add_argument("--title", required=True)
    p.add_argument("--from", dest="from_", required=True)
    p.add_argument("--blocked-by", type=numbers)
    p.add_argument("--roadmap", nargs=2)
    p.add_argument("--body", type=existing_file, required=True)

    p = command("sub", sub)
    p.add_argument("p", type=number)
    p.add_argument("--title", required=True)
    p.add_argument("--blocked-by", type=numbers)
    p.add_argument("--blocking", type=number)
    p.add_argument("--label", type=label_name)
    p.add_argument("--body", type=existing_file, required=True)

    p = command("relate", relate)
    p.add_argument("n", type=number)
    p.add_argument("action", choices=("add", "remove"))
    p.add_argument("m", type=number)

    p = command("order", order)
    p.add_argument("p", type=number)
    p.add_argument("--since", required=True)

    p = command("titles", titles)
    p.add_argument("p", type=number)

    p = command("edit", edit)
    p.add_argument("n", type=number)
    p.add_argument("--since", required=True)
    p.add_argument("--body", type=existing_file, required=True)
    p.add_argument("--title")

    p = command("comment", comment)
    p.add_argument("n", type=number)
    p.add_argument("--body", type=existing_file, required=True)

    p = command("handover", handover)
    p.add_argument("p", type=number)
    p.add_argument("--since")
    p.add_argument("--body", type=existing_file, required=True)

    p = command("close", close)
    p.add_argument("n", type=number)
    p.add_argument("--reason", choices=("completed", "not-planned"), required=True)
    p.add_argument("--comment", type=existing_file, required=True)

    a = parser.parse_args(argv[1:])
    a.project_sh = argv[0]
    a.func(a)

if __name__ == "__main__":
    main(sys.argv[1:])
