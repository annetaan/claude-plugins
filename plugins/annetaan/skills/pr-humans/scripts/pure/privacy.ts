import { dirname } from "node:path";
import { WORD, escapeRegExp, wordBoundary } from "../../../../scripts/pure/text.ts";

export type Kind = "local-path" | "session-id";

export type Problem = Kind | "mention";

const GENERIC_PATH =
  /(\/Users\/|\/home\/|~\/\.claude|\.claude\/projects|[A-Za-z]:\\Users|\/var\/folders\/|\/private\/var\/|\/private\/tmp\/|\/tmp\/)/u;
const SESSION_FILE = new RegExp(
  `\\.jsonl${wordBoundary("after")}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`,
  "u",
);
const CODE_SPAN = /`[^`\n]*`/gu;
const MENTION = new RegExp(`(?<![${WORD}\`/.-])@[A-Za-z0-9][A-Za-z0-9-]*`, "u");

type Row = Readonly<Record<string, unknown>>;

const rows = (value: unknown): readonly Row[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Row => typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];

export const knownValues = (input: {
  readonly home: string;
  readonly dirs: readonly string[];
  readonly sessions: unknown;
  readonly reports: unknown;
}): ReadonlyMap<string, Kind> => {
  const entries: (readonly [unknown, Kind])[] = [
    [input.home, "local-path"],
    ...input.dirs.map((dir) => [dir, "local-path"] as const),
  ];
  for (const session of rows(input.sessions)) {
    const cwds = session["cwds"];
    entries.push(
      [session["cwd"], "local-path"],
      ...(Array.isArray(cwds) ? cwds.map((dir: unknown) => [dir, "local-path"] as const) : []),
      [session["file"], "local-path"],
      [session["session"], "session-id"],
    );
  }
  for (const report of rows(input.reports)) {
    const file = report["file"];
    if (typeof file === "string") {
      entries.push([file, "local-path"], [dirname(file), "local-path"]);
    }
  }
  const known = new Map<string, Kind>();
  for (const [value, kind] of entries) {
    if (
      typeof value === "string" &&
      Array.from(value).length >= 4 &&
      value !== "/" &&
      !known.has(value)
    ) {
      known.set(value, kind);
    }
  }
  return known;
};

const holds = (body: string, value: string, kind: Kind): boolean =>
  kind === "session-id"
    ? new RegExp(`(?<![${WORD}-])${escapeRegExp(value)}(?![${WORD}-])`, "u").test(body)
    : body.includes(value);

export const lint = (
  body: string,
  known: ReadonlyMap<string, Kind> = new Map(),
): readonly Problem[] => {
  const hit = new Set(
    [...known].flatMap(([value, kind]: readonly [string, Kind]) =>
      holds(body, value, kind) ? [kind] : [],
    ),
  );
  const problems: Problem[] = [];
  if (hit.has("local-path") || GENERIC_PATH.test(body)) {
    problems.push("local-path");
  }
  if (hit.has("session-id") || SESSION_FILE.test(body)) {
    problems.push("session-id");
  }
  if (MENTION.test(body.replace(CODE_SPAN, ""))) {
    problems.push("mention");
  }
  return problems;
};
