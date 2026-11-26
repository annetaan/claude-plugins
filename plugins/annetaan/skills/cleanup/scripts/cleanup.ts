import { join } from "node:path";
import {
  checkedOutIn,
  hasBranch,
  isAncestor,
  listed,
  onOrigin,
  realPath,
  revParse,
  submoduleWork,
  worktreeList,
  type SubmoduleWork,
} from "../../../scripts/clone.ts";
import { projectWorktree, type WorktreeEntry } from "../../../scripts/pure/worktree-list.ts";
import { git, run } from "../../../scripts/command.ts";
import { fetchBranch, fetchFromOrigin } from "../../../scripts/fetch.ts";
import {
  losses,
  targetKind,
  updateStep,
  type BranchFacts,
  type UpdateStep,
} from "../../../scripts/pure/cleanup-steps.ts";
import { oldReports, REPORTS_KEPT } from "../../../scripts/pure/reports.ts";
import { splitLines } from "../../../scripts/pure/text.ts";
import { entry, Failure, statusLine, stop, Stopped, UsageError } from "../../../scripts/status.ts";
import {
  deleteReports,
  incomingReports,
  reportsIn,
  stampedIn,
} from "../../../scripts/work-reports.ts";
import {
  listedNames,
  located,
  removeWorktree,
  WORKTREES,
  type StepError,
} from "../../workflow/scripts/worktrees.ts";
import { readProject, startableAfter } from "../../pj1-plan/scripts/project.ts";
import {
  localBaseStep,
  notMerged,
  projectPull,
  projectTarget,
  type CleanupParent,
  type ProjectPull,
} from "./pure/project-cleanup.ts";

const USAGE = `usage: cleanup.sh list                     the run-* and propose-* worktrees of this clone with the state of their pull request,
                                           and one #<P> target per project with pj-<P>-* worktrees, with the state of the project
       cleanup.sh check <name>|#<P>        what run would do for the worktree <name>, or for project <P>, which must be merged
       cleanup.sh run <name>|#<P> [--discard]
                                           move the work reports out, remove the worktree, delete the branch, fast-forward the base.
                                           For #<P>: every pj-<P>-* worktree, the base branch locally and on origin, and <from>.
                                           --discard removes work that nothing else holds. It also deletes the work reports
                                           in <MAIN>/work-reports/ beyond the 100 newest by their stamp
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
`;

type Pr = {
  readonly number: number;
  readonly state: string;
  readonly url: string;
  readonly title: string;
  readonly base: string;
  readonly headSha: string;
};

type Kind = "run" | "propose" | "project";

type Tree = {
  readonly name: string;
  readonly path: string;
  readonly state: "prunable" | "clean" | "dirty";
  readonly changes: readonly string[];
  readonly submodules: readonly SubmoduleWork[];
  readonly reports: readonly string[];
};

type Branch = {
  readonly name: string;
  readonly local: "delete" | "keep";
  readonly why: "checked-out" | "unpushed" | null;
  readonly remote: "present" | "absent";
};

type Update =
  | { readonly branch: null; readonly action: "none" }
  | (UpdateStep & { readonly branch: string });

type Plan = {
  readonly main: string;
  readonly kind: Kind;
  readonly pr: (ProjectPull & { readonly state?: string }) | null;
  readonly worktrees: readonly Tree[];
  readonly branches: readonly Branch[];
  readonly loses: readonly string[];
  readonly update: Update;
  readonly parent?: { readonly number: number; readonly state: string };
  readonly oldReports: {
    readonly path: string;
    readonly keep: number;
    readonly names: readonly string[];
  };
};

const pullRequest = (
  main: string,
  branch: string,
): { readonly pr: Pr | null; readonly err: string | null } => {
  const r = run(
    [
      "gh",
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--json",
      "number,state,url,title,baseRefName,headRefOid",
    ],
    { cwd: main },
  );
  if (r.code !== 0) {
    return { pr: null, err: r.stderr.trim() || r.stdout.trim() || `gh pr list exited ${r.code}` };
  }
  type Listed = {
    readonly number: number;
    readonly state: string;
    readonly url: string;
    readonly title: string;
    readonly baseRefName: string;
    readonly headRefOid: string;
  };
  let found: readonly Listed[];
  try {
    found = JSON.parse(r.stdout) as readonly Listed[];
  } catch {
    return { pr: null, err: "unreadable output from gh pr list" };
  }
  const p = found.toSorted(
    (a, b) => Number(b.state === "OPEN") - Number(a.state === "OPEN") || b.number - a.number,
  )[0];
  if (p === undefined) {
    return { pr: null, err: null };
  }
  return {
    pr: {
      number: p.number,
      state: p.state.toLowerCase(),
      url: p.url,
      title: p.title,
      base: p.baseRefName,
      headSha: p.headRefOid,
    },
    err: null,
  };
};

