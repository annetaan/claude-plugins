import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { run, type RunResult } from "../../../scripts/command.ts";
import { fetchBranch } from "../../../scripts/fetch.ts";
import { Failure, UsageError, entry } from "../../../scripts/status.ts";
import {
  type BaseLine,
  type RoadmapLine,
  approvedDesign,
  baseOf,
  isDocument,
  lint,
  decisionCounts,
  orderOf,
  parentLint,
  parseBody,
  roadmapOf,
  sameWords,
  symbols,
  withOrder,
  withSections,
} from "./pure/issue-body.ts";
import {
  type BlockerNode,
  type Graph,
  type IssueView,
  type Next,
  type ParentNode,
  type Project,
  type PullRequest,
  type PullRequestNode,
  type Stand,
  issueRecords,
  nextStep,
  orderGraph,
  orderList,
  projectCycle,
  projectView,
  pullRequestsByIssue,
  roadmapView,
  runOrder,
  shown,
  transitiveBlockers,
  waitsOnEntry,
  breakageView,
} from "./pure/project-view.ts";
import { holdsName, premises, rootFiles, symbolKey } from "./pure/premises.ts";
import { ROADMAP_PATHS, roadmapFiles, roadmapParse } from "./pure/roadmap-file.ts";

const USAGE = `usage: project.sh [-R <owner/repo>] <parent>               the whole project, as JSON
       project.sh [-R <owner/repo>] <parent> --order       the run order, and the ## Order list to write, as JSON
       project.sh [-R <owner/repo>] <parent> --next        what to run next on the project, as JSON
       project.sh [-R <owner/repo>] <parent> --check <n> [<n>...]
                                                           whether each sub-issue can be implemented from its body now,
                                                           one JSON object per line
       project.sh [-R <owner/repo>] <parent> --order-body  the parent body with its ## Order list replaced, as text
       project.sh [-R <owner/repo>] <parent> --parent-body <file>
                                                           the parent body with everything from ## Goal on replaced by
                                                           <file>, as text
       project.sh [-R <owner/repo>] <parent> --design <n>  the approved design of sub-issue <n>, as Markdown text
       project.sh --lint <file|->                          lint one sub-issue body, read from a file or standard input
       project.sh --parent-lint <file|->                   lint one parent body, read from a file or standard input
       project.sh --same-words <before> <after>            whether two bodies differ in backticks and whitespace only
       project.sh --roadmap [<ref>]                        check the roadmap file, in the work tree or at <ref>, as JSON
  -R <owner/repo>   read another repository (default: the repository of the current directory)
--order exits non-zero and names the cycle when the blocked-by relationships have one,
        or when the projects wait on each other.
--next reads only. It prints what to run next (doctor, running, user or done), why, and a fingerprint of the state.
--check runs inside a work tree of a clone of the repository, from any directory in it. It fetches the branch the base was made from,
        and the base branch once it exists. The parent comes before --check. It reads GitHub and fetches once whatever
        the count, and dies before printing anything when a number is no sub-issue.
--order-body prints the parent body as GitHub has it now, with the lines under ## Order replaced by the list --order
        writes. It fails like --order when the blocked-by relationships have a cycle.
--parent-body reads the parent only. It prints the lines above the parent's first ## Goal outside a code fence, then
        <file>, which has to start at ## Goal.
--design reads the parent's query only and writes nothing. It dies when <n> is no sub-issue of the parent, or when
        a decision of <n> is open or contradictory.
--lint and --parent-lint touch neither GitHub nor git and always exit 0.
--same-words touches neither GitHub nor git and always exits 0 on two readable files, printing {"ok", "lint"}: ok is
        true when the two bodies have the same words once backticks are gone and whitespace is one space, and lint is
        the lint of <after>.
--roadmap runs inside a work tree, reads no parent and touches no GitHub, and always exits 0 on a readable roadmap,
        printing {"ok", "files", "path", "entries", "reasons"}. It dies outside a work tree and on a ref git cannot read.
`;

const PARENT_QUERY = `
query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $n) {
      number url title state stateReason updatedAt body
      labels(first: 50) { nodes { name } }
      blockedBy(first: 50) { nodes { number url title state stateReason body } }
      blocking(first: 50) { nodes { number body } }
      subIssues(first: 100) {
        totalCount
        nodes {
          number url title state stateReason updatedAt body
          labels(first: 50) { nodes { name } }
          blockedBy(first: 50) { nodes { number state parent { number } } }
          blocking(first: 50) { nodes { number } }
        }
      }
    }
  }
}`;

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

