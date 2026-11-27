import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { exclusions } from "../plugins/annetaan/scripts/pure/exclude.ts";
import { ensureIgnored } from "../plugins/annetaan/scripts/clone.ts";

const PATHS = [".claude/worktrees/", "work-reports/"] as const;

test("exclusions adds each missing path once", () => {
  assert.deepEqual(
    exclusions("# git ls-files\n.claude/worktrees/\n", [...PATHS, "work-reports/"]),
    {
      append: "work-reports/\n",
      added: ["work-reports/"],
    },
  );
  assert.deepEqual(exclusions("", PATHS), {
    append: ".claude/worktrees/\nwork-reports/\n",
    added: [".claude/worktrees/", "work-reports/"],
  });
  assert.deepEqual(exclusions("work-reports/x\n/work-reports/\n", ["work-reports/"]), {
    append: "work-reports/\n",
    added: ["work-reports/"],
  });
});

test("exclusions adds a newline to a file that does not end in one", () => {
  assert.deepEqual(exclusions("*.log", PATHS), {
    append: "\n.claude/worktrees/\nwork-reports/\n",
    added: [".claude/worktrees/", "work-reports/"],
  });
  assert.deepEqual(exclusions("*.log\r\n.claude/worktrees/", PATHS), {
    append: "\nwork-reports/\n",
    added: ["work-reports/"],
  });
});

test("exclusions adds nothing when every path has its line", () => {
  assert.deepEqual(exclusions("work-reports/\n*.log\n.claude/worktrees/", PATHS), {
    append: "",
    added: [],
  });
});

const tmp = mkdtempSync(join(tmpdir(), "exclude-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
mkdirSync(home);
process.env["HOME"] = home;
process.env["GIT_CONFIG_NOSYSTEM"] = "1";
process.env["XDG_CONFIG_HOME"] = join(home, ".config");
const env = {
  ...process.env,
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

const repository = (name: string, gitignore: string | null): string => {
  const dir = join(tmp, name);
  git(tmp, "init", "-q", "-b", "main", dir);
  const main = realpathSync(dir);
  writeFileSync(join(main, "README.md"), "readme\n");
  git(main, "add", "README.md");
  if (gitignore !== null) {
    writeFileSync(join(main, ".gitignore"), gitignore);
    git(main, "add", ".gitignore");
  }
  git(main, "commit", "-q", "-m", "init");
  return main;
};

const excludeOf = (main: string): string => readFileSync(join(main, ".git/info/exclude"), "utf8");

const count = (text: string, line: string): number =>
  text.split("\n").filter((each) => each === line).length;

const ignoredIn = (where: string, path: string): boolean =>
  gitResult(where, "check-ignore", "-q", path).status === 0;

test("ensureIgnored appends the two paths to the exclude file the clone shares", () => {
  const main = repository("shared", null);
  const wt = join(main, ".claude/worktrees/wt");
  git(main, "worktree", "add", "-q", "--detach", wt, "HEAD");
  assert.deepEqual(ensureIgnored(main, wt), {
    status: "ok",
    ignored: [".claude/worktrees/", "work-reports/"],
  });
  const text = excludeOf(main);
  assert.equal(count(text, ".claude/worktrees/"), 1);
  assert.equal(count(text, "work-reports/"), 1);
  assert.equal(
    git(wt, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude").trim(),
    join(main, ".git/info/exclude"),
  );
  assert.ok(ignoredIn(wt, "work-reports/"));
  assert.equal(git(main, "status", "--porcelain"), "");
});

test("ensureIgnored appends work-reports/ when only the main working tree's .gitignore ignores it", () => {
  const main = repository("main-only", null);
  const wt = join(tmp, "main-only-wt");
  git(main, "worktree", "add", "-q", "--detach", wt, "HEAD");
  writeFileSync(join(main, ".gitignore"), "work-reports/\n.claude/worktrees/\n");
  assert.ok(ignoredIn(main, "work-reports/"));
  assert.ok(!ignoredIn(wt, "work-reports/"));
  const result = ensureIgnored(main, wt);
  assert.equal(result.status, "ok");
  assert.ok(result.ignored.includes("work-reports/"), JSON.stringify(result));
  assert.ok(ignoredIn(wt, "work-reports/"));
});

test("ensureIgnored stops with still-not-ignored when the worktree's .gitignore negates work-reports/", () => {
  const main = repository("negated", null);
  git(main, "checkout", "-q", "-b", "negating");
  writeFileSync(join(main, ".gitignore"), "!work-reports/\n");
  git(main, "add", ".gitignore");
  git(main, "commit", "-q", "-m", "negate");
  git(main, "checkout", "-q", "main");
  const wt = join(tmp, "negated-wt");
  git(main, "worktree", "add", "-q", "--detach", wt, "negating");
  assert.deepEqual(ensureIgnored(main, wt), {
    status: "stop",
    reason: "still-not-ignored",
    message: "a .gitignore rule overrides info/exclude for work-reports/",
    notIgnored: ["work-reports/"],
    ignored: [".claude/worktrees/", "work-reports/"],
  });
  assert.deepEqual(ensureIgnored(main, null), { status: "ok", ignored: [] });
});

test("ensureIgnored appends nothing on a second call", () => {
  const main = repository("twice", null);
  assert.deepEqual(ensureIgnored(main, null), {
    status: "ok",
    ignored: [".claude/worktrees/", "work-reports/"],
  });
  const before = excludeOf(main);
  assert.deepEqual(ensureIgnored(main, null), { status: "ok", ignored: [] });
  assert.equal(excludeOf(main), before);
});
