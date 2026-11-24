import hashlib, json, os, re, subprocess, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "workflow", "scripts"))
from clone import fetch_branch

MODE = sys.argv[1]

SECTIONS = ["Goal", "Design", "Acceptance criteria", "Decisions", "Out of scope"]
ENTRY_RE = re.compile(r"^\s*[-*]\s+`([^`]+)`\s+\((added|changed|deleted)\):\s*(.+)$")
IDENT_RE = re.compile(r"^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$")
OPTION_RE = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s")
DECISION_RE = re.compile(r"^###\s+D\d+\.")
BASE_RE = re.compile(r"^Base:\s*`?([^`\s]+)`?\s+from\s+`?([^`\s]+)`?\s*$")
ROADMAP_RE = re.compile(r"^Roadmap:\s*`([^`]+)`\s+(\S.*?)\s*$")
ORDER_RE = re.compile(r"^\s*\d+\.\s+#(\d+)\b")
IMPLEMENTS_RE = re.compile(r"^Implements #(\d+)\s*$")
COUNT_RE = re.compile(r"(\s*\(\d+/\d+\))+\s*$")
PARENT_SECTIONS = ["Goal", "Design", "Decisions", "Out of scope"]
PARENT_BASE_RE = re.compile(r"^Base: `pj/\d+` from `[^`\s]+`\s*$")
ORDER_LINE_RE = re.compile(r"^\d+\. #\d+$")
ONLY_YOU_KNOW_RE = re.compile(r"^Only you know:\s*\S")
URL_RE = re.compile(r"\b[a-z][a-z0-9+.-]*://\S+")
LINE_ANCHOR_RE = re.compile(r"#L\d+\b", re.ASCII)
PATH_LINE_RE = re.compile(r"(?<![\w.:/-])(?=[\w./-]*[A-Za-z])[\w.-]*[./][\w./-]*:\d+\b", re.ASCII)
ROADMAP_PATHS = ["roadmap.md", "ROADMAP.md", "doc/roadmap.md", "doc/ROADMAP.md", "docs/roadmap.md", "docs/ROADMAP.md"]
DOCUMENT_SUFFIXES = (".md", ".mdx", ".markdown", ".rst", ".adoc")

def die(msg):
    print("project: " + msg, file=sys.stderr)
    sys.exit(1)

def unfenced(text):
    fence = False
    for line in (text or "").replace("\r\n", "\n").split("\n"):
        if line.lstrip().startswith("```"):
            fence = not fence
            continue
        if not fence:
            yield line

def head_of(body):
    out = []
    for line in unfenced(body):
        if line.startswith("## "):
            break
        out.append(line)
    return out

def base_of(body):
    for line in head_of(body):
        m = BASE_RE.match(line)
        if m:
            return m.group(1), m.group(2)
    return None

def roadmap_path(line):
    m = ROADMAP_RE.match(line)
    if not m:
        return None
    path = m.group(1).strip()
    if path.startswith("./"):
        path = path[2:]
    return (path, m.group(2)) if path in ROADMAP_PATHS else None

def roadmap_of(body):
    for line in head_of(body):
        if ROADMAP_RE.match(line):
            return roadmap_path(line)
    return None

def order_of(body):
    _, secs = split_sections(body)
    out = []
    for line in secs.get("Order", "").split("\n"):
        m = ORDER_RE.match(line)
        if m:
            out.append(int(m.group(1)))
    return out

def implements(body):
    for line in (body or "").replace("\r\n", "\n").split("\n"):
        if line.strip():
            m = IMPLEMENTS_RE.match(line)
            return int(m.group(1)) if m else None
    return None

def shown(issue):
    return dict({k: v for k, v in issue.items() if k not in ("files", "criteria")}, pr=pr_of.get(issue["number"]))

def headings(lines):
    fence, out = False, []
    for k, line in enumerate(lines):
        if line.lstrip().startswith("```"):
            fence = not fence
        elif not fence:
            m = re.match(r"^##\s+(.+?)\s*$", line)
            if m:
                out.append((k, m.group(1)))
    return out

def with_order(body, numbers):
    lines = (body or "").replace("\r", "").split("\n")
    titled_heads = headings(lines)
    heads = [k for k, _ in titled_heads]
    block = ["## Order", ""] + (["%d. #%d" % (k + 1, n) for k, n in enumerate(numbers)] + [""] if numbers else [])
    start = next((k for k, title in titled_heads if title == "Order"), None)
    if start is not None:
        end = next((k for k in heads if k > start), len(lines))
        out = lines[:start] + block + lines[end:]
    elif heads:
        out = lines[:heads[0]] + block + lines[heads[0]:]
    else:
        text = "\n".join(lines).rstrip("\n")
        out = ([text, ""] if text else []) + block
    return "\n".join(out).rstrip("\n") + "\n"