const DIGITS = /^[0-9]+$/;

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const gh = (args: readonly string[], where: string): RunResult => {
  const result = run(["gh", ...args], { cwd: where });
  if (result.code === 127) {
    throw new Failure("gh is not installed");
  }
  return result;
};

type Repo = { readonly full: string; readonly owner: string; readonly name: string };

const repoOf = (full: string): Repo => {
  const slash = full.indexOf("/");
  if (slash === -1) {
    throw new Failure(`the repository must read <owner/repo>: ${full}`);
  }
  return { full, owner: full.slice(0, slash), name: full.slice(slash + 1) };
};

const repoIn = (where: string): Repo => {
  const result = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], where);
  if (result.code !== 0) {
    throw new Failure(
      "cannot tell the repository. run this inside a clone or pass -R <owner/repo>",
    );
  }
  return repoOf(result.stdout.replace(/\n+$/u, ""));
};

type Data<T> = { readonly data?: { readonly repository?: T | null } | null };

const parsed = <T>(text: string): T | null => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

type Loaded = {
  readonly repo: Repo;
  readonly where: string;
  readonly parent: ParentNode;
  readonly line: BaseLine;
  readonly roadmap: RoadmapLine | null;
};

const load = (repo: Repo, n: number, where: string): Loaded => {
  const result = gh(
    [
      "api",
      "graphql",
      "-F",
      `owner=${repo.owner}`,
      "-F",
      `name=${repo.name}`,
      "-F",
      `n=${n}`,
      "-f",
      `query=${PARENT_QUERY}`,
    ],
    where,
  );
  const data =
    result.code === 0 ? parsed<Data<{ readonly issue?: ParentNode | null }>>(result.stdout) : null;
  if (data === null) {
    throw new Failure(`cannot read issue #${n} in ${repo.full}`);
  }
  const parent = data.data?.repository?.issue ?? null;
  if (parent === null) {
    throw new Failure("no such issue");
  }
  if (parent.subIssues.totalCount > parent.subIssues.nodes.length) {
    throw new Failure("more than 100 sub-issues. this script reads the first 100 only");
  }
  const named = baseOf(parent.body);
  if (named === null) {
    throw new Failure(`#${parent.number} has no Base: line`);
  }
  return { repo, where, parent, line: named, roadmap: roadmapOf(parent.body) };
};

type Graphql = Readonly<Record<string, unknown>>;

const graphql = (
  loaded: Loaded,
  fields: string,
  ints: ReadonlyMap<string, number>,
  strs: ReadonlyMap<string, string>,
  what: string,
): Graphql => {
  const decls = [
    "$owner: String!",
    "$name: String!",
    ...[...ints.keys()].map((k) => `$${k}: Int!`),
    ...[...strs.keys()].map((k) => `$${k}: String!`),
  ];
  const result = gh(
    [
      "api",
      "graphql",
      "-f",
      `owner=${loaded.repo.owner}`,
      "-f",
      `name=${loaded.repo.name}`,
      ...[...ints].flatMap(([k, v]) => ["-F", `${k}=${v}`]),
      ...[...strs].flatMap(([k, v]) => ["-f", `${k}=${v}`]),
      "-f",
      `query=query(${decls.join(", ")}) { repository(owner: $owner, name: $name) { ${fields} } }`,
    ],
    loaded.where,
  );
  if (result.code !== 0) {
    throw new Failure(`cannot ${what}: ${result.stderr.trim()}`);
  }
  return parsed<Data<Graphql>>(result.stdout)?.data?.repository ?? {};
};

const waitsOnParents = (
  number: number,
  blockers: readonly BlockerNode[],
): ReadonlyMap<number, BlockerNode> => {
  const out = new Map<number, BlockerNode>();
  for (const b of blockers) {
    if (b.number === number) {
      continue;
    }
    if (baseOf(b.body) === null) {
      throw new Failure(`#${number} is blocked by #${b.number}, which is no project`);
    }
    out.set(b.number, b);
  }
  return out;
};

