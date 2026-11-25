import { test, after } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repository = join(import.meta.dirname, "..");
const MANIFEST = "plugins/annetaan/.claude-plugin/plugin.json";
const USAGE = "FAIL: usage: bash tests/plugin-version.sh [--bump]\n";

const tmp = mkdtempSync(join(tmpdir(), "plugin-version-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
mkdirSync(home);
const env = {
  ...process.env,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

type Ran = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

const check = (cwd: string, ...args: readonly string[]): Ran => {
  const result = spawnSync("bash", ["tests/plugin-version.sh", ...args], {
    cwd,
    env,
    encoding: "utf8",
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

const manifest = (version: string): string =>
  `${JSON.stringify({ name: "annetaan", version, license: "MIT" }, null, 2)}\n`;

const fixture = (name: string, version: string): string => {
  const work = join(tmp, name);
  mkdirSync(join(work, "tests"), { recursive: true });
  mkdirSync(join(work, "plugins/annetaan/scripts"), { recursive: true });
  mkdirSync(join(work, "plugins/annetaan/.claude-plugin"), { recursive: true });
  for (const path of [
    "tests/plugin-version.sh",
    "tests/plugin-version.ts",
    "plugins/annetaan/scripts/ts.sh",
    "package.json",
  ]) {
    copyFileSync(join(repository, path), join(work, path));
  }
  writeFileSync(join(work, MANIFEST), manifest(version));
  git(work, "init", "-q", "-b", "main");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "init");
  const origin = join(tmp, `${name}-origin.git`);
  git(work, "clone", "-q", "--bare", ".", origin);
  git(work, "remote", "add", "origin", origin);
  git(work, "fetch", "-q", "origin");
  git(work, "remote", "set-head", "origin", "-a");
  git(work, "checkout", "-q", "-b", "feat");
  return work;
};

const change = (work: string): void => {
  writeFileSync(join(work, "plugins/annetaan/x.md"), "x\n");
};

test("passes when nothing under the plugin differs", () => {
  const work = fixture("clean", "0.9.0");
  assert.deepEqual(check(work), {
    code: 0,
    stdout: "ok: nothing under plugins/annetaan differs from origin/main\n",
    stderr: "",
  });
});

test("compares versions by number, so 0.10.0 is above 0.9.0", () => {
  const work = fixture("by-number", "0.9.0");
  change(work);
  const before = readFileSync(join(work, MANIFEST), "utf8");
  assert.deepEqual(check(work), {
    code: 1,
    stdout: "",
    stderr: `FAIL: ${MANIFEST} is 0.9.0, not above 0.9.0; run bash tests/plugin-version.sh --bump\n`,
  });
  assert.deepEqual(check(work, "--bump"), {
    code: 0,
    stdout: `bumped: ${MANIFEST} is 0.10.0\n`,
    stderr: "",
  });
  assert.equal(readFileSync(join(work, MANIFEST), "utf8"), before.replace('"0.9.0"', '"0.10.0"'));
  assert.deepEqual(check(work), {
    code: 0,
    stdout: `ok: ${MANIFEST} is 0.10.0, above 0.9.0\n`,
    stderr: "",
  });
});

test("takes the higher of the merge base and the default branch as the floor", () => {
  const work = fixture("floor", "0.9.0");
  writeFileSync(join(work, MANIFEST), manifest("0.10.0"));
  git(work, "commit", "-q", "-am", "feat at 0.10.0");
  git(work, "checkout", "-q", "main");
  writeFileSync(join(work, MANIFEST), manifest("0.11.0"));
  git(work, "commit", "-q", "-am", "main at 0.11.0");
  git(work, "push", "-q", "origin", "main");
  git(work, "fetch", "-q", "origin");
  git(work, "checkout", "-q", "feat");
  change(work);
  assert.deepEqual(check(work), {
    code: 1,
    stdout: "",
    stderr: `FAIL: ${MANIFEST} is 0.10.0, not above 0.11.0; run bash tests/plugin-version.sh --bump\n`,
  });
  assert.deepEqual(check(work, "--bump"), {
    code: 0,
    stdout: `bumped: ${MANIFEST} is 0.12.0\n`,
    stderr: "",
  });
  assert.equal(readFileSync(join(work, MANIFEST), "utf8"), manifest("0.12.0"));
});

test("rejects any argument but --bump", () => {
  const work = fixture("usage", "0.9.0");
  assert.deepEqual(check(work, "--x"), { code: 1, stdout: "", stderr: USAGE });
  assert.deepEqual(check(work, "--bump", "--bump"), { code: 1, stdout: "", stderr: USAGE });
});

test("fails when the working tree has no manifest", () => {
  const work = fixture("missing", "0.9.0");
  git(work, "rm", "-q", MANIFEST);
  assert.deepEqual(check(work), {
    code: 1,
    stdout: "",
    stderr: `FAIL: ${MANIFEST} in the working tree has no usable version\n`,
  });
});

test("fails when the working tree's version is not three integers", () => {
  const work = fixture("malformed", "0.9.0");
  change(work);
  writeFileSync(join(work, MANIFEST), manifest("x"));
  assert.deepEqual(check(work), {
    code: 1,
    stdout: "",
    stderr: `FAIL: ${MANIFEST} in the working tree has no usable version\n`,
  });
});