def run(*cmd):
    return subprocess.run(cmd, capture_output=True, text=True)

def roadmap_parse(text):
    lines = (text or "").replace("\r", "").split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    entries, reasons, seen, titles = [], [], set(), 0
    fence, k = False, 0
    if lines and lines[0].strip() == "---":
        close = next((j for j in range(1, len(lines)) if lines[j].strip() in ("---", "...")), None)
        if close is not None:
            k = close + 1
    prev = ""
    for n in range(k, len(lines)):
        line = lines[n]
        if line.lstrip().startswith("```"):
            fence = not fence
            prev = ""
            continue
        if fence:
            continue
        m = re.match(r"^##\s+(.+?)\s*$", line) if not line.startswith("###") and line.strip() != "##" else None
        if m:
            heading = m.group(1)
            if entries:
                entries[-1]["end"] = n
            entries.append({"heading": heading, "start": n + 1, "end": len(lines)})
            if heading in seen:
                reasons.append({"code": "duplicate-heading", "line": n + 1, "heading": heading})
            seen.add(heading)
        elif line.strip() == "##":
            reasons.append({"code": "empty-heading", "line": n + 1})
        elif re.match(r"^#\s+\S", line):
            if entries:
                reasons.append({"code": "title-after-entry", "line": n + 1})
            else:
                titles += 1
                if titles == 2:
                    reasons.append({"code": "several-titles", "line": n + 1})
        elif re.match(r"^\s{0,3}(=+|-+)\s*$", line) and prev.strip() and not prev.lstrip().startswith(("#", ">", "-", "*", "+", "|")) \
                and not re.match(r"^\s{0,3}\d{1,9}[.)](\s|$)", prev) \
                and not re.match(r"^\s{0,3}(=+|-+)\s*$", prev):
            reasons.append({"code": "setext-heading", "line": n, "heading": prev.strip()})
        prev = line
    return entries, reasons

def roadmap_read(ref):
    top = run("git", "rev-parse", "--show-toplevel")
    if top.returncode != 0:
        die("not inside a git work tree")
    top = top.stdout.strip()
    if ref:
        if ref.startswith("-") or run("git", "-C", top, "rev-parse", "--verify", "--quiet", ref + "^{commit}").returncode != 0:
            die("git cannot read the ref: " + ref)
        tree = run("git", "-C", top, "ls-tree", ref, "--", *ROADMAP_PATHS)
        if tree.returncode != 0:
            die("git cannot read the ref: " + ref)
        found = set()
        for l in tree.stdout.split("\n"):
            meta, _, path = l.partition("\t")
            if meta.split(" ")[1:2] == ["blob"]:
                found.add(path.strip('"'))
    else:
        found = set()
        for d in ("", "doc", "docs"):
            try:
                names = os.listdir(os.path.join(top, d))
            except OSError:
                continue
            for name in names:
                path = d + "/" + name if d else name
                if path in ROADMAP_PATHS and os.path.isfile(os.path.join(top, path)):
                    found.add(path)
    files = [p for p in ROADMAP_PATHS if p in found]
    out = {"ok": False, "files": files, "path": None, "entries": [], "reasons": []}
    if not files:
        out["reasons"].append({"code": "no-file"})
        return out
    if len(files) > 1:
        out["reasons"].append({"code": "several-files"})
        return out
    out["path"] = files[0]
    if ref:
        shown_ = run("git", "-C", top, "show", ref + ":" + files[0])
        if shown_.returncode != 0:
            die("git cannot read %s at %s" % (files[0], ref))
        text = shown_.stdout
    else:
        with open(os.path.join(top, files[0]), encoding="utf-8", errors="replace") as f:
            text = f.read()
    out["entries"], out["reasons"] = roadmap_parse(text)
    out["ok"] = not out["reasons"]
    return out

def graphql(fields, ints=None, strs=None, what="read the repository"):
    ints, strs = ints or {}, strs or {}
    decls = ["$owner: String!", "$name: String!"]
    decls += ["$%s: Int!" % k for k in ints] + ["$%s: String!" % k for k in strs]
    cmd = ["gh", "api", "graphql", "-f", "owner=" + REPO_OWNER, "-f", "name=" + REPO_NAME]
    for k, v in ints.items():
        cmd += ["-F", "%s=%d" % (k, v)]
    for k, v in strs.items():
        cmd += ["-f", "%s=%s" % (k, v)]
    cmd += ["-f", "query=query(%s) { repository(owner: $owner, name: $name) { %s } }" % (", ".join(decls), fields)]
    q = run(*cmd)
    if q.returncode != 0:
        die("cannot %s: %s" % (what, q.stderr.strip()))
    return json.loads(q.stdout)["data"]["repository"]

