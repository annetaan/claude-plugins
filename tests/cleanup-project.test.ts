import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const cleanupSh = join(
  import.meta.dirname,
  "../plugins/annetaan/skills/cleanup/scripts/cleanup.sh",
);

const tmp = mkdtempSync(join(tmpdir(), "cleanup-project-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
const fake = join(tmp, "fake");
const graph = join(fake, "graph.json");
const branches = join(fake, "branches.json");
mkdirSync(home);
mkdirSync(bin);

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
        query=*"updatedAt body"*)
          for n in "$@"; do
            [ "$n" = n=1 ] && { cat '${graph}'; exit 0; }
          done
          echo '{"data":{"repository":{"issue":null}}}'; exit 0 ;;
        query=*"ro: ref("*) cat '${branches}'; exit 0 ;;
      esac
    done
    echo "fake gh: unexpected query" >&2; exit 1 ;;
  *) echo "fake gh: unexpected call: $*" >&2; exit 1 ;;
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

const STAMP = "2026-01-01-0000";
const RUN_2 = `pj-1-2-${STAMP}`;
const RUN_3 = `pj-1-3-${STAMP}`;
const SYNC = `pj-1-sync-${STAMP}`;
const OTHER = `pj-2-2-${STAMP}`;
const PULL = "https://github.com/o/r/pull/9";

type Target = {
  readonly kind: string;
  readonly name: string;
  readonly worktrees: readonly string[];
  readonly branch: string | null;
  readonly pr: Readonly<Record<string, unknown>> | null;
  readonly state: string;
  readonly project?: Readonly<Record<string, unknown>>;
};

type Out = Readonly<Record<string, unknown>> & {
  readonly status: string;
  readonly reason?: string;
  readonly projectPr?: string | null;
  readonly loses: readonly string[];
  readonly errors: readonly unknown[];
  readonly worktrees: readonly Readonly<Record<string, unknown>>[];
  readonly branches: readonly Readonly<Record<string, unknown>>[];
  readonly update: { readonly action: string };
  readonly parent: { readonly number: number; readonly state: string };
  readonly startable: readonly unknown[];
  readonly targets: readonly Target[];
};

