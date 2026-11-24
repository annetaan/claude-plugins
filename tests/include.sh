#!/usr/bin/env bash
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/workflow/scripts"
WORKTREE="$SCRIPTS/worktree.sh"
INCLUDE="$SCRIPTS/include.sh"

TMP="$(mktemp -d)"
trap 'chmod -R u+rwx "$TMP" 2>/dev/null || true; rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
mkdir -p "$HOME"
export GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
git config --global init.defaultBranch main

fail() { echo "FAIL: $*" >&2; exit 1; }

json() { python3 -c 'import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))' "$1"; }

mode() { python3 -c 'import os,stat,sys; print(oct(stat.S_IMODE(os.stat(sys.argv[1]).st_mode)))' "$1"; }

has() { echo "$1" | python3 -c 'import json,sys; sys.exit(0 if sys.argv[2] in json.load(sys.stdin)[sys.argv[1]] else 1)' "$2" "$3"; }

setup() {
  rm -rf "$TMP/origin.git" "$TMP/work"
  git init -q --bare "$TMP/origin.git"
  git init -q "$TMP/work"
  MAIN="$(cd "$TMP/work" && pwd -P)"
  (
    cd "$MAIN"
    printf '%s\n' '.claude/worktrees/' 'work-reports/' '.env*' '*.local.toml' '.DS_Store' 'node_modules/' \
      '.worktreeinclude' > .gitignore
    mkdir -p apps/web
    echo readme > README.md
    echo web > apps/web/index.js
    git add .gitignore README.md apps/web/index.js
    git commit -q -m init
    git remote add origin "$TMP/origin.git"
    git push -q origin main
  )
  cd "$MAIN"
}

create() {
  local out
  out="$(bash "$WORKTREE" create main)"
  [ "$(echo "$out" | json 'd["status"]')" = ready ] || fail "create: $out"
  echo "$out"
}

setup
echo root > .env.local
chmod 600 .env.local
echo nested > apps/web/.env.local
chmod 640 apps/web/.env.local
echo mac > .DS_Store
echo mise > mise.local.toml
echo test > .env.test
echo weird > 'a[1]*.local.toml'
mkdir -p node_modules/p
echo dep > node_modules/p/index.js
echo s > extra.secret
echo 'extra.secret' >> .gitignore
printf '%s\n' '/.env.local' '/apps/web/.env.local' '!/.DS_Store' '/extra.secret' > .worktreeinclude

out="$(create)"
WT="$(echo "$out" | json 'd["worktree"]')"
[ "$(echo "$out" | json 'd["copied"]')" = "['.env.local', 'apps/web/.env.local']" ] || fail "copied: $out"
[ "$(cat "$WT/.env.local")" = root ] && [ "$(cat "$WT/apps/web/.env.local")" = nested ] || fail "copied contents"
[ "$(mode "$WT/.env.local")" = 0o600 ] && [ "$(mode "$WT/apps/web/.env.local")" = 0o640 ] || fail "modes not kept"
echo "ok: create copies the listed ignored files, at the root and nested, keeping their mode"

[ ! -e "$WT/.DS_Store" ] || fail ".DS_Store copied"
! has "$out" copied .DS_Store && ! has "$out" unlisted .DS_Store || fail ".DS_Store listed: $out"
echo "ok: a !/ line is neither copied nor unlisted"

[ "$(echo "$out" | json 'd["unlisted"]')" = "['.env.test', 'a[1]*.local.toml', 'mise.local.toml']" ] || fail "unlisted: $out"
[ ! -e "$WT/mise.local.toml" ] && [ ! -e "$WT/.env.test" ] || fail "an unlisted file was copied"
[ ! -e "$WT/node_modules" ] || fail "node_modules copied"
[ "$(echo "$out" | json '[p for k in ("copied", "notIgnored", "unlisted") for p in d[k] if p.startswith(("node_modules", ".claude/", "work-reports"))]')" = "[]" ] \
  || fail "an ignored directory is listed: $out"
echo "ok: an ignored file no line names is unlisted and not copied; ignored directories appear in neither list"

[ "$(echo "$out" | json 'd["notIgnored"]')" = "['extra.secret']" ] || fail "notIgnored: $out"
[ ! -e "$WT/extra.secret" ] || fail "extra.secret copied"
[ -z "$(git -C "$WT" status --porcelain)" ] || fail "status of $WT: $(git -C "$WT" status --porcelain)"
echo "ok: a listed file the worktree does not ignore is in notIgnored, not copied, and the worktree's status stays empty"

echo mine > "$WT/.env.local"
again="$(python3 -c 'import json,sys; sys.path.insert(0, sys.argv[1]); from include import include; print(json.dumps(include(sys.argv[2])))' "$SCRIPTS" "$WT")"
[ "$(cat "$WT/.env.local")" = mine ] || fail ".env.local overwritten"
[ "$(echo "$again" | json 'd["copied"]')" = "[]" ] || fail "second include copied: $again"
echo "ok: a file already present in the worktree is not overwritten"

! has "$out" unlisted .worktreeinclude || fail ".worktreeinclude unlisted: $out"
echo "ok: .worktreeinclude itself is never unlisted"