def raw_sections(body):
    lines = (body or "").replace("\r\n", "\n").split("\n")
    heads = headings(lines) + [(len(lines), None)]
    order, out = [], {}
    for (k, name), (end, _) in zip(heads, heads[1:]):
        order.append(name)
        out[name] = "\n".join(lines[k + 1:end])
    return order, out

def with_sections(body, path):
    lines = (body or "").replace("\r", "").split("\n")
    goal = next((k for k, title in headings(lines) if title == "Goal"), None)
    if goal is None:
        die("the parent body has no ## Goal heading")
    new = open(path).read().replace("\r", "").split("\n")
    filled = [k for k, line in enumerate(new) if line.strip()]
    if not filled or new[filled[0]].rstrip() != "## Goal":
        die("%s does not start at ## Goal" % path)
    return "\n".join(lines[:goal] + new[filled[0]:filled[-1] + 1]) + "\n"

def design_section(body):
    lines = (body or "").replace("\r", "").split("\n")
    heads = headings(lines)
    start = next((k for k, title in heads if title == "Design"), None)
    if start is None:
        return ""
    end = next((k for k, _ in heads if k > start), len(lines))
    return "\n".join(lines[start:end]).strip("\n")

def unfenced_indexes(lines):
    fence = False
    for k, line in enumerate(lines):
        if line.lstrip().startswith("```"):
            fence = not fence
        elif not fence:
            yield k

def cut_decision(block):
    open_lines = list(unfenced_indexes(block))
    parts = [block[0]]
    for k in open_lines:
        m = OPTION_RE.match(block[k])
        if m and m.group(1) in "xX":
            end = next((j for j in range(k + 1, len(block))
                        if block[j].strip() and (not block[j][:1].isspace() or OPTION_RE.match(block[j]))), len(block))
            parts.append("\n".join(block[k:end]).strip("\n"))
    parts += [block[k] for k in open_lines if block[k].startswith("Decided:")][:1]
    return "\n\n".join(parts)

def cut_decisions(text):
    lines = text.split("\n")
    starts = [k for k in unfenced_indexes(lines) if DECISION_RE.match(lines[k])]
    if not starts:
        return text
    head = "\n".join(lines[:starts[0]]).strip("\n")
    cut = [cut_decision(lines[a:b]) for a, b in zip(starts, starts[1:] + [len(lines)])]
    return "\n\n".join(([head] if head else []) + cut)

def approved_design(issue, parent, waited, broken):
    n, title, body = issue
    lines = (body or "").replace("\r", "").split("\n")
    heads = headings(lines)
    goal = next((k for k, t in heads if t == "Goal"), 0)
    dec = next((k for k, t in heads if t == "Decisions"), None)
    if dec is None:
        own = lines[goal:]
    else:
        end = next((k for k, _ in heads if k > dec), len(lines))
        cut = cut_decisions("\n".join(lines[dec + 1:end]).strip("\n"))
        own = lines[goal:dec + 1] + ["", cut, ""] + lines[end:]
    parts = ["# Issue #%d: %s" % (n, COUNT_RE.sub("", title)), "\n".join(own).strip("\n"),
             "# Parent #%d: %s" % (parent[0], parent[1]), design_section(parent[2])]
    for q, t, b in waited:
        parts += ["# Waited-on project #%d: %s" % (q, t), design_section(b)]
    parts += ["# Left broken on the base branch",
              "\n".join("- `%s` (left by #%d)" % c for c in broken) if broken else "None."]
    return "\n\n".join(p for p in parts if p) + "\n"

def split_sections(body):
    order, raw = raw_sections(body)
    return order, {k: "\n".join(unfenced(v)).strip() for k, v in raw.items()}

def spans_of(desc):
    out = []
    for span in re.findall(r"`([^`\n]+)`", desc):
        span = re.sub(r"\(.*\)$", "", span.strip())
        if IDENT_RE.match(span) and span not in out:
            out.append(span)
    return out

def is_document(path):
    return path.lower().endswith(DOCUMENT_SUFFIXES)

def symbols(entry, paths):
    out = []
    for span in entry["spans"]:
        if span in paths:
            continue
        sym = span.split(".")[-1]
        if sym not in out:
            out.append(sym)
    return out

def file_list(design):
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
        files.append({"path": path, "kind": m.group(2), "spans": spans_of(m.group(3))})
    return files, bad

