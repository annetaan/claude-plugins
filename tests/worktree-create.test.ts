import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/workflow/scripts/worktree.sh");

const tmp = mkdtempSync(join(tmpdir(), "worktree-create-"));
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

const gitResult = (cwd: string, ...args: readonly string[]) =>
  spawnSync("git", args, { cwd, env, encoding: "utf8" });

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = gitResult(cwd, ...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

const captured = (text: string): string => text.replace(/\n+$/, "");

const lines = (text: string): string[] => {
  const all = text.split("\n");
  return all.at(-1) === "" ? all.slice(0, -1) : all;
};

type Ran = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

type Created = {
  readonly status: string;
  readonly head: string;
  readonly name: string;
  readonly worktree: string;
  readonly ignored: readonly string[];
};

const origin = join(tmp, "origin.git");
const work = join(tmp, "work");
const other = join(tmp, "other");

git(tmp, "init", "-q", "--bare", "-b", "main", origin);
git(tmp, "init", "-q", "-b", "main", work);
const main = realpathSync(work);
writeFileSync(join(main, ".gitignore"), ".claude/worktrees/\n");
writeFileSync(join(main, "README.md"), "readme\n");
git(main, "add", ".gitignore", "README.md");
git(main, "commit", "-q", "-m", "init");
git(main, "remote", "add", "origin", origin);
git(main, "push", "-q", "origin", "main");
git(tmp, "clone", "-q", origin, other);
appendFileSync(join(other, "README.md"), "more\n");
git(other, "commit", "-q", "-am", "more");
git(other, "push", "-q", "origin", "main");
const tip = git(other, "rev-parse", "HEAD").trim();

const runAsync = () =>
  new Promise<Ran>((resolve, reject) => {
    const child = spawn("bash", [script, "create", "main"], { cwd: main, env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });

let created: readonly Created[] = [];

test("6 parallel creates against a moved origin all print ready on origin's tip", async () => {
  const runs = await Promise.all(Array.from({ length: 6 }, runAsync));
  created = runs.map((run, i) => {
    assert.equal(run.code, 0, `create ${i + 1} exited non-zero: ${run.stderr} ${run.stdout}`);
    const d = JSON.parse(run.stdout) as Created;
    assert.equal(d.status, "ready", `create ${i + 1} status: ${run.stdout}`);
    assert.equal(d.head, tip, `create ${i + 1} head is not origin's tip: ${run.stdout}`);
    return d;
  });
});

test("6 parallel creates add work-reports/ to the exclude file once", () => {
  assert.equal(created.length, 6);
  const exclude = lines(readFileSync(join(main, ".git/info/exclude"), "utf8"));
  assert.equal(exclude.filter((line) => line === "work-reports/").length, 1);
  assert.equal(exclude.filter((line) => line === ".claude/worktrees/").length, 1);
  const adders = created.filter((d) => d.ignored.includes("work-reports/"));
  assert.equal(adders.length, 1, JSON.stringify(created.map((d) => d.ignored)));
  assert.deepEqual(adders[0]?.ignored, [".claude/worktrees/", "work-reports/"]);
});

test("the names are distinct", () => {
  assert.equal(new Set(created.map((d) => d.name)).size, 6);
});

test("every worktree is listed, owns its git dir and is clean, and MAIN is clean", () => {
  assert.equal(created.length, 6);
  const listed = lines(git(main, "worktree", "list", "--porcelain"));
  for (const d of created) {
    assert.ok(listed.includes(`worktree ${d.worktree}`), `git worktree list misses ${d.worktree}`);
    const gitdir = captured(readFileSync(join(d.worktree, ".git"), "utf8")).slice(
      "gitdir: ".length,
    );
    assert.equal(basename(gitdir), d.name, `${d.name} has the git dir ${gitdir}`);
    assert.equal(
      git(d.worktree, "status", "--porcelain"),
      "",
      `status of ${d.worktree} is not empty`,
    );
  }
  assert.equal(git(main, "status", "--porcelain"), "", "status of MAIN is not empty");
});

test("create stops with still-not-ignored and removes the worktree it made", () => {
  const negatedOrigin = join(tmp, "negated.git");
  const negated = join(tmp, "negated");
  git(tmp, "init", "-q", "--bare", "-b", "main", negatedOrigin);
  git(tmp, "init", "-q", "-b", "main", negated);
  const negatedMain = realpathSync(negated);
  writeFileSync(join(negatedMain, ".gitignore"), "!work-reports/\n");
  git(negatedMain, "add", ".gitignore");
  git(negatedMain, "commit", "-q", "-m", "init");
  git(negatedMain, "remote", "add", "origin", negatedOrigin);
  git(negatedMain, "push", "-q", "origin", "main");
  const result = spawnSync("bash", [script, "create", "main"], {
    cwd: negatedMain,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const d = JSON.parse(result.stdout) as {
    readonly status: string;
    readonly reason: string;
    readonly notIgnored: readonly string[];
    readonly ignored: readonly string[];
    readonly base: string;
  };
  assert.equal(d.status, "stop", result.stdout);
  assert.equal(d.reason, "still-not-ignored");
  assert.deepEqual(d.notIgnored, ["work-reports/"]);
  assert.deepEqual(d.ignored, [".claude/worktrees/", "work-reports/"]);
  assert.equal(d.base, "main");
  assert.deepEqual(
    lines(git(negatedMain, "worktree", "list", "--porcelain")).filter((line) =>
      line.startsWith("worktree "),
    ),
    [`worktree ${negatedMain}`],
  );
  assert.deepEqual(readdirSync(join(negatedMain, ".claude/worktrees")), []);
});
