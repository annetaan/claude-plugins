import { run } from "../../../scripts/command.ts";
import { fetchBranch } from "../../../scripts/fetch.ts";
import { squeeze } from "../../../scripts/pure/text.ts";
import { entry, Failure, statusLine, stop, UsageError } from "../../../scripts/status.ts";
import {
  historyGroups,
  parseLevelFile,
  PATH_IN_REPO,
  showFields,
  type LevelRead,
  type MergedPr,
} from "./pure/level-file.ts";

const USAGE = `usage: level.sh show <dir> [<level>]                the level of the clone at <dir>, read from .claude/annetaan-level.md on
                                                    origin's default branch, and the model and effort it gives each levelled
                                                    agent. <level>, standard or high, overrides it
       level.sh history <dir>                       the Level: lines of the pull requests merged since the level file's
                                                    evaluated date, grouped by level and source
Every subcommand prints one JSON object with "status" and exits 0.
Exit 1 means a usage error, or <dir> is not inside a git clone.
`;

const oneLine = (text: string, fallback: string): string => squeeze(text) || fallback;

const DEFAULT_HEAD = /^ref: refs\/heads\/(\S+)\tHEAD$/mu;

const readFile = (where: string): LevelRead => {
  const listed = run(["git", "-C", where, "ls-remote", "--symref", "origin", "HEAD"]);
  if (listed.code !== 0) {
    return { problem: oneLine(listed.stderr, "git ls-remote failed") };
  }
  const branch = DEFAULT_HEAD.exec(listed.stdout)?.[1];
  if (branch === undefined) {
    return { problem: "origin names no default branch" };
  }
  const fetched = fetchBranch(where, branch);
  if (fetched.code !== 0) {
    return { problem: oneLine(fetched.stderr, "git fetch failed") };
  }
  const ref = `origin/${branch}`;
  const shown = run(["git", "-C", where, "show", `${ref}:${PATH_IN_REPO}`]);
  return { problem: null, ref, text: shown.code === 0 ? shown.stdout : null };
};

const cloneDir = (where: string): string => {
  if (run(["git", "-C", where, "rev-parse", "--git-dir"]).code !== 0) {
    throw new Failure(`not inside a git clone: ${where}`);
  }
  return where;
};

const today = (): string => {
  const now = new Date();
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
};

const show = (dir: string, override: string | null): string => {
  const where = cloneDir(dir);
  return statusLine({ status: "ok", ...showFields(readFile(where), override, today()) });
};

const history = (dir: string): string => {
  const where = cloneDir(dir);
  const read = readFile(where);
  let since: string | null = null;
  if (read.problem === null && read.text !== null) {
    const file = parseLevelFile(read.text);
    if (file.invalid === null) {
      since = file.evaluated;
    }
  }
  const cmd = [
    "gh",
    "pr",
    "list",
    "--state",
    "merged",
    "--limit",
    "1000",
    "--json",
    "number,url,body,mergedAt",
    ...(since === null ? [] : ["--search", `merged:>${since}`]),
  ];
  const listed = run(cmd, { cwd: where });
  if (listed.code !== 0) {
    stop("gh", oneLine(listed.stderr, "gh pr list failed"));
  }
  let prs: readonly MergedPr[] = [];
  try {
    prs = JSON.parse(listed.stdout) as readonly MergedPr[];
  } catch {
    stop("gh", `gh pr list printed no JSON: ${oneLine(listed.stdout, "empty output")}`);
  }
  return statusLine({ status: "ok", since, prs: prs.length, ...historyGroups(prs) });
};

const main = (args: readonly string[]): string => {
  const [sub, dir, level, ...rest] = args;
  if (sub === "show" && dir !== undefined && rest.length === 0) {
    if (level === undefined || level === "standard" || level === "high") {
      return show(dir, level ?? null);
    }
  }
  if (sub === "history" && dir !== undefined && level === undefined) {
    return history(dir);
  }
  throw new UsageError("");
};

entry(import.meta.url, "level", USAGE, main);
