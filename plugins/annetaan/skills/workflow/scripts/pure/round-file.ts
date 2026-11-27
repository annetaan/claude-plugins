import { splitLines } from "../../../../scripts/pure/text.ts";
import { SEATS } from "./agent-table.ts";
import {
  answered,
  DISAGREE,
  FINDING_ID,
  has,
  MARK,
  NO_SECTION,
  parseReview,
  section,
  fields,
  type Block,
  type ParsedReview,
  type ReviewDir,
} from "./review-file.ts";

export type KeepEntry = {
  readonly ids: readonly string[];
  readonly required: string;
  readonly breaks: string;
  readonly line: number;
};

export type DropEntry = { readonly id: string; readonly reason: string; readonly line: number };

export type EarlierEntry = {
  readonly id: string;
  readonly word: "stands" | "resolved";
  readonly reason: string;
  readonly line: number;
};

export type Judgement = {
  readonly seats: string;
  readonly keep: readonly KeepEntry[];
  readonly drop: readonly DropEntry[];
  readonly earlier: readonly EarlierEntry[];
  readonly notRun: readonly string[];
  readonly keepLine: number;
  readonly earlierLine: number;
};

export type JudgementFault = {
  readonly line: number;
  readonly why: "shape" | "unknown-id" | "twice" | "not-disagree" | "unjudged" | "no-reason";
  readonly id: string | null;
};

const HEADINGS = ["Keep", "Drop", "Earlier", "Not run"] as const;
const SEATS_LINE = /^Seats: \S/u;
const KEEP = new RegExp(`^- (${FINDING_ID}(?:, ${FINDING_ID})*)$`, "u");
const KEEP_FIELD = /^\s+(Required|Breaks): (\S.*)$/u;
const DROP = new RegExp(`^- (${FINDING_ID}): (\\S.*)$`, "u");
const EARLIER = new RegExp(`^- (${FINDING_ID}) (stands|resolved): (\\S.*)$`, "u");
const NOT_RUN = /^- \S/u;
const NEW_ID = new RegExp(`^### (${FINDING_ID}) `, "u");

type OpenKeep = {
  readonly ids: readonly string[];
  readonly line: number;
  readonly got: Map<string, string>;
};

const shape = (line: number): JudgementFault => ({ line, why: "shape", id: null });

export const parseJudgement = (text: string): Judgement | JudgementFault => {
  const lines = splitLines(text);
  let seats: string | null = null;
  let at = -1;
  const headingLines: number[] = [];
  let none = false;
  let count = 0;
  let open: OpenKeep | null = null;
  const keep: KeepEntry[] = [];
  const drop: DropEntry[] = [];
  const earlier: EarlierEntry[] = [];
  const notRun: string[] = [];
  const closeKeep = (): JudgementFault | null => {
    if (open === null) {
      return null;
    }
    const required = open.got.get("Required");
    const breaks = open.got.get("Breaks");
    if (required === undefined || breaks === undefined) {
      return shape(open.line);
    }
    keep.push({ ids: open.ids, required, breaks, line: open.line });
    open = null;
    return null;
  };
  const closeSection = (): JudgementFault | null => {
    const fault = closeKeep();
    if (fault !== null) {
      return fault;
    }
    return at >= 0 && !none && count === 0 ? shape(headingLines[at] ?? 0) : null;
  };
  for (const [i, raw] of lines.entries()) {
    const line = i + 1;
    const text = raw.trimEnd();
    if (text.trim() === "") {
      continue;
    }
    if (seats === null) {
      if (!SEATS_LINE.test(text)) {
        return shape(line);
      }
      seats = text;
      continue;
    }
    if (text.startsWith("## ")) {
      const fault = closeSection();
      if (fault !== null) {
        return fault;
      }
      if (text !== `## ${HEADINGS[at + 1] ?? ""}`) {
        return shape(line);
      }
      at += 1;
      headingLines.push(line);
      none = false;
      count = 0;
      continue;
    }
    if (at < 0 || none) {
      return shape(line);
    }
    if (text === "None.") {
      if (count > 0) {
        return shape(line);
      }
      none = true;
      continue;
    }
    const heading = HEADINGS[at];
    if (heading === "Keep") {
      const field = KEEP_FIELD.exec(text);
      if (open !== null && /^\s/u.test(text)) {
        const name = field?.[1];
        if (field === null || name === undefined || open.got.has(name)) {
          return shape(line);
        }
        open.got.set(name, field?.[2] ?? "");
        continue;
      }
      const entry = KEEP.exec(text);
      const fault = closeKeep();
      if (fault !== null) {
        return fault;
      }
      if (entry === null) {
        return shape(line);
      }
      open = { ids: (entry[1] ?? "").split(", "), line, got: new Map() };
    } else if (heading === "Drop") {
      const entry = DROP.exec(text);
      if (entry === null) {
        return shape(line);
      }
      drop.push({ id: entry[1] ?? "", reason: entry[2] ?? "", line });
    } else if (heading === "Earlier") {
      const entry = EARLIER.exec(text);
      if (entry === null) {
        return shape(line);
      }
      earlier.push({
        id: entry[1] ?? "",
        word: entry[2] === "stands" ? "stands" : "resolved",
        reason: entry[3] ?? "",
        line,
      });
    } else {
      if (!NOT_RUN.test(text)) {
        return shape(line);
      }
      notRun.push(text);
    }
    count += 1;
  }
  const fault = closeSection();
  if (fault !== null) {
    return fault;
  }
  if (seats === null || at !== HEADINGS.length - 1) {
    return shape(Math.max(lines.length, 1));
  }
  return {
    seats,
    keep,
    drop,
    earlier,
    notRun,
    keepLine: headingLines[0] ?? 0,
    earlierLine: headingLines[2] ?? 0,
  };
};

