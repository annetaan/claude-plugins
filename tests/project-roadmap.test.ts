import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/pj1-plan/scripts/project.sh");

const tmp = mkdtempSync(join(tmpdir(), "project-roadmap-"));
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
writeFileSync(join(work, "README.md"), "readme\n");
git(work, "add", "README.md");
git(work, "commit", "-q", "-m", "init");
git(work, "remote", "add", "origin", "../origin.git");
git(work, "push", "-q", "origin", "main");

const run = (args: readonly string[]) =>
  spawnSync("bash", [script, ...args], { cwd: work, env, encoding: "utf8" });

const json = (result: ReturnType<typeof run>) => {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const roadmap = (...args: readonly string[]) => json(run(["--roadmap", ...args]));
const codes = (...args: readonly string[]): string =>
  roadmap(...args)
    .reasons.map((r: { code: string }) => r.code)
    .join(",");
const writeRoadmap = (text: string): void => {
  writeFileSync(join(work, "roadmap.md"), text);
};
const pj = (...args: readonly string[]) => json(run(["-R", "test/repo", "1", ...args]));

type Spec = {
  readonly n: number;
  readonly state: string;
  readonly reason?: string;
  readonly files: readonly string[];
  readonly blockedBy?: readonly number[];
};

const setGraph = (parentBody: string, specs: readonly Spec[]): void => {
  const stateOf = new Map(specs.map((s) => [s.n, s.state]));
  const nodes = specs.map((s) => {
    const lines = s.files.map(
      (f) =>
        `- \`${f}\` (changed): ${f.endsWith("roadmap.md") ? "delete the entry." : "rename `foo`."}`,
    );
    return {
      number: s.n,
      url: `https://github.com/test/repo/issues/${s.n}`,
      title: `Task ${s.n}`,
      state: s.state,
      stateReason: s.reason ?? null,
      updatedAt: "2000-01-01T00:00:00Z",
      body: `## Goal\n\nx\n\n## Design\n\n${lines.join("\n")}\n\n## Acceptance criteria\n\n- \`foo\` is renamed.\n\n## Decisions\n\nNone.\n\n## Out of scope\n\nNothing.\n`,
      labels: { nodes: [{ name: "ready" }] },
      blockedBy: {
        nodes: (s.blockedBy ?? []).map((b) => ({ number: b, state: stateOf.get(b), parent: null })),
      },
      blocking: { nodes: [] },
    };
  });
  const parent = {
    number: 1,
    url: "https://github.com/test/repo/issues/1",
    title: "Project",
    state: "OPEN",
    stateReason: null,
    updatedAt: "2000-01-01T00:00:00Z",
    body: parentBody,
    labels: { nodes: [] },
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    subIssues: { totalCount: nodes.length, nodes },
  };
  writeFileSync(issuesJson, `${JSON.stringify({ data: { repository: { issue: parent } } })}\n`);
};

const HEAD_LINES = "Base: `pj/1` from `main`\n";
const RM_LINE = "Roadmap: `roadmap.md` Committed\n";
const TAIL = "\n## Goal\n\nx\n\n## Order\n\n1. #2\n2. #3\n";

test("no roadmap file reads as no-file", () => {
  assert.equal(codes(), "no-file");
  assert.equal(roadmap().ok, false);
});

test("two roadmap files read as several-files", () => {
  writeRoadmap("## A\n");
  mkdirSync(join(work, "doc"));
  writeFileSync(join(work, "doc/ROADMAP.md"), "## B\n");
  assert.equal(codes(), "several-files");
  const d = roadmap();
  assert.deepEqual(d.files, ["roadmap.md", "doc/ROADMAP.md"]);
  assert.equal(d.path, null);
  rmSync(join(work, "doc"), { recursive: true });
});

test("a roadmap in the format lists its entries with their extents", () => {
  writeRoadmap("# Roadmap\n\nSome words.\n\n## First\n\nbody\n\n## Second\nlast line\n");
  const d = roadmap();
  assert.equal(d.ok, true, codes());
  assert.equal(d.path, "roadmap.md");
  assert.deepEqual(
    d.entries.map((e: { heading: string; start: number; end: number }) => [
      e.heading,
      e.start,
      e.end,
    ]),
    [
      ["First", 5, 8],
      ["Second", 9, 10],
    ],
  );
});

test("a ## line inside a code fence is no entry", () => {
  writeRoadmap("## First\n\n```\n## not an entry\n```\n\ntext\n");
  const d = roadmap();
  assert.deepEqual(
    d.entries.map((e: { heading: string }) => e.heading),
    ["First"],
  );
  assert.equal(d.entries[0].end, 7);
});

test("a ### heading stays inside its entry", () => {
  writeRoadmap("## First\n\n### Sub\n\nmore\n\n## Second\n");
  const d = roadmap();
  assert.deepEqual(
    d.entries.map((e: { heading: string; end: number }) => [e.heading, e.end]),
    [
      ["First", 6],
      ["Second", 7],
    ],
  );
  assert.equal(d.ok, true);
});

test("a duplicate heading is reported", () => {
  writeRoadmap("## A\n\n## B\n\n##   A  \n");
  assert.equal(codes(), "duplicate-heading");
  const d = roadmap();
  assert.deepEqual([d.reasons[0].line, d.reasons[0].heading], [5, "A"]);
  writeRoadmap("## A\n\n##\n\n##   \nx\n");
  assert.equal(codes(), "empty-heading,empty-heading");
  assert.equal(roadmap().entries.length, 1);
});

test("a # heading after the first entry is reported", () => {
  writeRoadmap("## A\n\n# Late title\n");
  assert.equal(codes(), "title-after-entry");
  writeRoadmap("# T\n\n# U\n\n## A\n");
  assert.equal(codes(), "several-titles");
  assert.equal(roadmap().reasons[0].line, 3);
});

test("a setext heading is reported", () => {
  writeRoadmap("## A\n\nSetext\n------\n");
  assert.equal(codes(), "setext-heading");
  writeRoadmap("# T\n\nA preamble\n===\n\n## A\n");
  assert.equal(codes(), "setext-heading");
  writeRoadmap("---\ntitle: x\n---\n\n## A\n");
  assert.equal(codes(), "");
  writeRoadmap("---\n## X\n# c1\n# c2\n---\n\n## A\n");
  assert.equal(codes(), "");
  assert.deepEqual(
    roadmap().entries.map((e: { heading: string }) => e.heading),
    ["A"],
  );
  writeRoadmap("## A\n\n1. step\n---\n\n2) step\n---\n");
  assert.equal(codes(), "");
});

test("a roadmap with no entry is in the format", () => {
  writeRoadmap("# Roadmap\n\nNothing left.\n");
  const d = roadmap();
  assert.equal(d.ok, true, codes());
  assert.deepEqual(d.entries, []);
});

test("--roadmap at a ref reads that ref and not the working tree", () => {
  writeRoadmap("## Committed\n");
  git(work, "add", "roadmap.md");
  git(work, "commit", "-q", "-m", "roadmap");
  writeRoadmap("## One\n\n## One\n");
  assert.equal(codes(), "duplicate-heading");
  assert.equal(codes("HEAD"), "");
  assert.equal(roadmap("HEAD").entries[0].heading, "Committed");
  assert.equal(codes("HEAD~1"), "no-file");
  assert.notEqual(run(["--roadmap", "no-such-ref"]).status, 0);
});

test("--roadmap outside a work tree is refused", () => {
  const plain = join(tmp, "plain");
  mkdirSync(plain);
  const result = spawnSync("bash", [script, "--roadmap"], {
    cwd: plain,
    env: { ...env, GIT_CEILING_DIRECTORIES: tmp },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
});

test("a parent without a Roadmap: line reads roadmap as null", () => {
  git(work, "checkout", "-q", "roadmap.md");
  git(work, "push", "-q", "origin", "main", "main:refs/heads/pj/1");
  setGraph(HEAD_LINES + TAIL, [
    { n: 2, state: "OPEN", files: ["src/app.ts"] },
    { n: 3, state: "OPEN", files: ["roadmap.md"] },
  ]);
  assert.equal(pj().parent.roadmap, null);
});

test("the Roadmap: line gives path and entry, and Base: still reads", () => {
  setGraph(HEAD_LINES + RM_LINE + TAIL, [
    { n: 2, state: "OPEN", files: ["src/app.ts"] },
    { n: 3, state: "OPEN", files: ["roadmap.md"] },
  ]);
  const { parent } = pj();
  assert.deepEqual([parent.roadmap.path, parent.roadmap.entry], ["roadmap.md", "Committed"]);
  assert.deepEqual([parent.base, parent.from], ["pj/1", "main"]);
});

test("the roadmap task is the one sub-issue that lists the roadmap file", () => {
  setGraph(HEAD_LINES + RM_LINE + TAIL, [
    { n: 2, state: "OPEN", files: ["src/app.ts"] },
    { n: 3, state: "OPEN", files: ["roadmap.md"] },
  ]);
  const { roadmap: line } = pj().parent;
  assert.deepEqual([line.task, line.tasks], [3, [3]]);
});

test("two sub-issues that list the roadmap file give task null and both in tasks", () => {
  setGraph(HEAD_LINES + RM_LINE + TAIL, [
    { n: 2, state: "OPEN", files: ["roadmap.md"] },
    { n: 3, state: "OPEN", files: ["roadmap.md"] },
  ]);
  const { roadmap: line } = pj().parent;
  assert.deepEqual([line.task, line.tasks], [null, [2, 3]]);
});

test("missing names the open sub-issues the roadmap task is not blocked by", () => {
  setGraph(HEAD_LINES + RM_LINE + TAIL, [
    { n: 2, state: "OPEN", files: ["src/app.ts"] },
    { n: 3, state: "OPEN", files: ["roadmap.md"] },
    { n: 4, state: "OPEN", files: ["src/b.ts"] },
    { n: 5, state: "OPEN", files: ["src/c.ts"] },
  ]);
  assert.deepEqual(pj().parent.roadmap.missing, [2, 4, 5]);
  setGraph(HEAD_LINES + RM_LINE + TAIL, [
    { n: 2, state: "OPEN", files: ["src/app.ts"] },
    { n: 3, state: "OPEN", files: ["roadmap.md"], blockedBy: [2] },
    { n: 4, state: "OPEN", files: ["src/b.ts"] },
  ]);
  assert.deepEqual(pj().parent.roadmap.missing, [4]);
});

test("--next sends a roadmap task with missing edges to the doctor as roadmap-edges", () => {
  setGraph(HEAD_LINES + RM_LINE + "\n## Goal\n\nx\n\n## Order\n\n1. #3\n2. #2\n", [
    { n: 2, state: "OPEN", files: ["src/app.ts"] },
    { n: 3, state: "OPEN", files: ["roadmap.md"] },
  ]);
  const d = pj("--next");
  assert.deepEqual([d.next, d.why, d.issue], ["doctor", "roadmap-edges", 3]);
});

test("--next answers workable for the roadmap task once missing is empty", () => {
  setGraph(HEAD_LINES + RM_LINE + "\n## Goal\n\nx\n\n## Order\n\n1. #3\n2. #2\n", [
    { n: 2, state: "CLOSED", reason: "COMPLETED", files: ["src/app.ts"] },
    { n: 3, state: "OPEN", files: ["roadmap.md"] },
  ]);
  const d = pj("--next");
  assert.deepEqual([d.next, d.why, d.issue], ["running", "workable", 3]);
});

test("--order-body keeps the Roadmap: line under Base:", () => {
  setGraph(HEAD_LINES + RM_LINE + TAIL, [
    { n: 2, state: "CLOSED", reason: "COMPLETED", files: ["src/app.ts"] },
    { n: 3, state: "OPEN", files: ["roadmap.md"] },
  ]);
  const result = run(["-R", "test/repo", "1", "--order-body"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.split("\n").slice(0, 2), [
    "Base: `pj/1` from `main`",
    "Roadmap: `roadmap.md` Committed",
  ]);
});

test("a malformed Roadmap: line reads as null (no backticked path; a path outside the six)", () => {
  const specs = [
    { n: 2, state: "CLOSED", reason: "COMPLETED", files: ["src/app.ts"] },
    { n: 3, state: "OPEN", files: ["roadmap.md"] },
  ];
  for (const line of [
    "Roadmap: roadmap.md Committed\n",
    "Roadmap: `notes.md` Committed\n",
    "Roadmap: `roadmap.md`\n",
  ]) {
    setGraph(HEAD_LINES + line + TAIL, specs);
    assert.equal(pj().parent.roadmap, null, line);
  }
});

test("--check passes the roadmap task while the entry stands at the ref", () => {
  setGraph(HEAD_LINES + RM_LINE + TAIL, [{ n: 3, state: "OPEN", files: ["roadmap.md"] }]);
  const { premises } = pj("--check", "3");
  assert.deepEqual([premises.mode, premises.failures], ["full", []]);
});

test("--check fails with roadmap entry not found once the entry is gone", () => {
  writeRoadmap("## Other\n");
  git(work, "commit", "-q", "-am", "entry gone");
  git(work, "push", "-q", "origin", "main:refs/heads/pj/1");
  setGraph(HEAD_LINES + RM_LINE + TAIL, [{ n: 3, state: "OPEN", files: ["roadmap.md"] }]);
  assert.deepEqual(
    pj("--check", "3").premises.failures.map((f: { path: string; why: string }) => [f.path, f.why]),
    [["roadmap.md", "roadmap entry not found"]],
  );
});
