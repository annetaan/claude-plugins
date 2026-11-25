import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addedLines,
  buildReport,
  changedPaths,
  judge,
  parseArgs,
  type Entry,
  type Scanned,
} from "../plugins/annetaan/skills/workflow/scripts/pure/comment-check.ts";

const lines = (...parts: readonly string[]): string => parts.join("\n");

const entriesOf = (language: Parameters<typeof judge>[0], text: string): readonly Entry[] => {
  const judged = judge(language, text);
  assert.ok(judged.read, `${language} is read`);
  return judged.entries;
};

const comment = (line: number, text: string, end = line): Entry => ({
  kind: "comment",
  line,
  end,
  text,
});

const doc = (line: number, text: string, end = line): Entry => ({ kind: "doc", line, end, text });

test("python strings, prefixes and f-string fields are not comments", () => {
  const text = lines(
    "a = rb'#'",
    'b = F"#{x}"',
    "c = t'#'",
    'd = """#"""',
    's = "@pytest.mark.skip"',
    "e = 1  # real",
    "",
  );
  assert.deepEqual(entriesOf("python", text), [comment(6, "# real")]);
});

test("a comment inside an f-string field is a comment", () => {
  const text = lines('y = f"""{x  # c', '}"""', "");
  assert.deepEqual(entriesOf("python", text), [comment(1, "# c")]);
});

test("python docstrings after a header and on a one-line def", () => {
  const text = lines(
    '"""Module."""',
    "def f():",
    '    """F."""',
    "async def g():",
    '    """G."""',
    "class C(B):",
    '    """C."""',
    'def h(): "doc"',
    "x = 1",
    '"not doc"',
    "",
  );
  assert.deepEqual(entriesOf("python", text), [
    doc(1, '"""Module."""'),
    doc(3, '"""F."""'),
    doc(5, '"""G."""'),
    doc(7, '"""C."""'),
    doc(8, '"doc"'),
    comment(10, '"not doc"'),
  ]);
});

test("python that cannot be delimited is unread", () => {
  for (const text of [
    lines("x = 'abc", "y = 1", ""),
    lines('x = """abc', "y = 1", ""),
    lines("x = (1,", ""),
    lines("x = 1 \\", ""),
  ]) {
    assert.deepEqual(judge("python", text), { read: false }, text);
  }
  assert.deepEqual(entriesOf("python", lines("if x:", "    a = 1", "  b = 2  # c", "")), [
    comment(3, "# c"),
  ]);
});

test("crlf line ends", () => {
  assert.deepEqual(entriesOf("python", "x = 1  # c\r\n"), [comment(1, "# c")]);
  const continued = ["x = 'a\\", "b'", "y = f'a\\", "{x}'", "z = b'a\\", "b'  # c", ""];
  assert.deepEqual(entriesOf("python", continued.join("\r\n")), [comment(6, "# c")]);
  const shell = ["a=1 # c", "b=2", "# d", ""];
  assert.deepEqual(entriesOf("shell", shell.join("\r\n")), entriesOf("shell", shell.join("\n")));
  const js = ["const a = 1; // c", "/* d", "   e */", "const b = '/*';", ""];
  assert.deepEqual(entriesOf("js", js.join("\r\n")), entriesOf("js", js.join("\n")));
  assert.deepEqual(entriesOf("js", js.join("\r\n")), [comment(1, "// c"), comment(2, "/* d", 3)]);
});

test("non-ASCII identifiers and text", () => {
  assert.deepEqual(entriesOf("ts", lines("const a = 0;", "const é = 1; // c", "")), [
    comment(2, "// c"),
  ]);
  assert.deepEqual(entriesOf("python", lines("x = 0", "名前 = 1  # c", "")), [comment(2, "# c")]);
  assert.deepEqual(entriesOf("ts", lines("const v = é² / 2 // c", "")), [comment(1, "// c")]);
});

