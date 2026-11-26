import { lstatSync } from "node:fs";
import { join } from "node:path";
import {
  checkedOutIn,
  hasBranch,
  hasSubmodules,
  isAncestor,
  listed,
  mainWorktree,
  onOrigin,
  realPath,
  revParse,
  submoduleWork,
  worktreeList,
  type SubmoduleWork,
} from "../../../scripts/clone.ts";
import { git, run } from "../../../scripts/command.ts";
import { fetchBranch } from "../../../scripts/fetch.ts";
import { losses, updateStep, type UpdateStep } from "../../../scripts/pure/cleanup-steps.ts";
import { oldReports, REPORTS_KEPT } from "../../../scripts/pure/reports.ts";
import { splitLines } from "../../../scripts/pure/text.ts";
import {
  entry,
  Failure,
  statusLine,
  stop,
  Stopped,
  UsageError,
  type StatusObject,
} from "../../../scripts/status.ts";
import {
  deleteReports,
  incomingReports,
  moveReports,
  reportsIn,
  stampedIn,
} from "../../../scripts/work-reports.ts";
import { readProject } from "../../pj1-plan/scripts/project.ts";
import { closeSeats } from "../../workflow/scripts/flow.ts";
import {
  listEntry,
  localBaseStep,
  notMerged,
  projectSummary,
  type CleanupParent,
  type LocalBase,
  type ProjectSummary,
} from "./pure/project-cleanup.ts";

const USAGE = `usage: cleanup.sh list                  the projects that have a worktree in this clone
       cleanup.sh check <P>             what run would do for project <P>, which must be merged
       cleanup.sh run <P> [--discard]   move the work reports out, remove the worktree, delete the base branch,
                                        fast-forward <from>. --discard removes a worktree that holds work nothing else holds.
                                        It also deletes the work reports in <MAIN>/work-reports/ beyond the 100 newest
                                        by their stamp, the ones it moved in counted
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
`;

type StepError = { readonly step: string; readonly message: string };

type Tree = {
  readonly path: string;
  readonly state: "absent" | "foreign" | "prunable" | "clean" | "dirty";
  readonly changes?: readonly string[];
  readonly reports?: readonly string[];
  readonly submodules?: readonly SubmoduleWork[];
  readonly hasSubmodules?: boolean;
};

type Plan = {
  readonly project: ProjectSummary;
  readonly main: string;
  readonly worktree: Tree;
  readonly loses: readonly string[];
  readonly localBase: LocalBase | null;
  readonly remoteBase: "present" | "absent";
  readonly update: UpdateStep;
  readonly oldReports: {
    readonly path: string;
    readonly keep: number;
    readonly names: readonly string[];
  };
};

const located = (): string => {
  const main = mainWorktree();
  if (main === null) {
    return stop("not-a-repo", "not inside a git repository");
  }
  return main;
};

const exists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const worktreeOf = (main: string, p: number): string => join(main, `.claude/worktrees/pj-${p}`);

const parentOf = (p: number, where: string): CleanupParent => {
  try {
    return readProject(p, where).parent;
  } catch (error) {
    if (error instanceof Failure) {
      return stop("project", `project: ${error.message}`);
    }
    throw error;
  }
};

const treeOf = (main: string, wt: string): Tree => {
  const prunable = listed(main, wt);
  if (prunable === null) {
    return { path: wt, state: exists(wt) ? "foreign" : "absent" };
  }
  if (prunable) {
    return { path: wt, state: "prunable" };
  }
  const changes = splitLines(git(wt, ["status", "--porcelain"]));
  return {
    path: wt,
    state: changes.length > 0 ? "dirty" : "clean",
    changes: changes.slice(0, 20),
    reports: reportsIn(wt),
    submodules: submoduleWork(wt),
    hasSubmodules: hasSubmodules(wt),
  };
};

const live = (tree: Tree): boolean => tree.state === "clean" || tree.state === "dirty";

const localBaseOf = (
  main: string,
  wt: string,
  base: string,
  from: string,
  remote: boolean,
): LocalBase | null => {
  if (!hasBranch(main, base)) {
    return null;
  }
  const holder = checkedOutIn(main, base);
  const held = [`origin/${from}`];
  if (remote && fetchBranch(main, base).code === 0) {
    held.push(`origin/${base}`);
  }
  const otherHolder = holder !== null && realPath(holder) !== realPath(wt) ? holder : null;
  return localBaseStep({
    otherHolder,
    contained: otherHolder === null && held.some((ref) => isAncestor(main, base, ref)),
  });
};

const updateOf = (main: string, wt: string, from: string): UpdateStep => {
  const target = revParse(main, `origin/${from}`);
  const holder = checkedOutIn(main, from);
  const tip = hasBranch(main, from) ? revParse(main, `refs/heads/${from}`) : null;
  return updateStep({
    tip,
    target,
    tipIsAncestor: tip !== null && tip !== target && isAncestor(main, tip, target),
    holder: holder !== null && realPath(holder) === realPath(wt) ? null : holder,
  });
};

const plan = (p: number): Plan => {
  const main = located();
  const parent = parentOf(p, main);
  const refused = notMerged(p, parent);
  if (refused !== null) {
    throw new Stopped(refused);
  }
  const { base, from } = parent;
  const wt = worktreeOf(main, p);
  const tree = treeOf(main, wt);
  const loses = losses({
    dirty: tree.state === "dirty",
    submodules: (tree.submodules ?? []).length > 0,
    branch: null,
    detached: false,
  });
  if (fetchBranch(main, from).code !== 0) {
    stop("fetch-failed", `cannot fetch ${from} from origin`);
  }
  const remote = onOrigin(main, base);
  if (remote === null) {
    return stop("fetch-failed", "cannot read the branches on origin");
  }
  const localBase = localBaseOf(main, wt, base, from, remote);
  const update = updateOf(main, wt, from);
  const reportsRoot = join(main, "work-reports");
  return {
    project: projectSummary(parent),
    main,
    worktree: tree,
    loses,
    localBase,
    remoteBase: remote ? "present" : "absent",
    update,
    oldReports: {
      path: reportsRoot,
      keep: REPORTS_KEPT,
      names: oldReports(stampedIn(reportsRoot), live(tree) ? incomingReports(main, wt) : []),
    },
  };
};

