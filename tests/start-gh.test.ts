import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const scripts = join(import.meta.dirname, "../plugins/annetaan/skills");
const worktreeSh = join(scripts, "workflow/scripts/worktree.sh");
const runSh = join(scripts, "pj4-running/scripts/run.sh");

const tmp = mkdtempSync(join(tmpdir(), "start-gh-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
mkdirSync(home);
mkdirSync(bin);

writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
if [ "$1" = --version ]; then
  case "$FAKE_GH" in
    missing) exit 127 ;;
    none) echo something ;;
    *) echo "gh version $FAKE_GH (2026-01-01)" ;;
  esac
  exit 0
fi
echo "not logged in" >&2
exit 1
`,
  { mode: 0o755 },
);

const env = {
  ...process.env,
  PATH: `${bin}:${process.env["PATH"] ?? ""}`,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
};

const git = (cwd: string, ...args: readonly string[]): void => {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};

git(tmp, "init", "-q", "--bare", "origin.git");
git(tmp, "clone", "-q", "origin.git", "clone");
const clone = realpathSync(join(tmp, "clone"));

const startLine = (script: string, args: readonly string[], fake: string): unknown => {
  const result = spawnSync("bash", [script, ...args], {
    cwd: clone,
    env: { ...env, FAKE_GH: fake },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const starts = [
  { name: "worktree.sh start", script: worktreeSh, args: ["start"], base: { main: clone } },
  {
    name: "run.sh start",
    script: runSh,
    args: ["start", "1"],
    base: { main: clone, worktree: join(clone, ".claude/worktrees/pj-1") },
  },
] as const;

for (const { name, script, args, base } of starts) {
  test(`${name} stops with gh under gh 2.98.0`, () => {
    assert.deepEqual(startLine(script, args, "2.98.0"), {
      status: "stop",
      reason: "gh",
      message: "gh 2.99.0 or later is required, found 2.98.0",
      ...base,
    });
  });

  test(`${name} stops with gh on an unreadable version`, () => {
    assert.deepEqual(startLine(script, args, "none"), {
      status: "stop",
      reason: "gh",
      message: "gh 2.99.0 or later is required, found an unknown version",
      ...base,
    });
  });

  test(`${name} stops with gh when gh is not installed`, () => {
    assert.deepEqual(startLine(script, args, "missing"), {
      status: "stop",
      reason: "gh",
      message: "gh is not installed",
      ...base,
    });
  });

  test(`${name} gets past the version check under gh 2.99.0 and prints no other key`, () => {
    assert.deepEqual(startLine(script, args, "2.99.0"), {
      status: "stop",
      reason: "gh-auth",
      message: "gh is not logged in: not logged in",
      ...base,
      gh: "2.99.0",
    });
  });
}