def left_broken(design):
    lines, k = design.split("\n"), None
    for n, line in enumerate(lines):
        if re.match(r"^###\s+Left broken\s*$", line):
            k = n
            break
    if k is None:
        return [], False
    bullets = []
    for line in lines[k + 1:]:
        if line.startswith("###"):
            break
        if re.match(r"^\s*[-*]\s", line):
            bullets.append(line.strip())
        elif bullets and line.strip() and line[0].isspace():
            bullets[-1] += " " + line.strip()
    checks, bad = [], not bullets
    for b in bullets:
        m = re.search(r"`([^`\n]+)`", b)
        if not m or not m.group(1).strip():
            bad = True
        elif m.group(1).strip() not in checks:
            checks.append(m.group(1).strip())
    return checks, bad

def criteria_spans(secs):
    out = []
    for line in secs.get("Acceptance criteria", "").split("\n"):
        if re.match(r"^\s*[-*]\s", line):
            out += [s.strip() for s in re.findall(r"`([^`\n]+)`", line)]
    return out

def decisions(text):
    out = []
    lines, fence = text.split("\n"), False
    for k, line in enumerate(lines):
        if line.lstrip().startswith("```"):
            fence = not fence
            continue
        if fence:
            continue
        if DECISION_RE.match(line):
            out.append({"checked": 0, "options": 0, "recommended": 0, "onlyYouKnow": False, "optionLines": True})
            continue
        if not out:
            continue
        d = out[-1]
        if ONLY_YOU_KNOW_RE.match(line):
            d["onlyYouKnow"] = True
        m = OPTION_RE.match(line)
        if m:
            d["options"] += 1
            d["checked"] += m.group(1) in "xX"
            d["recommended"] += "(recommended)" in line
            under = next((l for l in lines[k + 1:] if l.strip()), "")
            if not under[:1].isspace() or OPTION_RE.match(under):
                d["optionLines"] = False
    return out

def decision_counts(decs):
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
    decs = decisions(raw_sections(body)[1].get("Decisions", ""))
    broken, bad_broken = left_broken(design)
    text = "\n".join(unfenced(body))
    return {
        "head": head_of(body),
        "lineNumber": bool(LINE_ANCHOR_RE.search(text) or PATH_LINE_RE.search(URL_RE.sub(" ", text))),
        "order": order, "secs": secs, "files": files, "bad_entries": bad, "decs": decs,
        "broken": broken, "bad_broken": bad_broken, "criteria": criteria_spans(secs),
        "stub": design == "To be drawn.",
    }

def lint(p, paths=frozenset()):
    if p["stub"]:
        return {"ok": False, "reasons": ["stub"]}
    reasons = []
    if p["order"] != SECTIONS:
        reasons.append("sections")
    if not p["files"]:
        reasons.append("no-files")
    if p["bad_entries"]:
        reasons.append("file-entry")
    known = {f["path"] for f in p["files"]} | paths
    if any(f["kind"] == "changed" and not is_document(f["path"]) and not symbols(f, known) for f in p["files"]):
        reasons.append("no-symbols")
    criteria = [l for l in p["secs"].get("Acceptance criteria", "").split("\n") if re.match(r"^\s*[-*]\s", l)]
    if not criteria or any("`" not in l for l in criteria):
        reasons.append("criteria")
    if p["bad_broken"]:
        reasons.append("breakage-entry")
    if p["lineNumber"]:
        reasons.append("line-number")
    if any(not d["optionLines"] for d in p["decs"]):
        reasons.append("option-shape")
    reasons += decision_reasons(p)
    return {"ok": not reasons, "reasons": reasons}

def decision_reasons(p):
    reasons = []
    decs, dtext = p["decs"], p["secs"].get("Decisions", "")
    if (not decs and dtext != "None.") or any(not 2 <= d["options"] <= 4 or d["recommended"] != 1 for d in decs):
        reasons.append("decision-shape")
    if any(not d["onlyYouKnow"] for d in decs):
        reasons.append("only-you-know")
    if any(d["checked"] == 0 for d in decs):
        reasons.append("decisions-open")
    if any(d["checked"] > 1 for d in decs):
        reasons.append("decisions-contradictory")
    return reasons

def parent_lint(p):
    reasons = []
    if not any(PARENT_BASE_RE.match(l) for l in p["head"]):
        reasons.append("base")
    if any(l.startswith("Roadmap:") and not roadmap_path(l) for l in p["head"]):
        reasons.append("roadmap")
    if any(l.strip() and not ORDER_LINE_RE.match(l.rstrip()) for l in p["secs"].get("Order", "").split("\n")):
        reasons.append("order")
    heads = p["order"]
    if [h for h in heads if h != "Order"] != PARENT_SECTIONS or \
            any(k > heads.index("Goal") for k, h in enumerate(heads) if h == "Order"):
        reasons.append("sections")
    reasons += decision_reasons(p)
    return {"ok": not reasons, "reasons": reasons}

