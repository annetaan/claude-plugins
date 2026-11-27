import { lstatSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { dropsOnMove, EXPERIMENT_DIRS, isStamped, landings, type Landing } from "./pure/reports.ts";
import { Failure } from "./status.ts";

export type ReportError = { readonly step: "old-reports"; readonly message: string };

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const isLink = (path: string): boolean => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

const exists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const entries = (root: string): readonly string[] =>
  isDirectory(root) ? readdirSync(root).toSorted() : [];

export const reportsIn = (wt: string): readonly string[] => {
  const root = join(wt, "work-reports");
  return entries(root).filter((name) => isDirectory(join(root, name)));
};

export const stampedIn = (root: string): readonly string[] =>
  entries(root).filter(
    (name) => isStamped(name) && isDirectory(join(root, name)) && !isLink(join(root, name)),
  );

const landingsOf = (main: string, wt: string): readonly Landing[] =>
  landings(entries(join(main, "work-reports")), reportsIn(wt));

export const incomingReports = (main: string, wt: string): readonly string[] => {
  const sources = new Set(stampedIn(join(wt, "work-reports")));
  return landingsOf(main, wt)
    .filter((landing) => sources.has(landing.report))
    .map((landing) => landing.dest);
};

const pruneBelow = (dir: string, name: string): void => {
  const found = readdirSync(dir, { withFileTypes: true });
  const names = found.map((entry) => entry.name);
  if (dropsOnMove(name, names)) {
    rmSync(dir, { recursive: true });
    return;
  }
  for (const entry of found) {
    if (entry.isDirectory()) {
      pruneBelow(join(dir, entry.name), entry.name);
    }
  }
};

const prune = (report: string): void => {
  if (isLink(report)) {
    return;
  }
  for (const name of EXPERIMENT_DIRS) {
    const dir = join(report, name);
    if (isDirectory(dir) && !isLink(dir)) {
      pruneBelow(dir, name);
    }
  }
};

export const moveReports = (main: string, wt: string): readonly string[] =>
  landingsOf(main, wt).map(({ report, dest }) => {
    const path = join(main, "work-reports", dest);
    if (exists(path)) {
      throw new Failure(`cannot move ${report}: ${path} exists`);
    }
    prune(join(wt, "work-reports", report));
    mkdirSync(dirname(path), { recursive: true });
    renameSync(join(wt, "work-reports", report), path);
    return path;
  });

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const deleteReports = (
  main: string,
  names: readonly string[],
): { readonly deleted: readonly string[]; readonly errors: readonly ReportError[] } => {
  const deleted: string[] = [];
  const errors: ReportError[] = [];
  for (const name of names) {
    try {
      rmSync(join(main, "work-reports", name), { recursive: true });
      deleted.push(name);
    } catch (error) {
      errors.push({ step: "old-reports", message: `cannot delete ${name}: ${reason(error)}` });
    }
  }
  return { deleted, errors };
};
