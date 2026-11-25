import { basename } from "node:path";
import { DIGIT, WORD, escapeRegExp, wordBoundary } from "../../../../scripts/pure/text.ts";
import { cap } from "./cap.ts";
import type { PullRequestView } from "./github.ts";

type JsonObject = Readonly<Record<string, unknown>>;

export type PrLink = { readonly repo: unknown; readonly number: unknown; readonly at: unknown };

export type Turn =
  | { readonly at: string | null; readonly kind: "message"; readonly text: string }
  | {
      readonly at: string | null;
      readonly kind: "command";
      readonly command: string;
      readonly args: string;
    }
  | {
      readonly at: string | null;
      readonly kind: "answer";
      readonly answers: readonly { readonly question: string; readonly answer: string }[];
      readonly notes: Readonly<Record<string, string>>;
    }
  | { readonly at: string | null; readonly kind: "refusal"; readonly text: string }
  | { readonly at: string | null; readonly kind: "interrupt" };

export type SessionLog = {
  readonly entrypoint: string | null;
  readonly cwd: string | null;
  readonly branches: readonly string[];
  readonly prLinks: readonly PrLink[];
  readonly first: string | null;
  readonly last: string | null;
  readonly cwds: readonly string[];
  readonly talk: string;
  readonly turns: readonly Turn[];
};

export type Session = {
  readonly file: string;
  readonly session: string;
  readonly why: readonly string[];
  readonly entrypoint: string | null;
  readonly cwd: string | null;
  readonly branches: readonly string[];
  readonly prLinks: readonly PrLink[];
  readonly first: string | null;
  readonly last: string | null;
  readonly cwds: readonly string[];
  readonly turns: readonly Turn[];
};

const SKIP_PREFIXES: readonly string[] = [
  "Another Claude session sent a message",
  "<task-notification>",
  "<local-command-",
  "Caveat: The messages below",
  "This session is being continued from a previous conversation",
];

const LINE_BREAK = /\r\n|\r|\n/u;
const REMINDER = /<system-reminder>.*?<\/system-reminder>/gsu;
const COMMAND_NAME = /<command-name>(.*?)<\/command-name>/su;
const COMMAND_ARGS = /<command-args>(.*?)<\/command-args>/su;
const OPENING_TAG = /^<[a-z-]+>/u;
const TAGGED = /<[^>]+>.*?<\/[^>]+>/gsu;
const OUTSIDE_MARKUP = /[^\s<>]/u;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const get = (object: JsonObject, key: string): unknown =>
  Object.hasOwn(object, key) ? object[key] : null;

const filled = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isObject(value)) {
    return Object.keys(value).length > 0;
  }
  return value !== null && value !== false && value !== 0 && value !== "";
};

const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

const textOf = (value: unknown): string => (typeof value === "string" ? value : "");

const stripReminders = (text: string): string => text.replace(REMINDER, "").trim();

