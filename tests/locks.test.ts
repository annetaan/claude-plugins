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
import { dirname, join } from "node:path";
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";

const scripts = join(import.meta.dirname, "../plugins/annetaan/skills/workflow/scripts");
const worktreeSh = join(scripts, "worktree.sh");
const flowSh = join(scripts, "flow.sh");

const tmp = mkdtempSync(join(tmpdir(), "locks-"));
const sleeper = spawn("sleep", ["600"], { stdio: "ignore" });
after(() => {
  sleeper.kill();
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

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const printed = (result: SpawnSyncReturns<string>): string => {
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return result.stdout;
};

const json = (script: string, cwd: string, ...args: readonly string[]) =>
  JSON.parse(printed(spawnSync("bash", [script, ...args], { cwd, env, encoding: "utf8" })));

const deadPid = (): number => {
  const ended = spawnSync("true");
  assert.equal(ended.status, 0);
  return ended.pid ?? 0;
};

const lockDir = (path: string, pid: number): void => {
  write(join(path, "pid"), `${pid}\n`);
};

const origin = join(tmp, "origin.git");
git(tmp, "init", "-q", "--bare", "-b", "main", origin);
git(tmp, "init", "-q", "-b", "main", join(tmp, "work"));
const main = realpathSync(join(tmp, "work"));
writeFileSync(join(main, ".gitignore"), ".claude/worktrees/\nwork-reports/\n");
git(main, "add", ".gitignore");
git(main, "commit", "-q", "-m", "init");
git(main, "remote", "add", "origin", origin);
git(main, "push", "-q", "origin", "main");
const common = join(main, ".git");

test("a clone lock directory holding a dead pid does not stop worktree.sh create", () => {
  lockDir(join(common, "annetaan-clone.lockdir"), deadPid());
  assert.equal(json(worktreeSh, main, "create", "main", "--kind", "run").status, "ready");
  assert.ok(!existsSync(join(common, "annetaan-clone.lockdir")), "the clone lock was left behind");
});

test("a left-over regular file annetaan-clone.lock does not stop worktree.sh create", () => {
  writeFileSync(join(common, "annetaan-clone.lock"), "");
  assert.equal(json(worktreeSh, main, "create", "main", "--kind", "run").status, "ready");
  assert.equal(readFileSync(join(common, "annetaan-clone.lock"), "utf8"), "");
});

const wt = join(main, ".claude/worktrees/run-test");
git(main, "worktree", "add", "-q", "--detach", wt, "HEAD");
const probe = join(wt, "work-reports/2026-01-01-0000-aaaaaaa/seats/a/ok");
write(join(probe, "run.sh"), "true\n");
const seatLock = (seat: string): string => join(common, `panel-run-test-${seat}.lockdir`);

test("a seat lock directory holding a dead pid does not stop flow.sh run", () => {
  lockDir(seatLock("a"), deadPid());
  assert.equal(json(flowSh, main, "run", wt, "a", probe).status, "ran");
  assert.ok(!existsSync(seatLock("a")), "the seat lock was left behind");
});

test("a seat lock directory holding a live pid gives busy", () => {
  lockDir(seatLock("a"), sleeper.pid ?? 0);
  const out = json(flowSh, main, "run", wt, "a", probe);
  assert.equal(out.status, "stop");
  assert.equal(out.reason, "busy");
  assert.equal(out.message, "seat a is held by another run");
  assert.ok(existsSync(seatLock("a")), "busy removed a lock a live run holds");
});

test("flow.sh close removes the seat lock directories with the seats", () => {
  assert.equal(json(flowSh, main, "run", wt, "b", probe).status, "ran");
  lockDir(seatLock("b"), sleeper.pid ?? 0);
  appendFileSync(join(common, "panel-run-test-a.lock"), "");
  const out = json(flowSh, main, "close", wt);
  assert.equal(out.status, "closed");
  assert.deepEqual(out.removed, [
    join(main, ".claude/worktrees/review-run-test-a"),
    join(main, ".claude/worktrees/review-run-test-b"),
  ]);
  assert.ok(!existsSync(seatLock("a")), "close left the lock of seat a");
  assert.ok(!existsSync(seatLock("b")), "close left the lock of seat b");
  assert.ok(existsSync(join(common, "panel-run-test-a.lock")), "close removed an old lock file");
});
