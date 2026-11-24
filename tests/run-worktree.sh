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

mkdir -p "$TMP/skills/pj4-running/scripts" "$TMP/skills/pj1-plan/scripts" "$TMP/skills/workflow/scripts" "$TMP/bin"
cp "$SCRIPTS/run.sh" "$SCRIPTS/run.py" "$TMP/skills/pj4-running/scripts/"
cp "$SCRIPTS/../../pj1-plan/scripts/issue.py" "$TMP/skills/pj1-plan/scripts/"
cp "$SCRIPTS/../../workflow/scripts/clone.py" "$SCRIPTS/../../workflow/scripts/include.py" "$TMP/skills/workflow/scripts/"
SCRIPT="$TMP/skills/pj4-running/scripts/run.sh"

cat > "$TMP/skills/pj1-plan/scripts/project.sh" <<'EOF'
#!/usr/bin/env bash
echo '{"parent":{"number":1,"base":"pj/1","waitsOn":[]},"issues":[]}'
EOF

cat > "$TMP/bin/gh" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  "repo view") echo '{"nameWithOwner":"o/r"}' ;;
  "api user") echo '{"login":"me"}' ;;
  "api repos/o/r/issues/1") echo '{"assignees":[{"login":"me"}]}' ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$TMP/bin/gh" "$TMP/skills/pj1-plan/scripts/project.sh"
export PATH="$TMP/bin:$PATH"

git init -q --bare "$TMP/origin.git"
git clone -q "$TMP/origin.git" "$TMP/seed" 2> /dev/null
(
  cd "$TMP/seed"
  echo one > a
  git add a
  git commit -q -m init
  git push -q origin HEAD:refs/heads/main HEAD:refs/heads/pj/1
)
git clone -q "$TMP/origin.git" "$TMP/clone"
cd "$TMP/clone"
printf '%s\n' work-reports/ .claude/worktrees/ .env.local mise.local.toml .worktreeinclude >> .git/info/exclude
echo secret > .env.local
echo mise > mise.local.toml
echo /.env.local > .worktreeinclude
WT="$(pwd -P)/.claude/worktrees/pj-1"

out="$("$SCRIPT" worktree 1)"
[ "$(echo "$out" | json 'd["status"], d["action"]')" = "('ready', 'created')" ] || fail "created: $out"
[ "$(echo "$out" | json 'd["copied"], d["notIgnored"], d["unlisted"]')" = "(['.env.local'], [], ['mise.local.toml'])" ] \
  || fail "created lists: $out"
[ "$(cat "$WT/.env.local")" = secret ] || fail ".env.local not copied"

echo /mise.local.toml >> .worktreeinclude
out="$("$SCRIPT" worktree 1)"
[ "$(echo "$out" | json 'd["status"], d["action"]')" = "('ready', 'moved')" ] || fail "moved: $out"
[ "$(echo "$out" | json 'd["copied"], d["notIgnored"], d["unlisted"]')" = "(['mise.local.toml'], [], [])" ] \
  || fail "moved lists: $out"
[ "$(cat "$WT/mise.local.toml")" = mise ] || fail "mise.local.toml not copied"
echo "ok: run.sh worktree ready carries copied and unlisted, on created and on moved"

echo changed > "$WT/a"
out="$("$SCRIPT" worktree 1)"
[ "$(echo "$out" | json 'd["status"], d["action"]')" = "('ready', 'discarded')" ] || fail "discarded: $out"
[ "$(cat "$WT/a")" = one ] || fail "the change was not discarded"
[ "$(cat "$WT/.env.local")" = secret ] && [ "$(cat "$WT/mise.local.toml")" = mise ] || fail "the discard removed a copied file"
[ "$(echo "$out" | json 'd["copied"], d["unlisted"]')" = "([], [])" ] || fail "discarded lists: $out"
echo "ok: a discard keeps the copied files"