const headContains = (main: string, tip: string, pr: Pr): boolean => {
  const head = pr.headSha;
  if (run(["git", "-C", main, "cat-file", "-e", `${head}^{commit}`]).code !== 0) {
    if (fetchFromOrigin(main, [`refs/pull/${pr.number}/head`]).code !== 0) {
      stop("fetch-failed", `cannot fetch the head of pull request #${pr.number} from origin`);
    }
  }
  return isAncestor(main, tip, head);
};

const branchAt = (trees: readonly WorktreeEntry[], path: string): string | null =>
  trees.find((e) => realPath(e.path) === realPath(path))?.branch ?? null;

const targetOf = (
  main: string,
  name: string,
): { readonly kind: Kind; readonly path: string; readonly branch: string | null } => {
  const kind = targetKind(name);
  if (kind === null || !listedNames(main, `${kind}-`).includes(name)) {
    return stop("unknown", `${name} is no run-* or propose-* worktree of this clone, or #<P>`);
  }
  const path = join(main, WORKTREES, name);
  return { kind, path, branch: branchAt(worktreeList(main), path) };
};

const projectTargets = (main: string): readonly Readonly<Record<string, unknown>>[] => {
  const byProject = Map.groupBy(
    listedNames(main, "pj-").flatMap((name) => {
      const found = projectWorktree(name);
      return found === null ? [] : [{ p: found.p, name }];
    }),
    (e) => e.p,
  );
  return [...byProject.entries()]
    .toSorted(([a], [b]) => a - b)
    .map(([p, entries]) => {
      const names = entries.map((e) => e.name);
      try {
        return projectTarget(readProject(p, main).parent, names);
      } catch (error) {
        if (error instanceof Failure) {
          return {
            kind: "project",
            name: `#${p}`,
            worktrees: names,
            branch: null,
            pr: null,
            state: "error",
            message: `project: ${error.message}`,
          };
        }
        throw error;
      }
    });
};

const list = (): string => {
  const main = located();
  const trees = worktreeList(main);
  const named = [
    ...listedNames(main, "run-").map((name) => ({ kind: "run", name })),
    ...listedNames(main, "propose-").map((name) => ({ kind: "propose", name })),
  ];
  const targets = named.map(({ kind, name }) => {
    const branch = branchAt(trees, join(main, WORKTREES, name));
    const base = { kind, name, worktrees: [name], branch };
    if (branch === null) {
      return { ...base, pr: null, state: "no-pr" };
    }
    const { pr, err } = pullRequest(main, branch);
    if (err !== null) {
      return { ...base, pr: null, state: "error", message: err };
    }
    return pr === null
      ? { ...base, pr: null, state: "no-pr" }
      : { ...base, pr: { number: pr.number, title: pr.title, url: pr.url }, state: pr.state };
  });
  return statusLine({ status: "ok", main, targets: [...targets, ...projectTargets(main)] });
};

const treeOf = (main: string, name: string, path: string): Tree => {
  if (listed(main, path) === true) {
    return { name, path, state: "prunable", changes: [], submodules: [], reports: [] };
  }
  const changes = splitLines(git(path, ["status", "--porcelain"]));
  return {
    name,
    path,
    state: changes.length > 0 ? "dirty" : "clean",
    changes: changes.slice(0, 20),
    submodules: submoduleWork(path),
    reports: reportsIn(path),
  };
};

const detachedOnNoOriginRef = (tree: Tree): boolean =>
  tree.state !== "prunable" &&
  run(["git", "-C", tree.path, "symbolic-ref", "-q", "HEAD"]).code !== 0 &&
  run([
    "git",
    "-C",
    tree.path,
    "for-each-ref",
    "--format=%(refname)",
    "--contains",
    "HEAD",
    "refs/remotes/origin",
  ]).stdout.trim() === "";