const printed = (cwd: string, ...args: readonly string[]): Out => {
  const result = spawnSync("bash", [cleanupSh, ...args], { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Out;
};

const subIssue = {
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

type Clone = { readonly main: string; readonly origin: string };

const setup = (merged: boolean): Clone => {
  for (const dir of ["origin.git", "seed", "clone", "fake"]) {
    rmSync(join(tmp, dir), { recursive: true, force: true });
  }
  mkdirSync(fake);
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
    subIssues: { totalCount: 1, nodes: [subIssue] },
  };
  writeFileSync(graph, `${JSON.stringify({ data: { repository: { issue: parent } } })}\n`);
  writeFileSync(
    branches,
    `${JSON.stringify({
      data: {
        repository: {
          ro: { compare: { status: "BEHIND" } },
          mo: { totalCount: merged ? 1 : 0 },
          po: { nodes: merged ? [] : [{ url: PULL }] },
        },
      },
    })}\n`,
  );
  git(tmp, "init", "-q", "--bare", "origin.git");
  git(tmp, "clone", "-q", "origin.git", "seed");
  const seed = join(tmp, "seed");
  writeFileSync(join(seed, ".gitignore"), "work-reports/\n.claude/worktrees/\n");
  git(seed, "add", ".gitignore");
  git(seed, "commit", "-q", "-m", "init");
  git(seed, "push", "-q", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/pj/1");
  git(tmp, "clone", "-q", "origin.git", "clone");
  const main = realpathSync(join(tmp, "clone"));
  git(main, "branch", "-q", "pj/1", "origin/pj/1");
  git(seed, "commit", "-q", "--allow-empty", "-m", "ahead");
  git(seed, "push", "-q", "origin", "HEAD:refs/heads/main");
  for (const name of [RUN_2, SYNC, OTHER]) {
    git(main, "worktree", "add", "-q", "--detach", `.claude/worktrees/${name}`, "origin/pj/1");
  }
  git(main, "worktree", "add", "-q", "-b", "feat/3-x", `.claude/worktrees/${RUN_3}`, "origin/pj/1");
  return { main, origin: join(tmp, "origin.git") };
};

const wt = (c: Clone, name: string): string => join(c.main, ".claude/worktrees", name);

const commitOnDetachedHead = (c: Clone): void => {
  const path = wt(c, RUN_2);
  writeFileSync(join(path, "work.txt"), "work\n");
  git(path, "add", "work.txt");
  git(path, "commit", "-q", "-m", "work");
};

test("list gathers every pj-1-* worktree into one #1 target", () => {
  const c = setup(true);
  const out = printed(c.main, "list");
  assert.equal(out.status, "ok");
  const project = out.targets.find((t) => t.name === "#1");
  assert.deepEqual(project, {
    kind: "project",
    name: "#1",
    worktrees: [RUN_2, RUN_3, SYNC],
    branch: "pj/1",
    pr: null,
    state: "merged",
    project: { number: 1, title: "Project" },
  });
  const others = out.targets.filter((t) => t.name !== "#1");
  assert.deepEqual(
    others.map((t) => [t.name, t.worktrees, t.state]),
    [["#2", [OTHER], "error"]],
  );
});

test("check #1 on a project not merged stops with not-merged and its pull request", () => {
  const c = setup(false);
  const out = printed(c.main, "check", "#1");
  assert.equal(out.status, "stop");
  assert.equal(out.reason, "not-merged");
  assert.equal(out.projectPr, PULL);
});

test("check #1 counts commits on a detached HEAD that origin lacks in loses", () => {
  const c = setup(true);
  const clean = printed(c.main, "check", "#1");
  assert.equal(clean.status, "ok");
  assert.deepEqual(clean.loses, []);
  commitOnDetachedHead(c);
  const out = printed(c.main, "check", "#1");
  assert.equal(out.status, "ok");
  assert.equal(out["kind"], "project");
  assert.deepEqual(out.loses, ["commits"]);
  assert.deepEqual(
    out.worktrees.map((t) => [t["name"], t["state"]]),
    [
      [RUN_2, "clean"],
      [RUN_3, "clean"],
      [SYNC, "clean"],
    ],
  );
  assert.deepEqual(out.parent, { number: 1, state: "OPEN" });
  assert.deepEqual(out.branches, [
    { name: "pj/1", local: "delete", why: null, remote: "present" },
    { name: "feat/3-x", local: "delete", why: null, remote: "absent" },
  ]);
});

test("run #1 removes every pj-1-* worktree, deletes pj/1 locally and on origin, and fast-forwards main", () => {
  const c = setup(true);
  const out = printed(c.main, "run", "#1");
  assert.equal(out.status, "done");
  assert.deepEqual(out.errors, []);
  assert.deepEqual(
    out.worktrees.map((t) => [t["name"], t["action"]]),
    [
      [RUN_2, "removed"],
      [RUN_3, "removed"],
      [SYNC, "removed"],
    ],
  );
  for (const name of [RUN_2, RUN_3, SYNC]) {
    assert.equal(existsSync(wt(c, name)), false, name);
  }
  assert.equal(existsSync(wt(c, OTHER)), true);
  assert.deepEqual(out.branches, [
    { name: "pj/1", local: "deleted", why: null, remote: "deleted" },
    { name: "feat/3-x", local: "deleted", why: null, remote: "absent" },
  ]);
  assert.equal(gitResult(c.main, "rev-parse", "--verify", "--quiet", "refs/heads/pj/1").status, 1);
  assert.equal(
    gitResult(c.main, "rev-parse", "--verify", "--quiet", "refs/heads/feat/3-x").status,
    1,
  );
  assert.equal(git(c.origin, "for-each-ref", "refs/heads/pj/1"), "");
  assert.equal(out.update.action, "updated");
  assert.equal(git(c.main, "rev-parse", "main"), git(c.origin, "rev-parse", "main"));
  assert.deepEqual(out.startable, []);
});

test("run #1 refuses with discard when a kept worktree holds commits", () => {
  const c = setup(true);
  commitOnDetachedHead(c);
  const out = printed(c.main, "run", "#1");
  assert.equal(out.status, "stop");
  assert.equal(out.reason, "discard");
  assert.deepEqual(out.loses, ["commits"]);
  for (const name of [RUN_2, RUN_3, SYNC]) {
    assert.equal(existsSync(wt(c, name)), true, name);
  }
  assert.notEqual(git(c.origin, "for-each-ref", "refs/heads/pj/1"), "");
});

test("run #1 removes the worktree of a finish stop and keeps its branch with the commits origin lacks", () => {
  const c = setup(true);
  const path = wt(c, RUN_3);
  writeFileSync(join(path, "finish.txt"), "finish\n");
  git(path, "add", "finish.txt");
  git(path, "commit", "-q", "-m", "finish");
  const tip = git(path, "rev-parse", "HEAD");
  const checked = printed(c.main, "check", "#1");
  assert.deepEqual(checked.loses, []);
  assert.deepEqual(checked.branches[1], {
    name: "feat/3-x",
    local: "keep",
    why: "unpushed",
    remote: "absent",
  });
  const out = printed(c.main, "run", "#1");
  assert.equal(out.status, "done");
  assert.equal(existsSync(path), false);
  assert.deepEqual(out.branches[1], {
    name: "feat/3-x",
    local: "kept",
    why: "unpushed",
    remote: "absent",
  });
  assert.equal(git(c.main, "rev-parse", "refs/heads/feat/3-x"), tip);
});

test("run #1 keeps the origin copy of a run branch it keeps as unpushed", () => {
  const c = setup(true);
  const path = wt(c, RUN_3);
  git(path, "push", "-q", "origin", "feat/3-x");
  const pushed = git(path, "rev-parse", "HEAD");
  writeFileSync(join(path, "finish.txt"), "finish\n");
  git(path, "add", "finish.txt");
  git(path, "commit", "-q", "-m", "finish");
  const checked = printed(c.main, "check", "#1");
  assert.deepEqual(checked.branches[1], {
    name: "feat/3-x",
    local: "keep",
    why: "unpushed",
    remote: "present",
  });
  const out = printed(c.main, "run", "#1");
  assert.equal(out.status, "done");
  assert.deepEqual(out.branches[0], {
    name: "pj/1",
    local: "deleted",
    why: null,
    remote: "deleted",
  });
  assert.deepEqual(out.branches[1], {
    name: "feat/3-x",
    local: "kept",
    why: "unpushed",
    remote: "kept",
  });
  assert.equal(git(c.origin, "rev-parse", "refs/heads/feat/3-x"), pushed);
  assert.equal(git(c.origin, "for-each-ref", "refs/heads/pj/1"), "");
});

test("run #1 --discard removes a kept worktree", () => {
  const c = setup(true);
  commitOnDetachedHead(c);
  const out = printed(c.main, "run", "#1", "--discard");
  assert.equal(out.status, "done");
  assert.deepEqual(out.errors, []);
  for (const name of [RUN_2, RUN_3, SYNC]) {
    assert.equal(existsSync(wt(c, name)), false, name);
  }
});
