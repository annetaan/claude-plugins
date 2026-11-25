import { createHash } from "node:crypto";
import {
  type BaseLine,
  type DecisionCounts,
  type FileEntry,
  type LintResult,
  type RoadmapLine,
  baseOf,
  decisionCounts,
  implementsOf,
  lint,
  parentLint,
  parseBody,
  titled,
} from "./issue-body.ts";

type Nodes<T> = { readonly nodes: readonly T[] };

export type SubIssueNode = {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly state: string;
  readonly stateReason?: string | null;
  readonly updatedAt: string;
  readonly body: string | null;
  readonly labels: Nodes<{ readonly name: string }>;
  readonly blockedBy: Nodes<{
    readonly number: number;
    readonly state: string;
    readonly parent?: { readonly number: number } | null;
  }>;
  readonly blocking: Nodes<{ readonly number: number }>;
};

export type BlockerNode = {
  readonly number: number;
  readonly url?: string;
  readonly title: string;
  readonly state: string;
  readonly stateReason?: string | null;
  readonly body: string | null;
};

export type ParentNode = {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly state: string;
  readonly stateReason?: string | null;
  readonly updatedAt: string;
  readonly body: string | null;
  readonly labels: Nodes<{ readonly name: string }>;
  readonly blockedBy: Nodes<BlockerNode>;
  readonly blocking: Nodes<{ readonly number: number; readonly body: string | null }>;
  readonly subIssues: { readonly totalCount: number } & Nodes<SubIssueNode>;
};

export type Blocker = {
  readonly number: number;
  readonly state: string;
  readonly parent: number | null;
};

export type IssueRecord = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly wantedTitle: string;
  readonly state: string;
  readonly stateReason: string | null;
  readonly updatedAt: string;
  readonly labels: readonly string[];
  readonly blockedBy: readonly Blocker[];
  readonly blocking: readonly number[];
  readonly stub: boolean;
  readonly files: readonly FileEntry[];
  readonly leftBroken: readonly string[];
  readonly criteria: readonly string[];
  readonly designPaths: readonly string[];
  readonly decisions: DecisionCounts;
  readonly lint: LintResult;
  readonly body: string | null;
};

export type PullRequest = {
  readonly number: number;
  readonly state: string;
  readonly isDraft: boolean;
  readonly url: string;
};

export type IssueView = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly wantedTitle: string;
  readonly state: string;
  readonly stateReason: string | null;
  readonly updatedAt: string;
  readonly labels: readonly string[];
  readonly blockedBy: readonly Blocker[];
  readonly blocking: readonly number[];
  readonly stub: boolean;
  readonly leftBroken: readonly string[];
  readonly designPaths: readonly string[];
  readonly decisions: DecisionCounts;
  readonly lint: LintResult;
  readonly pr: PullRequest | null;
};

export type Breakage = {
  readonly issue: number;
  readonly check: string;
  readonly closedBy: readonly number[];
  readonly state: "unclosed" | "planned" | "closed" | "open";
};

export type OrderCheck = {
  readonly ok: boolean;
  readonly unknown: readonly number[];
  readonly duplicate: readonly number[];
  readonly early: readonly { readonly number: number; readonly blocker: number }[];
  readonly missing: readonly number[];
};

export type RoadmapView = {
  readonly path: string;
  readonly entry: string;
  readonly tasks: readonly number[];
  readonly task: number | null;
  readonly missing: readonly number[];
};

export type WaitsOnEntry = {
  readonly number: number;
  readonly title: string;
  readonly url: string | null;
  readonly state: string;
  readonly stateReason: string | null;
  readonly base: string;
  readonly merged: boolean;
};

export type ParentView = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly stateReason: string | null;
  readonly updatedAt: string;
  readonly labels: readonly string[];
  readonly base: string;
  readonly from: string;
  readonly baseExists: boolean;
  readonly merged: boolean;
  readonly projectPr: string | null;
  readonly waitsOn: readonly WaitsOnEntry[];
  readonly waitedOnBy: readonly number[];
  readonly startable: boolean;
  readonly order: readonly number[];
  readonly orderCheck: OrderCheck;
  readonly roadmap: RoadmapView | null;
  readonly breakage: readonly Breakage[];
  readonly lint: LintResult;
};