test("changed paths pair renames", () => {
  assert.deepEqual(
    changedPaths(["M", "a.js", "R100", "old.ts", "new.ts", "C075", "src.go", "copy.go"]),
    new Map([
      ["a.js", "a.js"],
      ["new.ts", "old.ts"],
      ["copy.go", "src.go"],
    ]),
  );
});

test("added lines from hunk headers", () => {
  const diff = lines(
    "diff --git a/x b/x",
    "@@ -1 +2 @@",
    "+a",
    "@@ -3,0 +5,2 @@",
    "+b",
    "+c",
    "@@ -9,2 +12,0 @@",
    "-d",
    "-e",
    "",
  );
  assert.deepEqual(addedLines(diff), new Set([2, 5, 6]));
});

test("arguments", () => {
  assert.deepEqual(parseArgs([]), { library: false, every: false, ref: "HEAD" });
  assert.deepEqual(parseArgs(["--library"]), { library: true, every: false, ref: "HEAD" });
  assert.deepEqual(parseArgs(["--all"]), { library: false, every: true, ref: "HEAD" });
  assert.deepEqual(parseArgs(["main"]), { library: false, every: false, ref: "main" });
  assert.deepEqual(parseArgs(["--library", "main"]), { library: true, every: false, ref: "main" });
  for (const argv of [["--bogus"], ["a", "b"], ["--all", "HEAD"]]) {
    assert.equal(parseArgs(argv), null, argv.join(" "));
  }
});

test("report buckets and status", () => {
  const suppression = (line: number): Entry => ({
    kind: "suppression",
    line,
    end: line,
    text: "// eslint-disable-line",
  });
  const files: readonly Scanned[] = [
    {
      path: "b.ts",
      judged: { read: true, entries: [suppression(10), suppression(9), doc(3, "/** d */")] },
      added: new Set([10]),
    },
    {
      path: "a.ts",
      judged: { read: true, entries: [comment(2, "// x"), comment(2, "// y")] },
      added: new Set(),
    },
  ];
  const args = { library: false, every: false, ref: "main" };
  assert.deepEqual(buildReport(args, files), {
    status: "found",
    ref: "main",
    scanned: 2,
    fix: [
      { path: "a.ts", line: 2, text: "// x", kind: "comment" },
      { path: "a.ts", line: 2, text: "// y", kind: "comment" },
      { path: "b.ts", line: 3, text: "/** d */", kind: "doc" },
      { path: "b.ts", line: 10, text: "// eslint-disable-line", kind: "suppression" },
    ],
    doc: [],
    existing: [{ path: "b.ts", line: 9, text: "// eslint-disable-line" }],
    unread: [],
  });
  const library = buildReport({ ...args, library: true }, files);
  assert.deepEqual(library.doc, [{ path: "b.ts", line: 3, text: "/** d */" }]);
  assert.equal(
    library.fix.some((e) => e.kind === "doc"),
    false,
  );
  const every = buildReport({ library: false, every: true, ref: "HEAD" }, [
    {
      path: "b.ts",
      judged: { read: true, entries: [suppression(10), suppression(9)] },
      added: null,
    },
  ]);
  assert.equal(every.ref, null);
  assert.deepEqual(every.existing, []);
  assert.deepEqual(every.fix, [
    { path: "b.ts", line: 9, text: "// eslint-disable-line", kind: "suppression" },
    { path: "b.ts", line: 10, text: "// eslint-disable-line", kind: "suppression" },
  ]);
  const unread = buildReport(args, [{ path: "c.py", judged: { read: false }, added: new Set() }]);
  assert.deepEqual(unread, {
    status: "found",
    ref: "main",
    scanned: 0,
    fix: [],
    doc: [],
    existing: [],
    unread: ["c.py"],
  });
  const clean = buildReport(args, [
    { path: "d.py", judged: { read: true, entries: [] }, added: new Set() },
  ]);
  assert.equal(clean.status, "clean");
});