const branchOf = (
  main: string,
  path: string,
  branch: string,
  pr: Pr | null,
  trees: readonly WorktreeEntry[],
): { readonly entry: Branch; readonly facts: BranchFacts } => {
  const state = pr === null ? "no-pr" : pr.state;
  const remote = onOrigin(main, branch);
  if (remote === null) {
    return stop("fetch-failed", "cannot read the branches on origin");
  }
  const holder = trees.some((e) => e.branch === branch && realPath(e.path) !== realPath(path));
  const tip = hasBranch(main, branch) ? revParse(main, `refs/heads/${branch}`) : null;
  const unpushed =
    !holder && state === "merged" && tip !== null && pr !== null && !headContains(main, tip, pr);
  const heldOnOrigin =
    state === "no-pr" &&
    tip !== null &&
    run([
      "git",
      "-C",
      main,
      "for-each-ref",
      "--format=%(refname)",
      "--contains",
      tip,
      "refs/remotes/origin",
    ])
      .stdout.split(/\s+/)
      .some((h) => h !== "" && h !== `refs/remotes/origin/${branch}`);
  return {
    entry: {
      name: branch,
      local: holder || unpushed ? "keep" : "delete",
      why: holder ? "checked-out" : unpushed ? "unpushed" : null,
      remote: remote ? "present" : "absent",
    },
    facts: { state, tip, heldOnOrigin },
  };
};

const isOneOf = (path: string, paths: readonly string[]): boolean =>
  paths.some((p) => realPath(p) === realPath(path));

const updateOf = (main: string, base: string | null, paths: readonly string[]): Update => {
  if (base === null) {
    return { branch: null, action: "none" };
  }
  if (fetchBranch(main, base).code !== 0) {
    return stop("fetch-failed", `cannot fetch ${base} from origin`);
  }
  const target = revParse(main, `refs/remotes/origin/${base}`);
  const holderPath = checkedOutIn(main, base);
  const holder = holderPath !== null && isOneOf(holderPath, paths) ? null : holderPath;
  const tip = hasBranch(main, base) ? revParse(main, `refs/heads/${base}`) : null;
  return {
    branch: base,
    ...updateStep({
      tip,
      target,
      tipIsAncestor: tip !== null && tip !== target && isAncestor(main, tip, target),
      holder,
    }),
  };
};

const runPlan = (name: string): Plan => {
  const main = located();
  const { kind, path, branch } = targetOf(main, name);
  const trees = worktreeList(main);

  let pr: Pr | null = null;
  if (branch !== null) {
    const found = pullRequest(main, branch);
    if (found.err !== null) {
      stop("gh", `cannot read the pull requests of ${branch}: ${found.err}`);
    }
    pr = found.pr;
  }
  const prOut =
    pr === null ? null : { number: pr.number, title: pr.title, url: pr.url, state: pr.state };
  if (pr !== null && pr.state === "open") {
    stop("open", `the pull request #${pr.number} of ${branch ?? ""} is still open`, {
      pr: prOut,
    });
  }

  const tree = treeOf(main, name, path);
  const br = branch === null ? null : branchOf(main, path, branch, pr, trees);
  const reportsRoot = join(main, "work-reports");
  return {
    main,
    kind,
    pr: prOut,
    worktrees: [tree],
    branches: br === null ? [] : [br.entry],
    loses: losses({
      dirty: tree.state === "dirty",
      submodules: tree.submodules.length > 0,
      branch: br === null ? null : br.facts,
      detached: detachedOnNoOriginRef(tree),
    }),
    update: updateOf(main, pr?.state === "merged" ? pr.base : null, [path]),
    oldReports: {
      path: reportsRoot,
      keep: REPORTS_KEPT,
      names: oldReports(
        stampedIn(reportsRoot),
        tree.state === "prunable" ? [] : incomingReports(main, path),
      ),
    },
  };
};

const parentOf = (p: number, main: string): CleanupParent => {
  try {
    return readProject(p, main).parent;
  } catch (error) {
    if (error instanceof Failure) {
      return stop("unknown", `project: ${error.message}`);
    }
    throw error;
  }
};

