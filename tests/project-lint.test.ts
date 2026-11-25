import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/pj1-plan/scripts/project.sh");

const tmp = mkdtempSync(join(tmpdir(), "project-lint-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const run = (args: readonly string[], input?: string) =>
  spawnSync("bash", [script, ...args], {
    cwd: tmp,
    env: process.env,
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
  });

const printed = (result: ReturnType<typeof run>): string => {
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

const body = (first: string, second: string, third: string, extra = ""): string => `## Goal

Sign-out stops emptying what the page fetched once.

## Design

- \`src/session.ts\` (changed): \`signOut\` clears only the entries the session owns
- \`src/session.test.ts\` (changed): adds \`keeps the page-level cache on sign-out\` beside the \`signOut\` cases

\`signOut\` narrows its clear to the session's keys, so the sign-in form finds the fetched value where it left it.

### Shared state

- \`cache\` in \`src/cache.ts\`: written by \`signOut\`
  - \`SignInForm\` in \`src/signin.ts\`: assumes the value lives for the whole app, and it still does

### Model decisions

- Narrow the clear instead of refetching on a miss. The cause is the wide clear (\`src/session.ts\` \`signOut\`).
${extra}

## Acceptance criteria

- sign out, then sign in again: \`npm test -- signin\` prints \`3 passed\`
- \`keeps the page-level cache on sign-out\` passes

## Decisions

### D1. Does the admin screen show the retry count?

It changes what the people who run it see.

Only you know: whether the people who run the admin screen need the count.

- [${first}] Show it (recommended)
  Adds a column to \`src/admin.ts\`.
- [ ] Hide it${third}
  Leaves \`src/admin.ts\` as it is.

### D2. Does the page warn before sign-out?

Only you know: whether the people who sign out lose unsaved work.

- [${second}] Warn (recommended)
  Adds a prompt.
- [ ] Do not warn
  Nothing changes.

## Out of scope

The admin screen.
`;

const write = (name: string, text: string): string => {
  const path = join(tmp, name);
  writeFileSync(path, text);
  return path;
};

const lint = (path: string) => JSON.parse(printed(run(["--lint", path])));

const reasons = (path: string): unknown => {
  const found: readonly (string | { readonly code: string })[] = lint(path).reasons;
  return found.map((reason) => (typeof reason === "string" ? reason : reason.code));
};

const ok = (path: string): unknown => lint(path).ok;

test("an open decision with its Only you know line fails only decisions-open", () => {
  assert.deepEqual(reasons(write("open.md", body("x", " ", ""))), ["decisions-open"]);
});

test("both decisions ticked pass the lint with the subsections and the lines in place", () => {
  const path = write("ticked.md", body("x", "x", ""));
  assert.equal(ok(path), true, JSON.stringify(lint(path)));
});

test("two (recommended) in one decision still fail decision-shape", () => {
  const got = reasons(write("shape.md", body("x", "x", " (recommended)")));
  assert.ok(Array.isArray(got) && got.includes("decision-shape"), JSON.stringify(got));
});

test("a body with ### Left broken passes the lint", () => {
  const text = body(
    "x",
    "x",
    "",
    "\n### Left broken\n\n- `npm test -- signin`: fails until the next task moves the callers",
  );
  const path = write("broken.md", text);
  assert.equal(ok(path), true, JSON.stringify(lint(path)));
  assert.equal(JSON.parse(printed(run(["--lint", "-"], readFileSync(path, "utf8")))).ok, true);
});

test("a Left broken bullet with no backticked check fails breakage-entry", () => {
  const text = body(
    "x",
    "x",
    "",
    "\n### Left broken\n\n- the signin tests fail until the next task",
  );
  assert.deepEqual(reasons(write("nocheck.md", text)), ["breakage-entry"]);
});

const bodyOne = (path: string, text: string): string =>
  write(
    "one.md",
    `## Goal\n\nx\n\n## Design\n\n- \`${path}\` (changed): ${text}\n\n## Acceptance criteria\n\n- \`foo\` is renamed.\n\n## Decisions\n\nNone.\n\n## Out of scope\n\nNothing.\n`,
  );

test("a changed entry on a document passes with no symbol", () => {
  for (const doc of ["docs/guide.md", "README.MD"]) {
    const path = bodyOne(doc, "says the count comes from the settings");
    assert.equal(ok(path), true, `${doc}: ${JSON.stringify(lint(path))}`);
  }
});

test("--lint leaves a code entry with no symbol to --check", () => {
  for (const code of ["src/app.ts", "requirements.txt"]) {
    const path = bodyOne(code, "says the count comes from the settings");
    assert.equal(ok(path), true, `${code}: ${JSON.stringify(lint(path))}`);
  }
});

const base = body("x", "x", "");

const without = (name: string, start: string): string =>
  write(
    name,
    base
      .split("\n")
      .filter((line) => !line.startsWith(start))
      .join("\n"),
  );

test("a decision with no Only you know line fails only-you-know", () => {
  const path = without("noyk.md", "Only you know: whether the people who sign out");
  assert.deepEqual(reasons(path), ["only-you-know"]);
});

test("an option with no indented line fails option-shape", () => {
  for (const [name, start] of [
    ["last.md", "  Nothing changes."],
    ["next.md", "  Adds a prompt."],
  ] as const) {
    assert.deepEqual(reasons(without(name, start)), ["option-shape"], name);
  }
  const fenced = base.replace("  Adds a prompt.\n", "  ```sh\n  prompt\n  ```\n");
  assert.deepEqual(reasons(write("fenced.md", fenced)), []);
});

test("a pointer by line number fails line-number and a port does not", () => {
  const hits = [
    "`src/app.ts:42`",
    "see a/b:7",
    "`src/app.ts#L42-L50`",
    "https://github.com/o/r/blob/main/src/app.ts#L42",
    "参照src/app.ts:42",
    "src/app.ts#L42を参照",
  ];
  for (const hit of hits) {
    assert.deepEqual(
      reasons(write("hit.md", body("x", "x", "", `- ${hit}`))),
      ["line-number"],
      hit,
    );
  }
  const misses = [
    "`localhost:8080`",
    "https://example.com:443/path",
    "at 10:30",
    "`127.0.0.1:8080`",
    "`Dockerfile:3`",
    "\n```\nsrc/app.ts:42\n```",
  ];
  for (const miss of misses) {
    assert.deepEqual(reasons(write("miss.md", body("x", "x", "", `- ${miss}`))), [], miss);
  }
});

test("--lint prints the decision counts", () => {
  assert.deepEqual(lint(join(tmp, "open.md")).decisions, {
    contradictory: 0,
    open: 1,
    settled: 1,
    total: 2,
  });
});

const parent = (
  base = "Base: `pj/7` from `main`",
  roadmap = "",
  order = "1. #8",
  decisions = "None.",
  outOfScope = "z",
): string => `${base}
${roadmap}

## Order

${order}

## Goal

x

## Design

y

## Decisions

${decisions}

## Out of scope

${outOfScope}
`;

const decision = (
  box: string,
  second = "- [ ] B\n  b",
  onlyYouKnow = "Only you know: the users.",
): string =>
  `### D1. Which?\n\nWhy.\n\n${onlyYouKnow}\n\n- [${box}] A (recommended)\n  a\n${second}\n`.replace(
    /\n+$/,
    "",
  );

const plint = (text: string): unknown => {
  const result = JSON.parse(printed(run(["--parent-lint", "-"], text)));
  return [result.ok, result.reasons];
};

const B = "Base: `pj/7` from `main`";

test("--parent-lint names each broken rule and passes a parent in the format", () => {
  const cases: readonly (readonly [unknown, string])[] = [
    [
      [true, []],
      parent(B, "Roadmap: `docs/roadmap.md` Retry settings", "1. #8\n2. #9", decision("x")),
    ],
    [[false, ["base"]], parent("Base: pj/7 from main")],
    [[false, ["roadmap"]], parent(B, "Roadmap: `notes.md` Retry settings")],
    [[false, ["roadmap"]], parent(B, "Roadmap: `docs/roadmap.md`")],
    [[false, ["order"]], parent(B, "", "1. #8 first")],
    [[false, ["sections"]], parent(B, "", "1. #8", "None.\n\n## Notes")],
    [[false, ["decision-shape"]], parent(B, "", "1. #8", decision("x", ""))],
    [[false, ["only-you-know"]], parent(B, "", "1. #8", decision("x", "- [ ] B\n  b", ""))],
    [[false, ["decisions-open"]], parent(B, "", "1. #8", decision(" "))],
    [[false, ["decisions-contradictory"]], parent(B, "", "1. #8", decision("x", "- [x] B\n  b"))],
    [
      [false, ["sections"]],
      `${B}\n\n## Goal\n\nx\n\n## Order\n\n1. #8\n\n## Design\n\ny\n\n## Decisions\n\nNone.\n\n## Out of scope\n\nz\n`,
    ],
  ];
  for (const [want, text] of cases) {
    assert.deepEqual(plint(text), want, text);
  }
});

test("--parent-lint passes None. and no Roadmap line", () => {
  const text = `${B}\n\n## Goal\n\nx\n\n## Design\n\ny\n\n## Decisions\n\nNone.\n\n## Out of scope\n\nz\n`;
  assert.deepEqual(plint(text), [true, []]);
});
