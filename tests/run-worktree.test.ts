import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
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
  "api user") echo '{"login":"me"}' ;;
  "api repos/o/r/issues/1") echo '{"assignees":[{"login":"me"}]}' ;;
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
const wt = join(clone, ".claude/worktrees/pj-1");

type Ready = {
  readonly status: string;
  readonly action: string;
  readonly copied: readonly string[];
  readonly notIgnored: readonly string[];
  readonly unlisted: readonly string[];
};

const worktree = (): Ready => {
  const result = spawnSync("bash", [script, "worktree", "1"], {
    cwd: clone,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

test("run.sh worktree ready carries copied and unlisted, on created and on moved", () => {
  const created = worktree();
  assert.deepEqual([created.status, created.action], ["ready", "created"]);
  assert.deepEqual(
    [created.copied, created.notIgnored, created.unlisted],
    [[".env.local"], [], ["mise.local.toml"]],
  );
  assert.equal(readFileSync(join(wt, ".env.local"), "utf8"), "secret\n");

  appendFileSync(join(clone, ".worktreeinclude"), "/mise.local.toml\n");
  const moved = worktree();
  assert.deepEqual([moved.status, moved.action], ["ready", "moved"]);
  assert.deepEqual([moved.copied, moved.notIgnored, moved.unlisted], [["mise.local.toml"], [], []]);
  assert.equal(readFileSync(join(wt, "mise.local.toml"), "utf8"), "mise\n");
});

test("a discard keeps the copied files", () => {
  writeFileSync(join(wt, "a"), "changed\n");
  const discarded = worktree();
  assert.deepEqual([discarded.status, discarded.action], ["ready", "discarded"]);
  assert.equal(readFileSync(join(wt, "a"), "utf8"), "one\n");
  assert.equal(readFileSync(join(wt, ".env.local"), "utf8"), "secret\n");
  assert.equal(readFileSync(join(wt, "mise.local.toml"), "utf8"), "mise\n");
  assert.deepEqual([discarded.copied, discarded.unlisted], [[], []]);
});
