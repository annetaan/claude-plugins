import { WORD } from "../../../../scripts/pure/text.ts";

export type Lists = { readonly deny: readonly string[]; readonly ask: readonly string[] };
export type Settings = Lists | { readonly error: string };
export type FileLists = { readonly file: string; readonly lists: Lists };
export type Verdict = {
  readonly rule: string;
  readonly verdict: "granted" | "blocked";
  readonly file: string | null;
  readonly by: string | null;
};

export const baseRules = (skills: string): readonly string[] => [
  "Bash(gh:*)",
  "Bash(git:*)",
  `Bash(${skills}/pj1-plan/scripts/project.sh:*)`,
  `Bash(${skills}/pj1-plan/scripts/issue.sh:*)`,
  `Bash(${skills}/pj4-running/scripts/run.sh:*)`,
  `Bash(${skills}/workflow/scripts/flow.sh:*)`,
  `Bash(${skills}/workflow/scripts/level.sh:*)`,
  `Bash(${skills}/workflow/scripts/comments.sh:*)`,
  `Read(/${skills}/**)`,
];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const settingsOf = (text: string): Settings => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const permissions = isRecord(parsed) ? parsed["permissions"] : undefined;
  if (!isRecord(permissions)) {
    return { deny: [], ask: [] };
  }
  return { deny: strings(permissions["deny"]), ask: strings(permissions["ask"]) };
};

const RULE = new RegExp(`^([${WORD}]+)(?:\\((.*)\\))?$`, "su");

type Parsed = { readonly tool: string; readonly arg: string | undefined };

const parse = (rule: string): Parsed | null => {
  const found = RULE.exec(rule);
  const tool = found?.[1];
  return tool === undefined ? null : { tool, arg: found?.[2] };
};

const atBoundary = (s: string, prefix: string): boolean =>
  s === prefix || s.startsWith(`${prefix} `);

const readPath = (arg: string, home: string): string | null => {
  if (arg.startsWith("~/")) {
    const rest = arg.slice(2);
    if (rest.startsWith("/")) {
      return rest;
    }
    return home.endsWith("/") ? home + rest : `${home}/${rest}`;
  }
  return arg.startsWith("//") ? arg.slice(1) : null;
};

const under = (path: string, d: string): boolean =>
  path === d || path.startsWith(`${d.replace(/\/+$/u, "")}/`);

const bashBlocks = (have: string, need: string): boolean => {
  const want = need.slice(0, -2);
  const command = have.endsWith(":*") || have.endsWith(" *") ? have.slice(0, -2) : have;
  return atBoundary(want, command) || atBoundary(command, want);
};

const readBlocks = (have: string, need: string, home: string): boolean => {
  const needPath = readPath(need, home);
  const path = readPath(have, home);
  if (needPath === null || path === null) {
    return false;
  }
  const want = needPath.slice(0, -3);
  const glob = path.endsWith("/**");
  return (glob && under(want, path.slice(0, -3))) || under(glob ? path.slice(0, -3) : path, want);
};

export const blocks = (have: string, need: string, home: string): boolean => {
  if (have === need) {
    return true;
  }
  const h = parse(have);
  const n = parse(need);
  if (h === null || n === null || h.tool !== n.tool) {
    return false;
  }
  if (h.arg === undefined || (h.tool === "Bash" && h.arg === "*")) {
    return true;
  }
  if (n.arg === undefined) {
    return false;
  }
  if (n.tool === "Bash") {
    return bashBlocks(h.arg, n.arg);
  }
  return n.tool === "Read" && readBlocks(h.arg, n.arg, home);
};

export const judge = (rule: string, files: readonly FileLists[], home: string): Verdict => {
  for (const kind of ["deny", "ask"] as const) {
    for (const { file, lists } of files) {
      const by = lists[kind].find((have) => blocks(have, rule, home));
      if (by !== undefined) {
        return { rule, verdict: "blocked", file, by };
      }
    }
  }
  return { rule, verdict: "granted", file: null, by: null };
};