export type Project = { readonly parent: ParentView; readonly issues: readonly IssueView[] };

export type Next = {
  readonly next: "doctor" | "running" | "user" | "done";
  readonly why: string;
  readonly issue: number | null;
  readonly url: string | null;
  readonly fingerprint: string;
};

const byNumber = (a: number, b: number): number => a - b;

const uniqueSorted = (numbers: Iterable<number>): readonly number[] =>
  [...new Set(numbers)].toSorted(byNumber);

export const issueRecords = (nodes: readonly SubIssueNode[]): readonly IssueRecord[] =>
  nodes
    .map((node): IssueRecord => {
      const parsed = parseBody(node.body);
      const counts = decisionCounts(parsed.decs);
      return {
        number: node.number,
        title: node.title,
        url: node.url,
        wantedTitle: titled(node.title, counts),
        state: node.state,
        stateReason: node.stateReason ?? null,
        updatedAt: node.updatedAt,
        labels: node.labels.nodes.map((label) => label.name),
        blockedBy: node.blockedBy.nodes.map((b) => ({
          number: b.number,
          state: b.state,
          parent: b.parent?.number ?? null,
        })),
        blocking: node.blocking.nodes.map((b) => b.number),
        stub: parsed.stub,
        files: parsed.files,
        leftBroken: parsed.broken,
        criteria: parsed.criteria,
        designPaths: parsed.files.map((f) => f.path),
        decisions: counts,
        lint: lint(parsed),
        body: node.body,
      };
    })
    .toSorted((a, b) => byNumber(a.number, b.number));

export const shown = (issue: IssueRecord, pr: PullRequest | null): IssueView => ({
  number: issue.number,
  title: issue.title,
  url: issue.url,
  wantedTitle: issue.wantedTitle,
  state: issue.state,
  stateReason: issue.stateReason,
  updatedAt: issue.updatedAt,
  labels: issue.labels,
  blockedBy: issue.blockedBy,
  blocking: issue.blocking,
  stub: issue.stub,
  leftBroken: issue.leftBroken,
  designPaths: issue.designPaths,
  decisions: issue.decisions,
  lint: issue.lint,
  pr,
});

export type PullRequestNode = {
  readonly number: number;
  readonly state: string;
  readonly isDraft: boolean;
  readonly url: string;
  readonly body?: string | null;
};

export const pullRequestsByIssue = (
  prs: readonly PullRequestNode[],
): ReadonlyMap<number, PullRequest> => {
  const found = new Map<
    number,
    { readonly key: readonly [boolean, number]; readonly pr: PullRequest }
  >();
  for (const pr of prs) {
    const n = implementsOf(pr.body ?? null);
    if (n === null || (pr.state !== "OPEN" && pr.state !== "MERGED")) {
      continue;
    }
    const key = [pr.state !== "OPEN", pr.number] as const;
    const held = found.get(n);
    if (held === undefined || (key[0] !== held.key[0] ? !key[0] : key[1] < held.key[1])) {
      found.set(n, {
        key,
        pr: { number: pr.number, state: pr.state, isDraft: pr.isDraft, url: pr.url },
      });
    }
  }
  return new Map(
    [...found].map(([n, entry]: readonly [number, { readonly pr: PullRequest }]) => [n, entry.pr]),
  );
};

export type Graph = {
  readonly issues: readonly IssueRecord[];
  readonly byNumber: ReadonlyMap<number, IssueRecord>;
  readonly written: readonly number[];
  readonly position: ReadonlyMap<number, number>;
  readonly open: readonly number[];
  readonly waitsOn: ReadonlyMap<number, readonly number[]>;
  readonly unblocks: ReadonlyMap<number, readonly number[]>;
};

