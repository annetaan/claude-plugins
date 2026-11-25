import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/pj1-plan/scripts/project.sh");

const tmp = mkdtempSync(join(tmpdir(), "project-breakage-"));
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

const signin = "bash tests/signin.sh";

const body = (declare: boolean, criterion: boolean): string => {
  const left = declare
    ? `\n### Left broken\n\n- \`${signin}\`: fails until the callers move\n`
    : "";
  const crit = criterion ? `- \`${signin}\` passes\n` : "- `foo` is renamed.\n";
  return `## Goal\n\nRename foo.\n\n## Design\n\n- \`src/app.ts\` (changed): rename \`foo\`.\n${left}\n## Acceptance criteria\n\n${crit}\n## Decisions\n\nNone.\n\n## Out of scope\n\nNothing.\n`;
};

const node = (number: number, state: string, blockers: readonly number[], text: string) => ({
  number,
  url: `https://github.com/test/repo/issues/${number}`,
  title: `Task ${number}`,
  state: state === "OPEN" ? "OPEN" : "CLOSED",
  stateReason: state === "OPEN" ? null : state,
  updatedAt: "2000-01-01T00:00:00Z",
  body: text,
  labels: { nodes: [{ name: "ready" }] },
  blockedBy: { nodes: blockers.map((b) => ({ number: b, state: "OPEN", parent: { number: 1 } })) },
  blocking: { nodes: [] },
});

const issues = (
  breaker: string,
  closer: string,
  blocked: boolean,
  carries: boolean,
  declares: boolean,
): void => {
  const nodes = [
    node(2, breaker, [], body(declares, false)),
    node(3, closer, blocked ? [2] : [], body(false, carries)),
  ];
  const parent = {
    number: 1,
    url: "https://github.com/test/repo/issues/1",
    title: "Project",
    state: "OPEN",
    stateReason: null,
    updatedAt: "2000-01-01T00:00:00Z",
    body: "Base: `pj/1` from `main`\n\n## Goal\n\nx\n",
    labels: { nodes: [] },
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    subIssues: { totalCount: nodes.length, nodes },
  };
  writeFileSync(issuesJson, `${JSON.stringify({ data: { repository: { issue: parent } } })}\n`);
};

const check = (n: number) => json(run(["-R", "test/repo", "1", "--check", String(n)]));
const view = () => json(run(["-R", "test/repo", "1"]));
const states = (d: { parent: { breakage: readonly { state: string }[] } }) =>
  d.parent.breakage.map((b) => b.state);

test("a declared breakage with a closer passes --check", () => {
  issues("OPEN", "OPEN", true, true, true);
  for (const n of [2, 3]) {
    const d = check(n);
    assert.equal(d.ok, true, `#${n}`);
    assert.deepEqual(d.breakage, { unclosed: [] }, `#${n}`);
  }
});

test("a breakage with no closer fails --check with breakage.unclosed", () => {
  issues("OPEN", "OPEN", true, false, true);
  const d = check(2);
  assert.equal(d.ok, false);
  assert.deepEqual(d.breakage.unclosed, [{ issue: 2, check: signin }]);
});

test("a closer not blocked by the breaker does not count", () => {
  issues("OPEN", "OPEN", false, true, true);
  const d = check(2);
  assert.equal(d.ok, false);
  assert.equal(d.breakage.unclosed.length, 1);
});

test("a closer whose body lost the check leaves the entry unclosed for every issue of the project", () => {
  issues("OPEN", "OPEN", true, false, true);
  for (const n of [2, 3]) {
    const d = check(n);
    assert.equal(d.ok, false, `#${n}`);
    assert.deepEqual(d.breakage.unclosed, [{ issue: 2, check: signin }], `#${n}`);
  }
});

test("a closer closed as completed with no pull request still closes", () => {
  issues("OPEN", "COMPLETED", true, true, true);
  const d = check(2);
  assert.equal(d.ok, true);
  assert.deepEqual(d.breakage.unclosed, []);
});

test("parent.breakage reports planned, open and closed", () => {
  issues("OPEN", "OPEN", true, true, true);
  assert.deepEqual(view().parent.breakage, [
    { issue: 2, check: signin, closedBy: [3], state: "planned" },
  ]);
  issues("COMPLETED", "OPEN", true, true, true);
  assert.deepEqual(states(view()), ["open"]);
  issues("COMPLETED", "COMPLETED", true, true, true);
  assert.deepEqual(states(view()), ["closed"]);
  issues("OPEN", "OPEN", true, false, true);
  const unclosed = view();
  assert.deepEqual(states(unclosed), ["unclosed"]);
  for (const issue of unclosed.issues) {
    assert.equal("criteria" in issue, false);
  }
  issues("NOT_PLANNED", "OPEN", true, true, true);
  assert.deepEqual(view().parent.breakage, []);
});

test("--next still answers", () => {
  issues("OPEN", "OPEN", true, true, true);
  const d = json(run(["-R", "test/repo", "1", "--next"]));
  assert.ok(["doctor", "running", "user", "done"].includes(d.next), d.next);
});
