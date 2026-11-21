#!/usr/bin/env bash
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/pj4-running/scripts"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
git config --global init.defaultBranch main

fail() { echo "FAIL: $*" >&2; exit 1; }

json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }

mkdir -p "$TMP/skills/pj4-running/scripts" "$TMP/skills/pj1-plan/scripts" "$TMP/bin"
cp "$SCRIPTS/run.sh" "$SCRIPTS/run.py" "$TMP/skills/pj4-running/scripts/"
SCRIPT="$TMP/skills/pj4-running/scripts/run.sh"

cat > "$TMP/skills/pj1-plan/scripts/project.sh" <<'EOF'
#!/usr/bin/env bash
echo '{"parent":{"number":1,"base":"pj/1","waitsOn":[]},"issues":[{"number":2,"state":"OPEN","pr":{"number":3,"state":"OPEN"}}]}'
EOF

export FAKE="$TMP/fake"
cat > "$TMP/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE/gh.log"
none() { echo "no checks reported on the 'feat/2' branch" >&2; exit 1; }
case "$1 $2" in
  "repo view")
    echo '{"nameWithOwner":"o/r","squashMergeAllowed":true,"mergeCommitAllowed":false,"rebaseMergeAllowed":false}' ;;
  "api repos/o/r/rules/branches/pj/1") cat "$FAKE/ruleset" ;;
  "api repos/o/r/branches/pj/1") echo '{"protected":false}' ;;
  "api graphql") echo '{"data":{"repository":{"ref":{"branchProtectionRule":null}}}}' ;;
  "pr view") echo '{"headRefName":"feat/2","isDraft":true,"state":"OPEN"}' ;;
  "pr checks")
    checks="$(cat "$FAKE/checks")"
    if [ "$4" = "--json" ]; then
      case "$checks" in
        none) none ;;
        later) [ -e "$FAKE/polled" ] || { touch "$FAKE/polled"; none; } ;;
      esac
      echo '[{"name":"test"}]'
    else
      case "$checks" in
        none) none ;;
        fail) printf 'test\tfail\t1m\n'; exit 1 ;;
      esac
      printf 'test\tpass\t1m\n'
    fi ;;
  "pr ready"|"pr merge"|"issue comment"|"issue close") ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$TMP/bin/gh" "$TMP/skills/pj1-plan/scripts/project.sh"
export PATH="$TMP/bin:$PATH"

echo closed > "$TMP/closed.md"

setup() {
  local workflow="$1" ruleset="$2" checks="$3"
  cd "$TMP"
  rm -rf "$TMP/origin.git" "$TMP/seed" "$TMP/clone" "$FAKE"
  mkdir -p "$FAKE"
  echo "$ruleset" > "$FAKE/ruleset"
  echo "$checks" > "$FAKE/checks"
  git init -q --bare "$TMP/origin.git"
  git clone -q "$TMP/origin.git" "$TMP/seed" 2> /dev/null
  (
    cd "$TMP/seed"
    echo one > a
    git add a
    git commit -q -m init
    git push -q origin HEAD:refs/heads/main HEAD:refs/heads/pj/1
    if [ -n "$workflow" ]; then
      mkdir -p .github/workflows
      printf '%s\n' "$workflow" > .github/workflows/test.yml
      git add .github/workflows/test.yml
    fi
    echo two > a
    git commit -q -am work
    git push -q origin HEAD:refs/heads/feat/2
  )
  git clone -q "$TMP/origin.git" "$TMP/clone"
  cd "$TMP/clone"
  printf 'work-reports/\n.claude/worktrees/\n' >> .git/info/exclude
  git worktree add -q --detach .claude/worktrees/pj-1 origin/pj/1
}

merge() { "$SCRIPT" merge 1 2 3 --comment "$TMP/closed.md" "$@"; }

logged() { grep -qxF -- "$1" "$FAKE/gh.log"; }

polls() { grep -cxF -- "pr checks 3 --json name" "$FAKE/gh.log" || true; }

ON_PR='on:
  pull_request:
  push:
    branches: [main]'

ON_MAIN='on:
  pull_request:
    branches: [main]'

REQUIRED='[{"type":"required_status_checks"}]'

setup "$ON_PR" '[]' pass
out="$(merge)"
[ "$(echo "$out" | json 'd["status"]')" = merged ] || fail "every check passes: $out"
logged "pr checks 3 --watch --fail-fast" || fail "no watch: $(cat "$FAKE/gh.log")"
logged "pr merge 3 --squash" || fail "no merge: $(cat "$FAKE/gh.log")"
grep -q -e '--required' "$FAKE/gh.log" && fail "a gh call carries --required: $(cat "$FAKE/gh.log")"
echo "ok: merges once every check passes"

