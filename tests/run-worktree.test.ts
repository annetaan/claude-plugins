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
import { stampOf } from "../plugins/annetaan/scripts/pure/reports.ts";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/pj4-running/scripts/run.sh");

const tmp = mkdtempSync(join(tmpdir(), "run-worktree-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
const graph = join(tmp, "graph.json");
mkdirSync(home);
mkdirSync(bin);

const parent = {
  number: 1,
  url: "https://github.com/o/r/issues/1",
  title: "Project",
  state: "OPEN",
  stateReason: null,
  updatedAt: "2000-01-01T00:00:00Z",
  body: "Base: `pj/1` from `main`\n\n## Goal\n\nx\n",
  labels: { nodes: [{ name: "project" }] },
  blockedBy: { nodes: [] },
  blocking: { nodes: [] },
  subIssues: { totalCount: 0, nodes: [] },
};
writeFileSync(graph, `${JSON.stringify({ data: { repository: { issue: parent } } })}\n`);

writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
case "$1 $2" in
  "repo view")
    for arg in "$@"; do [ "$arg" = --jq ] && { echo o/r; exit 0; }; done
    echo '{"nameWithOwner":"o/r"}' ;;
  "pr list") echo '[]' ;;
  "api graphql")
    for arg in "$@"; do
      case "$arg" in
        query=*"updatedAt body"*) cat '${graph}'; exit 0 ;;
        query=*"ro: ref("*) echo '{"data":{"repository":{"ro":{"compare":{"status":"IDENTICAL"}},"mo":{"totalCount":0},"po":{"nodes":[]}}}}'; exit 0 ;;
      esac
    done
    echo "unexpected gh $*" >&2; exit 1 ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`,
  { mode: 0o755 },
);

const env = {
  ...process.env,
  PATH: `${bin}:${process.env["PATH"] ?? ""}`,
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

git(tmp, "config", "--global", "init.defaultBranch", "main");
git(tmp, "init", "-q", "--bare", "origin.git");
git(tmp, "clone", "-q", "origin.git", "seed");
const seed = join(tmp, "seed");
writeFileSync(join(seed, "a"), "one\n");
git(seed, "add", "a");
git(seed, "commit", "-q", "-m", "init");
git(seed, "push", "-q", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/pj/1");
git(tmp, "clone", "-q", "origin.git", "clone");
const clone = realpathSync(join(tmp, "clone"));
appendFileSync(
  join(clone, ".git/info/exclude"),
  "work-reports/\n.claude/worktrees/\n.env.local\nmise.local.toml\n.worktreeinclude\n",
);
writeFileSync(join(clone, ".env.local"), "secret\n");
writeFileSync(join(clone, "mise.local.toml"), "mise\n");
writeFileSync(join(clone, ".worktreeinclude"), "/.env.local\n");
const worktrees = join(clone, ".claude/worktrees");
const tip = git(clone, "rev-parse", "origin/pj/1").trim();

type Out = {
  readonly status: string;
  readonly reason?: string;
  readonly worktree?: string | null;
  readonly name?: string;
  readonly branch?: string;
  readonly start?: string;
  readonly commits?: number;
  readonly copied?: readonly string[];
  readonly notIgnored?: readonly string[];
  readonly unlisted?: readonly string[];
};

const worktree = (k: string, branch: string): Out => {
  const result = spawnSync("bash", [script, "worktree", "1", k, branch], {
    cwd: clone,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const headBranch = (cwd: string): string => git(cwd, "symbolic-ref", "--short", "HEAD").trim();

let first = "";

test("run.sh worktree makes pj-1-2-<stamp> on origin/pj/1 with the branch and the copied files", () => {
  const made = worktree("2", "feat/2-x");
  assert.equal(made.status, "ready", JSON.stringify(made));
  assert.match(made.name ?? "", /^pj-1-2-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}$/u);
  assert.equal(made.worktree, join(worktrees, made.name ?? ""));
  assert.deepEqual([made.branch, made.start], ["feat/2-x", tip]);
  assert.equal(headBranch(made.worktree ?? ""), "feat/2-x");
  assert.equal(git(made.worktree ?? "", "rev-parse", "HEAD").trim(), tip);
  assert.deepEqual(
    [made.copied, made.notIgnored, made.unlisted],
    [[".env.local"], [], ["mise.local.toml"]],
  );
  assert.equal(readFileSync(join(made.worktree ?? "", ".env.local"), "utf8"), "secret\n");
  first = made.worktree ?? "";
});

test("a second run.sh worktree for the same issue takes the next free name", () => {
  git(first, "switch", "--quiet", "--detach");
  git(clone, "branch", "-D", "feat/2-x");
  const now = Date.now();
  for (const at of [now, now + 60_000]) {
    const taken = join(worktrees, `pj-1-2-${stampOf(new Date(at))}`);
    if (!existsSync(taken)) {
      mkdirSync(taken);
    }
  }
  const again = worktree("2", "feat/2-x");
  assert.equal(again.status, "ready", JSON.stringify(again));
  assert.notEqual(again.worktree, first);
  assert.match(again.name ?? "", /^pj-1-2-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}-2$/u);
  assert.ok(existsSync(first), first);
  assert.equal(headBranch(again.worktree ?? ""), "feat/2-x");
});

test("run.sh worktree stops with left when the branch holds commits origin/pj/1 lacks", () => {
  const holder = git(clone, "worktree", "list", "--porcelain")
    .split("\n\n")
    .find((block) => block.includes("branch refs/heads/feat/2-x"))
    ?.split("\n")[0]
    ?.slice("worktree ".length);
  assert.ok(holder !== undefined);
  writeFileSync(join(holder, "b"), "work\n");
  git(holder, "add", "b");
  git(holder, "commit", "-q", "-m", "work");
  const left = worktree("2", "feat/2-x");
  assert.deepEqual(
    [left.status, left.reason, left.worktree, left.commits, left.branch],
    ["stop", "left", holder, 1, "feat/2-x"],
  );
});

test("run.sh worktree stops with checked-out when the branch is checked out in a worktree", () => {
  const made = worktree("3", "feat/3-x");
  assert.equal(made.status, "ready", JSON.stringify(made));
  const again = worktree("3", "feat/3-x");
  assert.deepEqual(
    [again.status, again.reason, again.worktree, again.branch],
    ["stop", "checked-out", made.worktree, "feat/3-x"],
  );
});

test("run.sh worktree deletes and makes again a branch with no commits of its own", () => {
  git(clone, "branch", "--quiet", "--track", "feat/4-x", "origin/pj/1");
  assert.equal(git(clone, "config", "branch.feat/4-x.merge").trim(), "refs/heads/pj/1");
  const made = worktree("4", "feat/4-x");
  assert.equal(made.status, "ready", JSON.stringify(made));
  assert.equal(headBranch(made.worktree ?? ""), "feat/4-x");
  assert.equal(git(clone, "rev-parse", "feat/4-x").trim(), tip);
  const tracking = spawnSync("git", ["config", "branch.feat/4-x.merge"], { cwd: clone, env });
  assert.equal(tracking.status, 1, "the branch made again tracks nothing");
});
