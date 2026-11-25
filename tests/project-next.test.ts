import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/pj1-plan/scripts/project.sh");

const tmp = mkdtempSync(join(tmpdir(), "project-next-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
const work = join(tmp, "work");
const issuesJson = join(tmp, "issues.json");
mkdirSync(home);
mkdirSync(bin);
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
if [ "$1 $2" = "pr list" ]; then
  echo '[]'
  exit 0
fi
if [ "$1 $2" = "api graphql" ]; then
  for arg in "$@"; do
    case "$arg" in
      query=*"updatedAt body"*) cat '${issuesJson}'; exit 0 ;;
      query=*"ro: ref("*) echo '{"data":{"repository":{"ro":{"compare":{"status":"IDENTICAL"}},"mo":{"totalCount":0},"po":{"nodes":[]}}}}'; exit 0 ;;
    esac
  done
  echo "fake gh: unexpected query" >&2
  exit 1
fi
echo "fake gh: unexpected call" >&2
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

const git = (cwd: string, ...args: readonly string[]): void => {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};

git(tmp, "init", "-q", "-b", "main", "work");
git(tmp, "init", "-q", "--bare", "origin.git");
mkdirSync(join(work, "src"));
writeFileSync(join(work, "src/app.ts"), "export function foo() {}\n");
git(work, "add", "src/app.ts");
git(work, "commit", "-q", "-m", "init");
git(work, "remote", "add", "origin", "../origin.git");
git(work, "push", "-q", "origin", "main", "main:refs/heads/pj/1");

const run = (args: readonly string[]) =>
  spawnSync("bash", [script, ...args], { cwd: work, env, encoding: "utf8" });

const json = (result: ReturnType<typeof run>) => {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const project = (...numbers: readonly number[]): string =>
  `Base: \`pj/1\` from \`main\`\n\n## Goal\n\nx\n\n## Order\n\n${numbers.map((n, i) => `${i + 1}. #${n}\n`).join("")}`;

const decisionsOf = (decision: string): string => {
  const box = decision === "open" ? " " : decision === "ticked" ? "x" : null;
  if (box === null) {
    return "None.\n";
  }
  return `### D1. Which name?\n\nIt changes the export.\n\nOnly you know: the name the callers use.\n\n- [${box}] \`bar\` (recommended)\n  - the export is \`bar\`\n- [ ] \`baz\`\n  - the export is \`baz\`\n`;
};

const issue = (
  number: number,
  labels: string,
  decision: string,
  ...blockers: readonly number[]
) => ({
  number,
  url: `https://github.com/test/repo/issues/${number}`,
  title: `Task ${number}`,
  state: "OPEN",
  stateReason: null,
  updatedAt: "2000-01-01T00:00:00Z",
  body: `## Goal\n\nRename foo.\n\n## Design\n\n- \`src/app.ts\` (changed): rename \`foo\`.\n\n## Acceptance criteria\n\n- \`foo\` is renamed.\n\n## Decisions\n\n${decisionsOf(decision)}\n## Out of scope\n\nNothing.\n`,
  labels: {
    nodes: labels
      .split(",")
      .filter((l) => l !== "none")
      .map((name) => ({ name })),
  },
  blockedBy: { nodes: blockers.map((b) => ({ number: b, state: "OPEN", parent: { number: 1 } })) },
  blocking: { nodes: [] },
});

const setGraph = (
  parentBody: string,
  subs: readonly ReturnType<typeof issue>[],
  parentBlockedBy: readonly object[] = [],
): void => {
  const parent = {
    number: 1,
    url: "https://github.com/test/repo/issues/1",
    title: "Project",
    state: "OPEN",
    stateReason: null,
    updatedAt: "2000-01-01T00:00:00Z",
    body: parentBody,
    labels: { nodes: [] },
    blockedBy: { nodes: parentBlockedBy },
    blocking: { nodes: [] },
    subIssues: { totalCount: subs.length, nodes: subs },
  };
  writeFileSync(issuesJson, `${JSON.stringify({ data: { repository: { issue: parent } } })}\n`);
};

const next = () => json(run(["-R", "test/repo", "1", "--next"]));
const view = () => json(run(["-R", "test/repo", "1"]));
const verdict = (d: { next: string; why: string; issue: number }) => [d.next, d.why, d.issue];

test("an issue stopped on a decision goes to the user, then to the doctor", () => {
  setGraph(project(2, 3), [issue(2, "none", "open"), issue(3, "ready", "none", 2)]);
  assert.deepEqual(verdict(next()), ["user", "decisions", 2]);
  setGraph(project(2, 3), [issue(2, "none", "ticked"), issue(3, "ready", "none", 2)]);
  assert.deepEqual(verdict(next()), ["doctor", "not-ready", 2]);
});

test("an issue stopped on a detail goes to the doctor", () => {
  setGraph(project(2, 3), [issue(2, "blocker", "none"), issue(3, "ready", "none", 2)]);
  assert.deepEqual(verdict(next()), ["doctor", "blocker", 2]);
});

test("a ready issue with its decisions settled is workable", () => {
  setGraph(project(2, 3), [issue(2, "ready", "none"), issue(3, "ready", "none", 2)]);
  assert.deepEqual(verdict(next()), ["running", "workable", 2]);
});

test("the parent carries its lint", () => {
  const parentBody =
    "Base: `pj/1` from `main`\n\n## Order\n\n1. #2\n\n## Goal\n\nx\n\n## Design\n\ny\n\n## Decisions\n\nNone.\n";
  setGraph(parentBody, [issue(2, "ready", "none")]);
  const parentFile = join(tmp, "parent.md");
  writeFileSync(parentFile, parentBody);
  const lint = view().parent.lint;
  assert.deepEqual(lint, json(run(["--parent-lint", parentFile])));
  assert.deepEqual(lint.reasons, ["sections"]);
});

test("the parent, each issue and each project it waits on carry a url", () => {
  const earlier = {
    number: 9,
    url: "https://github.com/test/repo/issues/9",
    title: "Earlier",
    state: "CLOSED",
    stateReason: "COMPLETED",
    body: "Base: `pj/9` from `main`\n\n## Goal\n\nx\n",
  };
  setGraph(project(2, 3), [issue(2, "ready", "none"), issue(3, "ready", "none", 2)], [earlier]);
  const d = view();
  assert.equal(d.parent.url, "https://github.com/test/repo/issues/1");
  assert.deepEqual(
    d.issues.map((i: { url: string }) => i.url),
    ["https://github.com/test/repo/issues/2", "https://github.com/test/repo/issues/3"],
  );
  assert.equal(d.parent.waitsOn[0].url, "https://github.com/test/repo/issues/9");
  assert.ok(d.parent.waitsOn[0].merged);
});