const PROJECT_WORKTREE = /^pj-(\d+)$/;

const listProjects = (): string => {
  const main = located();
  const prefix = join(main, ".claude/worktrees");
  const found = worktreeList(main)
    .slice(1)
    .flatMap((tree) => {
      const number = tree.path.startsWith(`${prefix}/`)
        ? PROJECT_WORKTREE.exec(tree.path.slice(prefix.length + 1))
        : null;
      return number === null ? [] : [Number(number[1])];
    })
    .toSorted((a, b) => a - b);
  const projects = found.map((p) => {
    try {
      return listEntry(readProject(p, main).parent);
    } catch (error) {
      if (error instanceof Failure) {
        return { number: p, error: `project: ${error.message}` };
      }
      throw error;
    }
  });
  return statusLine({ status: "ok", main, projects });
};

const check = (p: number): string => statusLine({ status: "ok", ...plan(p) });

const seatsOf = (wt: string): { readonly seats: readonly string[]; readonly error?: StepError } => {
  try {
    return { seats: closeSeats(wt) };
  } catch (error) {
    if (error instanceof Failure) {
      return { seats: [], error: { step: "seats", message: `flow: ${error.message}` } };
    }
    throw error;
  }
};

const stepError = (step: string, message: string): StepError => ({ step, message });

const cleanup = (p: number, discard: boolean): string => {
  const out = plan(p);
  const { main, worktree: tree } = out;
  const { base, from } = out.project;
  if (tree.state === "foreign") {
    stop("foreign", `${tree.path} exists and is not a worktree of this clone`, out);
  }
  if (out.loses.length > 0 && !discard) {
    stop(
      "discard",
      `${tree.path} holds work that nothing else holds: ${out.loses.join(", ")}`,
      out,
    );
  }
  const errors: StepError[] = [];
  const seats = seatsOf(tree.path);
  if (seats.error !== undefined) {
    errors.push(seats.error);
  }

  const moved = live(tree) ? moveReports(main, tree.path) : [];
  const reportsRoot = join(main, "work-reports");
  const names = oldReports(stampedIn(reportsRoot));
  const removal = deleteReports(main, names);
  errors.push(...removal.errors);

  let action: string;
  if (live(tree)) {
    const force = tree.state === "dirty" || tree.hasSubmodules === true ? ["--force"] : [];
    git(main, ["worktree", "remove", ...force, tree.path]);
    action = "removed";
  } else if (tree.state === "prunable") {
    git(main, ["worktree", "prune"]);
    action = "pruned";
  } else {
    action = "none";
  }

  let localBase: Readonly<Record<string, unknown>> | null = out.localBase;
  if (out.localBase !== null && out.localBase.action === "delete") {
    const result = run(["git", "-C", main, "branch", "-D", base]);
    localBase = { ...out.localBase, action: result.code === 0 ? "deleted" : "keep" };
    if (result.code !== 0) {
      errors.push(stepError("local-base", result.stderr.trim()));
    }
  }

  let remoteBase: string = out.remoteBase;
  if (remoteBase === "present") {
    const result = run(["git", "-C", main, "push", "--quiet", "origin", "--delete", base]);
    if (result.code === 0) {
      remoteBase = "deleted";
    } else {
      errors.push(stepError("remote-base", result.stderr.trim()));
    }
  }
  run(["git", "-C", main, "update-ref", "-d", `refs/remotes/origin/${base}`]);

  let update: Readonly<Record<string, unknown>> = out.update;
  if (out.update.action === "fast-forward") {
    const step = out.update;
    const result =
      step.worktree === null
        ? run(["git", "-C", main, "update-ref", `refs/heads/${from}`, step.to, step.from])
        : run(["git", "-C", step.worktree, "merge", "--ff-only", "--quiet", `origin/${from}`]);
    if (result.code === 0) {
      update = { ...step, action: "updated" };
    } else {
      update = { ...step, action: "not-updated" };
      errors.push(stepError("update", (result.stderr || result.stdout).trim()));
    }
  }

  const done: StatusObject = {
    status: "done",
    errors,
    ...out,
    worktree: {
      ...tree,
      seats: seats.seats,
      ...(live(tree) ? { moved } : {}),
      action,
    },
    localBase,
    remoteBase,
    update,
    oldReports: { ...out.oldReports, names, deleted: removal.deleted },
  };
  return statusLine(done);
};

const projectNumber = (text: string | undefined): number => {
  if (text === undefined || !/^[0-9]+$/.test(text)) {
    throw new Failure(`the project must be a number: ${text ?? ""}`);
  }
  return Number(text);
};

const main = (args: readonly string[]): string => {
  const [sub, ...rest] = args;
  if (sub === "list" && rest.length === 0) {
    return listProjects();
  }
  if (sub === "check" && rest.length === 1) {
    return check(projectNumber(rest[0]));
  }
  if (sub === "run" && (rest.length === 1 || (rest.length === 2 && rest[1] === "--discard"))) {
    return cleanup(projectNumber(rest[0]), rest.length === 2);
  }
  throw new UsageError("");
};

entry(import.meta.url, "cleanup", USAGE, main);
