import json, os, shutil, subprocess, sys, tempfile

LIST = ".worktreeinclude"
ESCAPED = "\\*?["

def pattern(path: str, never: bool) -> str:
    body = "".join("\\" + c if c in ESCAPED else "[\r]" if c == "\r" else c for c in path)
    stem = body.rstrip(" ")
    line = "/" + stem + "\\ " * (len(body) - len(stem))
    return "!" + line if never else line

def decided_rules(text: str) -> str:
    return "\n".join(l[1:] if l.startswith("!") else l for l in text.split("\n"))

def sort_out(matched: frozenset, candidates: frozenset, decided: frozenset, ignored: frozenset,
             present: frozenset) -> dict:
    return {"copied": sorted((matched & ignored) - present),
            "notIgnored": sorted(matched - ignored),
            "unlisted": sorted((candidates & ignored) - decided - present - {LIST})}

def nul_split(out: str) -> list:
    return [p for p in out.split("\0") if p]

def git(where, *args, stdin=None, ok=(0,)):
    r = subprocess.run(["git", "-C", where, *args], input=None if stdin is None else os.fsencode(stdin),
                       capture_output=True)
    if r.returncode not in ok:
        raise subprocess.CalledProcessError(r.returncode, r.args, r.stdout, r.stderr)
    return os.fsdecode(r.stdout)

def worktree_entries(where):
    entries = []
    for block in git(where, "worktree", "list", "--porcelain").split("\n\n"):
        lines = block.split("\n")
        if lines and lines[0].startswith("worktree "):
            entries.append((lines[0][len("worktree "):], any(l.startswith("prunable") for l in lines[1:])))
    return entries

def others(main, *excludes):
    return frozenset(nul_split(git(main, "ls-files", "-z", "--others", "--ignored", *excludes)))

def ignored_in(wt, paths):
    if not paths:
        return frozenset()
    return frozenset(nul_split(git(wt, "check-ignore", "-z", "--stdin", stdin="".join(p + "\0" for p in paths),
                                   ok=(0, 1))))

def survey(wt):
    main = worktree_entries(wt)[0][0]
    rules = os.path.join(main, LIST)
    candidates = frozenset(p for p in others(main, "--exclude-standard", "--directory", "--no-empty-directory")
                           if not p.endswith("/"))
    matched, decided = frozenset(), frozenset()
    if os.path.exists(rules):
        matched = others(main, "--exclude-from=" + rules)
        with open(rules, encoding="utf-8", newline="") as f:
            text = f.read()
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", suffix=LIST) as f:
            f.write(decided_rules(text))
            f.flush()
            decided = others(main, "--exclude-from=" + f.name)
    ignored = ignored_in(wt, sorted(matched | candidates))
    present = frozenset(p for p in matched | candidates if os.path.lexists(os.path.join(wt, p)))
    return main, sort_out(matched, candidates, decided, ignored, present)

def include(wt: str) -> dict:
    main, found = survey(wt)
    for path in found["copied"]:
        dst = os.path.join(wt, path)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(os.path.join(main, path), dst, follow_symlinks=False)
    return found

def emit(**obj):
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)

def linked(wt):
    try:
        entries = worktree_entries(wt)
    except subprocess.CalledProcessError:
        return False
    real = os.path.realpath(wt)
    return any(os.path.realpath(p) == real and not prunable for p, prunable in entries[1:])

def remember(wt, pairs):
    if not linked(wt):
        emit(status="stop", reason="unknown", message="%s is no linked worktree of a clone" % wt)
    main, found = survey(wt)
    missing = sorted({p for _, p in pairs} - set(found["unlisted"]))
    if missing:
        emit(status="stop", reason="not-unlisted", message="not unlisted in %s: %s" % (wt, ", ".join(missing)),
             paths=missing)
    added = [pattern(p, flag == "--never") for flag, p in pairs]
    rules = os.path.join(main, LIST)
    text = ""
    if os.path.exists(rules):
        with open(rules, encoding="utf-8", newline="") as f:
            text = f.read()
    with open(rules, "a", encoding="utf-8", newline="") as f:
        if text and not text.endswith("\n"):
            f.write("\n")
        f.write("".join(line + "\n" for line in added))
    emit(status="ok", added=added, **include(wt))

if __name__ == "__main__":
    rest = sys.argv[3:]
    remember(sys.argv[2], tuple(zip(rest[0::2], rest[1::2])))
