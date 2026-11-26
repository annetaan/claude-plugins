import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const scripts = join(import.meta.dirname, "../plugins/annetaan/skills");
const cleanupSh = join(scripts, "cleanup/scripts/cleanup.sh");
const pjCleanupSh = join(scripts, "pj-cleanup/scripts/cleanup.sh");
const flowSh = join(scripts, "workflow/scripts/flow.sh");

const tmp = mkdtempSync(join(tmpdir(), "worktree-submodules-"));
after(() => {
  spawnSync("chmod", ["-R", "u+rwx", tmp]);
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
mkdirSync(home);
mkdirSync(bin);
const issueJson = join(tmp, "issue.json");
writeFileSync(
  issueJson,
  `${JSON.stringify({
    data: {
      repository: {
        issue: {
          number: 1,
          url: "https://github.com/test/repo/issues/1",
          title: "P",
          state: "CLOSED",
          stateReason: "COMPLETED",
          updatedAt: "2000-01-01T00:00:00Z",
          body: "Base: `pj/1` from `main`\n\n## Goal\n\nx\n",
          labels: { nodes: [{ name: "project" }] },
          blockedBy: { nodes: [] },
          blocking: { nodes: [] },
          subIssues: { totalCount: 0, nodes: [] },
        },
      },
    },
  })}\n`,
);
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
if [ "$1 $2" = "repo view" ]; then
  echo test/repo
  exit 0
fi
if [ "$1 $2" = "pr list" ]; then
  echo '[]'
  exit 0
fi
if [ "$1 $2" = "api graphql" ]; then
  for arg in "$@"; do
    case "$arg" in
      query=*"updatedAt body"*) cat '${issueJson}'; exit 0 ;;
      query=*"ro: ref("*) echo '{"data":{"repository":{"ro":null,"mo":{"totalCount":1},"po":{"nodes":[]}}}}'; exit 0 ;;
    esac
  done
  echo "fake gh: unexpected query" >&2
  exit 1
fi
echo "fake gh: unexpected call: $*" >&2
exit 1
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

git(tmp, "config", "--global", "protocol.file.allow", "always");
git(tmp, "config", "--global", "init.defaultBranch", "main");

type SubmoduleEntry = {
  readonly path: string;
  readonly changes: readonly string[];
  readonly commits: number;
};

type Out = {
  readonly status: string;
  readonly reason?: string;
  readonly errors: readonly unknown[];
  readonly loses: readonly string[];
  readonly worktree: {
    readonly state: string;
    readonly action?: string;
    readonly submodules: readonly SubmoduleEntry[];
  };
  readonly worktrees: readonly {
    readonly state: string;
    readonly submodules: readonly SubmoduleEntry[];
  }[];
};

