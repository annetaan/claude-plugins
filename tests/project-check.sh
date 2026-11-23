#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj1-plan/scripts/project.sh"
SCRIPT="${PROJECT_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com

fail() { echo "FAIL: $*" >&2; exit 1; }

cd "$TMP"
git init -q -b main work
git init -q --bare origin.git
(
  cd work
  echo readme > README.md
  mkdir src
  printf 'export function foo() {}\nexport function oldName() {}\nexport function parseBody() {}\nexport const $el = 1\n' > src/app.ts
  git add README.md src/app.ts
  GIT_AUTHOR_DATE="1999-01-01T00:00:00Z" GIT_COMMITTER_DATE="1999-01-01T00:00:00Z" git commit -q -m "init"
  printf 'export function foo() {}\n' > src/app.ts
  git add src/app.ts
  git commit -q -m "drop oldName and parseBody"
  git remote add origin ../origin.git
  git push -q origin main main:refs/heads/pj/1
)
mkdir -p work/work-reports/run

mkdir bin
cat > bin/gh <<'PYEOF'
#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
if os.environ.get("FX_GH_LOG"):
    with open(os.environ["FX_GH_LOG"], "a") as log:
        log.write(" ".join(args[:2]) + "\n")
if args[:2] == ["pr", "list"]:
    print("[]")
    sys.exit(0)
if args[:2] == ["api", "graphql"]:
    query = next(a[len("query="):] for a in args if a.startswith("query="))
    if "updatedAt body" in query:
        body = ("## Goal\n\nRename foo.\n\n## Design\n\n"
                "- `src/app.ts` (changed): rename `foo`, as `README.md` describes.\n"
                + os.environ.get("FX_EXTRA_ENTRY", "") + "\n"
                "## Acceptance criteria\n\n- `foo` is renamed.\n\n"
                "## Decisions\n\nNone.\n\n## Out of scope\n\nNothing.\n")
        sub = {"number": 2, "url": "https://github.com/test/repo/issues/2", "title": "Rename foo", "state": "OPEN", "stateReason": None,
               "updatedAt": "2000-01-01T00:00:00Z", "body": body,
               "labels": {"nodes": [{"name": "ready"}]},
               "blockedBy": {"nodes": []}, "blocking": {"nodes": []}}
        subs = [sub]
        if os.environ.get("FX_TWO"):
            subs.append(dict(sub, number=3, url="https://github.com/test/repo/issues/3", title="Rename foo again"))
        parent = {"number": 1, "url": "https://github.com/test/repo/issues/1", "title": "Project", "state": "OPEN", "stateReason": None,
                  "updatedAt": "2000-01-01T00:00:00Z",
                  "body": "Base: `pj/1` from `main`\n\n## Goal\n\nx\n",
                  "labels": {"nodes": []}, "blockedBy": {"nodes": []}, "blocking": {"nodes": []},
                  "subIssues": {"totalCount": len(subs), "nodes": subs}}
        print(json.dumps({"data": {"repository": {"issue": parent}}}))
    elif "ro: ref(" in query:
        print(json.dumps({"data": {"repository": {"ro": {"compare": {"status": "IDENTICAL"}},
                                                  "mo": {"totalCount": 0}, "po": {"nodes": []}}}}))
    else:
        sys.stderr.write("fake gh: unexpected query\n")
        sys.exit(1)
    sys.exit(0)
sys.stderr.write("fake gh: unexpected call: %s\n" % " ".join(args))
sys.exit(1)
PYEOF
chmod +x bin/gh
REAL_GIT="$(command -v git)"
cat > bin/git <<GITEOF
#!/usr/bin/env bash
[ -z "\${FX_GIT_LOG:-}" ] || echo "\$*" >> "\$FX_GIT_LOG"
exec "$REAL_GIT" "\$@"
GITEOF
chmod +x bin/git
export PATH="$TMP/bin:$PATH"

check() { (cd "$1" && bash "$SCRIPT" -R test/repo 1 --check 2); }

root_out="$(check "$TMP/work")" || fail "check from the root exited non-zero"
sub_out="$(check "$TMP/work/src")" || fail "check from a tracked subdirectory exited non-zero"
nested_out="$(check "$TMP/work/work-reports/run")" || fail "check from an untracked nested directory exited non-zero"
[ "$root_out" = "$sub_out" ] || fail "output from work/src differs from the root: $sub_out"
[ "$root_out" = "$nested_out" ] || fail "output from work/work-reports/run differs from the root: $nested_out"
printf '%s' "$root_out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["lint"]["ok"] is True, d["lint"]
assert d["premises"]["mode"] == "full", d["premises"]
assert d["premises"]["failures"] == [], d["premises"]
assert "history" not in d
assert d["ok"] is True, d
' || fail "check from the root gave an unexpected result: $root_out"
echo "ok: check from a subdirectory matches check from the root"

for dir in "$TMP/origin.git" "$TMP/work/.git"; do
  rc=0
  err="$(check "$dir" 2>&1 >/dev/null)" || rc=$?
  [ "$rc" -ne 0 ] || fail "check in $dir exited 0"
  case "$err" in
    *"inside a work tree of a clone"*) ;;
    *) fail "check in $dir printed: $err" ;;
  esac
