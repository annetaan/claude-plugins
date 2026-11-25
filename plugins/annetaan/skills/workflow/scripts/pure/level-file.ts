import { splitLines } from "../../../../scripts/pure/text.ts";
import { AGENTS, LEVEL_SEATS, parseRecordLine, type RecordFields } from "./agent-table.ts";

export const PATH_IN_REPO = ".claude/annetaan-level.md";

export const DEFAULT_LEVEL = "standard";

const SOURCE_ORDER = ["file", "default", "override"];

export type LevelFile =
  | {
      readonly invalid: null;
      readonly level: string;
      readonly evaluated: string;
      readonly reviewBy: string;
    }
  | { readonly invalid: string };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const isDate = (text: string): boolean => {
  const found = ISO_DATE.exec(text);
  if (found === null) {
    return false;
  }
  const [, year, month, day] = found.map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days;
};

export const parseLevelFile = (text: string): LevelFile => {
  const lines = splitLines(text);
  const close = lines.indexOf("---", 1);
  if (lines[0] !== "---" || close === -1) {
    return { invalid: "no front matter between two --- lines" };
  }
  const fields = new Map<string, string>();
  for (const line of lines.slice(1, close)) {
    const at = line.indexOf(":");
    if (at !== -1) {
      fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
    }
  }
  const level = fields.get("level") ?? "";
  if (!Object.hasOwn(LEVEL_SEATS, level)) {
    return { invalid: "level is not standard or high" };
  }
  const evaluated = fields.get("evaluated") ?? "";
  const reviewBy = fields.get("review-by") ?? "";
  if (!isDate(evaluated) || !isDate(reviewBy)) {
    return { invalid: "evaluated and review-by are not both dates as YYYY-MM-DD" };
  }
  return { invalid: null, level, evaluated, reviewBy };
};

export type AgentSetting = { readonly model: string; readonly effort: string };

export const showAgents = (level: string): Readonly<Record<string, AgentSetting>> =>
  Object.fromEntries(
    Object.keys(AGENTS).flatMap((name) => {
      const found = AGENTS[name]?.[level];
      return found === undefined ? [] : [[name, { model: found[0], effort: found[1] }]];
    }),
  );

export type LevelRead =
  | { readonly problem: string }
  | { readonly problem: null; readonly ref: string; readonly text: string | null };

export const showFields = (
  read: LevelRead,
  override: string | null,
  today: string,
): Readonly<Record<string, unknown>> => {
  let level = DEFAULT_LEVEL;
  let source = "default";
  let evaluated: string | null = null;
  let reviewBy: string | null = null;
  let warning: string | null = null;
  if (read.problem !== null) {
    warning = `cannot read origin's default branch: ${read.problem}; level ${DEFAULT_LEVEL} unless overridden`;
  } else if (read.text !== null) {
    const file = parseLevelFile(read.text);
    if (file.invalid !== null) {
      warning = `${read.ref}:${PATH_IN_REPO}: ${file.invalid}; ignored`;
    } else {
      level = file.level;
      source = "file";
      evaluated = file.evaluated;
      reviewBy = file.reviewBy;
      if (file.reviewBy < today) {
        warning = `${read.ref}:${PATH_IN_REPO}: review-by ${file.reviewBy} has passed; /annetaan:level re-evaluates it`;
      }
    }
  }
  if (override !== null) {
    level = override;
    source = "override";
  }
  return {
    level,
    source,
    ref: read.problem === null ? read.ref : null,
    evaluated,
    reviewBy,
    warning,
    agents: showAgents(level),
    seats: [...(LEVEL_SEATS[level] ?? [])],
  };
};

const SCALE = 100;

export const perTask = (value: number, tasks: number): number | null => {
  if (tasks === 0) {
    return null;
  }
  const x = value / tasks;
  const eighths = x * 8;
  if (Number.isInteger(eighths) && eighths % 2 !== 0) {
    const low = Math.floor(x * SCALE);
    return (low % 2 === 0 ? low : low + 1) / SCALE;
  }
  return Number(x.toFixed(2));
};

export type MergedPr = {
  readonly number: number;
  readonly url: string;
  readonly body: string;
  readonly mergedAt: string;
};

export type Run = RecordFields & {
  readonly pr: number;
  readonly url: string;
  readonly mergedAt: string;
};

export type Group = {
  readonly level: string;
  readonly source: string;
  readonly runs: number;
  readonly tasks: number;
  readonly taskRounds: number;
  readonly integrationRounds: number;
  readonly findings: number;
  readonly sendBacks: number;
  readonly sendBacksPerTask: number | null;
  readonly findingsPerTask: number | null;
};

export type Unread = { readonly pr: number; readonly line: string };

export type History = {
  readonly runs: readonly Run[];
  readonly groups: readonly Group[];
  readonly unread: readonly Unread[];
};

const rank = (group: Pick<Group, "level" | "source">): readonly [number, number] => [
  Object.keys(LEVEL_SEATS).indexOf(group.level),
  SOURCE_ORDER.indexOf(group.source),
];

export const historyGroups = (prs: readonly MergedPr[]): History => {
  const runs: Run[] = [];
  const unread: Unread[] = [];
  for (const pr of prs) {
    let last: RecordFields | null = null;
    for (const raw of pr.body.split("\n")) {
      const line = raw.replace(/\r+$/, "");
      const found = parseRecordLine(line);
      if (found !== null) {
        last = found;
      } else if (line.startsWith("Level: ")) {
        unread.push({ pr: pr.number, line });
      }
    }
    if (last !== null) {
      runs.push({ pr: pr.number, url: pr.url, mergedAt: pr.mergedAt, ...last });
    }
  }
  const sorted = runs.toSorted((a, b) =>
    a.mergedAt < b.mergedAt ? -1 : a.mergedAt > b.mergedAt ? 1 : 0,
  );
  const totals = new Map<
    string,
    Omit<Group, "sendBacks" | "sendBacksPerTask" | "findingsPerTask">
  >();
  for (const run of sorted) {
    const key = `${run.level}\0${run.source}`;
    const g = totals.get(key) ?? {
      level: run.level,
      source: run.source,
      runs: 0,
      tasks: 0,
      taskRounds: 0,
      integrationRounds: 0,
      findings: 0,
    };
    totals.set(key, {
      ...g,
      runs: g.runs + 1,
      tasks: g.tasks + run.tasks,
      taskRounds: g.taskRounds + run.taskRounds,
      integrationRounds: g.integrationRounds + run.integrationRounds,
      findings: g.findings + run.findings,
    });
  }
  const groups = [...totals.values()]
    .toSorted((a, b) => {
      const [al, as] = rank(a);
      const [bl, bs] = rank(b);
      return al - bl || as - bs;
    })
    .map((g) => {
      const sendBacks = g.taskRounds - g.tasks;
      return {
        ...g,
        sendBacks,
        sendBacksPerTask: perTask(sendBacks, g.tasks),
        findingsPerTask: perTask(g.findings, g.tasks),
      };
    });
  return { runs: sorted, groups, unread };
};
