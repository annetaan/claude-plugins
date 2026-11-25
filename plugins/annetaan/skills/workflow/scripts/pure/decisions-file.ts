import { splitLines } from "../../../../scripts/pure/text.ts";
import { FENCE, ordered } from "./review-file.ts";

export const DECISIONS = "decisions.md";
export const DECISIONS_RECORD = "decisions.json";
const AREAS: readonly string[] = ["technology", "infrastructure", "database", "delivery"];
const PARTS = [
  "What was decided",
  "Other options and why this one",
  "Where it landed",
  "To overturn it",
] as const;
export const DECISION_LABEL = {
  name: "decision",
  color: "FBCA04",
  description: "A design decision a workflow run made on its own. Read it, then close it.",
} as const;
const LANDED = /^- `[^`]+`/u;
const OVERTURN = /^\/annetaan:workflow \S/u;

export type DecisionEntry = {
  readonly title: string;
  readonly area: string | null;
  readonly parts: Readonly<Record<string, readonly string[]>>;
};

export type FiledIssue = { readonly title: string; readonly number: number; readonly url: string };

type Part = { readonly name: string; readonly body: readonly string[] };

const splitHeadings = (
  lines: readonly string[],
  prefix: string,
): { readonly head: readonly string[]; readonly parts: readonly Part[] } => {
  const head: string[] = [];
  const parts: { readonly name: string; readonly body: string[] }[] = [];
  let fenced = false;
  for (const text of lines) {
    const fence = FENCE.test(text);
    if (!(fenced || fence) && text.startsWith(prefix)) {
      parts.push({ name: text.slice(prefix.length).trim(), body: [] });
    } else {
      (parts.at(-1)?.body ?? head).push(text);
    }
    if (fence) {
      fenced = !fenced;
    }
  }
  return { head, parts };
};

const trimmed = (lines: readonly string[]): readonly string[] => {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim() === "") {
    start += 1;
  }
  while (end > start && (lines[end - 1] ?? "").trim() === "") {
    end -= 1;
  }
  return lines.slice(start, end);
};

const overturnOk = (lines: readonly string[]): boolean => {
  const fences = lines.flatMap((text, n) => (FENCE.test(text) ? [n] : []));
  return (
    fences.length === 2 &&
    fences[0] === 0 &&
    fences[1] === lines.length - 1 &&
    lines.length > 2 &&
    OVERTURN.test(lines[1] ?? "")
  );
};

export const decisionEntry = (
  title: string,
  lines: readonly string[],
): { readonly reasons: ReadonlySet<string>; readonly entry: DecisionEntry } => {
  const found = new Set<string>();
  const split = splitHeadings(lines, "### ");
  const head = trimmed(split.head);
  const first = head[0];
  const area =
    first !== undefined && first.startsWith("Area: ") ? first.slice("Area: ".length) : null;
  if (area === null || !AREAS.includes(area)) {
    found.add("area");
  }
  const texts: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
    split.parts.map(({ name, body }) => [name, trimmed(body)]),
  );
  const names = split.parts.map(({ name }) => name);
  const shaped =
    names.length === PARTS.length &&
    names.every((name, i) => name === PARTS[i]) &&
    head.length <= 1 &&
    PARTS.slice(0, 2).every((name) => {
      const text = texts[name];
      return text === undefined || text.length > 0;
    });
  if (!shaped) {
    found.add("parts");
  }
  const landed = texts["Where it landed"];
  if (
    landed !== undefined &&
    !(landed.length > 0 && landed.every((text) => text.trim() === "" || LANDED.test(text)))
  ) {
    found.add("landed");
  }
  const overturn = texts["To overturn it"];
  if (overturn !== undefined && !overturnOk(overturn)) {
    found.add("overturn");
  }
  return { reasons: found, entry: { title, area, parts: texts } };
};

export const decisionEntries = (
  text: string,
): { readonly reasons: readonly string[]; readonly entries: readonly DecisionEntry[] } => {
  const lines = splitLines(text);
  const split = splitHeadings(lines.slice(1), "## ");
  const titles = split.parts.map(({ name }) => name);
  const head = trimmed(split.head);
  const bodyOk =
    split.parts.length === 0 ? head.length === 1 && head[0] === "None." : head.length === 0;
  const found = new Set<string>();
  if (
    lines[0] !== "# Decisions" ||
    !bodyOk ||
    titles.includes("") ||
    new Set(titles).size !== titles.length
  ) {
    found.add("sections");
  }
  const entries = split.parts.map(({ name, body }) => {
    const { reasons, entry } = decisionEntry(name, body);
    for (const reason of reasons) {
      found.add(reason);
    }
    return entry;
  });
  return { reasons: ordered(found), entries };
};

export const decisionBody = (entry: DecisionEntry, pr: number): string => {
  const part = (name: string): readonly string[] => entry.parts[name] ?? [];
  const sections: readonly (readonly [string, readonly string[]])[] = [
    ["What was decided", [`Area: ${entry.area ?? ""}`, "", ...part("What was decided")]],
    ["Other options and why this one", part("Other options and why this one")],
    ["Where it landed", [`Pull request: #${pr}`, "", ...part("Where it landed")]],
    ["To overturn it", part("To overturn it")],
  ];
  return `${sections.map(([name, body]) => `## ${name}\n\n${body.join("\n")}`).join("\n\n")}\n`;
};

export const filedIssue = (entry: DecisionEntry, out: string): FiledIssue => {
  const url = splitLines(out.trim()).at(-1) ?? "";
  const tail = url.replace(/\/+$/u, "");
  return { title: entry.title, number: Number(tail.slice(tail.lastIndexOf("/") + 1)), url };
};

export const filedNames = (filed: readonly FiledIssue[]): string =>
  filed.map((issue) => `#${issue.number} ${issue.title}`).join(", ") || "none";
