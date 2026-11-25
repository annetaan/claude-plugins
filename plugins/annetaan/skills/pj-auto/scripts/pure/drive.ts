import type { Next } from "../../../pj1-plan/scripts/pure/project-view.ts";
import { splitLines } from "../../../../scripts/pure/text.ts";

export type Run = "doctor" | "running";
export type Skill = "pj3-doctor" | "pj4-running";
export type Level = "standard" | "high";
export type Reason =
  | "not-a-repo"
  | "no-claude"
  | "project"
  | "stop-requested"
  | "user"
  | "done"
  | "doctor-cap"
  | "child-failed"
  | "needs-user"
  | "bg-killed"
  | "no-progress";
export type Drive = {
  readonly i: number;
  readonly doctorKeys: readonly string[];
  readonly noLine: readonly number[];
};
export type End = { readonly reason: Reason; readonly next: Next | null; readonly message: string };
export type Denial = { readonly tool: unknown; readonly input: unknown };
export type Child = { readonly code: number; readonly out: string; readonly err: string };
export type StepPaths = { readonly dir: string; readonly out: string; readonly err: string };
export type Started =
  | { readonly kind: "end"; readonly end: End }
  | { readonly kind: "run"; readonly run: Run; readonly skill: Skill; readonly drive: Drive };
export type Ran =
  | { readonly kind: "end"; readonly end: End; readonly denials: readonly Denial[] }
  | {
      readonly kind: "step";
      readonly result: "done" | "no-line";
      readonly denials: readonly Denial[];
      readonly drive: Drive;
    };

const ended = (reason: Reason, next: Next | null, message: string): Started => ({
  kind: "end",
  end: { reason, next, message },
});

export const start = (drive: Drive, next: Next, stopRequested: boolean): Started => {
  if (stopRequested) {
    return ended("stop-requested", next, "stopped at the user's word");
  }
  if (next.next === "user" || next.next === "done") {
    return ended(next.next, next, next.why);
  }
  if (next.next === "doctor") {
    const key = next.issue === null ? "order" : String(next.issue);
    if (drive.doctorKeys.filter((held) => held === key).length >= 2) {
      return ended("doctor-cap", next, `pj3-doctor already ran twice on ${key}`);
    }
    return {
      kind: "run",
      run: "doctor",
      skill: "pj3-doctor",
      drive: { ...drive, i: drive.i + 1, doctorKeys: [...drive.doctorKeys, key] },
    };
  }
  return { kind: "run", run: "running", skill: "pj4-running", drive: { ...drive, i: drive.i + 1 } };
};

export const stepPaths = (log: string, i: number, run: Run): StepPaths => ({
  dir: `${log}/${i}-${run}`,
  out: `${log}/${i}-${run}.json`,
  err: `${log}/${i}-${run}.err`,
});

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parsedRecord = (text: string): Readonly<Record<string, unknown>> | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const denialsOf = (found: unknown): readonly Denial[] =>
  Array.isArray(found)
    ? found.filter(isRecord).map((entry): Denial => {
        const given = entry["tool_input"];
        const ti = isRecord(given) ? given : {};
        const input = Object.hasOwn(ti, "command")
          ? ti["command"]
          : Object.hasOwn(ti, "file_path")
            ? ti["file_path"]
            : JSON.stringify(ti);
        return { tool: entry["tool_name"] ?? null, input };
      })
    : [];

const BACKGROUND =
  /^Background tasks still running .+ after the last turn \((.*)\); stopping them\./u;

const backgroundTasks = (err: string): string | null =>
  splitLines(err).reduce<string | null>((found, line) => BACKGROUND.exec(line)?.[1] ?? found, null);

export const ran = (
  drive: Drive,
  skill: Skill,
  cur: Next,
  child: Child,
  files: { readonly out: string; readonly err: string },
): Ran => {
  const record = parsedRecord(child.out);
  const denials = denialsOf(record?.["permission_denials"]);
  const end = (reason: Reason, message: string): Ran => ({
    kind: "end",
    end: { reason, next: cur, message },
    denials,
  });
  if (child.code !== 0 || record === null || Boolean(record["is_error"])) {
    return end("child-failed", `${skill} failed: see ${files.err} and ${files.out}`);
  }
  const result = typeof record["result"] === "string" ? record["result"] : "";
  const last =
    splitLines(result)
      .map((line) => line.trim())
      .filter((line) => line !== "")
      .at(-1) ?? "";
  if (last.startsWith("unattended: needs-user")) {
    return end("needs-user", last);
  }
  if (last === "unattended: done") {
    return { kind: "step", result: "done", denials, drive };
  }
  const background = backgroundTasks(child.err);
  if (background !== null) {
    return end(
      "bg-killed",
      `claude -p stopped the background tasks of step ${drive.i}, still running after its wait: ${background}`,
    );
  }
  return {
    kind: "step",
    result: "no-line",
    denials,
    drive: { ...drive, noLine: [...drive.noLine, drive.i] },
  };
};

export const progress = (cur: Next, next: Next, i: number): End | null =>
  cur.fingerprint === next.fingerprint
    ? { reason: "no-progress", next, message: `the state did not change after step ${i}` }
    : null;

export const child = (
  skill: Skill,
  p: number,
  dir: string,
  level: Level | null,
  rules: readonly string[],
): { readonly argv: readonly string[]; readonly env: Readonly<Record<string, string>> } => ({
  argv: [
    "claude",
    "-p",
    `/annetaan:${skill} ${p} unattended tmp=${dir}${level === null ? "" : ` level=${level}`}`,
    "--permission-mode",
    "auto",
    "--allowedTools",
    ...rules,
    "--add-dir",
    dir,
    "--output-format",
    "json",
  ],
  env: { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "3600000" },
});

export const startedLine = (log: string, main: string, project: number) => ({
  status: "started" as const,
  log,
  main,
  project,
});

export const beginLine = (
  i: number,
  run: Run,
  cur: Next,
  at: string,
  paths: StepPaths,
  log: string,
) => ({
  status: "begin" as const,
  i,
  run,
  why: cur.why,
  issue: cur.issue,
  at,
  dir: paths.dir,
  out: paths.out,
  err: paths.err,
  log,
});

export const stepLine = (
  i: number,
  run: Run,
  cur: Next,
  at: string,
  log: string,
  result: "done" | "no-line",
  denials: readonly Denial[],
) => ({
  status: "step" as const,
  i,
  run,
  why: cur.why,
  issue: cur.issue,
  at,
  log,
  result,
  denials,
});

export const endedLine = (
  end: End,
  noLine: readonly number[],
  i: number | null,
  denials: readonly Denial[],
  log: string,
) => ({
  status: "ended" as const,
  reason: end.reason,
  next: end.next,
  message: end.message,
  noLine,
  i,
  denials,
  log,
});