export const orderGraph = (issues: readonly IssueRecord[], written: readonly number[]): Graph => {
  const position = new Map<number, number>();
  for (const [k, n] of written.entries()) {
    if (!position.has(n)) {
      position.set(n, k);
    }
  }
  const open = issues.filter((i) => i.state === "OPEN").map((i) => i.number);
  const openSet = new Set(open);
  const index = new Map(issues.map((i) => [i.number, i]));
  const waitsOn = new Map(
    open.map((n) => [
      n,
      uniqueSorted(
        (index.get(n)?.blockedBy ?? []).map((b) => b.number).filter((b) => openSet.has(b)),
      ),
    ]),
  );
  const unblocks = new Map<number, number[]>(open.map((n) => [n, []]));
  for (const [n, deps] of waitsOn) {
    for (const d of deps) {
      unblocks.get(d)?.push(n);
    }
  }
  return { issues, byNumber: index, written, position, open, waitsOn, unblocks };
};

export const transitiveBlockers = (
  issue: IssueRecord,
  index: ReadonlyMap<number, IssueRecord>,
): ReadonlySet<number> => {
  const seen = new Set<number>();
  const todo = issue.blockedBy.map((b) => b.number);
  for (let m = todo.pop(); m !== undefined; m = todo.pop()) {
    if (seen.has(m)) {
      continue;
    }
    seen.add(m);
    todo.push(...(index.get(m)?.blockedBy ?? []).map((b) => b.number));
  }
  return seen;
};

export const breakageView = (graph: Graph): readonly Breakage[] => {
  const live = graph.issues.filter((i) => i.state === "OPEN" || i.stateReason === "COMPLETED");
  return live.flatMap((i) =>
    i.leftBroken.map((check): Breakage => {
      const closedBy = live
        .filter(
          (j) =>
            j.number !== i.number &&
            transitiveBlockers(j, graph.byNumber).has(i.number) &&
            j.criteria.includes(check),
        )
        .map((j) => j.number)
        .toSorted(byNumber);
      const state =
        closedBy.length === 0
          ? "unclosed"
          : i.state === "OPEN"
            ? "planned"
            : closedBy.some((c) => graph.byNumber.get(c)?.state === "CLOSED")
              ? "closed"
              : "open";
      return { issue: i.number, check, closedBy, state };
    }),
  );
};

export const findCycle = (graph: Graph, nodes: ReadonlySet<number>): readonly number[] => {
  const state = new Map<number, 1 | 2>();
  const depsOf = (n: number): readonly number[] => graph.waitsOn.get(n) ?? [];
  for (const start of [...nodes].toSorted(byNumber)) {
    if (state.has(start)) {
      continue;
    }
    const stack: { readonly n: number; next: number }[] = [{ n: start, next: 0 }];
    const path = [start];
    state.set(start, 1);
    for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
      const deps = depsOf(top.n);
      let nxt: number | undefined;
      while (top.next < deps.length) {
        const d = deps[top.next];
        top.next += 1;
        if (d !== undefined && nodes.has(d)) {
          nxt = d;
          break;
        }
      }
      if (nxt === undefined) {
        state.set(top.n, 2);
        stack.pop();
        path.pop();
      } else if (state.get(nxt) === 1) {
        return [...path.slice(path.indexOf(nxt)), nxt];
      } else if (!state.has(nxt)) {
        state.set(nxt, 1);
        stack.push({ n: nxt, next: 0 });
        path.push(nxt);
      }
    }
  }
  return [];
};

const waitingCount = (graph: Graph, n: number): number => {
  const seen = new Set<number>();
  const visit = (m: number): void => {
    for (const k of graph.unblocks.get(m) ?? []) {
      if (!seen.has(k)) {
        seen.add(k);
        visit(k);
      }
    }
  };
  visit(n);
  return seen.size;
};

export const runOrder = (
  graph: Graph,
): { readonly result: readonly number[]; readonly cycle: readonly number[] } => {
  const left = new Map(
    [...graph.waitsOn].map(([n, deps]: readonly [number, readonly number[]]) => [n, deps.length]),
  );
  const result: number[] = [];
  let free = [...left]
    .filter(([, c]: readonly [number, number]) => c === 0)
    .map(([n]: readonly [number, number]) => n);
  const rank = (n: number): readonly [number, number, number] => [
    graph.position.get(n) ?? graph.written.length,
    -waitingCount(graph, n),
    n,
  ];
  while (free.length > 0) {
    free = free.toSorted((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2];
    });
    const [n, ...rest] = free;
    if (n === undefined) {
      break;
    }
    free = rest;
    result.push(n);
    for (const m of graph.unblocks.get(n) ?? []) {
      const count = (left.get(m) ?? 0) - 1;
      left.set(m, count);
      if (count === 0) {
        free.push(m);
      }
    }
  }
  if (result.length < graph.open.length) {
    const done = new Set(result);
    return { result, cycle: findCycle(graph, new Set(graph.open.filter((n) => !done.has(n)))) };
  }
  return { result, cycle: [] };
};

