import { DIGIT } from "../../../../scripts/pure/text.ts";

export const SEATS = ["a", "b"] as const;

export type Seat = (typeof SEATS)[number];

export const LEVEL_SEATS: Readonly<Record<string, readonly Seat[]>> = {
  standard: ["a"],
  high: SEATS,
};

export type ModelEffort = readonly [string, string];

export const AGENTS: Readonly<Record<string, Readonly<Record<string, ModelEffort>>>> = {
  "workflow-design": { standard: ["opus", "medium"], high: ["fable", "medium"] },
  "pj-planner": { standard: ["opus", "medium"], high: ["fable", "medium"] },
  "pj-reviewer": { standard: ["opus", "medium"], high: ["fable", "medium"] },
  "workflow-worker": { standard: ["opus", "medium"], high: ["opus", "high"] },
  "pj-issue-writer": { standard: ["opus", "medium"], high: ["opus", "high"] },
  "workflow-reviewer-a": { standard: ["opus", "high"], high: ["opus", "high"] },
  "workflow-reviewer-b": { high: ["fable", "medium"] },
};

export type RecordFields = {
  readonly level: string;
  readonly source: string;
  readonly tasks: number;
  readonly taskRounds: number;
  readonly integrationRounds: number;
  readonly findings: number;
};

const RECORD = new RegExp(
  `^Level: (${Object.keys(LEVEL_SEATS).join("|")}) \\((file|override|default)\\) · tasks (${DIGIT}+) · task rounds (${DIGIT}+) · integration rounds (${DIGIT}+) · findings (${DIGIT}+)$`,
  "u",
);

export const parseRecordLine = (line: string): RecordFields | null => {
  const found = RECORD.exec(line);
  if (found === null) {
    return null;
  }
  const [, level = "", source = "", tasks, taskRounds, integrationRounds, findings] = found;
  return {
    level,
    source,
    tasks: Number(tasks),
    taskRounds: Number(taskRounds),
    integrationRounds: Number(integrationRounds),
    findings: Number(findings),
  };
};

export const recordLine = (fields: RecordFields): string =>
  `Level: ${fields.level} (${fields.source}) · tasks ${fields.tasks} · task rounds ${fields.taskRounds} · integration rounds ${fields.integrationRounds} · findings ${fields.findings}`;
