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

const tmp = mkdtempSync(join(tmpdir(), "run-merge-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
const fake = join(tmp, "fake");
const graph = join(tmp, "graph.json");
mkdirSync(home);
mkdirSync(bin);

const sub = {
  number: 2,
  url: "https://github.com/o/r/issues/2",
  title: "Task",
  state: "OPEN",
  stateReason: null,
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
printf '%s\\n' "$(printf '%s' "$*" | tr '\\n' ' ')" >> '${fake}/gh.log'
none() { echo "no checks reported on the 'feat/2' branch" >&2; exit 1; }
case "$1 $2" in
  "repo view")
    for arg in "$@"; do [ "$arg" = --jq ] && { echo o/r; exit 0; }; done
    echo '{"nameWithOwner":"o/r","squashMergeAllowed":true,"mergeCommitAllowed":false,"rebaseMergeAllowed":false}' ;;
  "api repos/o/r/rules/branches/pj/1") cat '${fake}/ruleset' ;;
  "api repos/o/r/branches/pj/1") echo '{"protected":false}' ;;
  "api graphql")
    for arg in "$@"; do
      case "$arg" in
        query=*"updatedAt body"*) cat '${graph}'; exit 0 ;;
        query=*"ro: ref("*) echo '{"data":{"repository":{"ro":{"compare":{"status":"IDENTICAL"}},"mo":{"totalCount":0},"po":{"nodes":[]}}}}'; exit 0 ;;
      esac
    done
    echo '{"data":{"repository":{"ref":{"branchProtectionRule":null}}}}' ;;
  "pr list") echo '[{"number":3,"state":"OPEN","isDraft":true,"url":"https://github.com/o/r/pull/3","body":"Implements #2"}]' ;;
  "pr view") echo '{"headRefName":"feat/2","isDraft":true,"state":"OPEN"}' ;;
  "pr checks")
    checks="$(cat '${fake}/checks')"
    row() { echo '[{"name":"test","bucket":"'"$1"'","link":"https://example.com/test"}]'; }
    if [ "$5" = name ]; then
      case "$checks" in
        none) none ;;
        later) [ -e '${fake}/polled' ] || { touch '${fake}/polled'; none; } ;;
      esac
      echo '[{"name":"test"}]'
    else
      case "$checks" in
        none) none ;;
        fail) row fail; exit 1 ;;
        cancel) row cancel; exit 1 ;;
        pending) row pending; exit 8 ;;
        slow) [ -e '${fake}/settled' ] || { touch '${fake}/settled'; row pending; exit 8; } ;;
      esac
      row pass
    fi ;;
  "pr ready"|"pr merge") ;;
  "issue view") echo '{"state":"OPEN","updatedAt":"2000-01-01T00:00:00Z","labels":[],"parent":{"number":1},"body":""}' ;;
  "issue close") ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`,
  { mode: 0o755 },
);

const DRIVER_WAIT = "CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS";

const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== DRIVER_WAIT)),
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

const closedComment = join(tmp, "closed.md");
const unmarked = join(tmp, "unmarked.md");
writeFileSync(closedComment, "**[pj4-running]** closed\n");
writeFileSync(unmarked, "closed\n");

const clone = join(tmp, "clone");

const setup = (workflow: string, ruleset: string, checks: string): void => {
  for (const dir of ["origin.git", "seed", "clone", "fake"]) {
    rmSync(join(tmp, dir), { recursive: true, force: true });
  }
  mkdirSync(fake);
  writeFileSync(join(fake, "ruleset"), `${ruleset}\n`);
  writeFileSync(join(fake, "checks"), `${checks}\n`);
  git(tmp, "init", "-q", "--bare", "origin.git");
  git(tmp, "clone", "-q", "origin.git", "seed");
  const seed = join(tmp, "seed");
  writeFileSync(join(seed, "a"), "one\n");
  git(seed, "add", "a");
  git(seed, "commit", "-q", "-m", "init");
  git(seed, "push", "-q", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/pj/1");
  if (workflow !== "") {
    mkdirSync(join(seed, ".github/workflows"), { recursive: true });
    writeFileSync(join(seed, ".github/workflows/test.yml"), `${workflow}\n`);
    git(seed, "add", ".github/workflows/test.yml");
  }
  writeFileSync(join(seed, "a"), "two\n");
  git(seed, "commit", "-q", "-am", "work");
  git(seed, "push", "-q", "origin", "HEAD:refs/heads/feat/2");
  git(tmp, "clone", "-q", "origin.git", "clone");
  appendFileSync(join(clone, ".git/info/exclude"), "work-reports/\n.claude/worktrees/\n");
  git(clone, "worktree", "add", "-q", "-b", "feat/2", runWorktree, "origin/feat/2");
};

const runName = "pj-1-2-2026-01-01-0000";
const runWorktree = join(clone, ".claude/worktrees", runName);

type Merged = {
  readonly status: string;
  readonly reason?: string;
  readonly message?: string;
  readonly issue?: string;
  readonly branch?: { readonly name: string; readonly local: string; readonly remote: string };
  readonly worktree?: { readonly name: string; readonly moved: readonly string[] } | null;
  readonly errors?: readonly { readonly step: string; readonly message: string }[];
};

const merge = (...extra: readonly string[]): Merged => {
  const result = spawnSync(
    "bash",
    [script, "merge", "1", "2", "3", "--comment", closedComment, ...extra],
    { cwd: clone, env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const calls = (): readonly string[] => {
  const log = join(fake, "gh.log");
  if (!existsSync(log)) {
    return [];
  }
  const lines = readFileSync(log, "utf8").split("\n");
  return lines.slice(0, -1);
};

const logged = (line: string): boolean => calls().includes(line);

const polls = (): number => calls().filter((line) => line === "pr checks 3 --json name").length;

const settles = (): number =>
  calls().filter((line) => line === "pr checks 3 --json name,bucket,link").length;

const ON_PR = "on:\n  pull_request:\n  push:\n    branches: [main]";
const ON_MAIN = "on:\n  pull_request:\n    branches: [main]";
const REQUIRED = '[{"type":"required_status_checks"}]';

test("merges once every check passes", () => {
  setup(ON_PR, "[]", "pass");
  assert.equal(merge().status, "merged");
  assert.ok(logged("pr checks 3 --json name,bucket,link"), calls().join("\n"));
  assert.ok(!calls().some((line) => line.includes("--watch")), calls().join("\n"));
  assert.ok(logged("pr merge 3 --squash"), calls().join("\n"));
  assert.ok(!calls().some((line) => line.includes("--required")), calls().join("\n"));
});

test("stops on a failing check the base branch does not require", () => {
  setup(ON_PR, "[]", "fail");
  const out = merge();
  assert.deepEqual([out.status, out.reason], ["stop", "checks-failed"]);
  assert.ok(out.message?.includes("test"), out.message);
  assert.ok(
    !calls().some((line) => line.startsWith("pr merge") || line.startsWith("pr ready")),
    calls().join("\n"),
  );
});

test("does not poll when the pull_request workflow names only other branches", () => {
  setup(ON_MAIN, "[]", "pass");
  assert.equal(merge().status, "merged");
  assert.equal(polls(), 0, calls().join("\n"));
  assert.equal(settles(), 1, calls().join("\n"));
});

test("merges with no workflow and no check, without polling", () => {
  setup("", "[]", "none");
  assert.equal(merge().status, "merged");
  assert.equal(polls(), 0, calls().join("\n"));
  assert.equal(settles(), 1, calls().join("\n"));
});

test("waits for the check a pull_request workflow registers", () => {
  setup(ON_PR, "[]", "later");
  assert.equal(merge().status, "merged");
  assert.equal(polls(), 2, calls().join("\n"));
  const order = calls().filter((line) =>
    [
      "pr checks 3 --json name",
      "pr checks 3 --json name,bucket,link",
      "pr merge 3 --squash",
    ].includes(line),
  );
  assert.deepEqual(order, [
    "pr checks 3 --json name",
    "pr checks 3 --json name",
    "pr checks 3 --json name,bucket,link",
    "pr merge 3 --squash",
  ]);
});

test("stops with checks-timeout when a check stays pending past --ceiling", () => {
  setup(ON_PR, "[]", "pending");
  const out = merge("--ceiling", "1");
  assert.deepEqual([out.status, out.reason], ["stop", "checks-timeout"]);
  assert.ok(out.message?.includes("test https://example.com/test"), out.message);
  assert.ok(
    !calls().some(
      (line) =>
        line.startsWith("pr ready") ||
        line.startsWith("pr merge") ||
        line.startsWith("issue close"),
    ),
    calls().join("\n"),
  );
});

test("the driver's background wait caps the ceiling", () => {
  setup(ON_PR, "[]", "pending");
  const began = performance.now();
  const result = spawnSync("bash", [script, "merge", "1", "2", "3", "--comment", closedComment], {
    cwd: clone,
    env: { ...env, [DRIVER_WAIT]: String(5 * 60 * 1000 + 1000) },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const out: Merged = JSON.parse(result.stdout);
  assert.deepEqual([out.status, out.reason], ["stop", "checks-timeout"]);
  assert.ok(performance.now() - began < 30_000, `took ${performance.now() - began} ms`);
  assert.ok(!calls().some((line) => line.startsWith("pr merge")), calls().join("\n"));
});

test("merges once a pending check passes", () => {
  setup(ON_PR, "[]", "slow");
  assert.equal(merge("--ceiling", "30").status, "merged");
  assert.equal(settles(), 2, calls().join("\n"));
});

test("a cancelled check stops with checks-failed", () => {
  setup(ON_PR, "[]", "cancel");
  const out = merge();
  assert.deepEqual([out.status, out.reason], ["stop", "checks-failed"]);
  assert.ok(out.message?.includes("test https://example.com/test"), out.message);
  assert.ok(!calls().some((line) => line.startsWith("pr merge")), calls().join("\n"));
});

test("merge takes --wait and --ceiling in either order, each once", () => {
  for (const flags of [
    ["--ceiling", "1", "--wait", "1"],
    ["--wait", "1", "--ceiling", "1"],
  ]) {
    setup(ON_PR, "[]", "pass");
    assert.equal(merge(...flags).status, "merged", flags.join(" "));
  }
  for (const flags of [
    ["--wait", "1", "--wait", "1"],
    ["--ceiling", "x"],
    ["--ceiling"],
    ["--other", "1"],
  ]) {
    setup(ON_PR, "[]", "pass");
    const result = spawnSync(
      "bash",
      [script, "merge", "1", "2", "3", "--comment", closedComment, ...flags],
      { cwd: clone, env, encoding: "utf8" },
    );
    assert.equal(result.status, 1, `${flags.join(" ")}: ${result.stdout}`);
    assert.deepEqual(calls(), [], flags.join(" "));
  }
});

test("goes on when a pull_request workflow registers nothing within --wait", () => {
  setup(ON_PR, "[]", "none");
  assert.equal(merge("--wait", "1").status, "merged");
});

const expectations: readonly (readonly [string, number, string])[] = [
  [
    "flow list with a comment",
    1,
    "on:\n  pull_request:\n    branches: [main, 'pj/**']  # the project branches too",
  ],
  [
    "item with a comment",
    1,
    "on:\n  pull_request:\n    branches:\n      - main\n      - 'pj/**'  # the project branches",
  ],
  [
    "comment after branches:",
    1,
    "on:\n  pull_request:\n    branches: # main and the project branches\n      - main\n      - 'pj/**'",
  ],
  ["a # inside quotes", 1, "on:\n  pull_request:\n    branches: ['main #1', 'pj/**']"],
  [
    "items at the key's own indent",
    1,
    "on:\n  pull_request:\n    branches:\n    - main\n    - 'pj/**'",
  ],
  [
    "ignored items at the key's own indent",
    0,
    "on:\n  pull_request:\n    branches-ignore:\n    - 'pj/**'",
  ],
  [
    "flow list over several lines",
    1,
    "on:\n  pull_request:\n    branches: [\n      main,\n      'pj/**',\n    ]",
  ],
  ["a [...] pattern in a flow list", 1, "on:\n  pull_request:\n    branches: [main, pj/[0-9]]"],
  [
    "a quoted [...] pattern before another",
    1,
    "on:\n  pull_request:\n    branches: ['v[0-9]+', 'pj/**']",
  ],
  [
    "a [...] pattern on a later line of a flow list",
    1,
    "on:\n  pull_request:\n    branches: [\n      'v[0-9]+',\n      'pj/**',\n    ]",
  ],
  [
    "a [...] pattern on the first line of a flow list",
    1,
    "on:\n  pull_request:\n    branches: ['v[0-9]+',\n      'pj/**']",
  ],
  ["a quoted ] in a flow list", 1, "on:\n  pull_request:\n    branches: ['a]', 'pj/**']"],
];

test("reads branch filters with comments, items at the key's indent, [...] patterns and flow lists over several lines", () => {
  for (const [name, polled, workflow] of expectations) {
    setup(workflow, "[]", "pass");
    assert.equal(merge().status, "merged", name);
    assert.equal(polls(), polled, `${name}: ${calls().join("\n")}`);
  }
});

test("stops with no-checks when the base branch requires a check and none registers", () => {
  setup("", REQUIRED, "none");
  const out = merge("--wait", "1");
  assert.deepEqual([out.status, out.reason], ["stop", "no-checks"]);
  assert.ok(!calls().some((line) => line.startsWith("pr merge")), calls().join("\n"));
});

test("merge refuses an unmarked comment before it reads or merges anything", () => {
  setup(ON_PR, "[]", "pass");
  const result = spawnSync("bash", [script, "merge", "1", "2", "3", "--comment", unmarked], {
    cwd: clone,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const out: Merged = JSON.parse(result.stdout);
  assert.deepEqual([out.status, out.reason], ["stop", "no-marker"]);
  assert.deepEqual(calls(), []);
});

test("merge closes the issue through issue.sh close", () => {
  setup(ON_PR, "[]", "pass");
  assert.equal(merge().issue, "closed");
  const writes = calls().filter(
    (line) => line.startsWith("issue ") && !line.startsWith("issue view"),
  );
  assert.deepEqual(writes, [
    "issue close 2 --reason completed --comment **[pj4-running]** closed ",
  ]);
});

const branchListed = (branch: string): boolean =>
  git(clone, "branch", "--list", branch).trim() !== "";

test("merge removes the worktree that has the head branch checked out", () => {
  setup(ON_PR, "[]", "pass");
  const out = merge();
  assert.equal(out.status, "merged", JSON.stringify(out));
  assert.deepEqual(out.worktree, { name: runName, moved: [] });
  assert.deepEqual(out.branch, { name: "feat/2", local: "deleted", remote: "deleted" });
  assert.deepEqual(out.errors, []);
  assert.ok(!existsSync(runWorktree), runWorktree);
  assert.ok(!branchListed("feat/2"));
});

test("merge removes a finish stop's worktree whose detached HEAD is the head branch's tip", () => {
  setup(ON_PR, "[]", "pass");
  git(runWorktree, "update-ref", "--no-deref", "HEAD", "HEAD");
  const out = merge();
  assert.equal(out.status, "merged", JSON.stringify(out));
  assert.deepEqual(out.worktree, { name: runName, moved: [] });
  assert.deepEqual(out.branch, { name: "feat/2", local: "deleted", remote: "deleted" });
  assert.deepEqual(out.errors, []);
  assert.ok(!existsSync(runWorktree), runWorktree);
});

test("merge skips a finish stop's worktree whose directory is gone, and deletes the head branch", () => {
  setup(ON_PR, "[]", "pass");
  git(runWorktree, "update-ref", "--no-deref", "HEAD", "HEAD");
  rmSync(runWorktree, { recursive: true, force: true });
  const out = merge();
  assert.equal(out.status, "merged", JSON.stringify(out));
  assert.equal(out.worktree, null);
  assert.deepEqual(out.branch, { name: "feat/2", local: "deleted", remote: "deleted" });
  assert.deepEqual(out.errors, []);
});

test("merge names a failed search for the worktree in errors and still deletes the head branch", () => {
  setup(ON_PR, "[]", "pass");
  git(runWorktree, "update-ref", "--no-deref", "HEAD", "HEAD");
  writeFileSync(join(clone, ".git/worktrees", runName, "HEAD"), "garbage\n");
  const out = merge();
  assert.equal(out.status, "merged", JSON.stringify(out));
  assert.equal(out.worktree, null);
  assert.deepEqual(out.branch, { name: "feat/2", local: "deleted", remote: "deleted" });
  assert.deepEqual(
    (out.errors ?? []).map((e) => e.step),
    ["worktree"],
  );
});

test("merge leaves a worktree that holds uncommitted work, keeps its local branch and names it in errors", () => {
  setup(ON_PR, "[]", "pass");
  writeFileSync(join(runWorktree, "a"), "unsaved\n");
  const out = merge();
  assert.equal(out.status, "merged", JSON.stringify(out));
  assert.equal(out.worktree, null);
  assert.deepEqual(out.branch, { name: "feat/2", local: "kept", remote: "deleted" });
  assert.deepEqual(out.errors, [
    { step: "worktree", message: `${realpathSync(runWorktree)} holds uncommitted, so it stays` },
  ]);
  assert.equal(readFileSync(join(runWorktree, "a"), "utf8"), "unsaved\n");
  assert.ok(branchListed("feat/2"));
});
