#!/usr/bin/env bash
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj1-plan/scripts"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }

mkdir -p "$TMP/a" "$TMP/b" "$TMP/bin"
cp "$SCRIPTS/issue.sh" "$SCRIPTS/issue.py" "$TMP/a/"
cp "$SCRIPTS/issue.sh" "$SCRIPTS/issue.py" "$SCRIPTS/project.sh" "$SCRIPTS/project.py" "$TMP/b/"
A="$TMP/a/issue.sh"
B="$TMP/b/issue.sh"

cat > "$TMP/a/project.sh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE/project.log"
case "$1" in
  --lint) cat > /dev/null; cat "$FAKE/lint"; exit 0 ;;
  --parent-lint) cat > "$FAKE/parent-lint-input"; cat "$FAKE/parent-lint"; exit 0 ;;
esac
case "${2:-}" in
  --order)
    if [ -s "$FAKE/order" ]; then cat "$FAKE/order" >&2; exit 1; fi
    echo '{"order":[],"list":[]}' ;;
  --order-body)
    if [ -e "$FAKE/bump" ]; then
      python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["updatedAt"]="2026-02-02T00:00:00Z"; json.dump(d, open(p, "w"))' "$FAKE/view-$1"
    fi
    cat "$FAKE/order-body" ;;
  "") cat "$FAKE/project.json" ;;
  *) echo "unexpected project.sh $*" >&2; exit 1 ;;
esac
EOF

export FAKE="$TMP/fake"
cat > "$TMP/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE/gh.log"
case "$1 $2" in
  "issue view") cat "$FAKE/view-$3" ;;
  "label create")
    if grep -qxF -- "$3" "$FAKE/labels"; then
      echo "label with name \"$3\" already exists; use \`--force\` to update its color and description" >&2
      exit 1
    fi ;;
  "issue create") echo "https://github.com/o/r/issues/$(cat "$FAKE/next")" ;;
  "issue edit")
    case " $* " in *" --body-file - "*) cat > "$FAKE/body-$3" ;; esac ;;
  "issue comment"|"issue close") ;;
  "api -X") ;;
  "api repos/{owner}/{repo}/issues/"*) cat "$FAKE/comments" ;;
  "repo view") echo o/r ;;
  "api graphql") cat "$FAKE/graphql" ;;
  "pr list") echo '[]' ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$TMP/bin/gh" "$TMP/a/project.sh"
export PATH="$TMP/bin:$PATH"

view() {
  local labels='[]' parent=null
  [ -z "$3" ] || labels="[{\"name\":\"$3\"}]"
  [ -z "$4" ] || parent="{\"number\":$4}"
  printf '{"state":"%s","updatedAt":"2026-01-01T00:00:00Z","labels":%s,"parent":%s,"body":"GitHub body of #%s"}\n' \
    "$2" "$labels" "$parent" "$1" > "$FAKE/view-$1"
}