export const orderCheck = (graph: Graph): OrderCheck => {
  const early = graph.open.flatMap((n) => {
    const at = graph.position.get(n);
    if (at === undefined) {
      return [];
    }
    return (graph.waitsOn.get(n) ?? [])
      .filter((b) => {
        const there = graph.position.get(b);
        return there !== undefined && there > at;
      })
      .map((blocker) => ({ number: n, blocker }));
  });
  const unknown = uniqueSorted(graph.written.filter((n) => !graph.byNumber.has(n)));
  const duplicate = uniqueSorted(
    graph.written.filter((n) => graph.written.filter((m) => m === n).length > 1),
  );
  return {
    ok: unknown.length === 0 && duplicate.length === 0 && early.length === 0,
    unknown,
    duplicate,
    early,
    missing: graph.open.toSorted(byNumber).filter((n) => !graph.position.has(n)),
  };
};

export const roadmapView = (line: RoadmapLine | null, graph: Graph): RoadmapView | null => {
  if (line === null) {
    return null;
  }
  const tasks = graph.issues
    .filter(
      (i) =>
        i.designPaths.includes(line.path) && (i.state === "OPEN" || i.stateReason === "COMPLETED"),
    )
    .map((i) => i.number);
  const task = tasks.length === 1 ? (tasks[0] ?? null) : null;
  const record = task === null ? undefined : graph.byNumber.get(task);
  let missing: readonly number[] = [];
  if (record !== undefined && record.state === "OPEN") {
    const blockers = new Set(record.blockedBy.map((b) => b.number));
    missing = graph.open.filter((n) => n !== task && !blockers.has(n)).toSorted(byNumber);
  }
  return { path: line.path, entry: line.entry, tasks, task, missing };
};

export const merged = (
  issue: { readonly state: string; readonly stateReason?: string | null },
  states: readonly string[],
  reached: boolean,
): boolean => {
  if (issue.state === "CLOSED") {
    return issue.stateReason === "COMPLETED";
  }
  return states.length > 0 && states.every((s) => s === "CLOSED") && reached;
};

export const orderList = (graph: Graph, result: readonly number[]): readonly number[] => {
  const done: number[] = [];
  for (const n of [...graph.written, ...graph.issues.map((i) => i.number)]) {
    const i = graph.byNumber.get(n);
    if (i?.state === "CLOSED" && i.stateReason === "COMPLETED" && !done.includes(n)) {
      done.push(n);
    }
  }
  return [...done, ...result];
};

export type Stand = { readonly exists: boolean; readonly reached: boolean };

export type ViewInput = {
  readonly parent: ParentNode;
  readonly line: BaseLine;
  readonly roadmap: RoadmapLine | null;
  readonly graph: Graph;
  readonly prs: ReadonlyMap<number, PullRequest>;
  readonly own: Stand & { readonly openPr: string | null };
  readonly waitsOn: readonly WaitsOnEntry[];
};

export const waitsOnEntry = (
  dep: BlockerNode,
  states: readonly string[],
  reached: boolean,
): WaitsOnEntry => ({
  number: dep.number,
  title: dep.title,
  url: dep.url ?? null,
  state: dep.state,
  stateReason: dep.stateReason ?? null,
  base: baseOf(dep.body)?.base ?? "",
  merged: merged(dep, states, reached),
});

