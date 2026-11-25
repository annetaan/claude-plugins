import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/pj1-plan/scripts/project.sh");

const tmp = mkdtempSync(join(tmpdir(), "project-parent-body-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const bin = join(tmp, "bin");
const log = join(tmp, "gh.log");
const issues = join(tmp, "issues.json");
mkdirSync(bin);
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
echo "$1 $2" >> '${log}'
if [ "$1 $2" = "pr list" ]; then
  echo '[]'
  exit 0
fi
if [ "$1 $2" = "api graphql" ]; then
  for arg in "$@"; do
    case "$arg" in
      query=*"updatedAt body"*) cat '${issues}'; exit 0 ;;
    esac
  done
fi
echo "fake gh: unexpected call" >&2
exit 1
`,
  { mode: 0o755 },
);
const env = { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` };

const run = (args: readonly string[]) =>
  spawnSync("bash", [script, ...args], { cwd: tmp, env, encoding: "utf8" });

const setParent = (text: string): void => {
  const parent = {
    number: 1,
    title: "Project",
    state: "OPEN",
    stateReason: null,
    updatedAt: "2000-01-01T00:00:00Z",
    body: text,
    labels: { nodes: [] },
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    subIssues: { totalCount: 0, nodes: [] },
  };
  writeFileSync(issues, `${JSON.stringify({ data: { repository: { issue: parent } } })}\n`);
};

const write = (name: string, text: string): string => {
  const path = join(tmp, name);
  writeFileSync(path, text);
  return path;
};

const splice = (file: string) => run(["-R", "test/repo", "1", "--parent-body", file]);

const printed = (result: ReturnType<typeof run>): string => {
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

const newBody = write("new.md", "\n\n## Goal\n\nnew goal\n\n## Design\n\nnew design\n\n\n");

const assertRefused = (result: ReturnType<typeof run>, want: string): void => {
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes(want), result.stderr);
};

test("the lines above ## Goal stay, CR removed, and the file follows", () => {
  setParent(
    "Base: `pj/1` from `main`\r\n\r\n## Order\r\n\r\n1. #2\r\n\r\n## Goal\r\n\r\nold goal\r\n\r\n## Design\r\n\r\nold design\r\n",
  );
  assert.equal(
    printed(splice(newBody)),
    "Base: `pj/1` from `main`\n\n## Order\n\n1. #2\n\n## Goal\n\nnew goal\n\n## Design\n\nnew design\n",
  );
});

test("a ## Goal inside a code fence is not the splice point", () => {
  setParent("Base: `pj/1` from `main`\n\n```\n## Goal\n```\n\n## Goal\n\nold goal\n");
  assert.equal(
    printed(splice(newBody)),
    "Base: `pj/1` from `main`\n\n```\n## Goal\n```\n\n## Goal\n\nnew goal\n\n## Design\n\nnew design\n",
  );
});

test("a body with no ## Goal is refused", () => {
  setParent("Base: `pj/1` from `main`\n\n```\n## Goal\n```\n\n## Design\n\nx\n");
  assertRefused(splice(newBody), "the parent body has no ## Goal heading");
});

test("a file that does not start at ## Goal is refused", () => {
  setParent("Base: `pj/1` from `main`\n\n## Goal\n\nold goal\n");
  const headless = write("headless.md", "\nnew goal\n\n## Goal\n\nx\n");
  assertRefused(splice(headless), "does not start at ## Goal");
});

test("a missing file is refused before gh is called", () => {
  writeFileSync(log, "");
  assertRefused(splice(join(tmp, "missing.md")), "no such file");
  assert.equal(readFileSync(log, "utf8"), "");
});

test("--order-body leaves a fenced ## Order alone", () => {
  setParent(
    "Base: `pj/1` from `main`\n\n```\n## Order\n\n9. #9\n```\n\n## Order\n\n1. #5\n\n## Goal\n\nx\n",
  );
  assert.equal(
    printed(run(["-R", "test/repo", "1", "--order-body"])),
    "Base: `pj/1` from `main`\n\n```\n## Order\n\n9. #9\n```\n\n## Order\n\n## Goal\n\nx\n",
  );
});