const baseBranch = (main: string, parent: CleanupParent, paths: readonly string[]): Branch => {
  const { base, from } = parent;
  const remote = onOrigin(main, base);
  if (remote === null) {
    return stop("fetch-failed", "cannot read the branches on origin");
  }
  const onRemote = remote ? "present" : "absent";
  if (!hasBranch(main, base)) {
    return { name: base, local: "delete", why: null, remote: onRemote };
  }
  const holder = checkedOutIn(main, base);
  const otherHolder = holder !== null && !isOneOf(holder, paths) ? holder : null;
  const held = [
    `origin/${from}`,
    ...(remote && fetchBranch(main, base).code === 0 ? [`origin/${base}`] : []),
  ];
  const step = localBaseStep({
    otherHolder,
    contained: otherHolder === null && held.some((ref) => isAncestor(main, base, ref)),
  });
  return step.action === "delete"
    ? { name: base, local: "delete", why: null, remote: onRemote }
    : { name: base, local: "keep", why: step.why, remote: onRemote };
};

const heldOnOrigin = (main: string, tip: string): boolean =>
  run([
    "git",
    "-C",
    main,
    "for-each-ref",
    "--format=%(refname)",
    "--contains",
    tip,
    "refs/remotes/origin",
  ]).stdout.trim() !== "";

const runBranch = (main: string, branch: string): Branch => {
  const remote = onOrigin(main, branch);
  if (remote === null) {
    return stop("fetch-failed", "cannot read the branches on origin");
  }
  const unpushed = !heldOnOrigin(main, revParse(main, `refs/heads/${branch}`));
  return {
    name: branch,
    local: unpushed ? "keep" : "delete",
    why: unpushed ? "unpushed" : null,
    remote: remote ? "present" : "absent",
  };
};

const projectPlan = (p: number): Plan => {
  const main = located();
  const parent = parentOf(p, main);
  const refused = notMerged(p, parent);
  if (refused !== null) {
    throw new Stopped(refused);
  }
  if (fetchBranch(main, parent.from).code !== 0) {
    stop("fetch-failed", `cannot fetch ${parent.from} from origin`);
  }
  const trees = listedNames(main, "pj-")
    .filter((name) => projectWorktree(name)?.p === p)
    .map((name) => treeOf(main, name, join(main, WORKTREES, name)));
  const paths = trees.map((t) => t.path);
  const listing = worktreeList(main);
  const checkedOut = [...new Set(paths.flatMap((path) => branchAt(listing, path) ?? []))].filter(
    (b) => b !== parent.base,
  );
  const reportsRoot = join(main, "work-reports");
  return {
    main,
    kind: "project",
    pr: projectPull(parent),
    worktrees: trees,
    branches: [baseBranch(main, parent, paths), ...checkedOut.map((b) => runBranch(main, b))],
    loses: losses({
      dirty: trees.some((t) => t.state === "dirty"),
      submodules: trees.some((t) => t.submodules.length > 0),
      branch: null,
      detached: trees.some((t) => detachedOnNoOriginRef(t)),
    }),
    update: updateOf(main, parent.from, paths),
    parent: { number: p, state: parent.state },
    oldReports: {
      path: reportsRoot,
      keep: REPORTS_KEPT,
      names: oldReports(
        stampedIn(reportsRoot),
        trees.filter((t) => t.state !== "prunable").flatMap((t) => incomingReports(main, t.path)),
      ),
    },
  };
};

const projectOf = (name: string): number | null => {
  const found = /^#([0-9]+)$/u.exec(name);
  return found === null ? null : Number(found[1]);
};

const plan = (name: string): Plan => {
  const p = projectOf(name);
  return p === null ? runPlan(name) : projectPlan(p);
};

const check = (name: string): string => statusLine({ status: "ok", ...plan(name) });

const removeBranch = (
  main: string,
  br: Branch,
): {
  readonly branch: {
    readonly name: string;
    readonly local: "deleted" | "kept";
    readonly why: Branch["why"];
    readonly remote: "deleted" | "absent" | "present";
  };
  readonly errors: readonly StepError[];
} => {
  const local =
    br.local === "delete" && hasBranch(main, br.name)
      ? run(["git", "-C", main, "branch", "-D", br.name])
      : null;
  const pushed =
    br.remote === "present"
      ? run(["git", "-C", main, "push", "--quiet", "origin", "--delete", br.name])
      : null;
  run(["git", "-C", main, "update-ref", "-d", `refs/remotes/origin/${br.name}`]);
  const remote =
    pushed === null
      ? "absent"
      : pushed.code === 0
        ? "deleted"
        : pushed.stderr.includes("remote ref does not exist")
          ? "absent"
          : "present";
  return {
    branch: {
      name: br.name,
      local: br.local === "delete" && (local === null || local.code === 0) ? "deleted" : "kept",
      why: br.why,
      remote,
    },
    errors: [
      ...(local !== null && local.code !== 0
        ? [{ step: "local-branch", message: local.stderr.trim() }]
        : []),
      ...(pushed !== null && remote === "present"
        ? [{ step: "remote-branch", message: pushed.stderr.trim() }]
        : []),
    ],
  };
};