export const projectView = (input: ViewInput): Project => {
  const { parent, graph } = input;
  return {
    parent: {
      number: parent.number,
      title: parent.title,
      url: parent.url,
      state: parent.state,
      stateReason: parent.stateReason ?? null,
      updatedAt: parent.updatedAt,
      labels: parent.labels.nodes.map((label) => label.name),
      base: input.line.base,
      from: input.line.from,
      baseExists: input.own.exists,
      merged: merged(
        parent,
        graph.issues.map((i) => i.state),
        input.own.reached,
      ),
      projectPr: input.own.openPr,
      waitsOn: input.waitsOn,
      waitedOnBy: parent.blocking.nodes.filter((b) => baseOf(b.body) !== null).map((b) => b.number),
      startable:
        parent.state === "OPEN" &&
        graph.issues.length === 0 &&
        input.waitsOn.every((d) => d.merged),
      order: graph.written,
      orderCheck: orderCheck(graph),
      roadmap: roadmapView(input.roadmap, graph),
      breakage: breakageView(graph),
      lint: parentLint(parseBody(parent.body)),
    },
    issues: graph.issues.map((i) => shown(i, input.prs.get(i.number) ?? null)),
  };
};

export const projectCycle = (
  start: number,
  deps: ReadonlyMap<number, readonly number[]>,
): readonly number[] => {
  const done = new Set<number>();
  const path: number[] = [];
  const visit = (n: number): readonly number[] => {
    path.push(n);
    for (const m of (deps.get(n) ?? []).toSorted(byNumber)) {
      if (path.includes(m)) {
        return [...path.slice(path.indexOf(m)), m];
      }
      if (!done.has(m)) {
        const found = visit(m);
        if (found.length > 0) {
          return found;
        }
      }
    }
    path.pop();
    done.add(n);
    return [];
  };
  return visit(start);
};

export const fingerprint = (view: Project): string => {
  const state = {
    parent: {
      updatedAt: view.parent.updatedAt,
      state: view.parent.state,
      labels: view.parent.labels,
    },
    issues: view.issues.map((i) => ({
      number: i.number,
      state: i.state,
      updatedAt: i.updatedAt,
      labels: i.labels,
      pr: i.pr === null ? null : { number: i.pr.number, state: i.pr.state },
    })),
    projectPr: view.parent.projectPr,
  };
  return createHash("sha256").update(JSON.stringify(state)).digest("hex");
};

export const nextStep = (view: Project): Next => {
  const p = view.parent;
  const out = (
    next: Next["next"],
    why: string,
    issue: number | null = null,
    url: string | null = null,
  ): Next => ({ next, why, issue, url, fingerprint: fingerprint(view) });
  if (p.state === "CLOSED") {
    return out("done", "closed");
  }
  if (p.merged) {
    return out("running", "merged-parent");
  }
  if (view.issues.length === 0) {
    return out("user", "split");
  }
  if (!p.baseExists && p.waitsOn.some((d) => !d.merged)) {
    return out("user", "waits");
  }
  const openSubs = view.issues.filter((i) => i.state === "OPEN");
  const donePrs = openSubs.filter((i) => i.pr?.state === "MERGED").map((i) => i.number);
  if (donePrs.length > 0) {
    return out("running", "close-merged", Math.min(...donePrs));
  }
  if (openSubs.length === 0) {
    return p.projectPr === null
      ? out("running", "project-pr")
      : out("user", "merge-project-pr", null, p.projectPr);
  }
  const index = new Map(openSubs.map((i) => [i.number, i]));
  const inOrder = p.order.flatMap((n) => {
    const i = index.get(n);
    return i === undefined ? [] : [i];
  });
  const k = inOrder[0];
  if (!p.orderCheck.ok || k === undefined) {
    return out("doctor", "order");
  }
  const n = k.number;
  if (k.labels.includes("blocker")) {
    return out("doctor", "blocker", n);
  }
  if (k.stub) {
    return out("doctor", "stub", n);
  }
  if (k.decisions.contradictory > 0) {
    return out("user", "contradictory", n);
  }
  if (k.decisions.open > 0) {
    return out("user", "decisions", n);
  }
  if (!k.labels.includes("ready")) {
    return out("doctor", "not-ready", n);
  }
  if (k.blockedBy.some((b) => b.state === "OPEN")) {
    return out("doctor", "blocked", n);
  }
  const rm = p.roadmap;
  if (rm !== null && rm.task === n && rm.missing.length > 0) {
    return out("doctor", "roadmap-edges", n);
  }
  return out("running", "workable", n);
};