type DraftLine = {
  readonly id: string;
  readonly text: string;
  readonly status: string | undefined;
  readonly disagree: boolean;
};

const draftEarlier = (draft: ParsedReview): readonly DraftLine[] =>
  section(draft, "Earlier findings").blocks.flatMap((block): readonly DraftLine[] => {
    const text = block[0] ?? "";
    const found = MARK.exec(text);
    return found === null
      ? []
      : [{ id: found[1] ?? "", text, status: found[2], disagree: text.endsWith(DISAGREE) }];
  });

const draftNew = (draft: ParsedReview): ReadonlyMap<string, Block> =>
  new Map(
    section(draft, "New findings").blocks.flatMap(
      (block): readonly (readonly [string, Block])[] => {
        const found = NEW_ID.exec(block[0] ?? "");
        return found === null ? [] : [[found[1] ?? "", block]];
      },
    ),
  );

type Named = {
  readonly id: string;
  readonly line: number;
  readonly word: "keep" | "drop" | "stands" | "resolved";
};

export const judgementFault = (
  judgement: Judgement,
  draft: ParsedReview,
): JudgementFault | null => {
  const fresh = draftNew(draft);
  const earlier = new Map(draftEarlier(draft).map((one) => [one.id, one]));
  const named: readonly Named[] = [
    ...judgement.keep.flatMap((entry) =>
      entry.ids.map((id): Named => ({ id, line: entry.line, word: "keep" })),
    ),
    ...judgement.drop.map((entry): Named => ({ id: entry.id, line: entry.line, word: "drop" })),
    ...judgement.earlier.map((entry): Named => ({
      id: entry.id,
      line: entry.line,
      word: entry.word,
    })),
  ].toSorted((x, y) => x.line - y.line);
  const seenNew = new Set<string>();
  const seenEarlier = new Set<string>();
  for (const { id, line, word } of named) {
    if (word === "keep" || word === "drop") {
      if (!fresh.has(id)) {
        return { line, why: "unknown-id", id };
      }
      if (seenNew.has(id)) {
        return { line, why: "twice", id };
      }
      seenNew.add(id);
      continue;
    }
    const was = earlier.get(id);
    if (was === undefined || (was.status === undefined && (word === "stands" || !was.disagree))) {
      return { line, why: "unknown-id", id };
    }
    if (seenEarlier.has(id)) {
      return { line, why: "twice", id };
    }
    seenEarlier.add(id);
    if (word === "resolved" && !was.disagree) {
      return { line, why: "not-disagree", id };
    }
  }
  for (const one of earlier.values()) {
    if (one.status !== undefined && !seenEarlier.has(one.id)) {
      return { line: judgement.earlierLine, why: "no-reason", id: one.id };
    }
  }
  for (const id of fresh.keys()) {
    if (!seenNew.has(id)) {
      return { line: judgement.keepLine, why: "unjudged", id };
    }
  }
  return null;
};

