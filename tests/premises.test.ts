import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type PremiseFacts,
  holdsName,
  premises,
  rootFiles,
  symbolKey,
} from "../plugins/annetaan/skills/pj1-plan/scripts/pure/premises.ts";
import {
  type IssueRecord,
  type SubIssueNode,
  issueRecords,
  orderGraph,
} from "../plugins/annetaan/skills/pj1-plan/scripts/pure/project-view.ts";

const body = (design: string): string =>
  `## Goal\n\nx\n\n## Design\n\n${design}\n\n## Acceptance criteria\n\n- \`x\`\n\n## Decisions\n\nNone.\n\n## Out of scope\n\nz\n`;

const node = (
  number: number,
  design: string,
  blockers: readonly number[] = [],
  state = "OPEN",
): SubIssueNode => ({
  number,
  url: `https://github.com/o/r/issues/${number}`,
  title: `Task ${number}`,
  state,
  stateReason: state === "CLOSED" ? "COMPLETED" : null,
  updatedAt: "2000-01-01T00:00:00Z",
  body: body(design),
  labels: { nodes: [] },
  blockedBy: { nodes: blockers.map((b) => ({ number: b, state, parent: { number: 1 } })) },
  blocking: { nodes: [] },
});

const facts = (extra: Partial<PremiseFacts> = {}): PremiseFacts => ({
  baseExists: true,
  waitsOnMerged: true,
  historyUnknown: false,
  paths: new Set(),
  exists: new Set(["src/app.ts"]),
  found: new Set([symbolKey("src/app.ts", "foo")]),
  inHistory: new Set([symbolKey("src/app.ts", "oldName")]),
  roadmap: null,
  roadmapHeadings: [],
  ...extra,
});

const run = (nodes: readonly SubIssueNode[], n: number, extra: Partial<PremiseFacts> = {}) => {
  const graph = orderGraph(issueRecords(nodes), []);
  const issue = graph.byNumber.get(n) as IssueRecord;
  return premises(issue, graph, facts(extra));
};

test("a symbol found in the file passes in full mode", () => {
  assert.deepEqual(run([node(2, "- `src/app.ts` (changed): `foo`")], 2), {
    mode: "full",
    excusers: [],
    failures: [],
  });
});

test("a symbol gone from the file and one never in it fail with their why", () => {
  assert.deepEqual(run([node(2, "- `src/app.ts` (changed): `oldName` and `never`")], 2).failures, [
    { path: "src/app.ts", symbol: "oldName", why: "symbol not found" },
    { path: "src/app.ts", symbol: "never", why: "symbol never in the file" },
  ]);
  assert.deepEqual(
    run([node(2, "- `src/app.ts` (changed): `never`")], 2, { historyUnknown: true }).failures,
    [{ path: "src/app.ts", symbol: "never", why: "symbol not found" }],
  );
});

test("an added file that exists and a changed one that does not fail", () => {
  assert.deepEqual(
    run([node(2, "- `src/app.ts` (added): x\n- `src/new.ts` (changed): x")], 2).failures,
    [
      { path: "src/app.ts", why: "added, but already exists" },
      { path: "src/new.ts", why: "changed, but does not exist" },
    ],
  );
});

test("an open blocker that adds the file excuses it in early mode", () => {
  const got = run(
    [node(2, "- `src/new.ts` (changed): `bar`", [3]), node(3, "- `src/new.ts` (added): `bar`")],
    2,
  );
  assert.deepEqual(got, { mode: "early", excusers: [3], failures: [] });
});

test("a stub blocker, an outside open blocker or an unmerged wait give mode none", () => {
  assert.equal(
    run([node(2, "- `src/app.ts` (changed): `x`", [3]), node(3, "To be drawn.")], 2).mode,
    "none",
  );
  assert.equal(run([node(2, "- `src/app.ts` (changed): `x`", [9])], 2).mode, "none");
  assert.equal(
    run([node(2, "- `src/app.ts` (changed): `x`")], 2, {
      baseExists: false,
      waitsOnMerged: false,
    }).mode,
    "none",
  );
});

test("a roadmap entry missing at the ref fails", () => {
  assert.deepEqual(
    run([node(2, "- `roadmap.md` (changed): drops the entry")], 2, {
      exists: new Set(["roadmap.md"]),
      roadmap: { path: "roadmap.md", entry: "再試行" },
      roadmapHeadings: ["設計"],
    }).failures,
    [{ path: "roadmap.md", why: "roadmap entry not found" }],
  );
});

test("holdsName and rootFiles read git's text", () => {
  assert.equal(holdsName("export * from './app';\n"), false);
  assert.equal(holdsName("export function foo() {}\n"), true);
  assert.deepEqual(
    [...rootFiles("100644 blob abc\tREADME.md\x00040000 tree def\tsrc\x00")],
    ["README.md"],
  );
});