def titled(title, counts):
    bare = COUNT_RE.sub("", title)
    if counts["settled"] < counts["total"]:
        return bare + " (%d/%d)" % (counts["settled"], counts["total"])
    return bare

def read_body(src):
    return sys.stdin.read() if src == "-" else open(src).read()

if MODE == "lint":
    parsed = parse(read_body(sys.argv[2]))
    print(json.dumps(dict(lint(parsed), decisions=decision_counts(parsed["decs"])), ensure_ascii=False))
    sys.exit(0)

if MODE == "parent-lint":
    print(json.dumps(parent_lint(parse(read_body(sys.argv[2]))), ensure_ascii=False))
    sys.exit(0)

def same_words(before_file, after_file):
    def words(text):
        return " ".join(text.replace("`", "").split())
    before, after = open(before_file).read(), open(after_file).read()
    return {"ok": words(before) == words(after), "lint": lint(parse(after))}

if MODE == "same-words":
    print(json.dumps(same_words(sys.argv[2], sys.argv[3]), ensure_ascii=False))
    sys.exit(0)

if MODE == "roadmap":
    print(json.dumps(roadmap_read(sys.argv[2]), ensure_ascii=False))
    sys.exit(0)

issues_file, repo = sys.argv[2], sys.argv[3]
REPO_OWNER, REPO_NAME = repo.split("/", 1)

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
roadmap_line = roadmap_of(parent["body"])

if MODE == "parent-body":
    sys.stdout.write(with_sections(parent["body"], sys.argv[4]))
    sys.exit(0)

issues = []
body_of = {}
for node in parent["subIssues"]["nodes"]:
    body_of[node["number"]] = node["body"]
    p = parse(node["body"])
    counts = decision_counts(p["decs"])
    issues.append({
        "number": node["number"],
        "title": node["title"],
        "url": node["url"],
        "wantedTitle": titled(node["title"], counts),
        "state": node["state"],
        "stateReason": node.get("stateReason"),
        "updatedAt": node["updatedAt"],
        "labels": [l["name"] for l in node["labels"]["nodes"]],
        "blockedBy": [{"number": b["number"], "state": b["state"], "parent": (b.get("parent") or {}).get("number")}
                      for b in node["blockedBy"]["nodes"]],
        "blocking": [b["number"] for b in node["blocking"]["nodes"]],
        "stub": p["stub"],
        "files": p["files"],
        "leftBroken": p["broken"],
        "criteria": p["criteria"],
        "designPaths": [f["path"] for f in p["files"]],
        "decisions": counts,
        "lint": lint(p),
    })
issues.sort(key=lambda i: i["number"])
by_number = {i["number"]: i for i in issues}

def transitive_blockers(issue):
    seen, todo = set(), [b["number"] for b in issue["blockedBy"]]
    while todo:
        m = todo.pop()
        if m in seen:
            continue
        seen.add(m)
        if m in by_number:
            todo.extend(b["number"] for b in by_number[m]["blockedBy"])
    return seen

def breakage_view():
    live = [i for i in issues if i["state"] == "OPEN" or i["stateReason"] == "COMPLETED"]
    out = []
    for i in live:
        for check_ in i["leftBroken"]:
            closers = sorted(j["number"] for j in live
                             if j["number"] != i["number"] and i["number"] in transitive_blockers(j)
                             and check_ in j["criteria"])
            if not closers:
                state = "unclosed"
            elif i["state"] == "OPEN":
                state = "planned"
            elif any(by_number[c]["state"] == "CLOSED" for c in closers):
                state = "closed"
            else:
                state = "open"
            out.append({"issue": i["number"], "check": check_, "closedBy": closers, "state": state})
    return out

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
    seen = set() if seen is None else seen
    for m in unblocks[n]:
        if m not in seen:
            seen.add(m)
            waiting_count(m, seen)
    return len(seen)

def run_order():
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
    early = [{"number": n, "blocker": b} for n in open_ if n in position
             for b in waits_on[n] if b in position and position[b] > position[n]]
    unknown = sorted({n for n in written if n not in by_number})
    duplicate = sorted({n for n in written if written.count(n) > 1})
    return {"ok": not unknown and not duplicate and not early, "unknown": unknown, "duplicate": duplicate,
            "early": early, "missing": [n for n in sorted(open_) if n not in position]}

