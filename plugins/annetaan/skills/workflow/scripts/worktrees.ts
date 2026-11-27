import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  hasSubmodules,
  listed,
  mainWorktree,
  realPath,
  revParse,
  worktreeList,
} from "../../../scripts/clone.ts";
import { git, run } from "../../../scripts/command.ts";
import { withCloneLock } from "../../../scripts/fetch.ts";
import { freeName, stampOf } from "../../../scripts/pure/reports.ts";
import { splitLines } from "../../../scripts/pure/text.ts";
import { Failure, stop } from "../../../scripts/status.ts";
import { moveReports } from "../../../scripts/work-reports.ts";
import { closeSeats } from "./flow.ts";

export const WORKTREES = ".claude/worktrees";

export type StepError = { readonly step: string; readonly message: string };

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const located = (): string => {
  const main = mainWorktree();
  if (main === null) {
    return stop("not-a-repo", "not inside a git repository");
  }
  return main;
};

export const listedNames = (main: string, prefix: string): readonly string[] => {
  const root = realPath(join(main, WORKTREES));
  return worktreeList(main)
    .slice(1)
    .map((e) => realPath(e.path))
    .filter((real) => dirname(real) === root && basename(real).startsWith(prefix))
    .map((real) => basename(real))
    .toSorted(byName);
};

const entriesOf = (root: string): readonly string[] => {
  try {
    return readdirSync(root);
  } catch {
    return [];
  }
};

export const addWorktree = (
  main: string,
  prefix: string,
  ref: string,
): { readonly name: string; readonly path: string } =>
  withCloneLock(main, () => {
    const taken = [...entriesOf(join(main, WORKTREES)), ...listedNames(main, "")];
    const name = freeName(prefix, stampOf(new Date()), taken);
    const path = join(main, WORKTREES, name);
    git(main, ["worktree", "add", "--quiet", "--detach", path, ref]);
    return { name, path };
  });

export const mergeIn = (
  wt: string,
  ref: string,
  message: string | null,
):
  | { readonly kind: "merged"; readonly sha: string }
  | { readonly kind: "conflict"; readonly files: readonly string[] } => {
  const merged = run([
    "git",
    "-C",
    wt,
    "merge",
    "--no-ff",
    ...(message === null ? [] : ["-m", message]),
    ref,
  ]);
  if (merged.code === 0) {
    return { kind: "merged", sha: revParse(wt, "HEAD") };
  }
  const files = splitLines(git(wt, ["diff", "--name-only", "--diff-filter=U"]));
  if (files.length > 0) {
    return { kind: "conflict", files };
  }
  run(["git", "-C", wt, "merge", "--abort"]);
  throw new Failure(`git merge ${ref} failed: ${(merged.stderr || merged.stdout).trim()}`);
};

const seatsOf = (
  path: string,
): { readonly seats: readonly string[]; readonly errors: readonly StepError[] } => {
  try {
    return { seats: closeSeats(path), errors: [] };
  } catch (error) {
    if (error instanceof Failure) {
      return { seats: [], errors: [{ step: "seats", message: `flow: ${error.message}` }] };
    }
    throw error;
  }
};

export const removeWorktree = (
  main: string,
  path: string,
  discard: boolean,
): {
  readonly action: "removed" | "pruned";
  readonly moved: readonly string[];
  readonly seats: readonly string[];
  readonly errors: readonly StepError[];
} => {
  const prunable = listed(main, path);
  if (prunable === null) {
    throw new Failure(`${path} is no worktree of this clone`);
  }
  const { seats, errors } = seatsOf(path);
  if (prunable) {
    git(main, ["worktree", "prune"]);
    return { action: "pruned", moved: [], seats, errors };
  }
  const force = discard || hasSubmodules(path) ? ["--force"] : [];
  const reportsIgnored = run(["git", "-C", path, "check-ignore", "-q", "work-reports/"]).code === 0;
  const moved = reportsIgnored ? moveReports(main, path) : [];
  git(main, ["worktree", "remove", ...force, path]);
  return { action: "removed", moved, seats, errors };
};
