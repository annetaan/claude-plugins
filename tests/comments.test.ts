import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/workflow/scripts/comments.sh");

const tmp = mkdtempSync(join(tmpdir(), "comments-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const nogit = join(tmp, "nogit");
mkdirSync(home);
mkdirSync(nogit);
const repo = join(tmp, "repo");

const env: Readonly<NodeJS.ProcessEnv> = {
  ...process.env,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CEILING_DIRECTORIES: tmp,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

const gitResult = (cwd: string, ...args: readonly string[]) =>
  spawnSync("git", args, { cwd, env, encoding: "utf8" });

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = gitResult(cwd, ...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

git(tmp, "config", "--global", "init.defaultBranch", "main");

const write = (name: string, text: string | Buffer): void => {
  writeFileSync(join(repo, name), text);
};

const append = (name: string, text: string): void => {
  appendFileSync(join(repo, name), text);
};

const fresh = (): void => {
  rmSync(repo, { recursive: true, force: true });
  git(tmp, "init", "-q", repo);
  write("README.md", "readme\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-q", "-m", "base");
};

const commitAll = (message: string): void => {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
};

type Fixed = {
  readonly path: string;
  readonly line: number;
  readonly kind: string;
  readonly text: string;
};
type Listed = { readonly path: string; readonly line: number; readonly text: string };
type Report = {
  readonly status: string;
  readonly ref: string | null;
  readonly scanned: number;
  readonly fix: readonly Fixed[];
  readonly doc: readonly Listed[];
  readonly existing: readonly Listed[];
  readonly unread: readonly string[];
};

type Checked = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly report: Report | null;
};

const check = (args: readonly string[] = [], cwd = repo): Checked => {
  const result = spawnSync(script, args, { cwd, env, encoding: "utf8" });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    report: result.stdout === "" ? null : (JSON.parse(result.stdout) as Report),
  };
};

const reportOf = (c: Checked): Report => {
  assert.ok(c.report !== null, c.stderr);
  return c.report;
};

const exits = (label: string, c: Checked, want: number): void => {
  assert.equal(c.code, want, `${label}: stdout ${c.stdout}`);
};

test("a comment is a fix in sh, py, js, ts, go, rs, css and html", () => {
  fresh();
  write("a.sh", "echo hi # note\n");
  write("a.py", "x = 1  # note\n");
  write("a.js", "const x = 1; // note\n");
  write("a.ts", "const x: number = 1; // note\n");
  write("a.go", "package main\n\nvar x = 1 // note\n");
  write("a.rs", "fn main() { let x = 1; // note\n}\n");
  write("a.css", "a { color: red; } /* note */\n");
  write("a.html", "<p>hi</p> <!-- note -->\n");
  let c = check();
  exits("comment in every language", c, 1);
  let r = reportOf(c);
  assert.deepEqual(
    r.fix
      .filter((e) => e.kind === "comment")
      .map((e) => e.path)
      .toSorted(),
    ["a.css", "a.go", "a.html", "a.js", "a.py", "a.rs", "a.sh", "a.ts"],
    "comment in every language",
  );
  assert.equal(r.fix.length, 8, "comment in every language");

  fresh();
  write("a.tsx", "export const A = () => <p>Don't stop</p>; // c1\n");
  write("b.jsx", "export const A = () => <p>and/or // not a comment</p>;\n");
  write("c.js", "const o = {a:// c1\n1};\n");
  write("d.js", "let i = 0; i++ / 2; // c1\n");
  write("e.js", "const é = 4; const z = é / 2; // c1\n");
  write(
    "f.jsx",
    `const B = (
  <div className="a" onClick={() => 1 / 2}>
    {items.map((x) => <i key={x}>it's</i>)}
    {/* real */}
  </div>
);
`,
  );
  c = check();
  exits("jsx and division", c, 1);
  r = reportOf(c);
  assert.deepEqual(
    r.fix.map((e) => [e.path, e.line]),
    [
      ["a.tsx", 1],
      ["c.js", 1],
      ["d.js", 1],
      ["e.js", 1],
      ["f.jsx", 4],
    ],
    "jsx and division",
  );
});

test("a shebang, a licence header and a tool directive pass", () => {
  fresh();
  write("s.sh", "#!/usr/bin/env bash\n# shellcheck source=/dev/null\n. ./lib.sh\n");
  write("l.js", "// Copyright (c) 2026 Example\n// All rights reserved.\n\nconst x = 1;\n");
  write("t.ts", '// @ts-expect-error the library types are wrong\nconst x: number = "a";\n');
  write(
    "p.py",
    "#!/usr/bin/env python3\n# SPDX-License-Identifier: MIT\n# -*- coding: utf-8 -*-\nx = 1\n",
  );
  write("a.test.js", "/**\n * @jest-environment jsdom\n */\ntest('a', () => {});\n");
  let c = check();
  exits("pass", c, 0);
  let r = reportOf(c);
  assert.equal(r.status, "clean", "pass");
  assert.equal(r.scanned, 5, "pass");

  fresh();
  write(
    "b.js",
    "/*\n * Builds the cache.\n * Rendered by @jsx automatic runtime.\n */\nconst x = 1;\n",
  );
  write("c.js", "const x = 1; // TODO drop @ts-check later\n");
  c = check();
  exits("prose naming a directive", c, 1);
  r = reportOf(c);
  assert.deepEqual(
    r.fix.map((e) => [e.path, e.kind]),
    [
      ["b.js", "comment"],
      ["c.js", "comment"],
    ],
    "prose naming a directive",
  );

  fresh();
  write(
    "a.py",
    '# SPDX-License-Identifier: MIT\n"""Explains the module at length."""\nimport os\n',
  );
  r = reportOf(check());
  assert.deepEqual(
    r.fix.map((e) => [e.path, e.line, e.kind]),
    [["a.py", 2, "doc"]],
    "licence then docstring",
  );
});

test("a configuration file is not scanned", () => {
  fresh();
  mkdirSync(join(repo, "sub"));
  write("vite.config.js", "// note\nexport default {};\n");
  write(".eslintrc.js", "// note\nmodule.exports = {};\n");
  write("ok.js", "const ok = 1;\n");
  const c = check();
  exits("config", c, 0);
  assert.equal(reportOf(c).scanned, 1, "config");
});

test("a string, a heredoc, a regex and a template literal are not comments", () => {
  fresh();
  write(
    "s.sh",
    `echo "a # b"
echo 'c # d'
echo $# \${#0}
echo a#b
x="$(echo "q # r")"
cat > f.txt <<'TXT'
# in a heredoc
TXT
echo done
`,
  );
  write(
    "r.js",
    `const url = "http://example.com";
const re = /a\\/\\/b/;
const t = \`x // y \${"z // w"} /* v */\`;
const q = 'it\\'s // no';
const parts = [1, 2].map((n) => n / 2 / 3);
`,
  );
  write("r.py", `x = "a # b"\ny = '''c # d'''\nz = f"{x} # no"\n`);
  write(
    "r.rs",
    `fn f<'a>(s: &'a str) -> &'a str {
    let raw = r#"// no"#;
    let quote = '"';
    let hash = '#';
    s
}
`,
  );
  let c = check();
  exits("not comments", c, 0);
  assert.equal(reportOf(c).scanned, 4, "not comments");

  fresh();
  write(
    "a.sh",
    `base=x
url=\${base}#anchor
echo $(date)#x
y=\`echo a\`#b
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
`,
  );
  c = check();
  exits("shell word starts", c, 1);
  const r = reportOf(c);
  assert.deepEqual(
    r.fix.map((e) => [e.path, e.line, e.kind]),
    [["a.sh", 7, "comment"]],
    "shell word starts",
  );
  assert.deepEqual(r.unread, [], "shell word starts");
});

test("a heredoc fed to python3 is scanned", () => {
  fresh();
  write(
    "h.sh",
    `python3 - <<'PY'
print(1)  # inside
PY
cat > f.txt <<'TXT'
# not scanned
TXT
`,
  );
  const c = check();
  exits("python heredoc", c, 1);
  assert.deepEqual(
    reportOf(c).fix.map((e) => [e.path, e.line, e.kind]),
    [["h.sh", 2, "comment"]],
    "python heredoc",
  );
});

test("a doc comment is a fix, and with --library it is listed under doc", () => {
  fresh();
  write("d.ts", "/** Returns the plan. */\nexport function plan() {}\n");
  write("m.py", '"""Module doc."""\nx = 1\n');
  let c = check();
  exits("doc", c, 1);
  assert.deepEqual(
    reportOf(c)
      .fix.map((e) => [e.path, e.kind])
      .toSorted((a, b) => (a.join("\n") < b.join("\n") ? -1 : 1)),
    [
      ["d.ts", "doc"],
      ["m.py", "doc"],
    ],
    "doc",
  );
  c = check(["--library"]);
  exits("doc --library", c, 0);
  let r = reportOf(c);
  assert.deepEqual(r.doc.map((e) => e.path).toSorted(), ["d.ts", "m.py"], "doc --library");
  assert.deepEqual(r.fix, [], "doc --library");
  write("e.js", "// note\n");
  c = check(["--library"]);
  exits("doc --library with a comment", c, 1);
  assert.deepEqual(
    reportOf(c).fix.map((e) => [e.path, e.kind]),
    [["e.js", "comment"]],
    "doc --library with a comment",
  );

  fresh();
  write(
    "g.go",
    `// Package g does things.
package g

// Exported does a thing.
func Exported() {}

// unexported does a thing.
func unexported() {}

// Spread out.

func Later() {}
`,
  );
  write(
    "r.rs",
    `//! Crate docs.
/// Item docs.
/** Block docs. */
fn a() {}
// plain
fn b() {}
`,
  );
  write(
    "h.html",
    `<!doctype html>
<html>
<style>
a { color: red; } /* css */
</style>
<script>
const x = 1; // js
</script>
</html>
`,
  );
  c = check(["--library"]);
  exits("go, rust and html", c, 1);
  r = reportOf(c);
  assert.deepEqual(
    r.fix.map((e) => [e.path, e.line]),
    [
      ["g.go", 7],
      ["g.go", 10],
      ["h.html", 4],
      ["h.html", 7],
      ["r.rs", 5],
    ],
    "go, rust and html",
  );
  assert.deepEqual(
    r.doc.map((e) => [e.path, e.line]),
    [
      ["g.go", 1],
      ["g.go", 4],
      ["r.rs", 1],
      ["r.rs", 2],
      ["r.rs", 3],
    ],
    "go, rust and html",
  );
});

test("a string that stands as a statement is a comment", () => {
  fresh();
  write("s.py", 'def f():\n    """doc"""\n    "not a docstring"\n    return 1\n');
  let r = reportOf(check());
  assert.deepEqual(
    r.fix.map((e) => [e.line, e.kind]),
    [
      [2, "doc"],
      [3, "comment"],
    ],
    "standalone string",
  );
  r = reportOf(check(["--library"]));
  assert.deepEqual(
    r.fix.map((e) => [e.line, e.kind]),
    [[3, "comment"]],
    "standalone string",
  );
  assert.deepEqual(
    r.doc.map((e) => e.line),
    [2],
    "standalone string",
  );

  fresh();
  write("b.py", 'def f(): "explains f"\n');
  r = reportOf(check());
  assert.deepEqual(
    r.fix.map((e) => [e.line, e.kind]),
    [[1, "doc"]],
    "one-line def",
  );
});

test("an added suppression is a fix, and an existing one is listed under existing", () => {
  fresh();
  write("a.js", "// eslint-disable-next-line no-console\nconsole.log(1);\n");
  commitAll("old");
  append("a.js", "// @ts-ignore\nconst x = 1;\n");
  let c = check();
  exits("suppression", c, 1);
  let r = reportOf(c);
  assert.deepEqual(
    r.fix.map((e) => [e.line, e.kind]),
    [[3, "suppression"]],
    "suppression",
  );
  assert.deepEqual(
    r.existing.map((e) => e.line),
    [1],
    "suppression",
  );
  r = reportOf(check(["--all"]));
  assert.deepEqual(
    r.fix.map((e) => [e.line, e.kind]),
    [
      [1, "suppression"],
      [3, "suppression"],
    ],
    "suppression --all",
  );

  fresh();
  write("o.ts", "// oxlint-disable-next-line no-console\nconsole.log(1);\n");
  commitAll("oxc");
  append(
    "o.ts",
    `/* oxlint-disable no-param-reassign */
// oxfmt-ignore
const m = [1, 0,
           0, 1];
// We never use oxlint-disable or oxfmt-ignore here.
`,
  );
  c = check();
  exits("oxc suppression", c, 1);
  r = reportOf(c);
  assert.deepEqual(
    r.fix.map((e) => [e.line, e.kind]),
    [
      [3, "suppression"],
      [4, "suppression"],
      [7, "comment"],
    ],
    "oxc suppression",
  );
  assert.deepEqual(
    r.existing.map((e) => e.line),
    [1],
    "oxc suppression",
  );

  fresh();
  write("a.js", "// We never use eslint-disable here; fix the rule instead.\nconst x = 1;\n");
  write("a.py", 'def f():\n    """Lines ending in # noqa are skipped."""\n    return 1\n');
  commitAll("prose");
  write("a.js", "// We never use eslint-disable here; fix the rule instead.\nconst x = 2;\n");
  write("a.py", 'def f():\n    """Lines ending in # noqa are skipped."""\n    return 2\n');
  c = check();
  exits("prose naming a suppression", c, 1);
  r = reportOf(c);
  assert.deepEqual(
    r.fix.map((e) => [e.path, e.kind]),
    [
      ["a.js", "comment"],
      ["a.py", "doc"],
    ],
    "prose naming a suppression",
  );
  assert.deepEqual(r.existing, [], "prose naming a suppression");

  fresh();
  write("a.js", "/*\n  eslint-disable no-console\n*/\nconsole.log(1);\n");
  commitAll("block");
  append("a.js", "const y = 1;\n");
  c = check();
  exits("block suppression", c, 0);
  assert.deepEqual(
    reportOf(c).existing.map((e) => e.line),
    [1],
    "block suppression",
  );

  fresh();
  write("c.py", "import os  # noqa\na = 1\nb = 2\nc = 3\nd = 4\n");
  commitAll("rename");
  git(repo, "mv", "c.py", "d.py");
  c = check();
  exits("renamed suppression", c, 0);
  assert.deepEqual(
    reportOf(c).existing.map((e) => [e.path, e.line]),
    [["d.py", 1]],
    "renamed suppression",
  );
  append("d.py", "import sys  # noqa\n");
  c = check();
  exits("renamed and edited", c, 1);
  r = reportOf(c);
  assert.deepEqual(
    r.fix.map((e) => [e.path, e.line]),
    [["d.py", 6]],
    "renamed and edited",
  );
  assert.deepEqual(
    r.existing.map((e) => [e.path, e.line]),
    [["d.py", 1]],
    "renamed and edited",
  );
  git(repo, "reset", "-q", "--hard");
  renameSync(join(repo, "c.py"), join(repo, "e.py"));
  c = check();
  exits("moved without git", c, 0);
  assert.deepEqual(
    reportOf(c).existing.map((e) => [e.path, e.line]),
    [["e.py", 1]],
    "moved without git",
  );
  assert.equal(
    gitResult(repo, "diff", "--cached", "--quiet").status,
    0,
    "moved without git: the index was changed",
  );

  fresh();
  write(
    "a.tsx",
    `const f = <T = unknown,>(x: T) => x;
const g = <const T,>(x: T) => x;
type F = <T>(x: T) => T;
let h: <T>(x: T) => T;
const k = <T extends object>(x: T) => x;
const el = <p>it's</p>;
`,
  );
  c = check();
  exits("tsx generics", c, 0);
  assert.equal(reportOf(c).scanned, 1, "tsx generics");
});

test("an unconditional skip is a suppression, and a conditional one is not", () => {
  fresh();
  write("t.test.js", 'it.skip("a", () => {});\nxit("b", () => {});\nit("c", () => {});\n');
  write(
    "u.py",
    `import pytest
import sys
@pytest.mark.skip
def test_a(): pass
@pytest.mark.skipif(sys.platform == "win32", reason="r")
def test_b(): pass
@pytest.mark.xfail
def test_c(): pass
def test_d():
    pytest.skip("no")
`,
  );
  write("m.rs", "#[ignore]\nfn a() {}\n#[allow(dead_code)]\nfn b() {}\n");
  write(
    "g_test.go",
    'package x\n\nimport "testing"\n\nfunc TestA(t *testing.T) { t.Skip("no") }\n',
  );
  const c = check();
  exits("skip", c, 1);
  assert.deepEqual(
    reportOf(c).fix.map((e) => [e.path, e.line, e.kind]),
    [
      ["m.rs", 1, "suppression"],
      ["m.rs", 3, "suppression"],
      ["t.test.js", 1, "suppression"],
      ["t.test.js", 2, "suppression"],
      ["u.py", 3, "suppression"],
      ["u.py", 7, "suppression"],
    ],
    "skip",
  );
});

test("an existing comment in a touched file is a fix, and an untouched file is not listed", () => {
  fresh();
  write("old.js", "// old note\n");
  write("other.js", "// other note\n");
  commitAll("old");
  append("old.js", "const x = 1;\n");
  const c = check();
  exits("touched", c, 1);
  const r = reportOf(c);
  assert.deepEqual(
    r.fix.map((e) => [e.path, e.line]),
    [["old.js", 1]],
    "touched",
  );
  assert.equal(r.scanned, 1, "touched");
});

test("an untracked file is touched", () => {
  fresh();
  write(".gitignore", "ign.js\n");
  commitAll("ignore");
  mkdirSync(join(repo, "sub"));
  write("sub/new.js", "// n\n");
  write("ign.js", "// n\n");
  const r = reportOf(check([], join(repo, "sub")));
  assert.deepEqual(
    r.fix.map((e) => e.path),
    ["sub/new.js"],
    "untracked",
  );
  assert.equal(r.scanned, 1, "untracked");
});

test("a file rewritten within the timestamp of the index is seen", () => {
  fresh();
  git(repo, "config", "core.checkStat", "minimal");
  git(repo, "config", "core.trustctime", "false");
  const file = join(repo, "a.js");
  const t2020 = new Date(2020, 0, 1, 0, 0, 0);
  write("a.js", "const x = 1;\n");
  utimesSync(file, t2020, t2020);
  commitAll("racy");
  const stamp = statSync(file);
  utimesSync(
    join(repo, git(repo, "rev-parse", "--git-path", "index").trim()),
    stamp.atime,
    stamp.mtime,
  );
  write("a.js", "// note 1234\n");
  assert.equal(statSync(file).size, 13, "racy: the rewrite changed the size");
  utimesSync(file, t2020, t2020);
  assert.notEqual(
    gitResult(repo, "diff", "--quiet", "HEAD", "--", "a.js").status,
    0,
    "racy: git itself misses the rewrite after the mtime is reset",
  );
  const c = check();
  exits("racy clean file", c, 1);
  assert.deepEqual(
    reportOf(c).fix.map((e) => e.path),
    ["a.js"],
    "racy clean file",
  );
});

test("a ref other than HEAD is the base of the diff", () => {
  fresh();
  const base = git(repo, "rev-parse", "HEAD").trim();
  write("a.js", "// one\n");
  commitAll("one");
  const first = git(repo, "rev-parse", "HEAD").trim();
  write("b.js", "// two\n");
  commitAll("two");
  let c = check();
  exits("ref HEAD", c, 0);
  assert.equal(reportOf(c).scanned, 0, "ref HEAD");
  let r = reportOf(check([base]));
  assert.deepEqual(
    r.fix.map((e) => e.path),
    ["a.js", "b.js"],
    "ref base",
  );
  assert.equal(r.ref, base, "ref base");
  r = reportOf(check([first]));
  assert.deepEqual(
    r.fix.map((e) => e.path),
    ["b.js"],
    "ref first",
  );

  fresh();
  git(repo, "branch", "docs");
  mkdirSync(join(repo, "docs"));
  write("docs/a.js", "const x = 1;\n");
  commitAll("docs");
  c = check(["docs"]);
  exits("ref that is also a path", c, 0);
  assert.equal(reportOf(c).scanned, 1, "ref that is also a path");

  fresh();
  write(
    "[id].tsx",
    `const a = 1;
const b = 2;
const c = 3;
const d = 4;
const e = 5;
// eslint-disable-next-line no-console
console.log(1);
`,
  );
  write("i.tsx", "const i = 1;\n");
  commitAll("pages");
  write(
    "[id].tsx",
    `const top = 0;
const a = 1;
const b = 2;
const c = 3;
const d = 4;
const e = 5;
// eslint-disable-next-line no-console
console.log(1);
`,
  );
  write(
    "i.tsx",
    `const i = 1;
const j = 1;
const k = 1;
const l = 1;
const m = 1;
const n = 1;
const o = 1;
const p = 1;
`,
  );
  c = check();
  exits("glob in a path", c, 0);
  assert.deepEqual(
    reportOf(c).existing.map((e) => [e.path, e.line]),
    [["[id].tsx", 7]],
    "glob in a path",
  );
});

test("--all lists every file and counts every suppression as a fix", () => {
  fresh();
  write("a.js", "// note\n// eslint-disable-next-line no-console\nconsole.log(1);\n");
  write("b.py", "x = 1\n");
  commitAll("files");
  const c = check(["--all"]);
  exits("--all", c, 1);
  const r = reportOf(c);
  assert.equal(r.ref, null, "--all");
  assert.equal(r.scanned, 2, "--all");
  assert.deepEqual(
    r.fix.map((e) => e.kind),
    ["comment", "suppression"],
    "--all",
  );
  assert.deepEqual(r.existing, [], "--all");
});

test("a file that cannot be read fails the check", () => {
  fresh();
  write("bad.py", "x = (\n");
  write("bad.js", "/* never closed\n");
  write(
    "bin.js",
    Buffer.concat([Buffer.from('const x = "'), Buffer.from([0xff]), Buffer.from('";\n')]),
  );
  write("ok.js", "const ok = 1;\n");
  const c = check();
  exits("unread", c, 1);
  const r = reportOf(c);
  assert.equal(r.status, "found", "unread");
  assert.deepEqual(r.unread, ["bad.js", "bad.py", "bin.js"], "unread");
  assert.equal(r.scanned, 1, "unread");
});

test("clean exits 0, found exits 1, a usage error and an unknown ref exit 2", () => {
  fresh();
  write("a.js", "const a = 1;\n");
  let c = check();
  exits("clean", c, 0);
  assert.equal(reportOf(c).status, "clean", "clean");
  append("a.js", "// retry later\n");
  c = check();
  exits("found", c, 1);
  assert.deepEqual(
    reportOf(c).fix.map((e) => [e.path, e.text]),
    [["a.js", "// retry later"]],
    "found",
  );
  write("a.js", "const a = 1;\n");
  exits("removed", check(), 0);
  c = check(["--bogus"]);
  exits("usage", c, 2);
  assert.ok(
    c.stderr.split("\n").some((l) => l.startsWith("usage:")),
    "usage text missing from stderr",
  );
  exits("--all with a ref", check(["--all", "HEAD"]), 2);
  exits("unknown ref", check(["nosuchref"]), 2);
  exits("outside git", check([], nogit), 2);
});