before="$(cat .worktreeinclude)"
r="$(bash "$INCLUDE" remember "$WT" --copy mise.local.toml --copy 'a[1]*.local.toml' --never .env.test)"
[ "$(echo "$r" | json 'd["status"]')" = ok ] || fail "remember: $r"
[ "$(echo "$r" | json 'd["added"]')" = "['/mise.local.toml', '/a\\\\[1]\\\\*.local.toml', '!/.env.test']" ] \
  || fail "added: $r"
[ "$(cat .worktreeinclude)" = "$before"$'\n/mise.local.toml\n/a\\[1]\\*.local.toml\n!/.env.test' ] \
  || fail "list: $(cat .worktreeinclude)"
[ "$(cat "$WT/mise.local.toml")" = mise ] && [ "$(cat "$WT/a[1]*.local.toml")" = weird ] || fail "remember did not copy"
[ ! -e "$WT/.env.test" ] || fail ".env.test copied"
[ "$(echo "$r" | json 'd["copied"]')" = "['a[1]*.local.toml', 'mise.local.toml']" ] || fail "copied: $r"
[ "$(echo "$r" | json 'd["unlisted"]')" = "[]" ] || fail "unlisted: $r"
echo "ok: remember --copy appends /<path>, copies it and drops it from unlisted; --never appends !/<path>"

second="$(create)"
WT2="$(echo "$second" | json 'd["worktree"]')"
[ "$(echo "$second" | json 'd["unlisted"]')" = "[]" ] || fail "second create unlisted: $second"
[ "$(cat "$WT2/mise.local.toml")" = mise ] || fail "second create did not copy mise.local.toml"
echo "ok: a second create after remember prints no unlisted file and copies the remembered one"

name="$(echo "$second" | json 'd["name"]')"
c="$(bash "$WORKTREE" cleanup "$name")"
[ "$(echo "$c" | json 'd["status"]')" = done ] || fail "cleanup: $c"
[ ! -e "$WT2" ] || fail "$WT2 still there"
echo "ok: cleanup removes a worktree holding copied files without --discard"

before="$(cat .worktreeinclude)"
r="$(bash "$INCLUDE" remember "$WT" --copy .env.local --never nope)"
[ "$(echo "$r" | json 'd["status"]')" = stop ] && [ "$(echo "$r" | json 'd["reason"]')" = not-unlisted ] || fail "not-unlisted: $r"
[ "$(echo "$r" | json 'd["paths"]')" = "['.env.local', 'nope']" ] || fail "paths: $r"
[ "$(cat .worktreeinclude)" = "$before" ] || fail "the list changed"
echo "ok: remember with a path not in unlisted stops with not-unlisted and leaves the list unchanged"

[ "$(bash "$INCLUDE" remember "$MAIN" --copy x | json 'd["reason"]')" = unknown ] || fail "MAIN is not unknown"
[ "$(bash "$INCLUDE" remember "$TMP/nowhere" --copy x | json 'd["reason"]')" = unknown ] || fail "a missing path is not unknown"
for args in "remember $WT" "remember $WT --copy" "remember $WT --keep x" "forget $WT --copy x"; do
  if bash "$INCLUDE" $args 2>/dev/null; then fail "usage accepted: $args"; fi
done
echo "ok: remember stops with unknown on MAIN and on a path that is no worktree, and refuses a wrong argument shape"

setup
echo mise > mise.local.toml
echo test > .env.test
out="$(create)"
WT="$(echo "$out" | json 'd["worktree"]')"
[ "$(echo "$out" | json 'd["copied"]')" = "[]" ] && [ "$(echo "$out" | json 'd["notIgnored"]')" = "[]" ] || fail "no list: $out"
[ "$(echo "$out" | json 'd["unlisted"]')" = "['.env.test', 'mise.local.toml']" ] || fail "no list unlisted: $out"
r="$(bash "$INCLUDE" remember "$WT" --copy mise.local.toml)"
[ "$(echo "$r" | json 'd["status"]')" = ok ] || fail "remember: $r"
[ "$(cat .worktreeinclude)" = /mise.local.toml ] || fail "created list: $(cat .worktreeinclude)"
printf '/mise.local.toml' > .worktreeinclude
bash "$INCLUDE" remember "$WT" --never .env.test > /dev/null
[ "$(cat .worktreeinclude)" = $'/mise.local.toml\n!/.env.test' ] || fail "newline: $(cat .worktreeinclude)"
echo "ok: remember creates the list when absent and adds the missing newline first"

setup
printf 'Icon?\n' >> .git/info/exclude
printf icon > $'Icon\r'
out="$(create)"
WT="$(echo "$out" | json 'd["worktree"]')"
[ "$(echo "$out" | json 'd["unlisted"]')" = "['Icon\\r']" ] || fail "Icon<CR> unlisted: $out"
r="$(bash "$INCLUDE" remember "$WT" --copy $'Icon\r')"
[ "$(echo "$r" | json 'd["added"], d["copied"], d["unlisted"]')" = "(['/Icon[\\r]'], ['Icon\\r'], [])" ] || fail "remember Icon<CR>: $r"
[ "$(cat "$WT/"$'Icon\r')" = icon ] || fail "Icon<CR> not copied"
second="$(create)"
[ "$(echo "$second" | json 'd["copied"], d["unlisted"]')" = "(['Icon\\r'], [])" ] || fail "second create Icon<CR>: $second"
echo "ok: a file whose name holds a carriage return is unlisted under its real name, remembered and copied"