const sortedDeps = (deps: ReadonlyMap<number, BlockerNode>): readonly BlockerNode[] =>
  [...deps.keys()]
    .toSorted((a, b) => a - b)
    .flatMap((k) => {
      const dep = deps.get(k);
      return dep === undefined ? [] : [dep];
    });

const graphOf = (loaded: Loaded): Graph =>
  orderGraph(issueRecords(loaded.parent.subIssues.nodes), orderOf(loaded.parent.body));

const pullRequests = (loaded: Loaded): ReadonlyMap<number, PullRequest> => {
  const base = loaded.line.base;
  const result = gh(
    [
      "pr",
      "list",
      "-R",
      loaded.repo.full,
      "--base",
      base,
      "--state",
      "all",
      "--limit",
      "500",
      "--json",
      "number,state,isDraft,url,body",
    ],
    loaded.where,
  );
  if (result.code !== 0) {
    throw new Failure(
      `cannot list the pull requests into ${base} in ${loaded.repo.full}: ${result.stderr.trim()}`,
    );
  }
  return pullRequestsByIssue(parsed<readonly PullRequestNode[]>(result.stdout) ?? []);
};

type Field = { readonly totalCount?: number; readonly nodes?: readonly unknown[] } | null;

const fieldOf = (r: Graphql, key: string): Field => (r[key] ?? null) as Field;

const stand = (r: Graphql, k: string): Stand => {
  const ref = r[`r${k}`] as { readonly compare?: { readonly status?: string } | null } | null;
  const status = ref?.compare?.status;
  return {
    exists: ref !== null && ref !== undefined,
    reached:
      (fieldOf(r, `m${k}`)?.totalCount ?? 0) > 0 || status === "AHEAD" || status === "IDENTICAL",
  };
};

type DepBranch = { readonly number: number; readonly base: string; readonly from: string };

const branches = (
  loaded: Loaded,
  deps: readonly DepBranch[],
): {
  readonly own: Stand & { readonly openPr: string | null };
  readonly deps: ReadonlyMap<number, Stand & { readonly states: readonly string[] }>;
} => {
  const fields: string[] = [];
  const strs = new Map<string, string>();
  const ints = new Map<string, number>();
  const refFields = (k: string, b: string, f: string, openPr: boolean): void => {
    strs.set(`q${k}`, `refs/heads/${b}`);
    strs.set(`b${k}`, b);
    strs.set(`f${k}`, f);
    fields.push(`r${k}: ref(qualifiedName: $q${k}) { compare(headRef: $f${k}) { status } }`);
    fields.push(
      `m${k}: pullRequests(headRefName: $b${k}, baseRefName: $f${k}, states: [MERGED], first: 1) { totalCount }`,
    );
    if (openPr) {
      fields.push(
        `p${k}: pullRequests(headRefName: $b${k}, baseRefName: $f${k}, states: [OPEN], first: 1) { nodes { url } }`,
      );
    }
  };
  refFields("o", loaded.line.base, loaded.line.from, true);
  for (const [k, dep] of deps.entries()) {
    ints.set(`n${k}`, dep.number);
    fields.push(
      `d${k}: issue(number: $n${k}) { subIssues(first: 100) { totalCount nodes { state } } }`,
    );
    refFields(String(k), dep.base, dep.from, false);
  }
  const r = graphql(loaded, fields.join(" "), ints, strs, "read the branches of the projects");
  const out = new Map<number, Stand & { readonly states: readonly string[] }>();
  for (const [k, dep] of deps.entries()) {
    const subs = (r[`d${k}`] as { readonly subIssues?: Field } | null)?.subIssues ?? null;
    const nodes = (subs?.nodes ?? []) as readonly { readonly state: string }[];
    if ((subs?.totalCount ?? 0) > nodes.length) {
      throw new Failure(
        `#${dep.number} has more than 100 sub-issues. this script reads the first 100 only`,
      );
    }
    out.set(dep.number, { ...stand(r, String(k)), states: nodes.map((s) => s.state) });
  }
  const openPrs = (fieldOf(r, "po")?.nodes ?? []) as readonly { readonly url: string }[];
  return { own: { ...stand(r, "o"), openPr: openPrs[0]?.url ?? null }, deps: out };
};

type Viewed = {
  readonly view: Project;
  readonly graph: Graph;
  readonly baseExists: boolean;
  readonly waitsOnMerged: boolean;
};