setup "$ON_PR" '[]' fail
out="$(merge)"
[ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "failing check: $out"
[ "$(echo "$out" | json 'd["reason"]')" = checks-failed ] || fail "failing check reason: $out"
grep -q -e '^pr merge' -e '^pr ready' "$FAKE/gh.log" && fail "left the draft after a failing check: $(cat "$FAKE/gh.log")"
echo "ok: stops on a failing check the base branch does not require"

setup "$ON_MAIN" '[]' pass
out="$(merge)"
[ "$(echo "$out" | json 'd["status"]')" = merged ] || fail "workflow for main only: $out"
[ "$(polls)" = 0 ] || fail "polled for a workflow that names only main: $(cat "$FAKE/gh.log")"
echo "ok: does not poll when the pull_request workflow names only other branches"

setup "" '[]' none
out="$(merge)"
[ "$(echo "$out" | json 'd["status"]')" = merged ] || fail "no workflow, no check: $out"
[ "$(polls)" = 0 ] || fail "polled with no workflow: $(cat "$FAKE/gh.log")"
echo "ok: merges with no workflow and no check, without polling"

setup "$ON_PR" '[]' later
out="$(merge)"
[ "$(echo "$out" | json 'd["status"]')" = merged ] || fail "check registers on the second poll: $out"
[ "$(polls)" = 2 ] || fail "not two polls: $(cat "$FAKE/gh.log")"
order="$(grep -nxF -e "pr checks 3 --json name" -e "pr checks 3 --watch --fail-fast" -e "pr merge 3 --squash" "$FAKE/gh.log" | cut -d: -f2- | tr '\n' '|')"
[ "$order" = "pr checks 3 --json name|pr checks 3 --json name|pr checks 3 --watch --fail-fast|pr merge 3 --squash|" ] \
  || fail "order: $order"
echo "ok: waits for the check a pull_request workflow registers"

setup "$ON_PR" '[]' none
out="$(merge --wait 1)"
[ "$(echo "$out" | json 'd["status"]')" = merged ] || fail "nothing registers within --wait: $out"
echo "ok: goes on when a pull_request workflow registers nothing within --wait"

expects() {
  local name="$1" polled="$2" workflow="$3"
  setup "$workflow" '[]' pass
  out="$(merge)"
  [ "$(echo "$out" | json 'd["status"]')" = merged ] || fail "$name: $out"
  [ "$(polls)" = "$polled" ] || fail "$name: $(polls) polls, not $polled: $(cat "$FAKE/gh.log")"
}

expects "flow list with a comment" 1 "on:
  pull_request:
    branches: [main, 'pj/**']  # the project branches too"
expects "item with a comment" 1 "on:
  pull_request:
    branches:
      - main
      - 'pj/**'  # the project branches"
expects "comment after branches:" 1 "on:
  pull_request:
    branches: # main and the project branches
      - main
      - 'pj/**'"
expects "a # inside quotes" 1 "on:
  pull_request:
    branches: ['main #1', 'pj/**']"
expects "items at the key's own indent" 1 "on:
  pull_request:
    branches:
    - main
    - 'pj/**'"
expects "ignored items at the key's own indent" 0 "on:
  pull_request:
    branches-ignore:
    - 'pj/**'"
expects "flow list over several lines" 1 "on:
  pull_request:
    branches: [
      main,
      'pj/**',
    ]"
expects "a [...] pattern in a flow list" 1 "on:
  pull_request:
    branches: [main, pj/[0-9]]"
expects "a quoted [...] pattern before another" 1 "on:
  pull_request:
    branches: ['v[0-9]+', 'pj/**']"
expects "a [...] pattern on a later line of a flow list" 1 "on:
  pull_request:
    branches: [
      'v[0-9]+',
      'pj/**',
    ]"
expects "a [...] pattern on the first line of a flow list" 1 "on:
  pull_request:
    branches: ['v[0-9]+',
      'pj/**']"
expects "a quoted ] in a flow list" 1 "on:
  pull_request:
    branches: ['a]', 'pj/**']"
echo "ok: reads branch filters with comments, items at the key's indent, [...] patterns and flow lists over several lines"

setup "" "$REQUIRED" none
out="$(merge --wait 1)"
[ "$(echo "$out" | json 'd["status"]')" = stop ] || fail "required check never registers: $out"
[ "$(echo "$out" | json 'd["reason"]')" = no-checks ] || fail "required check never registers reason: $out"
grep -q '^pr merge' "$FAKE/gh.log" && fail "merged with no required check: $(cat "$FAKE/gh.log")"
echo "ok: stops with no-checks when the base branch requires a check and none registers"