export const evidenceWanted = (dir: ReviewDir, scope: string, r: number): string | null => {
  for (let j = r - 1; j > 0; j -= 1) {
    const reply = `review/${scope}-round-${j}-reply.md`;
    if (
      has(dir, reply) &&
      answered(parseReview(dir, reply)).some((answer) => answer.answer === "fixed")
    ) {
      const evidence = `review/${scope}-round-${j}-evidence.md`;
      return has(dir, evidence) ? null : evidence;
    }
  }
  if (scope === "integration") {
    const walked = SEATS.some((seat) => {
      const key = `review/integration-round-1-${seat}.md`;
      return has(dir, key) && section(parseReview(dir, key), "Walk") !== NO_SECTION;
    });
    return walked ? null : "review/integration-round-1-a.md";
  }
  const evidence = `review/${scope}-evidence.md`;
  return has(dir, evidence) ? null : evidence;
};

const earlierText = (line: DraftLine, entry: EarlierEntry | undefined): string => {
  const base = line.disagree ? line.text.slice(0, -DISAGREE.length) : line.text;
  if (entry === undefined) {
    return base;
  }
  const at = 3 + line.id.length;
  const marked =
    entry.word === "resolved" && line.status !== undefined
      ? `${base.slice(0, at)}resolved${base.slice(at + line.status.length)}`
      : base;
  return `${marked}; ${entry.reason}`;
};

const startingWith = (block: Block, name: string): string =>
  block.slice(1).find((text) => text.startsWith(`${name}:`)) ?? "";

const seatOf = (block: Block | undefined): string =>
  fields(block ?? [], ["Found by"])["Found by"]?.[0] ?? "";

const keptText = (
  r: number,
  n: number,
  entry: KeepEntry,
  fresh: ReadonlyMap<string, Block>,
): string => {
  const first = fresh.get(entry.ids[0] ?? "") ?? [];
  const title = (first[0] ?? "").replace(NEW_ID, "");
  const seats = new Set(entry.ids.map((id) => seatOf(fresh.get(id))));
  return [
    `### R${r}.${n} ${title}`,
    "",
    `Found by: ${SEATS.filter((seat) => seats.has(seat)).join(", ")}`,
    startingWith(first, "Command"),
    startingWith(first, "Printed"),
    `Required: ${entry.required}`,
    `Breaks: ${entry.breaks}`,
  ].join("\n");
};

const body = (parts: readonly string[], joiner: string): string =>
  parts.length === 0 ? "None." : parts.join(joiner);

export const roundText = (
  scope: string,
  r: number,
  draft: ParsedReview,
  judgement: Judgement,
  verdict: "approve" | "changes-requested",
): string => {
  const reasons = new Map(judgement.earlier.map((entry) => [entry.id, entry]));
  const fresh = draftNew(draft);
  const earlier = draftEarlier(draft).map((line) => earlierText(line, reasons.get(line.id)));
  const kept = judgement.keep.map((entry, i) => keptText(r, i + 1, entry, fresh));
  const dropped = [
    ...section(draft, "Dropped").lines,
    ...judgement.drop.map(
      (entry) => `- ${seatOf(fresh.get(entry.id))}: ${entry.id}, ${entry.reason}`,
    ),
  ];
  return `# ${scope}, round ${r}\n\n${judgement.seats}\n\n## Earlier findings\n\n${body(earlier, "\n")}\n\n## New findings\n\n${body(kept, "\n\n")}\n\n## Dropped\n\n${dropped.join("\n")}\n\n## Not run\n\n${body(judgement.notRun, "\n")}\n\n## Verdict\n\n${verdict}\n`;
};