def roadmap_view():
    if roadmap_line is None:
        return None
    path, entry = roadmap_line
    tasks = [i["number"] for i in issues
             if path in i["designPaths"] and (i["state"] == "OPEN" or i["stateReason"] == "COMPLETED")]
    task = tasks[0] if len(tasks) == 1 else None
    missing = []
    if task is not None and by_number[task]["state"] == "OPEN":
        blockers = {b["number"] for b in by_number[task]["blockedBy"]}
        missing = sorted(n for n in open_ if n != task and n not in blockers)
    return {"path": path, "entry": entry, "tasks": tasks, "task": task, "missing": missing}

def waits_on_parents(number, blockers):
    out = {}
    for b in blockers:
        if b["number"] == number:
            continue
        if base_of(b["body"]) is None:
            die("#%d is blocked by #%d, which is no project" % (number, b["number"]))
        out[b["number"]] = b
    return out

project_bases = {parent["number"]: base}
deps_of = {parent["number"]: {}}
for n, par in waits_on_parents(parent["number"], parent["blockedBy"]["nodes"]).items():
    project_bases[n] = base_of(par["body"])[0]
    deps_of[parent["number"]][n] = par

if MODE == "design":
    n = int(sys.argv[4])
    if n not in by_number:
        die("#%d is not a sub-issue of #%d" % (n, parent["number"]))
    counts = by_number[n]["decisions"]
    if counts["open"] or counts["contradictory"]:
        die("#%d has decisions not settled: %d open, %d contradictory" % (n, counts["open"], counts["contradictory"]))
    deps = deps_of[parent["number"]]
    sys.stdout.write(approved_design(
        (n, by_number[n]["title"], body_of[n]),
        (parent["number"], parent["title"], parent["body"]),
        [(q, deps[q]["title"], deps[q]["body"]) for q in sorted(deps)],
        [(b["check"], b["issue"]) for b in breakage_view() if b["state"] == "open" and n not in b["closedBy"]]))
    sys.exit(0)

listed = run("gh", "pr", "list", "-R", repo, "--base", base, "--state", "all", "--limit", "500",
            "--json", "number,state,isDraft,url,body")
if listed.returncode != 0:
    die("cannot list the pull requests into %s in %s: %s" % (base, repo, listed.stderr.strip()))
pr_of, rank = {}, {}
for pr in json.loads(listed.stdout):
    n = implements(pr.get("body"))
    if n is None or pr["state"] not in ("OPEN", "MERGED"):
        continue
    key = (pr["state"] != "OPEN", pr["number"])
    if n not in rank or key < rank[n]:
        rank[n] = key
        pr_of[n] = {"number": pr["number"], "state": pr["state"], "isDraft": pr["isDraft"], "url": pr["url"]}

def project_deps(n):
    if n not in deps_of:
        r = graphql("p: issue(number: $n) { blockedBy(first: 50) { nodes { number title state stateReason body } } }",
                    ints={"n": n}, what="read project #%d" % n)
        blockers = ((r.get("p") or {}).get("blockedBy") or {}).get("nodes") or []
        deps_of[n] = waits_on_parents(n, blockers)
        for m, par in deps_of[n].items():
            project_bases[m] = base_of(par["body"])[0]
    return {m: project_bases[m] for m in deps_of[n]}

def walk_projects(start):
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

def branches(own, deps):
    fields, strs, ints = [], {}, {}
    def ref_fields(k, b, f, open_pr=False):
        strs.update({"q%s" % k: "refs/heads/" + b, "b%s" % k: b, "f%s" % k: f})
        fields.append("r%s: ref(qualifiedName: $q%s) { compare(headRef: $f%s) { status } }" % (k, k, k))
        fields.append("m%s: pullRequests(headRefName: $b%s, baseRefName: $f%s, states: [MERGED], first: 1) "
                      "{ totalCount }" % (k, k, k))
        if open_pr:
            fields.append("p%s: pullRequests(headRefName: $b%s, baseRefName: $f%s, states: [OPEN], first: 1) "
                          "{ nodes { url } }" % (k, k, k))
    ref_fields("o", *own, open_pr=True)
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
    open_prs = (r.get("po") or {}).get("nodes") or []
    return dict(stand("o"), openPr=open_prs[0]["url"] if open_prs else None), out

def merged(issue, states, reached):
    if issue["state"] == "CLOSED":
        return issue.get("stateReason") == "COMPLETED"
    return bool(states) and all(s == "CLOSED" for s in states) and reached

if MODE in ("project", "check", "next"):
    dep_list = [deps_of[parent["number"]][n] for n in sorted(deps_of[parent["number"]])]
    open_deps = [(d["number"],) + base_of(d["body"]) for d in dep_list if d["state"] == "OPEN"]
    own, dep_stand = branches((base, made_from), open_deps)
    base_exists = own["exists"]
    waits_on_entries = []
    for d in dep_list:
        st = dep_stand.get(d["number"], {"states": [], "reached": False})
        waits_on_entries.append({
            "number": d["number"], "title": d["title"], "url": d["url"], "state": d["state"], "stateReason": d.get("stateReason"),
            "base": base_of(d["body"])[0], "merged": merged(d, st["states"], st["reached"]),
        })

