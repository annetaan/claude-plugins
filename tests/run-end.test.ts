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

const tmp = mkdtempSync(join(tmpdir(), "run-end-"));
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

const gitResult = (cwd: string, ...args: readonly string[]) =>
  spawnSync("git", args, { cwd, env, encoding: "utf8" });

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = gitResult(cwd, ...args);
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
writeFileSync(join(seed, "a"), "other\n");
git(seed, "commit", "-q", "-am", "other");
git(seed, "push", "-q", "origin", "HEAD:refs/heads/other");
git(tmp, "clone", "-q", "origin.git", "clone");
const clone = realpathSync(join(tmp, "clone"));
appendFileSync(join(clone, ".git/info/exclude"), "work-reports/\n.claude/worktrees/\n");

type Made = { readonly worktree: string; readonly name: string; readonly start: string };

const made = (k: string, branch: string): Made => {
  const result = spawnSync("bash", [script, "worktree", "1", k, branch], {
    cwd: clone,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const out = JSON.parse(result.stdout);
  assert.equal(out.status, "ready", result.stdout);
  return out;
};

type Ended = {
  readonly status: string;
  readonly name: string;
  readonly worktree?: string;
  readonly moved: readonly string[];
  readonly head?: string;
  readonly commits?: number;
  readonly changes?: readonly string[];
  readonly errors: readonly unknown[];
};

const endRun = (p: string, name: string, since: string) =>
  spawnSync("bash", [script, "end", p, name, "--since", since], {
    cwd: clone,
    env,
    encoding: "utf8",
  });

const end = (name: string, since: string): Ended => {
  const result = endRun("1", name, since);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const report = (wt: string, name: string): void => {
  mkdirSync(join(wt, "work-reports", name), { recursive: true });
  writeFileSync(join(wt, "work-reports", name, "log.md"), `${name}\n`);
};

const branchListed = (branch: string): boolean =>
  git(clone, "branch", "--list", branch).trim() !== "";

const detached = (wt: string): boolean => gitResult(wt, "symbolic-ref", "-q", "HEAD").status === 1;

test("end removes a worktree with nothing since --since, with its seats and its branch, and moves the reports", () => {
  const { worktree, name, start } = made("2", "feat/2-x");
  report(worktree, "2026-01-01-0000-aaaaaaa");
  const seat = join(clone, ".claude/worktrees", `review-${name}-a`);
  git(clone, "worktree", "add", "-q", "--detach", seat, "origin/pj/1");
  const out = end(name, start);
  assert.deepEqual([out.status, out.name, out.errors], ["removed", name, []]);
  assert.deepEqual(out.moved, [join(clone, "work-reports/2026-01-01-0000-aaaaaaa")]);
  assert.equal(
    readFileSync(join(clone, "work-reports/2026-01-01-0000-aaaaaaa/log.md"), "utf8"),
    "2026-01-01-0000-aaaaaaa\n",
  );
  assert.ok(!existsSync(worktree), worktree);
  assert.ok(!existsSync(seat), seat);
  assert.ok(!branchListed("feat/2-x"));
});

test("end keeps a worktree with a commit, detaches its HEAD and deletes the branch", () => {
  const { worktree, name, start } = made("3", "feat/3-x");
  report(worktree, "2026-01-01-0000-bbbbbbb");
  writeFileSync(join(worktree, "b"), "work\n");
  git(worktree, "add", "b");
  git(worktree, "commit", "-q", "-m", "work");
  const head = git(worktree, "rev-parse", "HEAD").trim();
  const out = end(name, start);
  assert.deepEqual(
    [out.status, out.name, out.worktree, out.head, out.commits, out.changes, out.errors],
    ["kept", name, worktree, head, 1, [], []],
  );
  assert.deepEqual(out.moved, [join(clone, "work-reports/2026-01-01-0000-bbbbbbb")]);
  assert.ok(existsSync(join(worktree, "b")));
  assert.ok(detached(worktree), "HEAD is detached");
  assert.equal(git(worktree, "rev-parse", "HEAD").trim(), head);
  assert.ok(!branchListed("feat/3-x"));
});

test("end keeps a worktree with a merge in progress and frees the branch", () => {
  const { worktree, name, start } = made("4", "feat/4-x");
  writeFileSync(join(worktree, "a"), "mine\n");
  git(worktree, "commit", "-q", "-am", "mine");
  assert.equal(gitResult(worktree, "merge", "origin/other").status, 1);
  const out = end(name, start);
  assert.deepEqual([out.status, out.commits, out.errors], ["kept", 1, []]);
  assert.deepEqual(out.changes, ["UU a"]);
  assert.ok(detached(worktree), "HEAD is detached");
  assert.equal(gitResult(worktree, "rev-parse", "-q", "--verify", "MERGE_HEAD").status, 0);
  assert.ok(!branchListed("feat/4-x"));
});

test("end refuses a worktree of another project", () => {
  const { worktree, name, start } = made("5", "feat/5-x");
  const result = endRun("2", name, start);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /no worktree name of project #2/u);
  assert.ok(existsSync(worktree));
  assert.ok(branchListed("feat/5-x"));
});

test("end refuses a --since that is no ancestor of HEAD", () => {
  const { worktree, name } = made("6", "feat/6-x");
  const other = git(clone, "rev-parse", "origin/other").trim();
  const result = endRun("1", name, other);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /no ancestor of HEAD/u);
  assert.ok(existsSync(worktree));
  assert.ok(branchListed("feat/6-x"));
});
