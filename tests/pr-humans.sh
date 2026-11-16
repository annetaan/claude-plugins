#!/usr/bin/env bash
# Test: pr-humans.py reads the human turns of a session log (leaving out the runs of pr-humans itself), finds the
# sessions that touch a pull request, reads box ticks from an issue's edit history, tells who recorded a pull request,
# and refuses a comment that would leak a local path, a session id, a mention or another account's record.
#
# Run: bash tests/pr-humans.sh   (exit 0 is success, anything else is failure)
# Runs offline: nothing here calls gh. PR_HUMANS_PY=<path> tests another copy of pr-humans.py.
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pr-humans/scripts/pr-humans.py"
SCRIPT="${PR_HUMANS_PY:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# A session that opened PR 7 of o/r on branch feat/x, in the clone /work/r.
mkdir -p "$TMP/projects/-work-r"
LOG="$TMP/projects/-work-r/11111111-2222-3333-4444-555555555555.jsonl"
python3 - "$LOG" <<'EOF'
import json, sys
base = {"sessionId": "s1", "entrypoint": "cli", "cwd": "/work/r", "gitBranch": "feat/x", "isSidechain": False}
def u(content, **kw): return {**base, "type": "user", "timestamp": "2026-11-16T01:00:00Z", "message": {"role": "user", "content": content}, **kw}
def a(text): return {**base, "type": "assistant", "timestamp": "2026-11-16T01:00:01Z", "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}}
rows = [
    u("Add the export button\n<system-reminder>ignore me</system-reminder>"),
    u("<command-message>annetaan:workflow</command-message>\n<command-name>/annetaan:workflow</command-name>\n<command-args>export button</command-args>"),
    u("<system-reminder>only a reminder</system-reminder>"),
    u("Another Claude session sent a message: hi"),
    u([{"type": "tool_result", "tool_use_id": "t1", "content": "answered"}], toolUseResult={"questions": [], "answers": {"Approve the design?": "Approve"}, "annotations": {}}),
    u([{"type": "tool_result", "tool_use_id": "t2", "is_error": True, "content": "The user doesn't want to proceed with this tool use. the user said: use CSV"}]),
    u("[Request interrupted by user]"),
    u("subagent prompt", isSidechain=True),
    u("meta", isMeta=True),
    a("Opened https://github.com/o/r/pull/7"),
    {"type": "pr-link", "sessionId": "s1", "prNumber": 7, "prUrl": "https://github.com/o/r/pull/7", "prRepository": "o/r", "timestamp": "2026-11-16T01:00:02Z"},
    # The run of pr-humans itself: neither the command nor what follows it is part of the history.
    u("<command-name>/annetaan:pr-humans</command-name>\n<command-args>https://github.com/o/r/pull/70</command-args>"),
    a("Gathering."),
    u([{"type": "tool_result", "tool_use_id": "t3", "content": "answered"}], toolUseResult={"questions": [], "answers": {"Post it?": "Yes"}, "annotations": {}}),
    u([{"type": "tool_result", "tool_use_id": "t4", "is_error": True, "content": "The user doesn't want to proceed with this tool use. the user said: not yet"}]),
    u("[Request interrupted by user]"),
]
with open(sys.argv[1], "w") as f:
    for r in rows: f.write(json.dumps(r) + "\n")
EOF

# A session that only ran pr-humans on PR 7 and names it after that: not part of its history.
cat > "$TMP/projects/-work-r/other.jsonl" <<'EOF'
{"type":"user","sessionId":"s2","entrypoint":"cli","cwd":"/elsewhere","gitBranch":"main","timestamp":"2026-11-17T00:00:00Z","message":{"role":"user","content":"<command-name>/annetaan:pr-humans</command-name>\n<command-args>7</command-args>"}}
{"type":"assistant","sessionId":"s2","cwd":"/elsewhere","gitBranch":"main","timestamp":"2026-11-17T00:00:01Z","message":{"role":"assistant","content":[{"type":"text","text":"Recorded https://github.com/o/r/pull/7"}]}}
EOF

# A session that names the issue the pull request implements, before any pr-humans run.
cat > "$TMP/projects/-work-r/plan.jsonl" <<'EOF'
{"type":"user","sessionId":"s3","entrypoint":"cli","cwd":"/work/r","gitBranch":"main","timestamp":"2026-11-10T00:00:00Z","message":{"role":"user","content":"Plan https://github.com/o/r/issues/5 please"}}
EOF

# A session that names issue 50, which is not issue 5.
cat > "$TMP/projects/-work-r/fifty.jsonl" <<'EOF'
{"type":"user","sessionId":"s4","entrypoint":"cli","cwd":"/work/r","gitBranch":"main","timestamp":"2026-11-10T00:00:00Z","message":{"role":"user","content":"Look at https://github.com/o/r/issues/50"}}
EOF

# More sessions, with the shapes of a pr-humans run in them.
python3 - "$TMP/projects/-work-r" <<'EOF'
import json, os, sys
d = sys.argv[1]
base = {"entrypoint": "cli", "cwd": "/elsewhere", "gitBranch": "main", "isSidechain": False}
n = [0]
def ts():
    n[0] += 1
    return "2026-11-18T00:00:%02dZ" % n[0]
def u(content, **kw): return {**base, "type": "user", "timestamp": ts(), "message": {"role": "user", "content": content}, **kw}
def a(*parts): return {**base, "type": "assistant", "timestamp": ts(), "message": {"role": "assistant", "content": list(parts)}}
def text(t): return {"type": "text", "text": t}
def skill(name, args=""): return {"type": "tool_use", "id": "tu", "name": "Skill", "input": {"skill": name, "args": args}}
def cmd(name, args): return u("<command-name>%s</command-name>\n<command-args>%s</command-args>" % (name, args))
def answer(): return u([{"type": "tool_result", "tool_use_id": "t", "content": "ok"}], toolUseResult={"questions": [], "answers": {"Post it?": "Yes"}, "annotations": {}})
def link(num): return {"type": "pr-link", "sessionId": "x", "prNumber": num, "prUrl": "https://github.com/o/r/pull/%d" % num, "prRepository": "o/r", "timestamp": ts()}
def write(name, rows):
    with open(os.path.join(d, name + ".jsonl"), "w") as f:
        for r in rows: f.write(json.dumps(r) + "\n")

# pr-humans command, answer, a message typed, a workflow command: the run ends at the message.
write("afterrun", [cmd("/annetaan:pr-humans", "70"), answer(), a(text("Done")),
                   u("Now look at https://github.com/o/r/pull/7"), cmd("/annetaan:workflow", "x")])
# Asked in plain words: the message that asked is taken back, and so is everything up to the next message.
write("skillrun", [u("Record PR 7 with pr-humans: https://github.com/o/r/pull/7"),
                   a(text("Recording https://github.com/o/r/pull/7"), skill("annetaan:pr-humans")),
                   answer(), a(text("Posted https://github.com/o/r/pull/7"))])
# Another pull request's run, then a message that names PR 7: that message counts.
write("otherpr", [cmd("/annetaan:pr-humans", "70"), a(text("Recorded 70")),
                  u("Next, https://github.com/o/r/pull/7 needs a fix"), a(text("ok"))])
# A Skill call of another skill takes nothing back.
write("otherskill", [u("Fix https://github.com/o/r/pull/7"), a(skill("annetaan:workflow")), a(text("ok"))])
# A command between the message and the Skill call: the message stays.
write("cmdbetween", [u("Fix https://github.com/o/r/pull/7"), cmd("/annetaan:workflow", "x"),
                     a(skill("annetaan:pr-humans")), answer()])
# Two pull requests opened in one session, 7 then 8.
write("twolinks", [u("Work on it"), link(7), a(text("opened")), link(8)])
EOF

# --- sessions-of: the human turns
OUT="$(python3 "$SCRIPT" sessions-of "$LOG")"
check() { python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if eval(sys.argv[1]) else 1)' "$1" <<<"$OUT" || fail "$2"; }
check 'd["entrypoint"]=="cli" and d["branches"]==["feat/x"]' "meta"
check 'd["prLinks"]==[{"repo":"o/r","number":7,"at":"2026-11-16T01:00:02Z"}]' "pr-link"
check '[t["kind"] for t in d["turns"]]==["message","command","answer","refusal","interrupt"]' "turn kinds: $(python3 -c 'import json,sys;print([t["kind"] for t in json.load(sys.stdin)["turns"]])' <<<"$OUT")"
check 'd["turns"][0]["text"]=="Add the export button"' "reminder stripped"
check 'd["turns"][1]["command"]=="/annetaan:workflow" and d["turns"][1]["args"]=="export button"' "command"
check 'd["turns"][2]["answers"]==[{"question":"Approve the design?","answer":"Approve"}]' "answer"
check '"use CSV" in d["turns"][3]["text"]' "refusal"
check '"talk" not in d and "cwds" not in d' "talk and cwds not printed"

OUT="$(python3 "$SCRIPT" sessions-of "$TMP/projects/-work-r/afterrun.jsonl")"
check '[t["kind"] for t in d["turns"]]==["message","command"]' "after a run: $(python3 -c 'import json,sys;print([t["kind"] for t in json.load(sys.stdin)["turns"]])' <<<"$OUT")"
OUT="$(python3 "$SCRIPT" sessions-of "$TMP/projects/-work-r/skillrun.jsonl")"
check 'd["turns"]==[]' "a plain request for pr-humans is no turn"
OUT="$(python3 "$SCRIPT" sessions-of "$TMP/projects/-work-r/otherskill.jsonl")"
check '[t["kind"] for t in d["turns"]]==["message"]' "another skill takes nothing back"
OUT="$(python3 "$SCRIPT" sessions-of "$TMP/projects/-work-r/cmdbetween.jsonl")"
check '[t["kind"] for t in d["turns"]]==["message","command"]' "a command between keeps the message"
OUT="$(python3 "$SCRIPT" sessions-of "$TMP/projects/-work-r/twolinks.jsonl")"
check '[(l["repo"],l["number"]) for l in d["prLinks"]]==[("o/r",7),("o/r",8)] and d["prLinks"][0]["at"] < d["prLinks"][1]["at"]' "two pr-links keep order and time"

# --- find_sessions, checkbox_events, lint and the rest, through the module
python3 - "$SCRIPT" "$TMP/projects" "$TMP" <<'EOF'
import importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location("prh", sys.argv[1]); m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
os.environ["PR_HUMANS_PROJECTS"] = sys.argv[2]
tmp = sys.argv[3]

def fail(msg): print("FAIL:", msg, file=sys.stderr); sys.exit(1)

pr = {"number": 7, "url": "https://github.com/o/r/pull/7", "head": "feat/x",
      "issues": [{"url": "https://github.com/o/r/issues/5", "parent": None}]}
found = {s["session"]: s["why"] for s in m.find_sessions(pr, "o/r", "/work/r")}
if found.get("11111111-2222-3333-4444-555555555555") != ["created-pr", "on-branch", "names-pr"]:
    fail(f"creating session: {found}")
if "other" in found: fail("a session that only ran pr-humans was taken")
if "skillrun" in found: fail("a session that only asked for pr-humans in plain words was taken")
if found.get("afterrun") != ["names-pr"]: fail(f"message after a run: {found}")
if found.get("otherpr") != ["names-pr"]: fail(f"message after another pull request's run: {found}")
if found.get("otherskill") != ["names-pr"]: fail(f"message before another skill: {found}")
if found.get("twolinks") != ["created-pr"]: fail(f"two links, pull request 7: {found}")
if found.get("plan") != ["names-issue 5"]: fail(f"planning session: {found}")
if "fifty" in found: fail("issue 50 was taken for issue 5")
pr8 = {"number": 8, "url": "https://github.com/o/r/pull/8", "head": "feat/y", "issues": []}
found8 = {s["session"]: s["why"] for s in m.find_sessions(pr8, "o/r", None)}
if found8.get("twolinks") != ["created-pr"]: fail(f"two links, pull request 8: {found8}")
# Another repository with the same number is not this pull request.
if any("created-pr" in w for w in {s["session"]: s["why"] for s in m.find_sessions(pr, "o/other", None)}.values()):
    fail("pr-link of another repository")
sess = {s["session"]: s for s in m.find_sessions(pr, "o/r", "/work/r")}
if sess["11111111-2222-3333-4444-555555555555"]["cwds"] != ["/work/r"]: fail("cwds are not in sessions.json")

# Edits come newest first, each with the full body. Two decisions hold the same option, Yes.
def body(d1, d2, extra="", prose="Pick one."):
    return (f"## Decisions\n\n{prose}\n\n### D1. First\n\n- [{d1}] Yes\n- [ ] No\n\n"
            f"### D2. Second\n\n- [{d2}] Yes\n- [ ] No\n{extra}")
v1 = body(" ", " ")
v2 = body("x", " ")
v3 = body("x", "x", extra="- [x] Maybe\n", prose="Pick one, please.")
edits = [{"editor": {"login": "u"}, "editedAt": "3", "diff": v3},
         {"editor": {"login": "u"}, "editedAt": "2", "diff": v2},
         {"editor": {"login": "u"}, "editedAt": "1", "diff": v1}]
ev = m.checkbox_events(edits)
if len(ev) != 2: fail(f"events: {ev}")
if not (ev[0]["onlyBoxes"] and ev[0]["changed"] == [{"box": "Yes", "checked": True, "under": "D1. First"}]
        and ev[0]["addedChecked"] == [] and ev[0]["at"] == "2"):
    fail(f"tick of D1's Yes: {ev[0]}")
if ev[1]["onlyBoxes"] or ev[1]["changed"] != [{"box": "Yes", "checked": True, "under": "D2. Second"}] \
        or ev[1]["addedChecked"] != [{"box": "Maybe", "checked": True, "under": "D2. Second"}]:
    fail(f"tick in a rewrite: {ev[1]}")
if m.checkbox_events([{"diff": v1}]) != []: fail("one revision has no events")
# A line that starts with an issue reference is no heading, and adding or dropping it moves no box.
w1 = "### D1. First\n\n- [ ] Yes\n"
w2 = "### D1. First\n\n#5 same way as before\n- [x] Yes\n"
w3 = "### D1. First\n\n- [ ] Yes\n"
ev = m.checkbox_events([{"diff": w3, "editedAt": "3"}, {"diff": w2, "editedAt": "2"}, {"diff": w1, "editedAt": "1"}])
if [e["changed"] for e in ev] != [[{"box": "Yes", "checked": True, "under": "D1. First"}],
                                  [{"box": "Yes", "checked": False, "under": "D1. First"}]]:
    fail(f"issue reference taken for a heading: {ev}")

# lint: the patterns
if m.lint("## How people took part\n- approved the design [confirmed: commit a1b2c3d]\n- `@types/node` stays") != []:
    fail("clean body refused")
for bad, want in [("see /Users/me/x", "local-path"), ("~/.claude/projects/x", "local-path"),
                  (r"C:\Users\me\x", "local-path"), ("/var/folders/ab/T/x", "local-path"),
                  ("/private/tmp/x", "local-path"), ("/private/var/x", "local-path"), ("/tmp/x", "local-path"),
                  ("log a.jsonl", "session-id"), ("11111111-2222-3333-4444-555555555555", "session-id"),
                  ("thanks @someone", "mention")]:
    if want not in m.lint(bad): fail(f"lint missed {want} in {bad!r}")
if m.lint("mail me at a@b.c") != []: fail("an address is no mention")

# lint: what this machine holds
d = os.path.join(tmp, "known"); os.makedirs(d)
json.dump([{"session": "plan", "cwd": "/work/r/src", "cwds": ["/work/r/src", "/ab"], "file": "/store/s/plan.jsonl"},
           {"session": "abc", "cwd": "/"}], open(os.path.join(d, "sessions.json"), "w"))
json.dump([{"file": "/work/r/work-reports/a/b.md", "size": 1}], open(os.path.join(d, "reports.json"), "w"))
os.environ["HOME"] = "/opt/homedir"
known = m.known_values(d)
for body_, want in [("in /work/r/src it", "local-path"), ("the plan session", "session-id"),
                    ("see /work/r/work-reports/a here", "local-path"), ("at /opt/homedir/x", "local-path"),
                    ("dir " + d + "/x", "local-path"), ("dir " + os.path.realpath(d), "local-path")]:
    if want not in m.lint(body_, known): fail(f"known value missed ({want}) in {body_!r}")
if m.lint("the abc and /ab and a / b", known) != []: fail("a value under four characters, or /, was taken")
if m.lint("replanning is not a session", known) != []: fail("a session id inside a word was taken")
if m.lint("clean text", known) != []: fail("clean text refused with known values")
# A relative DIR is made absolute: its name as a word in the text is no path.
cwd = os.getcwd(); os.chdir(tmp)
try:
    os.makedirs("notes")
    if m.lint("review notes decided it", m.known_values("notes")) != []: fail("a relative DIR name was taken")
    if "local-path" not in m.lint(os.path.join(tmp, "notes"), m.known_values("notes")): fail("relative DIR, absolute path")
finally:
    os.chdir(cwd)

# recordedBy, who left the marker
me_c = {"author": {"login": "me"}, "body": m.MARKER + "\nx"}
ot_c = {"author": {"login": "other"}, "body": m.MARKER + "\nx"}
plain = {"author": {"login": "other"}, "body": "just a comment"}
if m.recorded_by([plain, me_c, ot_c], "me") != "me": fail("recordedBy me")
if m.recorded_by([plain, ot_c], "me") != "other": fail("recordedBy other")
if m.recorded_by([plain], "me") is not None: fail("recordedBy none")

# pick_record, from the REST comments
rme = {"id": 1, "user": {"login": "me"}, "body": m.MARKER + "\nx"}
rot = {"id": 2, "user": {"login": "other"}, "body": m.MARKER + "\nx"}
rpl = {"id": 3, "user": {"login": "me"}, "body": "no marker"}
mine, others = m.pick_record([rpl, rme], "me")
if [c["id"] for c in mine] != [1] or others: fail("pick_record: only mine")
mine, others = m.pick_record([rpl, rot], "me")
if mine or [c["id"] for c in others] != [2]: fail("pick_record: only others")
if m.pick_record([rpl], "me") != ([], []): fail("pick_record: no marker")

# previous.md
pd = os.path.join(tmp, "prev"); os.makedirs(pd)
if not m.write_previous([plain, ot_c, {"author": {"login": "me"}, "body": m.MARKER + "\n## H\nbody"}], "me", pd):
    fail("previous not written")
got = open(os.path.join(pd, "previous.md")).read()
if got != "## H\nbody\n" or m.MARKER in got: fail(f"previous.md: {got!r}")
if m.write_previous([plain, ot_c], "me", pd) or os.path.exists(os.path.join(pd, "previous.md")):
    fail("previous.md kept for another account's record")
EOF

# --- post refuses before touching GitHub (gh is not on PATH here, so touching it would not be exit 3)
mkdir -p "$TMP/post1" "$TMP/post3"
printf 'from /Users/me/x\n' > "$TMP/post1/comment.md"
printf '[{"session":"s","cwd":"/work/r/src","cwds":["/work/r/src"]}]' > "$TMP/post3/sessions.json"
printf 'worked in /work/r/src\n' > "$TMP/post3/comment.md"
set +e
OUT="$(PATH=/usr/bin:/bin python3 "$SCRIPT" post 7 "$TMP/post1")"; rc=$?
set -e
[ "$rc" = 3 ] || fail "post exit $rc"
check 'd["status"]=="stop" and d["number"]==7 and d["problems"]==["local-path"]' "post problems"
set +e
OUT="$(PATH=/usr/bin:/bin python3 "$SCRIPT" post 7 "$TMP/post3")"; rc=$?
set -e
[ "$rc" = 3 ] || fail "post exit $rc with a known cwd"
check 'd["problems"]==["local-path"]' "post known cwd"

# --- usage errors
set +e
python3 "$SCRIPT" targets --bogus >/dev/null 2>&1; [ $? = 2 ] || fail "targets usage"
python3 "$SCRIPT" gather 7 >/dev/null 2>&1; [ $? = 2 ] || fail "gather usage"
python3 "$SCRIPT" post 7 >/dev/null 2>&1; [ $? = 2 ] || fail "post usage"
set -e

echo "ok"