const printed = (cwd: string, script: string, ...args: readonly string[]): Out => {
  const result = spawnSync("bash", [script, ...args], { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Out;
};

const exists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const REPORT = "2026-01-01-0000-aaaaaaa";

type Clone = { readonly main: string; readonly wt: string; readonly name: string };

const clone = (dir: string, name: string, withOrigin: boolean, init: boolean): Clone => {
  const root = join(tmp, dir);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root);
  const subsrc = join(root, "subsrc");
  git(root, "init", "-q", "subsrc");
  writeFileSync(join(subsrc, "f"), "one\n");
  git(subsrc, "add", "f");
  git(subsrc, "commit", "-q", "-m", "one");
  git(subsrc, "tag", "v1");
  git(root, "init", "-q", "-b", "main", "work");
  const main = realpathSync(join(root, "work"));
  writeFileSync(join(main, ".gitignore"), "work-reports/\n.claude/worktrees/\n");
  writeFileSync(join(main, "README.md"), "readme\n");
  git(main, "submodule", "-q", "add", subsrc, "sub");
  git(main, "add", ".gitignore", "README.md");
  git(main, "commit", "-q", "-m", "init");
  if (withOrigin) {
    git(root, "init", "-q", "--bare", "origin.git");
    git(main, "remote", "add", "origin", join(root, "origin.git"));
    git(main, "push", "-q", "origin", "main");
  }
  git(main, "worktree", "add", "-q", "--detach", `.claude/worktrees/${name}`, "HEAD");
  const wt = join(main, ".claude/worktrees", name);
  if (init) {
    git(wt, "submodule", "-q", "update", "--init");
  }
  mkdirSync(join(wt, "work-reports", REPORT), { recursive: true });
  writeFileSync(join(wt, "work-reports", REPORT, "log.md"), "x\n");
  return { main, wt, name };
};

const setup = (init: boolean): Clone => clone("run", "run-test", true, init);
const setupPj = (init: boolean): Clone => clone("pj", "pj-1", true, init);

const commitInSub = (wt: string): void => {
  git(join(wt, "sub"), "commit", "-q", "--allow-empty", "-m", "local");
  git(wt, "add", "sub");
  git(wt, "commit", "-q", "-m", "bump");
};

const seatRun = ({ main, wt }: Clone, seat: string): void => {
  const dir = join(wt, "work-reports", REPORT, "seats", seat, "p");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.sh"), "echo repro > repro.sh\n");
  const result = spawnSync("bash", [flowSh, "run", wt, seat, dir], {
    cwd: main,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
};

const seatsGone = ({ main, name }: Clone): boolean =>
  ["a", "b"].every(
    (seat) =>
      !exists(join(main, ".claude/worktrees", `review-${name}-${seat}`)) &&
      !exists(join(main, ".git/worktrees", `review-${name}-${seat}`)),
  );

const gone = ({ main, wt, name }: Clone): boolean =>
  !exists(wt) && !exists(join(main, ".git/worktrees", name));

test("cleanup.sh run removes the seats beside a run worktree with a submodule", () => {
  const c = setup(true);
  seatRun(c, "a");
  seatRun(c, "b");
  const out = printed(c.main, cleanupSh, "run", "run-test");
  assert.equal(out.status, "done");
  assert.deepEqual(out.errors, []);
  assert.ok(gone(c));
  assert.ok(seatsGone(c));
});

test("cleanup.sh check on a run worktree with an initialized clean submodule has empty loses and submodules", () => {
  const c = setup(true);
  const out = printed(c.main, cleanupSh, "check", "run-test");
  assert.deepEqual(out.loses, []);
  assert.deepEqual(out.worktrees[0]?.submodules, []);
});

test("cleanup.sh run removes a run worktree with an initialized clean submodule", () => {
  const c = setup(true);
  const out = printed(c.main, cleanupSh, "run", "run-test");
  assert.equal(out.status, "done");
  assert.ok(gone(c));
  assert.ok(exists(join(c.main, "work-reports", REPORT)));
});

test("cleanup.sh run removes a run worktree whose submodule is not initialized", () => {
  const c = setup(false);
  assert.equal(printed(c.main, cleanupSh, "run", "run-test").status, "done");
  assert.ok(gone(c));
});

test("cleanup.sh run on a run worktree refuses with discard when a submodule has an uncommitted change, and removes and moves nothing", () => {
  const c = setup(true);
  writeFileSync(join(c.wt, "sub/new.txt"), "dirty\n");
  const out = printed(c.main, cleanupSh, "run", "run-test");
  assert.equal(out.status, "stop");
  assert.equal(out.reason, "discard");
  assert.equal(out.worktrees[0]?.submodules[0]?.path, "sub");
  assert.deepEqual(out.worktrees[0]?.submodules[0]?.changes, ["?? new.txt"]);
  assert.ok(exists(join(c.wt, "sub/new.txt")));
  assert.ok(statSync(join(c.wt, "work-reports", REPORT)).isDirectory());
  assert.equal(exists(join(c.main, "work-reports")), false);
});

test("cleanup.sh run on a run worktree refuses with discard when a submodule has a commit on no remote that the superproject records", () => {
  const c = setup(true);
  commitInSub(c.wt);
  const out = printed(c.main, cleanupSh, "run", "run-test");
  assert.equal(out.status, "stop");
  assert.equal(out.reason, "discard");
  assert.equal(out.worktrees[0]?.state, "clean");
  assert.deepEqual(out.loses, ["submodules", "commits"]);
  assert.equal(out.worktrees[0]?.submodules[0]?.commits, 1);
  assert.ok(exists(c.wt));
});

test("cleanup.sh run --discard removes a run worktree whose submodule holds work", () => {
  const c = setup(true);
  commitInSub(c.wt);
  assert.equal(printed(c.main, cleanupSh, "run", "run-test", "--discard").status, "done");
  assert.ok(gone(c));
});

test("cleanup.sh check on a run worktree does not count a submodule pinned to a commit that only a tag reaches", () => {
  const c = setup(true);
  git(join(c.wt, "sub"), "commit", "-q", "--allow-empty", "-m", "tagged");
  git(join(c.wt, "sub"), "tag", "v2");
  git(c.wt, "add", "sub");
  git(c.wt, "commit", "-q", "-m", "bump");
  const out = printed(c.main, cleanupSh, "check", "run-test");
  assert.deepEqual(out.loses, ["commits"]);
  assert.deepEqual(out.worktrees[0]?.submodules, []);
});

test("cleanup.sh check on a run worktree prints the submodules that hold work", () => {
  const c = setup(true);
  commitInSub(c.wt);
  const out = printed(c.main, cleanupSh, "check", "run-test");
  assert.equal(out.status, "ok");
  assert.deepEqual(
    out.worktrees[0]?.submodules.map((s) => [s.path, s.commits]),
    [["sub", 1]],
  );
});

test("cleanup.sh run removes a worktree with an initialized clean submodule", () => {
  const c = setupPj(true);
  const out = printed(c.main, pjCleanupSh, "run", "1");
  assert.equal(out.status, "done");
  assert.equal(out.worktree.action, "removed");
  assert.ok(gone(c));
  assert.ok(exists(join(c.main, "work-reports", REPORT)));
  assert.deepEqual(out.errors, []);
});

test("cleanup.sh run refuses with discard when a submodule has a commit on no remote, and removes nothing", () => {
  const c = setupPj(true);
  commitInSub(c.wt);
  const out = printed(c.main, pjCleanupSh, "run", "1");
  assert.equal(out.status, "stop");
  assert.equal(out.reason, "discard");
  assert.deepEqual(out.loses, ["submodules"]);
  assert.equal(out.worktree.state, "clean");
  assert.equal(out.worktree.submodules[0]?.commits, 1);
  assert.ok(exists(c.wt));
  assert.ok(statSync(join(c.wt, "work-reports", REPORT)).isDirectory());
  assert.equal(exists(join(c.main, "work-reports")), false);
});

test("cleanup.sh run --discard removes a worktree whose submodule holds work", () => {
  const c = setupPj(true);
  commitInSub(c.wt);
  assert.equal(printed(c.main, pjCleanupSh, "run", "1", "--discard").status, "done");
  assert.ok(gone(c));
});

test("cleanup.sh run removes the seats beside a worktree with a submodule", () => {
  const c = setupPj(true);
  seatRun(c, "b");
  const before = printed(c.main, pjCleanupSh, "check", "1");
  assert.equal(before.status, "ok");
  assert.deepEqual(before.loses, []);
  const out = printed(c.main, pjCleanupSh, "run", "1");
  assert.equal(out.status, "done");
  assert.deepEqual(out.errors, []);
  assert.ok(gone(c));
  assert.ok(seatsGone(c));
});