const viewOf = (loaded: Loaded): Viewed => {
  const graph = graphOf(loaded);
  const depList = sortedDeps(waitsOnParents(loaded.parent.number, loaded.parent.blockedBy.nodes));
  const prs = pullRequests(loaded);
  const openDeps = depList.flatMap((d) => {
    const named = d.state === "OPEN" ? baseOf(d.body) : null;
    return named === null ? [] : [{ number: d.number, base: named.base, from: named.from }];
  });
  const stood = branches(loaded, openDeps);
  const waitsOn = depList.map((d) => {
    const st = stood.deps.get(d.number);
    return waitsOnEntry(d, st?.states ?? [], st?.reached ?? false);
  });
  const view = projectView({
    parent: loaded.parent,
    line: loaded.line,
    roadmap: loaded.roadmap,
    graph,
    prs,
    own: stood.own,
    waitsOn,
  });
  return {
    view,
    graph,
    baseExists: stood.own.exists,
    waitsOnMerged: waitsOn.every((d) => d.merged),
  };
};

export type OrderResult =
  | {
      readonly kind: "order";
      readonly order: readonly IssueView[];
      readonly list: readonly number[];
      readonly body: string;
    }
  | { readonly kind: "cycle"; readonly message: string };

const projectDeps = (loaded: Loaded): ReadonlyMap<number, readonly number[]> => {
  const deps = new Map<number, readonly number[]>([
    [
      loaded.parent.number,
      [...waitsOnParents(loaded.parent.number, loaded.parent.blockedBy.nodes).keys()],
    ],
  ]);
  const todo = [...(deps.get(loaded.parent.number) ?? [])];
  for (let n = todo.shift(); n !== undefined; n = todo.shift()) {
    if (deps.has(n)) {
      continue;
    }
    const r = graphql(
      loaded,
      "p: issue(number: $n) { blockedBy(first: 50) { nodes { number title state stateReason body } } }",
      new Map([["n", n]]),
      new Map(),
      `read project #${n}`,
    );
    const p = r["p"] as { readonly blockedBy?: { readonly nodes?: readonly BlockerNode[] } } | null;
    const found = [...waitsOnParents(n, p?.blockedBy?.nodes ?? []).keys()];
    deps.set(n, found);
    todo.push(...found);
  }
  return deps;
};

const orderFor = (loaded: Loaded): OrderResult => {
  const graph = graphOf(loaded);
  waitsOnParents(loaded.parent.number, loaded.parent.blockedBy.nodes);
  const prs = pullRequests(loaded);
  const { result, cycle } = runOrder(graph);
  if (cycle.length > 0) {
    return {
      kind: "cycle",
      message: `the blocked-by relationships have a cycle: ${cycle.map((n) => `#${n}`).join(" blocked by ")}`,
    };
  }
  const projects = projectCycle(loaded.parent.number, projectDeps(loaded));
  if (projects.length > 0) {
    return {
      kind: "cycle",
      message: `the projects have a cycle: ${projects.map((n) => `#${n}`).join(" waits on ")}`,
    };
  }
  const list = orderList(graph, result);
  return {
    kind: "order",
    order: result.flatMap((n) => {
      const record = graph.byNumber.get(n);
      return record === undefined ? [] : [shown(record, prs.get(n) ?? null)];
    }),
    list,
    body: withOrder(loaded.parent.body, list),
  };
};

const designFor = (loaded: Loaded, n: number): string => {
  const graph = graphOf(loaded);
  const deps = sortedDeps(waitsOnParents(loaded.parent.number, loaded.parent.blockedBy.nodes));
  const record = graph.byNumber.get(n);
  if (record === undefined) {
    throw new Failure(`#${n} is not a sub-issue of #${loaded.parent.number}`);
  }
  const counts = record.decisions;
  if (counts.open > 0 || counts.contradictory > 0) {
    throw new Failure(
      `#${n} has decisions not settled: ${counts.open} open, ${counts.contradictory} contradictory`,
    );
  }
  return approvedDesign(
    { number: n, title: record.title, body: record.body },
    { number: loaded.parent.number, title: loaded.parent.title, body: loaded.parent.body },
    deps.map((d) => ({ number: d.number, title: d.title, body: d.body })),
    breakageView(graph)
      .filter((b) => b.state === "open" && !b.closedBy.includes(n))
      .map((b) => ({ check: b.check, issue: b.issue })),
  );
};