def project_view():
    return {
        "parent": dict({k: parent.get(k) for k in ("number", "title", "url", "state", "stateReason", "updatedAt")},
                       labels=[l["name"] for l in parent["labels"]["nodes"]],
                       base=base, **{"from": made_from},
                       baseExists=base_exists,
                       merged=merged(parent, [i["state"] for i in issues], own["reached"]),
                       projectPr=own["openPr"],
                       waitsOn=waits_on_entries,
                       waitedOnBy=[b["number"] for b in parent["blocking"]["nodes"] if base_of(b["body"])],
                       startable=(parent["state"] == "OPEN" and not issues
                                  and all(d["merged"] for d in waits_on_entries)),
                       order=written,
                       orderCheck=order_check(),
                       roadmap=roadmap_view(),
                       breakage=breakage_view(),
                       lint=parent_lint(parse(parent["body"]))),
        "issues": [shown(i) for i in issues],
    }

def fingerprint(view):
    p = view["parent"]
    state = {
        "parent": {"updatedAt": p["updatedAt"], "state": p["state"], "labels": p["labels"]},
        "issues": [{"number": i["number"], "state": i["state"], "updatedAt": i["updatedAt"], "labels": i["labels"],
                    "pr": {"number": i["pr"]["number"], "state": i["pr"]["state"]} if i["pr"] else None}
                   for i in view["issues"]],
        "projectPr": p["projectPr"],
    }
    return hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()

def next_step(view):
    p, subs = view["parent"], view["issues"]
    def out(step, why, issue=None, url=None):
        return {"next": step, "why": why, "issue": issue, "url": url, "fingerprint": fingerprint(view)}
    if p["state"] == "CLOSED":
        return out("done", "closed")
    if p["merged"]:
        return out("running", "merged-parent")
    if not subs:
        return out("user", "split")
    if not p["baseExists"] and any(not d["merged"] for d in p["waitsOn"]):
        return out("user", "waits")
    open_subs = [i for i in subs if i["state"] == "OPEN"]
    done_prs = [i["number"] for i in open_subs if (i["pr"] or {}).get("state") == "MERGED"]
    if done_prs:
        return out("running", "close-merged", min(done_prs))
    if not open_subs:
        if p["projectPr"]:
            return out("user", "merge-project-pr", url=p["projectPr"])
        return out("running", "project-pr")
    by_number = {i["number"]: i for i in open_subs}
    in_order = [by_number[n] for n in p["order"] if n in by_number]
    if not p["orderCheck"]["ok"] or not in_order:
        return out("doctor", "order")
    k = in_order[0]
    n = k["number"]
    if "blocker" in k["labels"]:
        return out("doctor", "blocker", n)
    if k["stub"]:
        return out("doctor", "stub", n)
    if k["decisions"]["contradictory"] > 0:
        return out("user", "contradictory", n)
    if k["decisions"]["open"] > 0:
        return out("user", "decisions", n)
    if "ready" not in k["labels"]:
        return out("doctor", "not-ready", n)
    if any(b["state"] == "OPEN" for b in k["blockedBy"]):
        return out("doctor", "blocked", n)
    rm = p["roadmap"]
    if rm and rm["task"] == n and rm["missing"]:
        return out("doctor", "roadmap-edges", n)
    return out("running", "workable", n)

if MODE == "project":
    print(json.dumps(project_view(), ensure_ascii=False))
    sys.exit(0)

if MODE == "next":
    print(json.dumps(next_step(project_view()), ensure_ascii=False))
    sys.exit(0)

