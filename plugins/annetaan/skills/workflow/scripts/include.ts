import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "../../../scripts/command.ts";
import { realPath, worktreeList } from "../../../scripts/clone.ts";
import { entry, Failure, stop, statusLine, UsageError } from "../../../scripts/status.ts";
import {
  decidedRules,
  LIST,
  nulSplit,
  pattern,
  sortOut,
  type IncludeResult,
} from "./pure/include-rules.ts";

export type { IncludeResult };

const USAGE = `usage: include.sh remember <worktree> [--copy <path>]... [--never <path>]...
                                  append /<path> for each --copy and !/<path> for each --never to <MAIN>/.worktreeinclude,
                                  then copy the listed ignored files into <worktree>. Every <path> has to be one of the
                                  worktree's unlisted files, and at least one is given
Prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
`;

const gitOut = (where: string, args: readonly string[], input = "", ok = [0]): string => {
  const result = run(["git", "-C", where, ...args], { input });
  if (!ok.includes(result.code)) {
    throw new Failure(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
};

const others = (main: string, excludes: readonly string[]): ReadonlySet<string> =>
  new Set(nulSplit(gitOut(main, ["ls-files", "-z", "--others", "--ignored", ...excludes])));

const ignoredIn = (wt: string, paths: readonly string[]): ReadonlySet<string> =>
  paths.length === 0
    ? new Set()
    : new Set(
        nulSplit(
          gitOut(
            wt,
            ["check-ignore", "-z", "--stdin"],
            paths.map((p) => `${p}\0`).join(""),
            [0, 1],
          ),
        ),
      );

const exists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const decidedBy = (main: string, text: string): ReadonlySet<string> => {
  const dir = mkdtempSync(join(tmpdir(), "include-"));
  try {
    const rules = join(dir, LIST);
    writeFileSync(rules, decidedRules(text));
    return others(main, [`--exclude-from=${rules}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const survey = (wt: string): { readonly main: string; readonly found: IncludeResult } => {
  const main = worktreeList(wt)[0]?.path;
  if (main === undefined) {
    throw new Failure(`git worktree list names no worktree for ${wt}`);
  }
  const rules = join(main, LIST);
  const candidates = new Set(
    [...others(main, ["--exclude-standard", "--directory", "--no-empty-directory"])].filter(
      (p) => !p.endsWith("/"),
    ),
  );
  const listed = existsSync(rules);
  const matched = listed ? others(main, [`--exclude-from=${rules}`]) : new Set<string>();
  const decided = listed ? decidedBy(main, readFileSync(rules, "utf8")) : new Set<string>();
  const all = [...new Set([...matched, ...candidates])].toSorted((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const ignored = ignoredIn(wt, all);
  const present = new Set(all.filter((p) => exists(join(wt, p))));
  return { main, found: sortOut({ matched, candidates, decided, ignored, present }) };
};

export const includeIgnored = (wt: string): IncludeResult => {
  const { main, found } = survey(wt);
  for (const path of found.copied) {
    const dst = join(wt, path);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(join(main, path), dst, { verbatimSymlinks: true, preserveTimestamps: true });
  }
  return found;
};

const linked = (wt: string): boolean => {
  let entries;
  try {
    entries = worktreeList(wt);
  } catch {
    return false;
  }
  const real = realPath(wt);
  return entries.slice(1).some((e) => realPath(e.path) === real && !e.prunable);
};

type Pair = { readonly flag: string; readonly path: string };

const remember = (wt: string, pairs: readonly Pair[]): string => {
  if (!linked(wt)) {
    stop("unknown", `${wt} is no linked worktree of a clone`);
  }
  const { main, found } = survey(wt);
  const unlisted = new Set(found.unlisted);
  const missing = [...new Set(pairs.map((p) => p.path))]
    .filter((p) => !unlisted.has(p))
    .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (missing.length > 0) {
    stop("not-unlisted", `not unlisted in ${wt}: ${missing.join(", ")}`, { paths: missing });
  }
  const added = pairs.map((p) => pattern(p.path, p.flag === "--never"));
  const rules = join(main, LIST);
  const text = existsSync(rules) ? readFileSync(rules, "utf8") : "";
  const lead = text !== "" && !text.endsWith("\n") ? "\n" : "";
  appendFileSync(rules, lead + added.map((line) => `${line}\n`).join(""));
  return statusLine({ status: "ok", added, ...includeIgnored(wt) });
};

const main = (args: readonly string[]): string => {
  const [sub, wt, ...rest] = args;
  if (sub !== "remember" || wt === undefined || rest.length < 2 || rest.length % 2 !== 0) {
    throw new UsageError("");
  }
  const pairs: Pair[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i] ?? "";
    if (flag !== "--copy" && flag !== "--never") {
      throw new UsageError("");
    }
    pairs.push({ flag, path: rest[i + 1] ?? "" });
  }
  return remember(wt, pairs);
};

entry(import.meta.url, "include", USAGE, main);
