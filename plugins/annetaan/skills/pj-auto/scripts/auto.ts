import { spawn } from "node:child_process";
import {
  accessSync,
  appendFileSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { environment, run } from "../../../scripts/command.ts";
import { mainWorktree } from "../../../scripts/clone.ts";
import { entry, Failure, statusLine, UsageError } from "../../../scripts/status.ts";
import { readNext } from "../../pj1-plan/scripts/project.ts";
import type { Next } from "../../pj1-plan/scripts/pure/project-view.ts";
import {
  beginLine,
  child,
  endedLine,
  progress,
  ran,
  start,
  startedLine,
  stepLine,
  stepPaths,
  type Denial,
  type Drive,
  type End,
  type Level,
} from "./pure/drive.ts";
import { baseRules, judge, settingsOf, type FileLists } from "./pure/rules.ts";

const USAGE = `usage: auto.sh <P> --log <dir> [--level <level>]   drive project <P> until it needs the user, logging into the existing directory <dir>;
                                               --level passes level=<level>, standard or high, to every run
usage: auto.sh --rules                         judge the rules every drive grants its runs against the deny and ask rules of the user's settings
In the drive form, every line on standard output is one JSON object with "status": started, begin, step or ended.
Create <dir>/stop to end the drive after the current step.
Exit 1 means a usage error. Otherwise it exits 0.
`;

const isExecutableFile = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const onPath = (name: string): boolean =>
  (process.env["PATH"] ?? "")
    .split(delimiter)
    .filter((dir) => dir !== "")
    .some((dir) => isExecutableFile(join(dir, name)));

const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");

const skillsDir = (): string =>
  resolve(dirname(process.argv[1] ?? fileURLToPath(import.meta.url)), "../..");

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const settingsFile = (
  file: string,
): { readonly settings: Readonly<Record<string, unknown>>; readonly lists: FileLists } => {
  const empty = { file, lists: { deny: [], ask: [] } };
  if (!existsSync(file)) {
    return { settings: { file, exists: false, error: null }, lists: empty };
  }
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return { settings: { file, exists: true, error: messageOf(error) }, lists: empty };
  }
  const read = settingsOf(text);
  if ("error" in read) {
    return { settings: { file, exists: true, error: read.error }, lists: empty };
  }
  return { settings: { file, exists: true, error: null }, lists: { file, lists: read } };
};

const rulesForm = (): string => {
  const main = mainWorktree();
  if (main === null) {
    throw new Failure("not inside a git repository");
  }
  const home = homedir();
  const read = [
    join(process.env["CLAUDE_CONFIG_DIR"] || join(home, ".claude"), "settings.json"),
    join(main, ".claude", "settings.json"),
    join(main, ".claude", "settings.local.json"),
  ].map(settingsFile);
  const fileLists = read.map((file) => file.lists);
  return statusLine({
    status: "rules",
    main,
    base: baseRules(skillsDir()).map((rule) => judge(rule, fileLists, home)),
    settings: read.map((file) => file.settings),
  });
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const levelOf = (args: readonly string[]): Level | null => {
  if (args.length === 3) {
    return null;
  }
  const level = args[4];
  if (args[3] !== "--level" || (level !== "standard" && level !== "high")) {
    throw new UsageError("");
  }
  return level;
};

const driveForm = (args: readonly string[]): string => {
  if ((args.length !== 3 && args.length !== 5) || args[1] !== "--log") {
    throw new UsageError("");
  }
  const level = levelOf(args);
  const [project = "", , given = ""] = args;
  if (!/^[0-9]+$/u.test(project)) {
    throw new Failure(`the project must be a number: ${project}`);
  }
  if (!isDirectory(given)) {
    throw new Failure(`no such directory: ${given}`);
  }
  const log = resolve(given);
  const p = Number(project);

  const emit = (line: string): void => {
    process.stdout.write(line);
    appendFileSync(join(log, "drive.jsonl"), line);
  };
  const finish = (
    end: End,
    noLine: readonly number[],
    i: number | null,
    denials: readonly Denial[],
  ): string => {
    emit(statusLine(endedLine(end, noLine, i, denials, log)));
    return "";
  };

  const main = mainWorktree();
  if (main === null) {
    emit(statusLine(startedLine(log, "", p)));
    return finish(
      { reason: "not-a-repo", next: null, message: "not inside a git repository" },
      [],
      null,
      [],
    );
  }
  if (!onPath("claude")) {
    emit(statusLine(startedLine(log, main, p)));
    return finish(
      { reason: "no-claude", next: null, message: "the claude CLI is not installed" },
      [],
      null,
      [],
    );
  }
  emit(statusLine(startedLine(log, main, p)));

  if (onPath("caffeinate")) {
    const held = spawn("caffeinate", ["-i", "-w", String(process.pid)], {
      detached: true,
      stdio: "ignore",
    });
    held.on("error", () => undefined);
    held.unref();
  }

  const next = (): Next | End => {
    try {
      return readNext(p, main);
    } catch (error) {
      if (error instanceof Failure) {
        return { reason: "project", next: null, message: `project: ${error.message}` };
      }
      throw error;
    }
  };
  const isEnd = (value: Next | End): value is End => "reason" in value;

  const rules = baseRules(skillsDir());
  let drive: Drive = { i: 0, doctorKeys: [], noLine: [] };
  let cur = next();
  if (isEnd(cur)) {
    return finish(cur, drive.noLine, null, []);
  }
  for (;;) {
    const s = start(drive, cur, existsSync(join(log, "stop")));
    if (s.kind === "end") {
      return finish(s.end, drive.noLine, null, []);
    }
    drive = s.drive;
    const paths = stepPaths(log, drive.i, s.run);
    try {
      mkdirSync(paths.dir);
    } catch {
      return finish(
        { reason: "child-failed", next: cur, message: `cannot create ${paths.dir}` },
        drive.noLine,
        drive.i,
        [],
      );
    }
    emit(statusLine(beginLine(drive.i, s.run, cur, now(), paths, log)));
    const c = child(s.skill, p, paths.dir, level, rules);
    const result = run(c.argv, { cwd: main, env: environment(c.env) });
    writeFileSync(paths.out, result.stdout);
    writeFileSync(paths.err, result.stderr);
    const r = ran(
      drive,
      s.skill,
      cur,
      { code: result.code, out: result.stdout, err: result.stderr },
      paths,
    );
    if (r.kind === "end") {
      return finish(r.end, drive.noLine, drive.i, r.denials);
    }
    drive = r.drive;
    emit(statusLine(stepLine(drive.i, s.run, cur, now(), log, r.result, r.denials)));
    const n = next();
    if (isEnd(n)) {
      return finish(n, drive.noLine, null, []);
    }
    const stalled = progress(cur, n, drive.i);
    if (stalled !== null) {
      return finish(stalled, drive.noLine, null, []);
    }
    cur = n;
  }
};

const main = (args: readonly string[]): string =>
  args.length === 1 && args[0] === "--rules" ? rulesForm() : driveForm(args);

entry(import.meta.url, "auto", USAGE, main);