setup() {
  rm -rf "$FAKE" "$TMP"/*.github
  mkdir -p "$FAKE"
  : > "$FAKE/gh.log"
  : > "$FAKE/project.log"
  : > "$FAKE/labels"
  : > "$FAKE/comments"
  : > "$FAKE/order"
  echo '{"ok":true,"reasons":[]}' > "$FAKE/lint"
  echo '{"ok":true,"reasons":[]}' > "$FAKE/parent-lint"
  echo 7 > "$FAKE/next"
  view 1 OPEN project ""
  view 2 OPEN "" 1
  view 3 OPEN "" 1
  view 5 CLOSED "" 1
  view 6 CLOSED project ""
  view 9 OPEN "" ""
}

logged() { grep -qxF -- "$1" "$FAKE/gh.log"; }

writes() { grep -v '^issue view ' "$FAKE/gh.log" || true; }

status() { echo "$1" | json 'd["status"]'; }

reason() { echo "$1" | json 'd["reason"]'; }

printf '## Goal\n\nRetry failed jobs.\n' > "$TMP/body.md"
printf '**[pj3-doctor]** Resolved by the rewrite of #2.\n' > "$TMP/marked.md"
printf 'No marker here.\n' > "$TMP/plain.md"
printf '**[pj4-running]** Handover notes\n- bash tests/run.sh runs the tests\n' > "$TMP/handover.md"

VIEW_FIELDS="--json state,updatedAt,labels,parent,body"

setup
out="$(cd "$TMP" && python3 -I -c '
import sys
sys.path.insert(0, sys.argv[1])
import issue
assert issue.MARKERS == ("**[pj3-doctor]**", "**[pj4-running]**", "**[pj-cleanup]**"), issue.MARKERS
assert issue.check_marker(sys.argv[2]) is None
assert issue.check_marker(sys.argv[3]) == sys.argv[3] + " does not start with a marker"
' "$TMP/a" "$TMP/marked.md" "$TMP/plain.md" 2>&1)" || fail "import: $out"
[ -z "$out" ] || fail "the import printed: $out"
[ ! -s "$FAKE/gh.log" ] && [ ! -s "$FAKE/project.log" ] || fail "the import ran a command: $(cat "$FAKE/gh.log" "$FAKE/project.log")"
echo "ok: issue.py imports MARKERS and check_marker and runs no command"

setup
echo ready > "$FAKE/labels"
out="$("$A" label 2 --add ready,blocker --remove doing)"
[ "$(status "$out")" = ok ] || fail "label: $out"
logged "label create ready --color 0E8A16 --description Every decision is settled and the body is complete for its day. pj4-running details it against the code, then works on it." \
  || fail "label did not make sure ready exists: $(cat "$FAKE/gh.log")"
logged "label create blocker --color B60205 --description pj4-running stopped on this. Settle it before anything else." \
  || fail "label did not create blocker: $(cat "$FAKE/gh.log")"
grep -q '^label create doing' "$FAKE/gh.log" && fail "label created a label it only removes: $(cat "$FAKE/gh.log")"
grep -q -e '--force' "$FAKE/gh.log" && fail "label passed --force: $(cat "$FAKE/gh.log")"
[ "$(writes | tail -n 1)" = "issue edit 2 --add-label ready,blocker --remove-label doing" ] \
  || fail "label did not add and remove in one last edit: $(cat "$FAKE/gh.log")"
[ "$(grep -c '^issue edit' "$FAKE/gh.log")" = 1 ] || fail "label edited more than once: $(cat "$FAKE/gh.log")"
echo "ok: label adds and removes in one call and reuses an existing label"

setup
out="$("$A" parent --title "Retry" --from main --blocked-by 3,4 --roadmap docs/roadmap.md "Retry settings" --body "$TMP/body.md")"
[ "$(status "$out")" = ok ] || fail "parent: $out"
[ "$(echo "$out" | json 'd["number"]')" = 7 ] || fail "parent number: $out"
[ "$(echo "$out" | json 'd["url"]')" = https://github.com/o/r/issues/7 ] || fail "parent url: $out"
[ "$(writes | cut -d' ' -f1-3)" = "label create project
issue create --label
issue edit 7" ] || fail "parent writes: $(cat "$FAKE/gh.log")"
logged "issue create --label project --title Retry --body-file $TMP/body.md --blocked-by 3,4" \
  || fail "parent did not file with the project label: $(cat "$FAKE/gh.log")"
logged "issue edit 7 --body-file -" || fail "parent did not edit the body: $(cat "$FAKE/gh.log")"
want="$(printf 'Base: `pj/7` from `main`\nRoadmap: `docs/roadmap.md` Retry settings\n\n'; cat "$TMP/body.md")"
[ "$(cat "$FAKE/body-7")" = "$want" ] || fail "parent body: $(cat "$FAKE/body-7")"
[ "$(cat "$FAKE/parent-lint-input")" = "${want/pj\/7/pj/0}" ] || fail "parent lint input: $(cat "$FAKE/parent-lint-input")"
echo "ok: parent files the project and writes Base and Roadmap above the body"

setup
echo '{"ok":false,"reasons":["sections"]}' > "$FAKE/parent-lint"
out="$("$A" parent --title "Retry" --from main --body "$TMP/body.md")"
[ "$(reason "$out")" = lint ] || fail "parent lint: $out"
[ "$(echo "$out" | json 'd["reasons"]')" = "['sections']" ] || fail "parent lint reasons: $out"
out="$("$A" edit 1 --since 2026-01-01T00:00:00Z --body "$TMP/body.md")"
[ "$(reason "$out")" = lint ] || fail "edit on a parent: $out"
[ -z "$(writes)" ] || fail "a failing parent lint wrote: $(cat "$FAKE/gh.log")"
out="$("$A" edit 2 --since 2026-01-01T00:00:00Z --body "$TMP/body.md" --title "Add retry")"
[ "$(status "$out")" = ok ] || fail "edit on a sub-issue: $out"
logged "issue edit 2 --body-file $TMP/body.md --title Add retry" || fail "edit on a sub-issue: $(cat "$FAKE/gh.log")"
echo "ok: a parent body that fails the parent lint stops lint"

setup
echo 8 > "$FAKE/next"
out="$("$A" sub 1 --title "Add retry" --blocked-by 2,3 --blocking 4 --label blocker --body "$TMP/body.md")"
[ "$(status "$out")" = ok ] || fail "sub: $out"
[ "$(echo "$out" | json 'd["number"], d["url"]')" = "(8, 'https://github.com/o/r/issues/8')" ] || fail "sub number: $out"
logged "label create blocker --color B60205 --description pj4-running stopped on this. Settle it before anything else." \
  || fail "sub did not make sure its label exists: $(cat "$FAKE/gh.log")"
logged "issue create --parent 1 --title Add retry --body-file $TMP/body.md --blocked-by 2,3 --blocking 4 --label blocker" \
  || fail "sub did not file under 1: $(cat "$FAKE/gh.log")"
[ "$(cat "$FAKE/project.log")" = "--lint -
1 --order" ] || fail "sub did not lint and check the order: $(cat "$FAKE/project.log")"
echo '{"ok":false,"reasons":["decisions-open","stub"]}' > "$FAKE/lint"
out="$("$A" sub 1 --title "Stub" --body "$TMP/body.md")"
[ "$(status "$out")" = ok ] || fail "sub with decisions-open and stub: $out"
echo '{"ok":false,"reasons":["criteria","decisions-open"]}' > "$FAKE/lint"
: > "$FAKE/gh.log"
out="$("$A" sub 1 --title "Bad" --body "$TMP/body.md")"
[ "$(reason "$out")" = lint ] || fail "sub with a failing lint: $out"
[ "$(echo "$out" | json 'd["reasons"]')" = "['criteria', 'decisions-open']" ] || fail "sub lint reasons: $out"
[ ! -s "$FAKE/gh.log" ] || fail "sub with a failing lint called gh: $(cat "$FAKE/gh.log")"
echo "ok: sub files a sub-issue and refuses a failing lint"

setup
echo 8 > "$FAKE/next"
echo "project: the blocked-by relationships have a cycle: #8 blocked by #2 blocked by #8" > "$FAKE/order"
out="$("$A" sub 1 --title "Add retry" --blocked-by 2 --blocking 4 --body "$TMP/body.md")"
[ "$(reason "$out")" = cycle ] || fail "sub cycle: $out"
[ "$(echo "$out" | json 'd["number"], d["url"]')" = "(8, 'https://github.com/o/r/issues/8')" ] || fail "sub cycle number: $out"
[ "$(writes | tail -n 1)" = "issue edit 8 --remove-blocked-by 2 --remove-blocking 4" ] \
  || fail "sub did not take its edges off: $(cat "$FAKE/gh.log")"
: > "$FAKE/gh.log"
out="$("$A" relate 2 add 3)"
[ "$(reason "$out")" = cycle ] || fail "relate cycle: $out"
[ "$(writes)" = "issue edit 2 --add-blocked-by 3
issue edit 2 --remove-blocked-by 3" ] || fail "relate did not take the edge off: $(cat "$FAKE/gh.log")"
: > "$FAKE/project.log"
out="$("$A" relate 1 add 6)"
[ "$(reason "$out")" = cycle ] || fail "relate cycle on a parent: $out"
[ "$(cat "$FAKE/project.log")" = "1 --order" ] || fail "relate on a parent checked: $(cat "$FAKE/project.log")"
echo "project: cannot read issue #1" > "$FAKE/order"
: > "$FAKE/gh.log"
if out="$("$A" relate 2 add 3 2>&1)"; then fail "relate exited 0 on a failed check: $out"; fi
logged "issue edit 2 --remove-blocked-by 3" || fail "relate kept the edge after a failed check: $(cat "$FAKE/gh.log")"
: > "$FAKE/project.log"
out="$("$A" relate 2 remove 3)"
[ "$(status "$out")" = ok ] || fail "relate remove: $out"
[ ! -s "$FAKE/project.log" ] || fail "relate remove ran a check: $(cat "$FAKE/project.log")"
if out="$("$A" relate 9 add 3 2>&1)"; then fail "relate on an issue outside a project: $out"; fi
echo "ok: a cycle takes the edge back off and stops cycle"

setup
printf 'Base: `pj/1` from `main`\n\n## Order\n\n1. #2\n' > "$FAKE/order-body"
touch "$FAKE/bump"
out="$("$A" order 1 --since 2026-01-01T00:00:00Z)"
[ "$(reason "$out")" = moved ] || fail "order moved: $out"
[ "$(echo "$out" | json 'd["updatedAt"], "github" in d')" = "('2026-02-02T00:00:00Z', False)" ] || fail "order moved fields: $out"
cp "$TMP/body.md" "$TMP/edit.md"
out="$("$A" edit 2 --since 2025-12-31T00:00:00Z --body "$TMP/edit.md")"
[ "$(reason "$out")" = moved ] || fail "edit moved: $out"
[ "$(echo "$out" | json 'd["updatedAt"], d["github"]')" = "('2026-01-01T00:00:00Z', '$TMP/edit.md.github')" ] \
  || fail "edit moved fields: $out"
[ "$(cat "$TMP/edit.md.github")" = "GitHub body of #2" ] || fail "edit github text: $(cat "$TMP/edit.md.github")"
echo '{"id":11,"updated_at":"2026-01-03T00:00:00Z","body":"**[pj4-running]** Handover notes\n- a human line"}' > "$FAKE/comments"
cp "$TMP/handover.md" "$TMP/notes.md"
out="$("$A" handover 1 --since 2026-01-02T00:00:00Z --body "$TMP/notes.md")"
[ "$(reason "$out")" = moved ] || fail "handover moved: $out"
[ "$(echo "$out" | json 'd["updated_at"], d["github"]')" = "('2026-01-03T00:00:00Z', '$TMP/notes.md.github')" ] \
  || fail "handover moved fields: $out"
[ "$(cat "$TMP/notes.md.github")" = "$(printf '**[pj4-running]** Handover notes\n- a human line')" ] \
  || fail "handover github text: $(cat "$TMP/notes.md.github")"
[ -z "$(writes | grep -v '^api repos/')" ] || fail "moved wrote: $(cat "$FAKE/gh.log")"
rm "$FAKE/bump"
view 1 OPEN project ""
out="$("$A" order 1 --since 2026-01-01T00:00:00Z)"
[ "$(status "$out")" = ok ] || fail "order: $out"
[ "$(cat "$FAKE/body-1")" = "$(cat "$FAKE/order-body")" ] || fail "order body: $(cat "$FAKE/body-1")"
echo "ok: moved saves GitHub's text beside the file"

setup
out="$("$A" handover 1 --body "$TMP/handover.md")"
[ "$(status "$out")" = ok ] || fail "first handover: $out"
logged "issue comment 1 --body-file $TMP/handover.md" || fail "first handover did not post: $(cat "$FAKE/gh.log")"
logged 'api repos/{owner}/{repo}/issues/1/comments --paginate --jq .[] | select(.body | startswith("**[pj4-running]** Handover notes")) | {id, updated_at, body}' \
  || fail "handover did not read the comments: $(cat "$FAKE/gh.log")"
out="$("$A" handover 1 --since 2026-01-03T00:00:00Z --body "$TMP/handover.md")"
[ "$(echo "$out" | json 'd["reason"], d["updated_at"], "github" in d')" = "('moved', None, False)" ] \
  || fail "handover on a gone comment: $out"
echo '{"id":11,"updated_at":"2026-01-03T00:00:00Z","body":"**[pj4-running]** Handover notes"}' > "$FAKE/comments"
: > "$FAKE/gh.log"
out="$("$A" handover 1 --body "$TMP/handover.md")"
[ "$(reason "$out")" = moved ] || fail "second handover with no --since: $out"
[ -z "$(writes | grep -v '^api repos/')" ] || fail "second handover wrote: $(cat "$FAKE/gh.log")"
out="$("$A" handover 1 --since 2026-01-03T00:00:00Z --body "$TMP/handover.md")"
[ "$(status "$out")" = ok ] || fail "handover under since: $out"
[ "$(writes | tail -n 1)" = "api -X PATCH repos/{owner}/{repo}/issues/comments/11 -F body=@$TMP/handover.md" ] \
  || fail "handover did not rewrite: $(cat "$FAKE/gh.log")"
echo "ok: handover posts once and rewrites under since"

setup
out="$("$A" comment 2 --body "$TMP/plain.md")"
[ "$(echo "$out" | json 'd["reason"], d["message"]')" = "('no-marker', '$TMP/plain.md does not start with a marker')" ] \
  || fail "comment no-marker: $out"
out="$("$A" close 2 --reason completed --comment "$TMP/plain.md")"
[ "$(reason "$out")" = no-marker ] || fail "close no-marker: $out"
out="$("$A" handover 1 --body "$TMP/marked.md")"
[ "$(reason "$out")" = no-marker ] || fail "handover no-marker: $out"
[ ! -s "$FAKE/gh.log" ] || fail "no-marker called gh: $(cat "$FAKE/gh.log")"
echo "ok: a file with no marker stops no-marker"

setup
cat > "$FAKE/project.json" <<'EOF'
{"issues":[{"number":2,"state":"OPEN","title":"A","wantedTitle":"A (0/1)"},
           {"number":3,"state":"OPEN","title":"B","wantedTitle":"B"},
           {"number":5,"state":"CLOSED","title":"C","wantedTitle":"C (0/1)"}]}
EOF
for call in "label 5 --add ready" "comment 5 --body $TMP/marked.md" "edit 5 --since 2026-01-01T00:00:00Z --body $TMP/body.md" \
            "relate 5 add 2" "sub 6 --title T --body $TMP/body.md" "order 6 --since 2026-01-01T00:00:00Z" \
            "handover 6 --body $TMP/handover.md"; do
  out="$("$A" $call)"
  [ "$(reason "$out")" = closed ] || fail "$call on a closed issue: $out"
done
[ -z "$(writes)" ] || fail "a closed issue was written: $(cat "$FAKE/gh.log")"
out="$("$A" titles 1)"
grep -q '^issue edit 5' "$FAKE/gh.log" && fail "titles retitled a closed sub-issue: $(cat "$FAKE/gh.log")"
echo "ok: a closed issue stops closed"

setup
out="$("$A" close 2 --reason not-planned --comment "$TMP/marked.md")"
[ "$(status "$out")" = ok ] || fail "close: $out"
[ "$(writes)" = "issue close 2 --reason not planned --comment **[pj3-doctor]** Resolved by the rewrite of #2." ] \
  || fail "close did not write once: $(cat "$FAKE/gh.log")"
: > "$FAKE/gh.log"
out="$("$A" close 5 --reason completed --comment "$TMP/marked.md")"
[ "$(status "$out")" = ok ] || fail "close on a closed issue: $out"
[ -z "$(writes)" ] || fail "close on a closed issue wrote: $(cat "$FAKE/gh.log")"
echo "ok: close posts the marker comment and closes in one call"

setup
cat > "$FAKE/project.json" <<'EOF'
{"issues":[{"number":2,"state":"OPEN","title":"A","wantedTitle":"A (0/1)"},
           {"number":3,"state":"OPEN","title":"B","wantedTitle":"B"},
           {"number":5,"state":"CLOSED","title":"C","wantedTitle":"C (0/1)"}]}
EOF
out="$("$A" titles 1)"
[ "$(echo "$out" | json 'd["status"], d["changed"]')" = "('ok', [2])" ] || fail "titles: $out"
[ "$(cat "$FAKE/gh.log")" = "issue edit 2 --title A (0/1)" ] || fail "titles writes: $(cat "$FAKE/gh.log")"
echo "ok: titles retitles only open sub-issues that differ"

setup
usage_error() {
  local err rc=0
  "$A" "$@" > "$TMP/stdout" 2> "$TMP/stderr" || rc=$?
  [ "$rc" = 1 ] || fail "$*: exit $rc"
  [ ! -s "$TMP/stdout" ] || fail "$*: printed $(cat "$TMP/stdout")"
  head -n 1 "$TMP/stderr" | grep -q '^usage: issue.sh label ' || fail "$*: no usage: $(cat "$TMP/stderr")"
  tail -n 1 "$TMP/stderr" | grep -q '^issue: ' || fail "$*: no message: $(cat "$TMP/stderr")"
}
usage_error
usage_error frob 2
usage_error label 2
usage_error label 0 --add ready
usage_error label 2 --add wip
usage_error label 2 --add ready -h
usage_error comment 2 --body "$TMP/missing.md"
usage_error close 2 --reason duplicate --comment "$TMP/marked.md"
usage_error relate 2 link 3
usage_error sub 1 --title T --blocked-by 2,x --body "$TMP/body.md"
usage_error parent --title T --from main --roadmap docs/roadmap.md --body "$TMP/body.md"
[ ! -s "$FAKE/gh.log" ] || fail "a usage error called gh: $(cat "$FAKE/gh.log")"
rc=0
out="$("$A" comment 2 --body "$TMP/plain.md")" || rc=$?
[ "$rc" = 0 ] && [ "$(status "$out")" = stop ] || fail "a refusal exited $rc: $out"
echo "ok: usage errors exit 1 and refusals exit 0"

setup
cat > "$FAKE/graphql" <<'EOF'
{"data":{"repository":{"issue":{"number":1,"title":"Project","state":"OPEN","stateReason":null,
 "updatedAt":"2026-01-01T00:00:00Z","body":"Base: `pj/1` from `main`\n\n## Goal\n\nG.\n",
 "labels":{"nodes":[{"name":"project"}]},"blockedBy":{"nodes":[]},"blocking":{"nodes":[]},
 "subIssues":{"totalCount":2,"nodes":[
  {"number":2,"title":"Two","state":"OPEN","stateReason":null,"updatedAt":"2026-01-01T00:00:00Z","body":"",
   "labels":{"nodes":[]},"blockedBy":{"nodes":[{"number":3,"state":"OPEN","parent":{"number":1}}]},
   "blocking":{"nodes":[{"number":3}]}},
  {"number":3,"title":"Three","state":"OPEN","stateReason":null,"updatedAt":"2026-01-01T00:00:00Z","body":"",
   "labels":{"nodes":[]},"blockedBy":{"nodes":[{"number":2,"state":"OPEN","parent":{"number":1}}]},
   "blocking":{"nodes":[{"number":2}]}}]}}}}}
EOF
cat > "$TMP/open.md" <<'EOF'
## Goal

Sign-out stops emptying what the page fetched once.

## Design

- `src/session.ts` (changed): `signOut` clears only the entries the session owns

## Acceptance criteria

- sign out, then sign in again: `npm test -- signin` prints `3 passed`

## Decisions

### D1. Does the admin screen show the retry count?

Only you know: whether the people who run the admin screen need the count.

- [ ] Show it (recommended)
  Adds a column to `src/admin.ts`.
- [ ] Hide it
  Leaves `src/admin.ts` as it is.

## Out of scope

The admin screen.
EOF
printf '## Goal\n\nFound while working on #2.\n\n## Design\n\nTo be drawn.\n\n## Acceptance criteria\n\nTo be drawn.\n\n## Decisions\n\nTo be drawn.\n\n## Out of scope\n\nTo be drawn.\n' > "$TMP/stub.md"
printf '## Goal\n\nG.\n\n## Decisions\n\nNone.\n\n## Out of scope\n\nNothing.\n' > "$TMP/nodesign.md"
out="$("$B" sub 1 --title "Open" --body "$TMP/open.md")"
[ "$(status "$out")" = ok ] || fail "the real lint refused an open decision: $out"
out="$("$B" sub 1 --title "Stub" --body "$TMP/stub.md")"
[ "$(status "$out")" = ok ] || fail "the real lint refused a stub: $out"
out="$("$B" parent --title "P" --from main --body "$TMP/nodesign.md")"
[ "$(echo "$out" | json 'd["reason"], d["reasons"]')" = "('lint', ['sections'])" ] || fail "the real parent lint: $out"
: > "$FAKE/gh.log"
out="$("$B" relate 2 add 3)"
[ "$(reason "$out")" = cycle ] || fail "the real cycle message: $out"
echo "$out" | json 'd["message"]' | grep -qF "have a cycle: #2 blocked by #3 blocked by #2" || fail "cycle message: $out"
logged "issue edit 2 --remove-blocked-by 3" || fail "the real cycle kept the edge: $(cat "$FAKE/gh.log")"
echo "ok: issue.sh reads the real project.sh lint and cycle output"