const gitAt = (top: string, args: readonly string[]): RunResult =>
  run(["git", ...args], { cwd: top });

const checkFor = (loaded: Loaded, numbers: readonly number[]): string => {
  const top = gitAt(loaded.where, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) {
    throw new Failure(
      `--check runs inside a work tree of a clone of ${loaded.repo.owner}/${loaded.repo.name}`,
    );
  }
  const viewed = viewOf(loaded);
  const where = top.stdout.trim();
  const { graph } = viewed;
  for (const n of numbers) {
    if (!graph.byNumber.has(n)) {
      throw new Failure(`#${n} is not a sub-issue of #${loaded.parent.number}`);
    }
  }
  const { base, from } = loaded.line;
  for (const branch of [from, ...(viewed.baseExists ? [base] : [])]) {
    const fetched = fetchBranch(where, branch);
    if (fetched.code !== 0) {
      throw new Failure(`cannot fetch ${branch} from origin: ${fetched.stderr.trim()}`);
    }
  }
  const ref = `origin/${viewed.baseExists ? base : from}`;
  const historyUnknown =
    gitAt(where, ["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true";
  const tree = gitAt(where, ["ls-tree", "-z", ref]);
  if (tree.code !== 0) {
    throw new Failure(`git ls-tree failed: ${tree.stderr.trim()}`);
  }
  const root = rootFiles(tree.stdout);
  const unclosed = breakageView(graph)
    .filter((b) => b.state === "unclosed")
    .map((b) => ({ issue: b.issue, check: b.check }));
  const rv = roadmapView(loaded.roadmap, graph);
  const several = rv !== null && rv.tasks.length > 1 ? rv.tasks : [];
  const show = (path: string): RunResult => gitAt(where, ["show", `${ref}:${path}`]);
  return numbers
    .map((n) => {
      const issue = graph.byNumber.get(n);
      if (issue === undefined) {
        return "";
      }
      const mine = several.includes(n) ? several : [];
      const paths = new Set([
        ...root,
        ...[...transitiveBlockers(issue, graph.byNumber)].flatMap(
          (m) => graph.byNumber.get(m)?.files.map((f) => f.path) ?? [],
        ),
        ...issue.files.map((f) => f.path),
      ]);
      const holding = new Set(
        issue.files
          .filter((f) => f.kind === "changed" && !isDocument(f.path))
          .filter((f) => {
            const shown = show(f.path);
            return shown.code === 0 && holdsName(shown.stdout);
          })
          .map((f) => f.path),
      );
      const checkLint = lint(parseBody(issue.body), paths, holding);
      const exists = new Set(
        issue.files
          .map((f) => f.path)
          .filter((path) => gitAt(where, ["cat-file", "-e", `${ref}:${path}`]).code === 0),
      );
      const found = new Set<string>();
      const inHistory = new Set<string>();
      for (const f of issue.files) {
        if (f.kind !== "changed" || isDocument(f.path) || !exists.has(f.path)) {
          continue;
        }
        for (const symbol of symbols(f, paths)) {
          const key = symbolKey(f.path, symbol);
          if (gitAt(where, ["grep", "-w", "-F", "-q", symbol, ref, "--", f.path]).code === 0) {
            found.add(key);
          } else if (!historyUnknown) {
            const asWord = `(^|[^A-Za-z0-9_])${symbol.split("$").join("[$]")}([^A-Za-z0-9_]|$)`;
            const log = gitAt(where, [
              "log",
              "--format=%H",
              "-n",
              "1",
              "--pickaxe-regex",
              `-S${asWord}`,
              ref,
              "--",
              f.path,
            ]);
            if (log.stdout.trim() !== "") {
              inHistory.add(key);
            }
          }
        }
      }
      const roadmap = loaded.roadmap;
      const roadmapShown =
        roadmap !== null && issue.files.some((f) => f.kind === "changed" && f.path === roadmap.path)
          ? show(roadmap.path)
          : null;
      const roadmapHeadings =
        roadmapShown !== null && roadmapShown.code === 0
          ? roadmapParse(roadmapShown.stdout).entries.map((e) => e.heading)
          : [];
      const found_ = premises(issue, graph, {
        baseExists: viewed.baseExists,
        waitsOnMerged: viewed.waitsOnMerged,
        historyUnknown,
        paths,
        exists,
        found,
        inHistory,
        roadmap,
        roadmapHeadings,
      });
      return line({
        number: n,
        base,
        from,
        baseExists: viewed.baseExists,
        ok:
          checkLint.ok &&
          found_.failures.length === 0 &&
          unclosed.length === 0 &&
          mine.length === 0,
        lint: checkLint,
        premises: found_,
        breakage: { unclosed },
        roadmap: { "several-tasks": mine },
      });
    })
    .join("");
};

const roadmapRead = (ref: string): string => {
  const shown = run(["git", "rev-parse", "--show-toplevel"]);
  if (shown.code !== 0) {
    throw new Failure("not inside a git work tree");
  }
  const top = shown.stdout.trim();
  const found: string[] = [];
  if (ref !== "") {
    const unreadable = new Failure(`git cannot read the ref: ${ref}`);
    if (
      ref.startsWith("-") ||
      run(["git", "-C", top, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).code !== 0
    ) {
      throw unreadable;
    }
    const tree = run(["git", "-C", top, "ls-tree", ref, "--", ...ROADMAP_PATHS]);
    if (tree.code !== 0) {
      throw unreadable;
    }
    for (const record of tree.stdout.split("\n")) {
      const tab = record.indexOf("\t");
      const meta = tab === -1 ? record : record.slice(0, tab);
      const path = tab === -1 ? "" : record.slice(tab + 1);
      if (meta.split(" ")[1] === "blob") {
        found.push(path.replace(/^"+|"+$/gu, ""));
      }
    }
  } else {
    for (const dir of ["", "doc", "docs"]) {
      let names: readonly string[];
      try {
        names = readdirSync(join(top, dir));
      } catch {
        continue;
      }
      for (const name of names) {
        const path = dir === "" ? name : `${dir}/${name}`;
        if (ROADMAP_PATHS.includes(path) && isFile(join(top, path))) {
          found.push(path);
        }
      }
    }
  }
  const files = roadmapFiles(found);
  if (files.path === null) {
    return line({ ok: false, files: files.files, path: null, entries: [], reasons: files.reasons });
  }
  let text: string;
  if (ref !== "") {
    const shownFile = run(["git", "-C", top, "show", `${ref}:${files.path}`]);
    if (shownFile.code !== 0) {
      throw new Failure(`git cannot read ${files.path} at ${ref}`);
    }
    text = shownFile.stdout;
  } else {
    text = new TextDecoder("utf-8").decode(readFileSync(join(top, files.path)));
  }
  const parsedRoadmap = roadmapParse(text);
  return line({
    ok: parsedRoadmap.reasons.length === 0,
    files: files.files,
    path: files.path,
    entries: parsedRoadmap.entries,
    reasons: parsedRoadmap.reasons,
  });
};

const loadIn = (parent: number, where: string): Loaded => load(repoIn(where), parent, where);

export const readProject = (parent: number, where: string): Project =>
  viewOf(loadIn(parent, where)).view;

export const readOrder = (parent: number, where: string): OrderResult =>
  orderFor(loadIn(parent, where));

export const readNext = (parent: number, where: string): Next =>
  nextStep(viewOf(loadIn(parent, where)).view);

type Mode =
  | "project"
  | "order"
  | "order-body"
  | "parent-body"
  | "next"
  | "design"
  | "check"
  | "lint"
  | "parent-lint"
  | "same-words"
  | "roadmap";

type Options = {
  repo: string;
  mode: Mode;
  parent: string;
  targets: number[];
  file: string;
  before: string;
  after: string;
  design: string;
  ref: string;
};

const parseArgs = (args: readonly string[]): Options => {
  const o: Options = {
    repo: "",
    mode: "project",
    parent: "",
    targets: [],
    file: "",
    before: "",
    after: "",
    design: "",
    ref: "",
  };
  let i = 0;
  const need = (count: number): void => {
    if (args.length - i < count) {
      throw new UsageError("");
    }
  };
  while (i < args.length) {
    const arg = args[i] ?? "";
    if (arg === "-R" || arg === "--repo") {
      need(2);
      o.repo = args[i + 1] ?? "";
      i += 2;
    } else if (arg === "--order" || arg === "--order-body" || arg === "--next") {
      o.mode = arg === "--order" ? "order" : arg === "--next" ? "next" : "order-body";
      i += 1;
    } else if (arg === "--parent-body") {
      need(2);
      o.mode = "parent-body";
      o.file = args[i + 1] ?? "";
      i += 2;
    } else if (arg === "--design") {
      o.mode = "design";
      o.design = args[i + 1] ?? "";
      if (!DIGITS.test(o.design)) {
        throw new Failure("--design takes one issue number");
      }
      i += 2;
    } else if (arg === "--check") {
      o.mode = "check";
      i += 1;
      while (i < args.length && DIGITS.test(args[i] ?? "")) {
        o.targets.push(Number(args[i]));
        i += 1;
      }
      if (o.targets.length === 0) {
        throw new Failure("--check takes issue numbers");
      }
    } else if (arg === "--lint" || arg === "--parent-lint") {
      need(2);
      o.mode = arg === "--lint" ? "lint" : "parent-lint";
      o.file = args[i + 1] ?? "";
      i += 2;
    } else if (arg === "--same-words") {
      need(3);
      o.mode = "same-words";
      o.before = args[i + 1] ?? "";
      o.after = args[i + 2] ?? "";
      i += 3;
    } else if (arg === "--roadmap") {
      o.mode = "roadmap";
      i += 1;
      const next = args[i];
      if (next !== undefined && !next.startsWith("-")) {
        o.ref = next;
        i += 1;
      }
    } else if (arg === "-h" || arg === "--help") {
      throw new UsageError("");
    } else if (arg.length > 1 && arg.startsWith("-")) {
      throw new Failure(`unknown option: ${arg}`);
    } else {
      if (o.parent !== "") {
        throw new Failure("one parent issue at a time");
      }
      o.parent = arg;
      i += 1;
    }
  }
  return o;
};

const readBody = (file: string): string =>
  file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");

const main = (args: readonly string[]): string => {
  const o = parseArgs(args);
  if (o.mode === "lint" || o.mode === "parent-lint") {
    if (o.parent !== "") {
      throw new Failure(`--${o.mode} takes no parent`);
    }
    if (o.file !== "-" && !isFile(o.file)) {
      throw new Failure(`no such file: ${o.file}`);
    }
    const body = parseBody(readBody(o.file));
    return o.mode === "lint"
      ? line({ ...lint(body), decisions: decisionCounts(body.decs) })
      : line(parentLint(body));
  }
  if (o.mode === "same-words") {
    if (o.parent !== "") {
      throw new Failure("--same-words takes no parent");
    }
    for (const file of [o.before, o.after]) {
      if (!isFile(file)) {
        throw new Failure(`no such file: ${file}`);
      }
    }
    return line(sameWords(readFileSync(o.before, "utf8"), readFileSync(o.after, "utf8")));
  }
  if (o.mode === "roadmap") {
    if (o.parent !== "") {
      throw new Failure("--roadmap takes no parent");
    }
    return roadmapRead(o.ref);
  }
  if (o.parent === "") {
    throw new UsageError("");
  }
  if (!DIGITS.test(o.parent)) {
    throw new Failure(`the parent must be an issue number: ${o.parent}`);
  }
  if (o.mode === "parent-body" && !isFile(o.file)) {
    throw new Failure(`no such file: ${o.file}`);
  }
  const where = process.cwd();
  const repo = o.repo === "" ? repoIn(where) : repoOf(o.repo);
  const loaded = load(repo, Number(o.parent), where);
  switch (o.mode) {
    case "parent-body": {
      const done = withSections(loaded.parent.body, readFileSync(o.file, "utf8"), o.file);
      if (done.kind === "error") {
        throw new Failure(done.message);
      }
      return done.text;
    }
    case "design":
      return designFor(loaded, Number(o.design));
    case "check":
      return checkFor(loaded, o.targets);
    case "project":
      return line(viewOf(loaded).view);
    case "next":
      return line(nextStep(viewOf(loaded).view));
    case "order":
    case "order-body": {
      const order = orderFor(loaded);
      if (order.kind === "cycle") {
        throw new Failure(order.message);
      }
      return o.mode === "order-body" ? order.body : line({ order: order.order, list: order.list });
    }
  }
};

entry(import.meta.url, "project", USAGE, main);