const parsedLine = (line: string): JsonObject | null => {
  try {
    const value: unknown = JSON.parse(line);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
};

const callsPrHumans = (part: unknown): boolean => {
  if (!isObject(part) || get(part, "type") !== "tool_use" || get(part, "name") !== "Skill") {
    return false;
  }
  const input = get(part, "input");
  return isObject(input) && textOf(get(input, "skill")).includes("pr-humans");
};

const refused = (body: string): boolean => {
  const lower = body.toLowerCase();
  return (
    body.includes("doesn't want to proceed") ||
    lower.includes("user rejected") ||
    lower.includes("the user said:")
  );
};

const markupOnly = (text: string): boolean =>
  text.startsWith("<") && OPENING_TAG.test(text) && !OUTSIDE_MARKUP.test(text.replace(TAGGED, ""));

const answerTurn = (at: string | null, result: JsonObject, answers: JsonObject): Turn => {
  const annotations = get(result, "annotations");
  return {
    at,
    kind: "answer",
    answers: Object.entries(answers).map(([question, answer]: readonly [string, unknown]) => ({
      question: cap(question, 400),
      answer: cap(stringOrNull(answer), 400),
    })),
    notes: Object.fromEntries(
      Object.entries(isObject(annotations) ? annotations : {}).flatMap(
        ([key, value]: readonly [string, unknown]) =>
          isObject(value) && filled(get(value, "notes"))
            ? [[cap(key, 200), cap(stringOrNull(get(value, "notes")), 400)]]
            : [],
      ),
    ),
  };
};

export const humanTurns = (log: string): SessionLog => {
  const turns: Turn[] = [];
  const talk: string[] = [];
  const branches = new Set<string>();
  const cwds = new Set<string>();
  const prLinks: PrLink[] = [];
  let entrypoint: string | null = null;
  let cwd: string | null = null;
  let first: string | null = null;
  let last: string | null = null;
  let inRun = false;
  let lastMessage: readonly [number, number] | null = null;
  for (const line of log.split(LINE_BREAK)) {
    const row = parsedLine(line);
    if (row === null) {
      continue;
    }
    const type = get(row, "type");
    if (type === "pr-link") {
      prLinks.push({
        repo: get(row, "prRepository"),
        number: get(row, "prNumber"),
        at: get(row, "timestamp"),
      });
      continue;
    }
    if ((type !== "user" && type !== "assistant") || filled(get(row, "isSidechain"))) {
      continue;
    }
    const at = stringOrNull(get(row, "timestamp"));
    const rowCwd = stringOrNull(get(row, "cwd"));
    first = first || at;
    last = at || last;
    entrypoint = entrypoint || stringOrNull(get(row, "entrypoint"));
    cwd = cwd || rowCwd;
    if (!inRun) {
      if (rowCwd !== null && rowCwd !== "") {
        cwds.add(rowCwd);
      }
      const branch = stringOrNull(get(row, "gitBranch"));
      if (branch !== null && branch !== "") {
        branches.add(branch);
      }
    }
    const message = get(row, "message");
    const content = isObject(message) ? get(message, "content") : null;
    if (type === "assistant") {
      if (!Array.isArray(content)) {
        continue;
      }
      if (content.some(callsPrHumans)) {
        if (!inRun && lastMessage !== null) {
          turns.splice(lastMessage[0], 1);
          talk.splice(lastMessage[1], 1);
          lastMessage = null;
        }
        inRun = true;
      }
      if (!inRun) {
        for (const part of content) {
          if (isObject(part) && get(part, "type") === "text") {
            talk.push(textOf(get(part, "text")));
          }
        }
      }
      continue;
    }
    if (filled(get(row, "isMeta"))) {
      continue;
    }
    const result = get(row, "toolUseResult");
    const answers = isObject(result) ? get(result, "answers") : null;
    if (isObject(result) && isObject(answers)) {
      if (!inRun) {
        turns.push(answerTurn(at, result, answers));
      }
      continue;
    }
    let text: string;
    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const part of content) {
        if (!isObject(part)) {
          continue;
        }
        const partType = get(part, "type");
        if (partType === "text") {
          texts.push(textOf(get(part, "text")));
        } else if (partType === "tool_result") {
          const raw = get(part, "content");
          const body = typeof raw === "string" ? raw : JSON.stringify(raw);
          if (!inRun && refused(body)) {
            turns.push({ at, kind: "refusal", text: cap(stripReminders(body), 800) });
          }
        }
      }
      text = stripReminders(texts.join("\n"));
    } else if (typeof content === "string") {
      text = stripReminders(content);
    } else {
      continue;
    }
    if (text === "" || SKIP_PREFIXES.some((prefix) => text.startsWith(prefix))) {
      continue;
    }
    const command = COMMAND_NAME.exec(text);
    if (command !== null) {
      const name = command[1] ?? "";
      inRun = name.includes("pr-humans");
      if (!inRun) {
        const args = COMMAND_ARGS.exec(text)?.[1] ?? "";
        turns.push({ at, kind: "command", command: name.trim(), args: cap(args.trim(), 800) });
        talk.push(args);
        lastMessage = null;
      }
      continue;
    }
    if (text.startsWith("[Request interrupted")) {
      if (!inRun) {
        turns.push({ at, kind: "interrupt" });
      }
      continue;
    }
    if (markupOnly(text)) {
      continue;
    }
    inRun = false;
    lastMessage = [turns.length, talk.length];
    talk.push(text);
    turns.push({ at, kind: "message", text: cap(text) });
  }
  return {
    entrypoint,
    cwd,
    branches: [...branches].toSorted(),
    prLinks,
    first,
    last,
    cwds: [...cwds].toSorted(),
    talk: talk.join("\n"),
    turns,
  };
};

const urlPattern = (url: string): RegExp => new RegExp(`${escapeRegExp(url)}(?!${DIGIT})`, "u");

export const matchSession = (
  file: { readonly path: string; readonly raw: string },
  pr: PullRequestView,
  repo: string,
  root: string | null,
): Session | null => {
  const issueUrls = pr.issues.flatMap((issue) =>
    issue.parent === null ? [issue.url] : [issue.url, issue.parent.url],
  );
  const named = [pr.url, ...issueUrls].filter((url) => urlPattern(url).test(file.raw));
  const prNumber = new RegExp(`"prNumber":\\s*${pr.number}${wordBoundary("after")}`, "u");
  if (
    named.length === 0 &&
    !prNumber.test(file.raw) &&
    !(pr.head !== "" && file.raw.includes(pr.head))
  ) {
    return null;
  }
  const { talk, ...log } = humanTurns(file.raw);
  const why: string[] = [];
  if (log.prLinks.some((link) => link.repo === repo && link.number === pr.number)) {
    why.push("created-pr");
  }
  if (
    root !== null &&
    log.branches.includes(pr.head) &&
    log.cwds.some((dir) => dir === root || dir.startsWith(`${root}/`))
  ) {
    why.push("on-branch");
  }
  for (const url of named) {
    if (urlPattern(url).test(talk)) {
      why.push(url === pr.url ? "names-pr" : `names-issue ${url.split("/").at(-1) ?? ""}`);
    }
  }
  if (why.length === 0 || (why.length === 1 && why[0] === "on-branch" && log.turns.length === 0)) {
    return null;
  }
  return { file: file.path, session: basename(file.path).slice(0, -6), why, ...log };
};

export const bySessionStart = (sessions: readonly Session[]): readonly Session[] =>
  sessions.toSorted((a, b) => {
    const x = a.first ?? "";
    const y = b.first ?? "";
    return x < y ? -1 : x > y ? 1 : 0;
  });

export const matchReports = (
  logs: readonly { readonly file: string; readonly text: string }[],
  pr: PullRequestView,
): readonly { readonly file: string; readonly size: number }[] => {
  const reference = new RegExp(`(?<![${WORD}/])#${pr.number}(?!${DIGIT})`, "u");
  return logs.flatMap(({ file, text }) =>
    text.includes(pr.url) || (pr.head !== "" && text.includes(pr.head)) || reference.test(text)
      ? [{ file, size: Array.from(text).length }]
      : [],
  );
};
