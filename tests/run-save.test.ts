import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/pj4-running/scripts/run.sh");

const tmp = mkdtempSync(join(tmpdir(), "run-save-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const check = join(tmp, "check");
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

const gitResult = (cwd: string, ...args: readonly string[]) =>
  spawnSync("git", args, { cwd, env, encoding: "utf8" });

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = gitResult(cwd, ...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

git(tmp, "config", "--global", "init.defaultBranch", "main");

const setup = () => {
  rmSync(join(tmp, "work"), { recursive: true, force: true });
  rmSync(check, { recursive: true, force: true });
  git(tmp, "init", "-q", join(tmp, "work"));
  const main = realpathSync(join(tmp, "work"));
  writeFileSync(join(main, "a"), "one\n");
  git(main, "add", "a");
  git(main, "commit", "-q", "-m", "init");
  appendFileSync(join(main, ".git/info/exclude"), "work-reports/\n.claude/worktrees/\n");
  git(main, "worktree", "add", "-q", "-b", "feat", ".claude/worktrees/pj-1", "HEAD");
  const wt = join(main, ".claude/worktrees/pj-1");
  const start = git(wt, "rev-parse", "HEAD").trim();
  mkdirSync(join(wt, "work-reports"));
  return { main, wt, start, diff: join(wt, "work-reports/stopped.diff") };
};

const dirty = (wt: string): void => {
  writeFileSync(join(wt, "a"), "two\n");
  git(wt, "commit", "-q", "-am", "second");
  appendFileSync(join(wt, "a"), "three\n");
  writeFileSync(join(wt, "b"), "new\n");
};

const save = (main: string, ...args: readonly string[]) =>
  spawnSync("bash", [script, "save", "1", ...args], { cwd: main, env, encoding: "utf8" });

const json = (result: ReturnType<typeof save>) => {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test("save holds the commits and the uncommitted work in one diff that applies onto START", () => {
  const { main, wt, start, diff } = setup();
  dirty(wt);
  const d = json(save(main, "--to", diff, "--since", start));
  assert.equal(d.status, "saved");
  assert.equal(d.commits, 1);
  assert.equal(d.head, start);
  assert.deepEqual(d.errors, []);
  git(main, "worktree", "add", "-q", "--detach", check, start);
  git(check, "apply", diff);
  assert.equal(readFileSync(join(check, "a"), "utf8"), "two\nthree\n");
  assert.equal(readFileSync(join(check, "b"), "utf8"), "new\n");
});

test("save leaves the worktree detached at START with the branch deleted", () => {
  const { main, wt, start, diff } = setup();
  dirty(wt);
  json(save(main, "--to", diff, "--since", start));
  assert.equal(git(wt, "rev-parse", "HEAD").trim(), start);
  assert.notEqual(gitResult(wt, "symbolic-ref", "-q", "HEAD").status, 0);
  assert.notEqual(gitResult(wt, "rev-parse", "--verify", "--quiet", "refs/heads/feat").status, 0);
  assert.equal(git(wt, "status", "--porcelain"), "");
  git(wt, "switch", "-q", "--no-track", "-c", "next", start);
});

test("save with nothing to save prints clean and deletes the branch", () => {
  const { main, wt, start, diff } = setup();
  const d = json(save(main, "--to", diff, "--since", start));
  assert.equal(d.status, "clean");
  assert.equal(d.commits, 0);
  assert.equal(d.branch, "feat");
  assert.notEqual(gitResult(wt, "rev-parse", "--verify", "--quiet", "refs/heads/feat").status, 0);
  assert.ok(!existsSync(diff));
});

test("save without --since is a usage error", () => {
  const { main, wt, diff } = setup();
  const result = save(main, "--to", diff);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^usage:/m);
  git(wt, "rev-parse", "--verify", "--quiet", "refs/heads/feat");
});
