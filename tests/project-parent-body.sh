#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj1-plan/scripts/project.sh"
SCRIPT="${PROJECT_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

mkdir "$TMP/bin"
cat > "$TMP/bin/gh" <<'PYEOF'
#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ["GH_LOG"], "a") as log:
    log.write(" ".join(args[:2]) + "\n")
if args[:2] == ["pr", "list"]:
    print("[]")
    sys.exit(0)
if args[:2] == ["api", "graphql"]:
    query = next(a[len("query="):] for a in args if a.startswith("query="))
    if "updatedAt body" not in query:
        sys.stderr.write("fake gh: unexpected query\n")
        sys.exit(1)
    parent = {"number": 1, "title": "Project", "state": "OPEN", "stateReason": None,
              "updatedAt": "2000-01-01T00:00:00Z",
              "body": open(os.environ["PARENT_BODY"], newline="").read(),
              "labels": {"nodes": []}, "blockedBy": {"nodes": []}, "blocking": {"nodes": []},
              "subIssues": {"totalCount": 0, "nodes": []}}
    print(json.dumps({"data": {"repository": {"issue": parent}}}))
    sys.exit(0)
sys.stderr.write("fake gh: unexpected call: %s\n" % " ".join(args))
sys.exit(1)
PYEOF
chmod +x "$TMP/bin/gh"
export PATH="$TMP/bin:$PATH"
export PARENT_BODY="$TMP/parent.md"
export GH_LOG="$TMP/gh.log"

splice() { bash "$SCRIPT" -R test/repo 1 --parent-body "$1"; }

printf 'Base: `pj/1` from `main`\r\n\r\n## Order\r\n\r\n1. #2\r\n\r\n## Goal\r\n\r\nold goal\r\n\r\n## Design\r\n\r\nold design\r\n' > "$PARENT_BODY"
printf '\n\n## Goal\n\nnew goal\n\n## Design\n\nnew design\n\n\n' > "$TMP/new.md"
printf 'Base: `pj/1` from `main`\n\n## Order\n\n1. #2\n\n## Goal\n\nnew goal\n\n## Design\n\nnew design\n' > "$TMP/want.md"
splice "$TMP/new.md" > "$TMP/out.md"
cmp -s "$TMP/out.md" "$TMP/want.md" || fail "the splice: $(cat "$TMP/out.md")"
echo "ok: the lines above ## Goal stay, CR removed, and the file follows"

printf 'Base: `pj/1` from `main`\n\n```\n## Goal\n```\n\n## Goal\n\nold goal\n' > "$PARENT_BODY"
printf 'Base: `pj/1` from `main`\n\n```\n## Goal\n```\n\n## Goal\n\nnew goal\n\n## Design\n\nnew design\n' > "$TMP/want.md"
splice "$TMP/new.md" > "$TMP/out.md"
cmp -s "$TMP/out.md" "$TMP/want.md" || fail "a fenced ## Goal: $(cat "$TMP/out.md")"
echo "ok: a ## Goal inside a code fence is not the splice point"

printf 'Base: `pj/1` from `main`\n\n```\n## Goal\n```\n\n## Design\n\nx\n' > "$PARENT_BODY"
if splice "$TMP/new.md" > "$TMP/out.md" 2> "$TMP/err"; then fail "a body with no ## Goal exited 0"; fi
[ ! -s "$TMP/out.md" ] || fail "a body with no ## Goal printed: $(cat "$TMP/out.md")"
grep -q -F 'the parent body has no ## Goal heading' "$TMP/err" || fail "a body with no ## Goal: $(cat "$TMP/err")"
echo "ok: a body with no ## Goal is refused"

printf 'Base: `pj/1` from `main`\n\n## Goal\n\nold goal\n' > "$PARENT_BODY"
printf '\nnew goal\n\n## Goal\n\nx\n' > "$TMP/headless.md"
if splice "$TMP/headless.md" > "$TMP/out.md" 2> "$TMP/err"; then fail "a file not at ## Goal exited 0"; fi
[ ! -s "$TMP/out.md" ] || fail "a file not at ## Goal printed: $(cat "$TMP/out.md")"
grep -q -F 'does not start at ## Goal' "$TMP/err" || fail "a file not at ## Goal: $(cat "$TMP/err")"
echo "ok: a file that does not start at ## Goal is refused"

: > "$GH_LOG"
if splice "$TMP/missing.md" > "$TMP/out.md" 2> "$TMP/err"; then fail "a missing file exited 0"; fi
[ ! -s "$TMP/out.md" ] || fail "a missing file printed: $(cat "$TMP/out.md")"
grep -q -F 'no such file' "$TMP/err" || fail "a missing file: $(cat "$TMP/err")"
[ ! -s "$GH_LOG" ] || fail "a missing file called gh: $(cat "$GH_LOG")"
echo "ok: a missing file is refused before gh is called"

printf 'Base: `pj/1` from `main`\n\n```\n## Order\n\n9. #9\n```\n\n## Order\n\n1. #5\n\n## Goal\n\nx\n' > "$PARENT_BODY"
printf 'Base: `pj/1` from `main`\n\n```\n## Order\n\n9. #9\n```\n\n## Order\n\n## Goal\n\nx\n' > "$TMP/want.md"
bash "$SCRIPT" -R test/repo 1 --order-body > "$TMP/out.md"
cmp -s "$TMP/out.md" "$TMP/want.md" || fail "--order-body with a fenced ## Order: $(cat "$TMP/out.md")"
echo "ok: --order-body leaves a fenced ## Order alone"