done
echo "ok: check outside a work tree is refused"

chk_failures() {
  local entries="$1" tree="${2:-$TMP/work}"
  (cd "$tree" && FX_EXTRA_ENTRY="$entries" bash "$SCRIPT" -R test/repo 1 --check 2) | python3 -c "
import json, sys
d = json.load(sys.stdin)
print([(f['path'], f.get('symbol'), f['why']) for f in d['premises']['failures']])"
}

got="$(chk_failures '- `README.md` (changed): says `Temporal` is used
')"
[ "$got" = "[]" ] || fail "a document entry with a new name printed $got, wanted []"
got="$(chk_failures '- `src/app.ts` (changed): uses `Temporal`
')"
case "$got" in
  *"('src/app.ts', 'Temporal'"*) ;;
  *) fail "a code entry with a new name printed $got, wanted a failure on Temporal" ;;
esac
echo "ok: --check looks up no name in a document entry"

got="$(chk_failures '- `docs/none.md` (changed): says `Temporal` is used
')"
[ "$got" = "[('docs/none.md', None, 'changed, but does not exist')]" ] || fail "a missing document printed $got"
echo "ok: --check fails a document entry whose path does not exist"

got="$(chk_failures '- `src/app.ts` (changed): uses `Temporal`
')"
[ "$got" = "[('src/app.ts', 'Temporal', 'symbol never in the file')]" ] || fail "a name the file never held printed $got"
echo "ok: --check reads a name the file never held as symbol never in the file"

got="$(chk_failures '- `src/app.ts` (changed): uses `oldName`
')"
[ "$got" = "[('src/app.ts', 'oldName', 'symbol not found')]" ] || fail "a name the file once held printed $got"
echo "ok: --check reads a name the file once held as symbol not found"

got="$(chk_failures '- `src/app.ts` (changed): uses `$el`
')"
[ "$got" = "[('src/app.ts', '\$el', 'symbol not found')]" ] || fail "a held name with a dollar sign printed $got"
echo "ok: --check reads a held name with a $ as symbol not found"

got="$(chk_failures '- `src/app.ts` (changed): uses `parse`
')"
[ "$got" = "[('src/app.ts', 'parse', 'symbol never in the file')]" ] || fail "a name inside a longer held name printed $got"
echo "ok: --check reads a name inside a longer name as symbol never in the file"

git clone -q --depth 1 -b main "file://$TMP/origin.git" "$TMP/shallow"
for name in Temporal oldName; do
  got="$(chk_failures "- \`src/app.ts\` (changed): uses \`$name\`
" "$TMP/shallow")"
  [ "$got" = "[('src/app.ts', '$name', 'symbol not found')]" ] || fail "a shallow clone printed $got for $name"
done
echo "ok: --check in a shallow clone reads every missing name as symbol not found"

multi() { (cd "$TMP/work" && FX_TWO=1 bash "$SCRIPT" -R test/repo 1 --check "$@"); }
two_out="$(multi 3 2)" || fail "--check 3 2 exited non-zero"
[ "$(printf '%s\n' "$two_out" | wc -l | tr -d ' ')" = 2 ] || fail "--check 3 2 printed: $two_out"
order="$(printf '%s\n' "$two_out" | python3 -c '
import json, sys
print([json.loads(l)["number"] for l in sys.stdin])')"
[ "$order" = "[3, 2]" ] || fail "--check 3 2 printed numbers $order, wanted [3, 2]"
[ "$(printf '%s\n' "$two_out" | sed -n 2p)" = "$(multi 2)" ] || fail "the #2 line of --check 3 2 differs from --check 2 alone"
echo "ok: --check with several numbers prints one line each, in the order given"

count_calls() {
  rm -f "$TMP/gh.log" "$TMP/call.log"
  (cd "$TMP/work" && FX_TWO=1 FX_GH_LOG="$TMP/gh.log" FX_GIT_LOG="$TMP/call.log" bash "$SCRIPT" -R test/repo 1 --check "$@" >/dev/null)
  echo "gh: $(sort "$TMP/gh.log" | uniq -c | tr -s ' ' | tr '\n' ';') fetches: $(grep -c '^fetch' "$TMP/call.log" || true)"
}
one_calls="$(count_calls 2)"
many_calls="$(count_calls 2 3)"
case "$one_calls" in *"api graphql"*"fetches: "[1-9]*) ;; *) fail "--check 2 made unexpected calls: $one_calls" ;; esac
[ "$one_calls" = "$many_calls" ] || fail "--check 2 3 called '$many_calls', --check 2 called '$one_calls'"
echo "ok: --check with several numbers reads GitHub and fetches once"

rc=0
out="$(multi 2 99 2>"$TMP/err")" || rc=$?
[ "$rc" -ne 0 ] || fail "--check 2 99 exited 0"
[ -z "$out" ] || fail "--check 2 99 printed on stdout: $out"
grep -q '#99 is not a sub-issue of #1' "$TMP/err" || fail "--check 2 99 said: $(cat "$TMP/err")"
echo "ok: --check dies before printing when one number is no sub-issue"
