import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { git, run } from "./command.ts";
import { parseWorktreeList, type WorktreeEntry } from "./pure/worktree-list.ts";
import { splitLines } from "./pure/text.ts";
import { Failure, type StatusObject } from "./status.ts";

export const worktreeList = (where: string): readonly WorktreeEntry[] =>
  parseWorktreeList(git(where, ["worktree", "list", "--porcelain"]));

export const mainWorktree = (): string | null => {
  const result = run(["git", "worktree", "list", "--porcelain"]);
  if (result.code !== 0) {
    return null;
  }
  return parseWorktreeList(result.stdout)[0]?.path ?? null;
};

export const realPath = (path: string): string => {
  const rest: string[] = [];
  let head = resolve(path);
  for (;;) {
    try {
      return join(realpathSync(head), ...rest.toReversed());
    } catch {
      const up = dirname(head);
      if (up === head) {
        return resolve(path);
      }
      rest.push(basename(head));
      head = up;
    }
  }
};

export const listed = (main: string, path: string): boolean | null => {
  const real = realPath(path);
  return worktreeList(main).find((entry) => realPath(entry.path) === real)?.prunable ?? null;
};

export const checkedOutIn = (main: string, branch: string): string | null =>
  worktreeList(main).find((entry) => entry.branch === branch)?.path ?? null;

export const hasBranch = (where: string, branch: string): boolean =>
  run(["git", "-C", where, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).code === 0;

export const isAncestor = (where: string, ancestor: string, ref: string): boolean =>
  run(["git", "-C", where, "merge-base", "--is-ancestor", ancestor, ref]).code === 0;

export const revParse = (where: string, ref: string): string =>
  git(where, ["rev-parse", ref]).trim();

export const onOrigin = (main: string, branch: string): boolean | null => {
  const result = run([
    "git",
    "-C",
    main,
    "ls-remote",
    "--exit-code",
    "--heads",
    "origin",
    `refs/heads/${branch}`,
  ]);
  if (result.code === 0) {
    return true;
  }
  return result.code === 2 ? false : null;
};

export type SubmoduleWork = {
  readonly path: string;
  readonly changes: readonly string[];
  readonly commits: number;
};

export const submoduleWork = (wt: string): readonly SubmoduleWork[] => {
  const result = run([
    "git",
    "-C",
    wt,
    "submodule",
    "--quiet",
    "foreach",
    "--recursive",
    "echo $displaypath",
  ]);
  if (result.code !== 0) {
    throw new Failure(`git submodule foreach failed: ${result.stderr.trim()}`);
  }
  return splitLines(result.stdout).flatMap((path): readonly SubmoduleWork[] => {
    const sub = join(wt, path);
    const changes = splitLines(git(sub, ["status", "--porcelain"]));
    const commits = Number.parseInt(
      git(sub, [
        "rev-list",
        "--count",
        "HEAD",
        "--branches",
        "--glob=refs/stash",
        "--not",
        "--remotes",
        "--tags",
      ]).trim(),
      10,
    );
    return changes.length > 0 || commits > 0
      ? [{ path, changes: changes.slice(0, 20), commits }]
      : [];
  });
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export const hasSubmodules = (wt: string): boolean => {
  if (splitLines(git(wt, ["ls-files", "--stage"])).some((line) => line.startsWith("160000 "))) {
    return true;
  }
  const gitdir = git(wt, ["rev-parse", "--absolute-git-dir"]).trim();
  return isDirectory(join(gitdir, "modules"));
};

export const ignoreCheck = (main: string, wt: string, add: boolean): StatusObject => {
  const missing = (): readonly string[] =>
    (
      [
        [main, ".claude/worktrees/"],
        [wt, "work-reports/"],
      ] as const
    )
      .filter(([where, path]) => run(["git", "-C", where, "check-ignore", "-q", path]).code !== 0)
      .map(([, path]) => path);
  const notIgnored = missing();
  if (notIgnored.length === 0) {
    return { status: "ok", notIgnored: [], added: [] };
  }
  if (!add) {
    return { status: "ask", notIgnored };
  }
  const exclude = git(wt, [
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "info/exclude",
  ]).trim();
  mkdirSync(dirname(exclude), { recursive: true });
  const text = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  const lead = text !== "" && !text.endsWith("\n") ? "\n" : "";
  appendFileSync(exclude, lead + notIgnored.map((path) => `${path}\n`).join(""));
  const left = missing();
  if (left.length > 0) {
    return {
      status: "stop",
      reason: "still-not-ignored",
      message: `a .gitignore rule overrides info/exclude for ${left.join(", ")}`,
      notIgnored: left,
      added: notIgnored,
    };
  }
  return { status: "ok", notIgnored: [], added: notIgnored };
};