def check(numbers):
    top = run("git", "rev-parse", "--show-toplevel")
    if top.returncode != 0:
        die("--check runs inside a work tree of a clone of %s/%s" % (REPO_OWNER, REPO_NAME))
    os.chdir(top.stdout.strip())
    for n in numbers:
        if n not in by_number:
            die("#%d is not a sub-issue of #%d" % (n, parent["number"]))
    for branch in [made_from] + ([base] if base_exists else []):
        fetch = fetch_branch(".", branch)
        if fetch.returncode != 0:
            die("cannot fetch %s from origin: %s" % (branch, fetch.stderr.strip()))
    ref = "origin/" + (base if base_exists else made_from)
    history_unknown = run("git", "rev-parse", "--is-shallow-repository").stdout.strip() == "true"

    tree = run("git", "ls-tree", "-z", ref)
    if tree.returncode != 0:
        die("git ls-tree failed: " + tree.stderr.strip())
    root_files = set()
    for rec in tree.stdout.split("\0"):
        meta, _, fname = rec.partition("\t")
        if fname and meta.split()[1] == "blob":
            root_files.add(fname)
    unclosed = [{"issue": b["issue"], "check": b["check"]} for b in breakage_view() if b["state"] == "unclosed"]
    rv = roadmap_view()
    several = rv["tasks"] if rv and len(rv["tasks"]) > 1 else []
    for n in numbers:
        issue = by_number[n]
        mine = several if n in several else []
        paths = root_files | {f["path"] for m in transitive_blockers(issue) if m in by_number for f in by_number[m]["files"]}
        paths |= {f["path"] for f in issue["files"]}
        check_lint = lint(parse(body_of[n]), paths)

        failures = []
        excusers = []
        walked = transitive_blockers(issue)
        if (not (base_exists or all(d["merged"] for d in waits_on_entries))
                or any(b["number"] not in by_number and b["state"] == "OPEN" for b in issue["blockedBy"])
                or any(m in by_number and by_number[m]["state"] == "OPEN" and by_number[m]["stub"] for m in walked)):
            mode = "none"
        else:
            excusers = sorted(m for m in walked if m in by_number and by_number[m]["state"] == "OPEN")
            mode = "early" if excusers else "full"
            lists = lambda kinds, path: [m for m in excusers
                                         if any(g["path"] == path and g["kind"] in kinds for g in by_number[m]["files"])]
            tokens = {m: set(re.findall(r"[A-Za-z_$][\w$]*", body_of[m] or "")) for m in excusers}
            for f in issue["files"]:
                exists = run("git", "cat-file", "-e", "%s:%s" % (ref, f["path"])).returncode == 0
                why = None
                if f["kind"] == "added":
                    if lists({"added"}, f["path"]):
                        why = "added, but an open blocker adds it too"
                    elif exists and not lists({"deleted"}, f["path"]):
                        why = "added, but already exists"
                elif lists({"deleted"}, f["path"]):
                    why = "%s, but an open blocker deletes it" % f["kind"]
                elif not exists and not lists({"added"}, f["path"]):
                    why = "%s, but does not exist" % f["kind"]
                if why:
                    failures.append({"path": f["path"], "why": why})
                elif f["kind"] == "changed":
                    namers = lists({"added", "changed"}, f["path"])
                    for sym in ([] if is_document(f["path"]) else symbols(f, paths)):
                        found = exists and run("git", "grep", "-w", "-F", "-q", sym, ref, "--", f["path"]).returncode == 0
                        if not found and not any(sym in tokens[m] for m in namers):
                            as_word = "(^|[^A-Za-z0-9_])" + sym.replace("$", "[$]") + "([^A-Za-z0-9_]|$)"
                            held = history_unknown or (exists and run("git", "log", "--format=%H", "-n", "1", "--pickaxe-regex", "-S" + as_word, ref, "--", f["path"]).stdout.strip() != "")
                            failures.append({"path": f["path"], "symbol": sym,
                                             "why": "symbol not found" if held else "symbol never in the file"})
                    if roadmap_line and f["path"] == roadmap_line[0]:
                        shown_text = run("git", "show", "%s:%s" % (ref, f["path"]))
                        entries = roadmap_parse(shown_text.stdout)[0] if shown_text.returncode == 0 else []
                        if not any(e["heading"] == roadmap_line[1] for e in entries):
                            failures.append({"path": f["path"], "why": "roadmap entry not found"})

        print(json.dumps({
            "number": n,
            "base": base,
            "from": made_from,
            "baseExists": base_exists,
            "ok": check_lint["ok"] and not failures and not unclosed and not mine,
            "lint": check_lint,
            "premises": {"mode": mode, "excusers": excusers, "failures": failures},
            "breakage": {"unclosed": unclosed},
            "roadmap": {"several-tasks": mine},
        }, ensure_ascii=False))

if MODE == "check":
    check([int(a) for a in sys.argv[4:]])
    sys.exit(0)

result, cycle = run_order()
if cycle:
    die("the blocked-by relationships have a cycle: " + " blocked by ".join("#%d" % n for n in cycle))

walk_projects(parent["number"])

def order_list():
    done = []
    for n in written + [i["number"] for i in issues]:
        i = by_number.get(n)
        if i and i["state"] == "CLOSED" and i["stateReason"] == "COMPLETED" and n not in done:
            done.append(n)
    return done + result

if MODE == "order-body":
    sys.stdout.write(with_order(parent["body"], order_list()))
    sys.exit(0)

print(json.dumps({"order": [shown(open_[n]) for n in result], "list": order_list()}, ensure_ascii=False))