const applyUpdate = (
  main: string,
  update: Update,
): {
  readonly update: {
    readonly action: string;
    readonly from: string | null;
    readonly to: string | null;
  };
  readonly errors: readonly StepError[];
} => {
  switch (update.action) {
    case "none":
    case "absent":
      return { update: { action: update.action, from: null, to: null }, errors: [] };
    case "current":
      return { update: { action: "current", from: update.sha, to: update.sha }, errors: [] };
    case "diverged":
      return { update: { action: "diverged", from: update.sha, to: update.to }, errors: [] };
    case "fast-forward": {
      const r =
        update.worktree === null
          ? run([
              "git",
              "-C",
              main,
              "update-ref",
              `refs/heads/${update.branch}`,
              update.to,
              update.from,
            ])
          : run([
              "git",
              "-C",
              update.worktree,
              "merge",
              "--ff-only",
              "--quiet",
              `origin/${update.branch}`,
            ]);
      const moved = { from: update.from, to: update.to };
      return r.code === 0
        ? { update: { action: "updated", ...moved }, errors: [] }
        : {
            update: { action: "not-updated", ...moved },
            errors: [{ step: "update", message: (r.stderr || r.stdout).trim() }],
          };
    }
  }
};

type Removed = {
  readonly worktree: readonly {
    readonly name: string;
    readonly action: string;
    readonly moved: readonly string[];
  }[];
  readonly errors: readonly StepError[];
};

const removed = (main: string, tree: Tree, discard: boolean): Removed => {
  try {
    const removal = removeWorktree(main, tree.path, discard);
    return {
      worktree: [{ name: tree.name, action: removal.action, moved: removal.moved }],
      errors: removal.errors,
    };
  } catch (error) {
    if (error instanceof Failure) {
      return { worktree: [], errors: [{ step: "worktree", message: error.message }] };
    }
    throw error;
  }
};

const startableOf = (
  main: string,
  p: number,
): {
  readonly startable: ReturnType<typeof startableAfter>;
  readonly errors: readonly StepError[];
} => {
  try {
    return { startable: startableAfter(readProject(p, main), main), errors: [] };
  } catch (error) {
    if (error instanceof Failure) {
      return { startable: [], errors: [{ step: "startable", message: error.message }] };
    }
    throw error;
  }
};

const cleanup = (name: string, discard: boolean): string => {
  const out = plan(name);
  if (out.loses.length > 0 && !discard) {
    stop("discard", `${name} holds work that nothing else holds: ${out.loses.join(", ")}`, out);
  }
  const { main } = out;
  const removals = out.worktrees.map((tree) => removed(main, tree, discard));
  const branches = out.branches.map((br) => removeBranch(main, br));
  const update = applyUpdate(main, out.update);
  const deleted = deleteReports(main, oldReports(stampedIn(join(main, "work-reports"))));
  const after = out.parent === undefined ? null : startableOf(main, out.parent.number);
  return statusLine({
    status: "done",
    worktrees: removals.flatMap((r) => r.worktree),
    branches: branches.map((b) => b.branch),
    update: update.update,
    oldReports: { deleted: deleted.deleted },
    ...(after === null ? {} : { startable: after.startable }),
    errors: [
      ...removals.flatMap((r) => r.errors),
      ...branches.flatMap((b) => b.errors),
      ...update.errors,
      ...deleted.errors,
      ...(after === null ? [] : after.errors),
    ],
  });
};

const main = (args: readonly string[]): string => {
  const [sub, name, flag] = args;
  if (sub === "list" && args.length === 1) {
    return list();
  }
  if (sub === "check" && name !== undefined && args.length === 2) {
    return check(name);
  }
  if (
    sub === "run" &&
    name !== undefined &&
    (args.length === 2 || (args.length === 3 && flag === "--discard"))
  ) {
    return cleanup(name, args.length === 3);
  }
  throw new UsageError("");
};

entry(import.meta.url, "cleanup", USAGE, main);
