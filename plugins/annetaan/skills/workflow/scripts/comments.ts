import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git, run, type RunOptions } from "../../../scripts/command.ts";
import { entry, Failure, UsageError, type Output } from "../../../scripts/status.ts";
import {
  addedLines,
  buildReport,
  changedPaths,
  judge,
  languageOf,
  parseArgs,
  type Args,
  type Judged,
  type Language,
  type Scanned,
} from "./pure/comment-check.ts";
import { nulSplit } from "./pure/include-rules.ts";

const USAGE = `usage: comments.sh [--library] [<ref>]
       comments.sh [--library] --all`;

const environment = (
  extra: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> => ({
  ...Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  ),
  ...extra,
});

const regularFile = (path: string): boolean => {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
};

const decoder = new TextDecoder("utf-8", { fatal: true });

const judgeFile = (language: Language, path: string): Judged => {
  let text: string;
  try {
    text = decoder.decode(readFileSync(path));
  } catch (error) {
    if (error instanceof TypeError) {
      return { read: false };
    }
    throw error;
  }
  return judge(language, text);
};

const scratchIndex = (top: string, untracked: readonly string[], scratch: string): RunOptions => {
  const index = join(scratch, "index");
  const real = resolve(top, git(top, ["rev-parse", "--git-path", "index"]).trim());
  if (existsSync(real)) {
    cpSync(real, index, { preserveTimestamps: true });
  }
  const options = { env: environment({ GIT_INDEX_FILE: index }) };
  if (untracked.length > 0) {
    git(
      top,
      ["--literal-pathspecs", "add", "-N", "--pathspec-from-file=-", "--pathspec-file-nul"],
      { ...options, input: untracked.map((path) => `${path}\0`).join("") },
    );
  }
  return options;
};

const scan = (
  top: string,
  args: Args,
  names: readonly string[],
  origins: ReadonlyMap<string, string>,
  options: RunOptions,
): readonly Scanned[] =>
  [...new Set(names)].toSorted().flatMap((path) => {
    const language = languageOf(path);
    const full = join(top, path);
    if (language === null || !regularFile(full)) {
      return [];
    }
    const added = args.every
      ? null
      : addedLines(
          git(
            top,
            [
              "--literal-pathspecs",
              "diff",
              "-U0",
              "-M",
              "--no-color",
              "--no-ext-diff",
              args.ref,
              "--",
              origins.get(path) ?? path,
              path,
            ],
            options,
          ),
        );
    return [{ path, judged: judgeFile(language, full), added }];
  });

const report = (top: string, args: Args, scratch: string): Output => {
  const untracked = nulSplit(git(top, ["ls-files", "-z", "--others", "--exclude-standard"]));
  const sortedUntracked = [...new Set(untracked)].toSorted();
  let files: readonly Scanned[];
  if (args.every) {
    const names = [...nulSplit(git(top, ["ls-files", "-z"])), ...sortedUntracked];
    files = scan(top, args, names, new Map(), {});
  } else {
    if (
      run(["git", "-C", top, "rev-parse", "--verify", "--quiet", `${args.ref}^{commit}`]).code !== 0
    ) {
      throw new Failure(`unknown ref: ${args.ref}`);
    }
    const options = scratchIndex(top, sortedUntracked, scratch);
    const origins = changedPaths(
      nulSplit(
        git(top, ["diff", "-z", "--name-status", "-M", "--diff-filter=d", args.ref, "--"], options),
      ),
    );
    files = scan(top, args, [...origins.keys()], origins, options);
  }
  const built = buildReport(args, files);
  const out = `${JSON.stringify(built, null, 1)}\n`;
  return built.status === "found" ? { out, code: 1 } : out;
};

const main = (argv: readonly string[]): Output => {
  const args = parseArgs(argv);
  if (args === null) {
    throw new UsageError("");
  }
  const toplevel = run(["git", "rev-parse", "--show-toplevel"]);
  if (toplevel.code !== 0) {
    throw new Failure("not inside a git work tree");
  }
  const scratch = mkdtempSync(join(tmpdir(), "comments-"));
  try {
    return report(toplevel.stdout.trim(), args, scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

entry(import.meta.url, "comments", USAGE, main, { usage: 2, failure: 2 });
