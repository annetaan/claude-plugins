import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type IssueView,
  type ParentView,
  type Project,
  type SubIssueNode,
  findCycle,
  fingerprint,
  issueRecords,
  nextStep,
  orderGraph,
  runOrder,
} from "../plugins/annetaan/skills/pj1-plan/scripts/pure/project-view.ts";

const issue = (number: number, extra: Partial<IssueView> = {}): IssueView => ({
  number,
  title: `Task ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  wantedTitle: `Task ${number}`,
  state: "OPEN",
  stateReason: null,
  updatedAt: "2000-01-01T00:00:00Z",
  labels: ["ready"],
  blockedBy: [],
  blocking: [],
  stub: false,
  leftBroken: [],
  designPaths: [],
  decisions: { total: 0, settled: 0, open: 0, contradictory: 0 },
  lint: { ok: true, reasons: [] },
  pr: null,
  ...extra,
});

const parent = (extra: Partial<ParentView> = {}): ParentView => ({
  number: 1,
  title: "Project",
  url: "https://github.com/o/r/issues/1",
  state: "OPEN",
  stateReason: null,
  updatedAt: "2000-01-01T00:00:00Z",
  labels: ["project"],
  base: "pj/1",
  from: "main",
  baseExists: true,
  merged: false,
  projectPr: null,
  waitsOn: [],
  waitedOnBy: [],
  startable: false,
  order: [2],
  orderCheck: { ok: true, unknown: [], duplicate: [], early: [], missing: [] },
  roadmap: null,
  breakage: [],
  lint: { ok: true, reasons: [] },
  ...extra,
});

const view = (p: Partial<ParentView>, issues: readonly IssueView[] = [issue(2)]): Project => ({
  parent: parent(p),
  issues,
});

const why = (v: Project): readonly [string, string, number | null, string | null] => {
  const next = nextStep(v);
  return [next.next, next.why, next.issue, next.url];
};

const pr = (state: string) => ({ number: 9, state, isDraft: false, url: "https://x/pull/9" });
const waited = (merged: boolean) => ({
  number: 5,
  title: "Earlier",
  url: null,
  state: "OPEN",
  stateReason: null,
  base: "pj/5",
  merged,
});

test("nextStep gives each why", () => {
  const cases: readonly (readonly [
    Project,
    readonly [string, string, number | null, string | null],
  ])[] = [
    [view({ state: "CLOSED" }), ["done", "closed", null, null]],
    [view({ merged: true }), ["running", "merged-parent", null, null]],
    [view({}, []), ["user", "split", null, null]],
    [view({ baseExists: false, waitsOn: [waited(false)] }), ["user", "waits", null, null]],
    [view({}, [issue(2), issue(3, { pr: pr("MERGED") })]), ["running", "close-merged", 3, null]],
    [
      view({ projectPr: "https://x/pull/1" }, [issue(2, { state: "CLOSED" })]),
      ["user", "merge-project-pr", null, "https://x/pull/1"],
    ],
    [view({}, [issue(2, { state: "CLOSED" })]), ["running", "project-pr", null, null]],
    [view({ order: [] }), ["doctor", "order", null, null]],
    [view({}, [issue(2, { labels: ["blocker"] })]), ["doctor", "blocker", 2, null]],
    [view({}, [issue(2, { stub: true })]), ["doctor", "stub", 2, null]],
    [
      view({}, [issue(2, { decisions: { total: 1, settled: 0, open: 0, contradictory: 1 } })]),
      ["user", "contradictory", 2, null],
    ],
    [
      view({}, [issue(2, { decisions: { total: 1, settled: 0, open: 1, contradictory: 0 } })]),
      ["user", "decisions", 2, null],
    ],
    [view({}, [issue(2, { labels: [] })]), ["doctor", "not-ready", 2, null]],
    [
      view({}, [issue(2, { blockedBy: [{ number: 7, state: "OPEN", parent: 1 }] })]),
      ["doctor", "blocked", 2, null],
    ],
    [
      view({ roadmap: { path: "roadmap.md", entry: "X", tasks: [2], task: 2, missing: [3] } }),
      ["doctor", "roadmap-edges", 2, null],
    ],
    [view({}), ["running", "workable", 2, null]],
  ];
  for (const [v, want] of cases) {
    assert.deepEqual(why(v), want);
  }
});

test("the fingerprint is equal for equal views and differs when a label changes", () => {
  assert.equal(fingerprint(view({})), fingerprint(view({})));
  assert.notEqual(
    fingerprint(view({})),
    fingerprint(view({}, [issue(2, { labels: ["blocker"] })])),
  );
  assert.notEqual(fingerprint(view({})), fingerprint(view({ labels: ["project", "doing"] })));
  assert.match(fingerprint(view({})), /^[0-9a-f]{64}$/);
});

const node = (number: number, ...blockers: readonly number[]): SubIssueNode => ({
  number,
  url: `https://github.com/o/r/issues/${number}`,
  title: `Task ${number}`,
  state: "OPEN",
  stateReason: null,
  updatedAt: "2000-01-01T00:00:00Z",
  body: "To be drawn.",
  labels: { nodes: [] },
  blockedBy: { nodes: blockers.map((b) => ({ number: b, state: "OPEN", parent: { number: 1 } })) },
  blocking: { nodes: [] },
});

test("runOrder sorts numbers as numbers", () => {
  const graph = orderGraph(issueRecords([node(10), node(9), node(100)]), []);
  assert.deepEqual(runOrder(graph), { result: [9, 10, 100], cycle: [] });
  assert.deepEqual(
    runOrder(orderGraph(issueRecords([node(10), node(9), node(100, 9)]), [100, 9])).result,
    [9, 100, 10],
  );
});

test("findCycle names the cycle the blocked-by relationships make", () => {
  const graph = orderGraph(issueRecords([node(2, 3), node(3, 2), node(4)]), []);
  assert.deepEqual(runOrder(graph), { result: [4], cycle: [2, 3, 2] });
  assert.deepEqual(findCycle(graph, new Set([2, 3])), [2, 3, 2]);
  assert.deepEqual(findCycle(graph, new Set([4])), []);
});
