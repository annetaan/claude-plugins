import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/pj1-plan/scripts/project.sh");

const tmp = mkdtempSync(join(tmpdir(), "project-same-words-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const run = (args: readonly string[]) =>
  spawnSync("bash", [script, ...args], { cwd: tmp, env: process.env, encoding: "utf8" });

const printed = (result: ReturnType<typeof run>): string => {
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

const body = (anchor: string, entry: string): string => `## Goal

Rename foo.

## Design

${entry}

## Acceptance criteria

- ${anchor}

## Decisions

None.

## Out of scope

Nothing.
`;

const write = (name: string, text: string): string => {
  const path = join(tmp, name);
  writeFileSync(path, text);
  return path;
};

const field = (before: string, after: string) =>
  JSON.parse(printed(run(["--same-words", before, after])));

const before = write(
  "before.md",
  body("`foo` is renamed.", "- `src/app.ts` (changed): rename `foo` to `bar`"),
);
const noTicks = write(
  "no-ticks.md",
  body("foo is renamed.", "- `src/app.ts` (changed): rename foo to bar"),
);

test("bodies that differ in backticks and whitespace only are the same words", () => {
  assert.equal(field(before, noTicks).ok, true);
  const wrapped = write(
    "wrapped.md",
    body("`foo` is\n  renamed.", "- `src/app.ts` (changed): rename\n  `foo` to   `bar`"),
  );
  assert.equal(field(before, wrapped).ok, true);
});

test("a changed word is not the same words", () => {
  const word = write(
    "word.md",
    body("`foo` is renamed.", "- `src/app.ts` (changed): rename `foo` to `baz`"),
  );
  assert.equal(field(before, word).ok, false);
});

test("--same-words prints the lint of the second body", () => {
  const after = field(before, noTicks).lint;
  assert.ok(after.reasons.includes("criteria"), JSON.stringify(after));
  const first = field(noTicks, before).lint;
  assert.ok(!first.reasons.includes("criteria"), JSON.stringify(first));
});

test("--same-words refuses a parent and a missing file", () => {
  const parent = run(["1", "--same-words", before, before]);
  assert.notEqual(parent.status, 0);
  assert.ok(
    (parent.stdout + parent.stderr).includes("--same-words takes no parent"),
    parent.stderr,
  );
  const missing = run(["--same-words", join(tmp, "none.md"), before]);
  assert.notEqual(missing.status, 0);
  assert.ok((missing.stdout + missing.stderr).includes("no such file"), missing.stderr);
});
