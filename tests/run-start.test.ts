import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
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

const tmp = mkdtempSync(join(tmpdir(), "run-start-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
const fake = join(tmp, "fake");
const graph = join(fake, "graph.json");
mkdirSync(home);
mkdirSync(bin);

writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
printf '%s\\n' "$(printf '%s' "$*" | tr '\\n' ' ')" >> '${fake}/gh.log'
case "$1 $2" in
  "--version ") echo "gh version 2.99.0 (2026-01-01)" ;;
  "auth status") ;;
  "repo view")
    for arg in "$@"; do [ "$arg" = --jq ] && { echo o/r; exit 0; }; done
    echo '{"nameWithOwner":"o/r","hasIssuesEnabled":true,"viewerPermission":"WRITE","defaultBranchRef":{"name":"main"},"squashMergeAllowed":true,"mergeCommitAllowed":false,"rebaseMergeAllowed":false}' ;;
  "api repos/o/r/rules/branches/pj/1") echo '[]' ;;
  "api repos/o/r/branches/pj/1") echo '{"protected":false}' ;;
  "api user") echo '{"login":"me"}' ;;
  "api repos/o/r/issues/1")
    if [ -e '${fake}/added' ]; then echo '{"assignees":[{"login":"me"}]}'; else cat '${fake}/assignees'; fi ;;
  "issue edit") touch '${fake}/added' ;;
  "pr list") echo '[]' ;;
  "api graphql")
    for arg in "$@"; do
      case "$arg" in
        query=*"updatedAt body"*) cat '${graph}'; exit 0 ;;
        query=*"ro: ref("*) echo '{"data":{"repository":{"ro":{"compare":{"status":"BEHIND"}},"mo":{"totalCount":0},"po":{"nodes":[]}}}}'; exit 0 ;;
      esac
    done
    echo '{"data":{"repository":{"ref":{"branchProtectionRule":null}}}}' ;;
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

const clone = join(tmp, "clone");

const subIssue = (state: "OPEN" | "CLOSED") => ({
  number: 2,
  url: "https://github.com/o/r/issues/2",
  title: "Task",
  state,
  stateReason: state === "CLOSED" ? "COMPLETED" : null,
  updatedAt: "2000-01-01T00:00:00Z",
  body: "## Goal\n\nx\n\n## Design\n\nTo be drawn.\n",
  labels: { nodes: [{ name: "ready" }] },
  blockedBy: { nodes: [] },
  blocking: { nodes: [] },
});

const setup = (subs: "none" | "OPEN" | "CLOSED", assignees: readonly string[]): string => {
  for (const dir of ["origin.git", "seed", "clone", "fake"]) {
    rmSync(join(tmp, dir), { recursive: true, force: true });
  }
  mkdirSync(fake);
  const nodes = subs === "none" ? [] : [subIssue(subs)];
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
    subIssues: { totalCount: nodes.length, nodes },
  };
  writeFileSync(graph, `${JSON.stringify({ data: { repository: { issue: parent } } })}\n`);
  writeFileSync(
    join(fake, "assignees"),
    `${JSON.stringify({ assignees: assignees.map((login) => ({ login })) })}\n`,
  );
  git(tmp, "init", "-q", "--bare", "origin.git");
  git(tmp, "clone", "-q", "origin.git", "seed");
  const seed = join(tmp, "seed");
  writeFileSync(join(seed, "a"), "one\n");
  git(seed, "add", "a");
  git(seed, "commit", "-q", "-m", "init");
  git(seed, "push", "-q", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/pj/1");
  git(tmp, "clone", "-q", "origin.git", "clone");
  return realpathSync(clone);
};

type Started = {
  readonly status: string;
  readonly reason?: string;
  readonly main?: string;
  readonly worktree?: string;
  readonly ignored?: readonly string[];
  readonly assignee?: { readonly login: string; readonly added: boolean };
  readonly login?: string;
  readonly assignees?: readonly string[];
  readonly self?: boolean;
};

const start = (main: string): Started => {
  const result = spawnSync("bash", [script, "start", "1"], { cwd: main, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const calls = (): readonly string[] => {
  const log = join(fake, "gh.log");
  return existsSync(log) ? readFileSync(log, "utf8").split("\n").slice(0, -1) : [];
};

const assigning = (): readonly string[] =>
  calls().filter((line) => line === "api user" || line.startsWith("issue edit"));

const exclude = (main: string): string => readFileSync(join(main, ".git/info/exclude"), "utf8");

const IGNORE_PATHS = [".claude/worktrees/", "work-reports/"];

test("start assigns the user when nobody is assigned", () => {
  const main = setup("OPEN", []);
  const out = start(main);
  assert.equal(out.status, "run", JSON.stringify(out));
  assert.deepEqual(out.assignee, { login: "me", added: true });
  assert.equal(out.worktree, undefined);
  assert.equal(out.main, main);
  assert.deepEqual(assigning(), ["api user", "issue edit 1 --add-assignee me"]);
});

test("start stops with assigned when someone else is assigned", () => {
  const main = setup("OPEN", ["other"]);
  const out = start(main);
  assert.deepEqual(
    [out.status, out.reason, out.login, out.assignees, out.self, out.main, out.worktree],
    ["stop", "assigned", "me", ["other"], false, main, undefined],
  );
  assert.deepEqual(assigning(), ["api user"]);
});

test("start empty assigns nobody and writes no exclude line", () => {
  const main = setup("none", []);
  const before = exclude(main);
  const out = start(main);
  assert.equal(out.status, "empty", JSON.stringify(out));
  assert.equal(out.worktree, undefined);
  assert.deepEqual(assigning(), []);
  assert.equal(exclude(main), before);
});

test("start done writes the missing ignore paths and prints ignored", () => {
  const main = setup("CLOSED", []);
  const out = start(main);
  assert.equal(out.status, "done", JSON.stringify(out));
  assert.deepEqual(out.ignored, IGNORE_PATHS);
  const lines = exclude(main).split("\n");
  for (const path of IGNORE_PATHS) {
    assert.ok(lines.includes(path), path);
  }
});

test("start done assigns nobody", () => {
  const main = setup("CLOSED", []);
  const out = start(main);
  assert.equal(out.status, "done", JSON.stringify(out));
  assert.equal(out.worktree, undefined);
  assert.equal(out.assignee, undefined);
  assert.deepEqual(assigning(), []);
});
