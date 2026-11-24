#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/plugins/annetaan/skills/workflow/scripts/comments.sh"
SCRIPT="${COMMENTS_SH:-$SCRIPT}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
mkdir -p "$HOME" "$TMP/nogit"
export GIT_CONFIG_NOSYSTEM=1
export GIT_CEILING_DIRECTORIES="$TMP"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.com
git config --global init.defaultBranch main

fail() { echo "FAIL: $*" >&2; exit 1; }

check() { rc=0; OUT="$("$SCRIPT" "$@" 2>"$TMP/err")" || rc=$?; }

json() { python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$OUT" "$1"; }

expect() {
  local label="$1" expression="$2" want="$3" got
  got="$(json "$expression")"
  [ "$got" = "$want" ] || fail "$label: $expression gave '$got', wanted '$want'"
}

expect_rc() { [ "$rc" = "$2" ] || fail "$1: exit $rc, wanted $2; stdout: $OUT"; }

fresh() {
  rm -rf "$TMP/repo"
  git init -q "$TMP/repo"
  cd "$TMP/repo"
  echo readme > README.md
  git add README.md
  git commit -q -m base
}

commit_all() { git add -A && git commit -q -m "$1"; }

fresh
cat > a.sh <<'EOF'
echo hi # note
EOF
cat > a.py <<'EOF'
x = 1  # note
EOF
cat > a.js <<'EOF'
const x = 1; // note
EOF
cat > a.ts <<'EOF'
const x: number = 1; // note
EOF
cat > a.go <<'EOF'
package main

var x = 1 // note
EOF
cat > a.rs <<'EOF'
fn main() { let x = 1; // note
}
EOF
cat > a.css <<'EOF'
a { color: red; } /* note */
EOF
cat > a.html <<'EOF'
<p>hi</p> <!-- note -->
EOF
check
expect_rc "comment in every language" 1
expect "comment in every language" 'sorted(e["path"] for e in d["fix"] if e["kind"] == "comment")' \
  "['a.css', 'a.go', 'a.html', 'a.js', 'a.py', 'a.rs', 'a.sh', 'a.ts']"
expect "comment in every language" 'len(d["fix"])' 8
fresh
cat > a.tsx <<'EOF'
export const A = () => <p>Don't stop</p>; // c1
EOF
cat > b.jsx <<'EOF'
export const A = () => <p>and/or // not a comment</p>;
EOF
cat > c.js <<'EOF'
const o = {a:// c1
1};
EOF
cat > d.js <<'EOF'
let i = 0; i++ / 2; // c1
EOF
cat > e.js <<'EOF'
const é = 4; const z = é / 2; // c1
EOF
cat > f.jsx <<'EOF'
const B = (
  <div className="a" onClick={() => 1 / 2}>
    {items.map((x) => <i key={x}>it's</i>)}
    {/* real */}
  </div>
);
EOF
check
expect_rc "jsx and division" 1
expect "jsx and division" '[(e["path"], e["line"]) for e in d["fix"]]' \
  "[('a.tsx', 1), ('c.js', 1), ('d.js', 1), ('e.js', 1), ('f.jsx', 4)]"
echo "ok: a comment is a fix in sh, py, js, ts, go, rs, css and html"

fresh
cat > s.sh <<'EOF'
#!/usr/bin/env bash
# shellcheck source=/dev/null
. ./lib.sh
EOF
cat > l.js <<'EOF'
// Copyright (c) 2026 Example
// All rights reserved.

const x = 1;
EOF
cat > t.ts <<'EOF'
// @ts-expect-error the library types are wrong
const x: number = "a";
EOF
cat > p.py <<'EOF'
#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# -*- coding: utf-8 -*-
x = 1
EOF
cat > a.test.js <<'EOF'
/**
 * @jest-environment jsdom
 */
test('a', () => {});
EOF
check
expect_rc "pass" 0
expect "pass" 'd["status"]' clean
expect "pass" 'd["scanned"]' 5
fresh
cat > b.js <<'EOF'
/*
 * Builds the cache.
 * Rendered by @jsx automatic runtime.
 */
const x = 1;
EOF
cat > c.js <<'EOF'
const x = 1; // TODO drop @ts-check later
EOF
check
expect_rc "prose naming a directive" 1
expect "prose naming a directive" '[(e["path"], e["kind"]) for e in d["fix"]]' "[('b.js', 'comment'), ('c.js', 'comment')]"
fresh
cat > a.py <<'EOF'
# SPDX-License-Identifier: MIT
"""Explains the module at length."""
import os
EOF
check
expect "licence then docstring" '[(e["path"], e["line"], e["kind"]) for e in d["fix"]]' "[('a.py', 2, 'doc')]"
echo "ok: a shebang, a licence header and a tool directive pass"

fresh
mkdir sub
cat > vite.config.js <<'EOF'
// note
export default {};
EOF
cat > .eslintrc.js <<'EOF'
// note
module.exports = {};
EOF
echo 'const ok = 1;' > ok.js
check
expect_rc "config" 0
expect "config" 'd["scanned"]' 1
echo "ok: a configuration file is not scanned"

fresh
cat > s.sh <<'EOF'
echo "a # b"
echo 'c # d'
echo $# ${#0}
echo a#b
x="$(echo "q # r")"
cat > f.txt <<'TXT'
# in a heredoc
TXT
echo done
EOF
cat > r.js <<'EOF'
const url = "http://example.com";
const re = /a\/\/b/;
const t = `x // y ${"z // w"} /* v */`;
const q = 'it\'s // no';
const parts = [1, 2].map((n) => n / 2 / 3);
EOF
cat > r.py <<'EOF'
x = "a # b"
y = '''c # d'''
z = f"{x} # no"
EOF
cat > r.rs <<'EOF'
fn f<'a>(s: &'a str) -> &'a str {
    let raw = r#"// no"#;
    let quote = '"';
    let hash = '#';
    s
}
EOF
check
expect_rc "not comments" 0
expect "not comments" 'd["scanned"]' 4
fresh
cat > a.sh <<'EOF'
base=x
url=${base}#anchor
echo $(date)#x
y=`echo a`#b
n=$((x << y))
m=$((1<<k))
# real
k
cat <<END-X
hello
END-X
echo done
if (( a << b )); then echo x; fi
while ((i<<1 < n)); do i=$((i+1)); done
EOF
check
expect_rc "shell word starts" 1
expect "shell word starts" '[(e["path"], e["line"], e["kind"]) for e in d["fix"]]' "[('a.sh', 7, 'comment')]"
expect "shell word starts" 'd["unread"]' "[]"
echo "ok: a string, a heredoc, a regex and a template literal are not comments"

fresh
cat > h.sh <<'EOF'
python3 - <<'PY'
print(1)  # inside
PY
cat > f.txt <<'TXT'
# not scanned
TXT
EOF
check
expect_rc "python heredoc" 1
expect "python heredoc" '[(e["path"], e["line"], e["kind"]) for e in d["fix"]]' "[('h.sh', 2, 'comment')]"
echo "ok: a heredoc fed to python3 is scanned"

fresh
cat > d.ts <<'EOF'
/** Returns the plan. */
export function plan() {}
EOF
cat > m.py <<'EOF'
"""Module doc."""
x = 1
EOF
check
expect_rc "doc" 1
expect "doc" 'sorted((e["path"], e["kind"]) for e in d["fix"])' "[('d.ts', 'doc'), ('m.py', 'doc')]"
check --library
expect_rc "doc --library" 0
expect "doc --library" 'sorted(e["path"] for e in d["doc"])' "['d.ts', 'm.py']"
expect "doc --library" 'd["fix"]' "[]"
echo '// note' > e.js
check --library
expect_rc "doc --library with a comment" 1
expect "doc --library with a comment" '[(e["path"], e["kind"]) for e in d["fix"]]' "[('e.js', 'comment')]"
fresh
cat > g.go <<'EOF'
// Package g does things.
package g

// Exported does a thing.
func Exported() {}

// unexported does a thing.
func unexported() {}

// Spread out.

func Later() {}
EOF
cat > r.rs <<'EOF'
//! Crate docs.
/// Item docs.
/** Block docs. */
fn a() {}
// plain
fn b() {}
EOF
cat > h.html <<'EOF'
<!doctype html>
<html>
<style>
a { color: red; } /* css */
</style>
<script>
const x = 1; // js
</script>
</html>
EOF
check --library
expect_rc "go, rust and html" 1
expect "go, rust and html" '[(e["path"], e["line"]) for e in d["fix"]]' \
  "[('g.go', 7), ('g.go', 10), ('h.html', 4), ('h.html', 7), ('r.rs', 5)]"
expect "go, rust and html" '[(e["path"], e["line"]) for e in d["doc"]]' \
  "[('g.go', 1), ('g.go', 4), ('r.rs', 1), ('r.rs', 2), ('r.rs', 3)]"
echo "ok: a doc comment is a fix, and with --library it is listed under doc"

fresh
cat > s.py <<'EOF'
def f():
    """doc"""
    "not a docstring"
    return 1
EOF
check
expect "standalone string" '[(e["line"], e["kind"]) for e in d["fix"]]' "[(2, 'doc'), (3, 'comment')]"
check --library
expect "standalone string" '[(e["line"], e["kind"]) for e in d["fix"]]' "[(3, 'comment')]"
expect "standalone string" '[e["line"] for e in d["doc"]]' "[2]"
fresh
cat > b.py <<'EOF'
def f(): "explains f"
EOF
check
expect "one-line def" '[(e["line"], e["kind"]) for e in d["fix"]]' "[(1, 'doc')]"
echo "ok: a string that stands as a statement is a comment"

fresh
cat > a.js <<'EOF'
// eslint-disable-next-line no-console
console.log(1);
EOF
commit_all old
cat >> a.js <<'EOF'
// @ts-ignore
const x = 1;
EOF
check
expect_rc "suppression" 1
expect "suppression" '[(e["line"], e["kind"]) for e in d["fix"]]' "[(3, 'suppression')]"
expect "suppression" '[e["line"] for e in d["existing"]]' "[1]"
check --all
expect "suppression --all" '[(e["line"], e["kind"]) for e in d["fix"]]' "[(1, 'suppression'), (3, 'suppression')]"
fresh
cat > o.ts <<'EOF'
// oxlint-disable-next-line no-console
console.log(1);
EOF
commit_all oxc
cat >> o.ts <<'EOF'
/* oxlint-disable no-param-reassign */
// oxfmt-ignore
const m = [1, 0,
           0, 1];
// We never use oxlint-disable or oxfmt-ignore here.
EOF
check
expect_rc "oxc suppression" 1
expect "oxc suppression" '[(e["line"], e["kind"]) for e in d["fix"]]' "[(3, 'suppression'), (4, 'suppression'), (7, 'comment')]"
expect "oxc suppression" '[e["line"] for e in d["existing"]]' "[1]"
fresh
cat > a.js <<'EOF'
// We never use eslint-disable here; fix the rule instead.
const x = 1;
EOF
cat > a.py <<'EOF'
def f():
    """Lines ending in # noqa are skipped."""
    return 1
EOF
commit_all prose
cat > a.js <<'EOF'
// We never use eslint-disable here; fix the rule instead.
const x = 2;
EOF
cat > a.py <<'EOF'
def f():
    """Lines ending in # noqa are skipped."""
    return 2
EOF
check
expect_rc "prose naming a suppression" 1
expect "prose naming a suppression" '[(e["path"], e["kind"]) for e in d["fix"]]' "[('a.js', 'comment'), ('a.py', 'doc')]"
expect "prose naming a suppression" 'd["existing"]' "[]"
fresh
cat > a.js <<'EOF'
/*
  eslint-disable no-console
*/
console.log(1);
EOF
commit_all block
echo 'const y = 1;' >> a.js
check
expect_rc "block suppression" 0
expect "block suppression" '[e["line"] for e in d["existing"]]' "[1]"
fresh
cat > c.py <<'EOF'
import os  # noqa
a = 1
b = 2
c = 3
d = 4
EOF
commit_all rename
git mv c.py d.py
check
expect_rc "renamed suppression" 0
expect "renamed suppression" '[(e["path"], e["line"]) for e in d["existing"]]' "[('d.py', 1)]"
echo 'import sys  # noqa' >> d.py
check
expect_rc "renamed and edited" 1
expect "renamed and edited" '[(e["path"], e["line"]) for e in d["fix"]]' "[('d.py', 6)]"
expect "renamed and edited" '[(e["path"], e["line"]) for e in d["existing"]]' "[('d.py', 1)]"
git reset -q --hard
mv c.py e.py
check
expect_rc "moved without git" 0
expect "moved without git" '[(e["path"], e["line"]) for e in d["existing"]]' "[('e.py', 1)]"
git diff --cached --quiet || fail "moved without git: the index was changed"
fresh
cat > a.tsx <<'EOF'
const f = <T = unknown,>(x: T) => x;
const g = <const T,>(x: T) => x;
type F = <T>(x: T) => T;
let h: <T>(x: T) => T;
const k = <T extends object>(x: T) => x;
const el = <p>it's</p>;
EOF
check
expect_rc "tsx generics" 0
expect "tsx generics" 'd["scanned"]' 1
echo "ok: an added suppression is a fix, and an existing one is listed under existing"

fresh
cat > t.test.js <<'EOF'
it.skip("a", () => {});
xit("b", () => {});
it("c", () => {});
EOF
cat > u.py <<'EOF'
import pytest
import sys
@pytest.mark.skip
def test_a(): pass
@pytest.mark.skipif(sys.platform == "win32", reason="r")
def test_b(): pass
@pytest.mark.xfail
def test_c(): pass
def test_d():
    pytest.skip("no")
EOF
cat > m.rs <<'EOF'
#[ignore]
fn a() {}
#[allow(dead_code)]
fn b() {}
EOF
cat > g_test.go <<'EOF'
package x

import "testing"

func TestA(t *testing.T) { t.Skip("no") }
EOF
check
expect_rc "skip" 1
expect "skip" '[(e["path"], e["line"], e["kind"]) for e in d["fix"]]' \
  "[('m.rs', 1, 'suppression'), ('m.rs', 3, 'suppression'), ('t.test.js', 1, 'suppression'), ('t.test.js', 2, 'suppression'), ('u.py', 3, 'suppression'), ('u.py', 7, 'suppression')]"
echo "ok: an unconditional skip is a suppression, and a conditional one is not"

fresh
echo '// old note' > old.js
echo '// other note' > other.js
commit_all old
echo 'const x = 1;' >> old.js
check
expect_rc "touched" 1
expect "touched" '[(e["path"], e["line"]) for e in d["fix"]]' "[('old.js', 1)]"
expect "touched" 'd["scanned"]' 1
echo "ok: an existing comment in a touched file is a fix, and an untouched file is not listed"

fresh
echo 'ign.js' > .gitignore
commit_all ignore
mkdir sub
echo '// n' > sub/new.js
echo '// n' > ign.js
(cd sub && "$SCRIPT" > "$TMP/sub.json" 2>/dev/null) || true
OUT="$(cat "$TMP/sub.json")"
expect "untracked" '[e["path"] for e in d["fix"]]' "['sub/new.js']"
expect "untracked" 'd["scanned"]' 1
echo "ok: an untracked file is touched"

fresh
git config core.checkStat minimal
git config core.trustctime false
echo 'const x = 1;' > a.js
touch -t 202001010000.00 a.js
commit_all racy
touch -r a.js "$(git rev-parse --git-path index)"
echo '// note 1234' > a.js
[ "$(wc -c < a.js | tr -d " ")" = 13 ] || fail "racy: the rewrite changed the size"
touch -t 202001010000.00 a.js
git diff --quiet HEAD -- a.js && fail "racy: git itself misses the rewrite after the mtime is reset"
check
expect_rc "racy clean file" 1
expect "racy clean file" '[e["path"] for e in d["fix"]]' "['a.js']"
echo "ok: a file rewritten within the timestamp of the index is seen"

fresh
base="$(git rev-parse HEAD)"
echo '// one' > a.js
commit_all one
first="$(git rev-parse HEAD)"
echo '// two' > b.js
commit_all two
check
expect_rc "ref HEAD" 0
expect "ref HEAD" 'd["scanned"]' 0
check "$base"
expect "ref base" '[e["path"] for e in d["fix"]]' "['a.js', 'b.js']"
expect "ref base" 'd["ref"] == "'"$base"'"' True
check "$first"
expect "ref first" '[e["path"] for e in d["fix"]]' "['b.js']"
fresh
git branch docs
mkdir docs
echo 'const x = 1;' > docs/a.js
commit_all docs
check docs
expect_rc "ref that is also a path" 0
expect "ref that is also a path" 'd["scanned"]' 1
fresh
cat > '[id].tsx' <<'EOF'
const a = 1;
const b = 2;
const c = 3;
const d = 4;
const e = 5;
// eslint-disable-next-line no-console
console.log(1);
EOF
cat > i.tsx <<'EOF'
const i = 1;
EOF
commit_all pages
cat > '[id].tsx' <<'EOF'
const top = 0;
const a = 1;
const b = 2;
const c = 3;
const d = 4;
const e = 5;
// eslint-disable-next-line no-console
console.log(1);
EOF
cat > i.tsx <<'EOF'
const i = 1;
const j = 1;
const k = 1;
const l = 1;
const m = 1;
const n = 1;
const o = 1;
const p = 1;
EOF
check
expect_rc "glob in a path" 0
expect "glob in a path" '[(e["path"], e["line"]) for e in d["existing"]]' "[('[id].tsx', 7)]"
echo "ok: a ref other than HEAD is the base of the diff"

fresh
cat > a.js <<'EOF'
// note
// eslint-disable-next-line no-console
console.log(1);
EOF
echo 'x = 1' > b.py
commit_all files
check --all
expect_rc "--all" 1
expect "--all" 'd["ref"]' None
expect "--all" 'd["scanned"]' 2
expect "--all" '[e["kind"] for e in d["fix"]]' "['comment', 'suppression']"
expect "--all" 'd["existing"]' "[]"
echo "ok: --all lists every file and counts every suppression as a fix"

fresh
printf 'x = (\n' > bad.py
printf '/* never closed\n' > bad.js
printf 'const x = "\xff";\n' > bin.js
echo 'const ok = 1;' > ok.js
check
expect_rc "unread" 1
expect "unread" 'd["status"]' found
expect "unread" 'd["unread"]' "['bad.js', 'bad.py', 'bin.js']"
expect "unread" 'd["scanned"]' 1
echo "ok: a file that cannot be read fails the check"

fresh
echo 'const a = 1;' > a.js
check
expect_rc "clean" 0
expect "clean" 'd["status"]' clean
echo '// retry later' >> a.js
check
expect_rc "found" 1
expect "found" '[(e["path"], e["text"]) for e in d["fix"]]' "[('a.js', '// retry later')]"
echo 'const a = 1;' > a.js
check
expect_rc "removed" 0
check --bogus
expect_rc "usage" 2
grep -q '^usage:' "$TMP/err" || fail "usage text missing from stderr"
check --all HEAD
expect_rc "--all with a ref" 2
check nosuchref
expect_rc "unknown ref" 2
rc=0
(cd "$TMP/nogit" && "$SCRIPT" >/dev/null 2>&1) || rc=$?
expect_rc "outside git" 2
echo "ok: clean exits 0, found exits 1, a usage error and an unknown ref exit 2"
