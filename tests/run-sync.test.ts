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

const tmp = mkdtempSync(join(tmpdir(), "run-sync-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
const graph = join(tmp, "graph.json");
mkdirSync(home);
mkdirSync(bin);

const sub = {
  number: 2,
  url: "https://github.com/o/r/issues/2",
  title: "Task",
  state: "CLOSED",
  stateReason: "COMPLETED",
  updatedAt: "2000-01-01T00:00:00Z",
  body: "## Goal\n\nx\n\n## Design\n\nTo be drawn.\n",
  labels: { nodes: [{ name: "ready" }] },
  blockedBy: { nodes: [] },
  blocking: { nodes: [] },
};
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
  subIssues: { totalCount: 1, nodes: [sub] },
};
writeFileSync(graph, `${JSON.stringify({ data: { repository: { issue: parent } } })}\n`);

writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
case "$1 $2" in
  "repo view")
    for arg in "$@"; do [ "$arg" = --jq ] && { echo o/r; exit 0; }; done
    echo '{"nameWithOwner":"o/r"}' ;;
  "pr list") echo '[{"number":3,"state":"MERGED","isDraft":false,"url":"https://github.com/o/r/pull/3","body":"Implements #2"}]' ;;
  "api graphql")
    for arg in "$@"; do
      case "$arg" in
        query=*"updatedAt body"*) cat '${graph}'; exit 0 ;;
        query=*"ro: ref("*) echo '{"data":{"repository":{"ro":{"compare":{"status":"BEHIND"}},"mo":{"totalCount":0},"po":{"nodes":[]}}}}'; exit 0 ;;
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

const clone = join(tmp, "clone");
const origin = join(tmp, "origin.git");

const commit = (seed: string, file: string, text: string, ...refs: readonly string[]): void => {
  writeFileSync(join(seed, file), text);
  git(seed, "add", file);
  git(seed, "commit", "-q", "-m", `${file} ${text.trim()}`);
  git(seed, "push", "-q", "origin", ...refs.map((ref) => `HEAD:refs/heads/${ref}`));
};

const setup = (main: "same" | "ahead" | "conflict"): string => {
  for (const dir of ["origin.git", "seed", "clone"]) {
    rmSync(join(tmp, dir), { recursive: true, force: true });
  }
  git(tmp, "init", "-q", "--bare", "origin.git");
  git(tmp, "clone", "-q", "origin.git", "seed");
  const seed = join(tmp, "seed");
  commit(seed, "a", "one\n", "main", "pj/1");
  if (main === "ahead") {
    commit(seed, "b", "main\n", "main");
  }
  if (main === "conflict") {
    commit(seed, "a", "main\n", "main");
    git(seed, "reset", "-q", "--hard", "HEAD~1");
    commit(seed, "a", "base\n", "pj/1");
  }
  git(tmp, "clone", "-q", "origin.git", "clone");
  appendFileSync(join(clone, ".git/info/exclude"), "work-reports/\n.claude/worktrees/\n");
  return git(clone, "rev-parse", "origin/pj/1").trim();
};

type Synced = {
  readonly status: string;
  readonly reason?: string;
  readonly sha?: string;
  readonly start?: string;
  readonly files?: readonly string[];
  readonly worktree?: string;
  readonly name?: string;
  readonly copied?: readonly string[];
  readonly base?: string;
  readonly from?: string;
};

const sync = (...args: readonly string[]): Synced => {
  const result = spawnSync("bash", [script, "sync", "1", ...args], {
    cwd: realpathSync(clone),
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const SYNC_NAME = /^pj-1-sync-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}$/u;

const originTip = (): string => git(origin, "rev-parse", "refs/heads/pj/1").trim();

test("sync current makes a sync worktree and merges nothing", () => {
  const tip = setup("same");
  const out = sync();
  assert.deepEqual(
    [out.status, out.sha, out.base, out.from, out.copied],
    ["current", tip, "pj/1", "main", []],
  );
  assert.match(out.name ?? "", SYNC_NAME);
  assert.equal(out.worktree, join(realpathSync(clone), ".claude/worktrees", out.name ?? ""));
  assert.equal(git(out.worktree ?? "", "rev-parse", "HEAD").trim(), tip);
  assert.equal(originTip(), tip);
});

test("sync merged pushes the merge made in the sync worktree", () => {
  const tip = setup("ahead");
  const out = sync();
  assert.equal(out.status, "merged", JSON.stringify(out));
  assert.match(out.name ?? "", SYNC_NAME);
  assert.ok(existsSync(out.worktree ?? ""));
  assert.equal(git(out.worktree ?? "", "rev-parse", "HEAD").trim(), out.sha);
  assert.equal(originTip(), out.sha);
  const parents = git(out.worktree ?? "", "rev-list", "--parents", "-n", "1", "HEAD").trim();
  assert.equal(parents.split(" ")[1], tip);
  assert.equal(git(out.worktree ?? "", "log", "-1", "--format=%s").trim(), "Merge main into pj/1");

  const ended = spawnSync("bash", [script, "end", "1", out.name ?? "", "--since", out.sha ?? ""], {
    cwd: realpathSync(clone),
    env,
    encoding: "utf8",
  });
  assert.equal(ended.status, 0, ended.stderr);
  assert.deepEqual(JSON.parse(ended.stdout), {
    status: "removed",
    name: out.name,
    moved: [],
    errors: [],
  });
  assert.ok(!existsSync(out.worktree ?? ""));
});

test("sync conflict leaves the merge in progress in the sync worktree", () => {
  const tip = setup("conflict");
  const out = sync();
  assert.deepEqual([out.status, out.start, out.files], ["conflict", tip, ["a"]]);
  assert.match(out.name ?? "", SYNC_NAME);
  assert.equal(
    gitResult(out.worktree ?? "", "rev-parse", "-q", "--verify", "MERGE_HEAD").status,
    0,
  );
  assert.equal(originTip(), tip);
});

test("sync --push pushes the merge committed in the named worktree", () => {
  const tip = setup("conflict");
  const conflict = sync();
  const wt = conflict.worktree ?? "";
  writeFileSync(join(wt, "a"), "both\n");
  git(wt, "add", "a");
  git(wt, "commit", "-q", "--no-edit");
  const out = sync("--push", conflict.name ?? "");
  assert.deepEqual(
    [out.status, out.worktree, out.name],
    ["merged", wt, conflict.name],
    JSON.stringify(out),
  );
  assert.equal(originTip(), out.sha);
  assert.notEqual(out.sha, tip);
  assert.equal(readFileSync(join(wt, "a"), "utf8"), "both\n");
});

test("sync --push stops with unfinished on a merge still in progress", () => {
  const tip = setup("conflict");
  const conflict = sync();
  const out = sync("--push", conflict.name ?? "");
  assert.deepEqual([out.status, out.reason], ["stop", "unfinished"]);
  assert.equal(originTip(), tip);
});
