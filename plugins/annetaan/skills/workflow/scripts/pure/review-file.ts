import { DIGIT, splitLines, squeeze } from "../../../../scripts/pure/text.ts";
import { SEATS } from "./agent-table.ts";

export type ReviewDir = Readonly<Record<string, string>>;

export type Block = readonly string[];

export type Section = {
  readonly heading: string | null;
  readonly lines: readonly string[];
  readonly blocks: readonly Block[];
  readonly loose: readonly string[];
};

export type ReviewKind = {
  readonly kind: string;
  readonly scope: string;
  readonly round: number | null;
  readonly seat: string | null;
};

export type ParsedReview = {
  readonly kind: string | null;
  readonly scope: string | null;
  readonly round: number | null;
  readonly seat: string | null;
  readonly title: string | null;
  readonly seats: readonly string[];
  readonly answers: readonly Block[];
  readonly loose: readonly string[];
  readonly sections: readonly Section[];
};

export type OpenFindings = ReadonlyMap<string, string>;

export type Finding = {
  readonly id: string;
  readonly stood: number;
  readonly reply: string | null;
};

export type ScopeState = {
  readonly scope: string;
  readonly round: number;
  readonly cap: boolean;
  readonly verdict: string | null;
  readonly open: readonly Finding[];
};

export type RunArgs = {
  readonly script: string;
  readonly wt: string;
  readonly seat: string;
  readonly probe: string;
};

export type ProbeResult = { readonly exit: number; readonly output: string };

const D = DIGIT;
const POSITIVE = `[1-9]${D}*`;
export const SCOPE = `task-${POSITIVE}|integration|merge`;
const SCOPE_NAME = new RegExp(`^(?:${SCOPE})$`, "u");
const ROUND_NAME = new RegExp(
  `^(${SCOPE})-round-(${POSITIVE})(?:-(a|b|reply|evidence))?\\.md$`,
  "u",
);
const FIRST_EVIDENCE_NAME = new RegExp(`^(task-${POSITIVE}|merge)-evidence\\.md$`, "u");
const CAP = 5;
export const FENCE = /^\s*```/u;
const FINDING_SECTIONS: readonly string[] = ["Findings", "New findings"];
const FREE_SECTIONS: readonly string[] = ["Not run"];
const ENTRY_SECTIONS: readonly string[] = [
  "Acceptance criteria",
  "Flows",
  "Reproduced first",
  "Walk",
];
export const NO_SECTION: Section = { heading: null, lines: [], blocks: [], loose: [] };
export const FINDING_ID = `R${POSITIVE}\\.${POSITIVE}`;
export const MARK = new RegExp(
  `^- (${FINDING_ID}) (?:resolved(?:: \\S.*)?|(stands again|stands): \\S.*)$`,
  "u",
);
export const DISAGREE = "; reply: disagree";
const ANSWER = new RegExp(`^- (${FINDING_ID}) (fixed|disagree): \\S`, "u");
const SUB_BULLET = /^\s+- (ran|saw|not run):/u;
const FORBIDDEN: readonly string[] = "$\"';&|<>()`".split("");
export const REASONS: readonly string[] = [
  "sections",
  "id",
  "finding",
  "command",
  "entry",
  "no-round",
  "line",
  "missing",
  "ran",
  "assumed",
  "no-evidence",
  "area",
  "parts",
  "landed",
  "overturn",
];
const SEAT_NAMES: readonly string[] = SEATS;

export const isScope = (text: string): boolean => SCOPE_NAME.test(text);

const baseName = (key: string): string => key.slice(key.lastIndexOf("/") + 1);

export const words = (text: string): readonly string[] => {
  const squeezed = squeeze(text);
  return squeezed === "" ? [] : squeezed.split(" ");
};

export const ordered = (found: ReadonlySet<string>): readonly string[] =>
  REASONS.filter((reason) => found.has(reason));

export const reviewKind = (name: string): ReviewKind | null => {
  const round = ROUND_NAME.exec(name);
  if (round !== null) {
    const [, scope = "", number, tail] = round;
    const seat = tail !== undefined && SEAT_NAMES.includes(tail) ? tail : null;
    return {
      kind: seat !== null ? "seat" : (tail ?? "round"),
      scope,
      round: Number(number),
      seat,
    };
  }
  const evidence = FIRST_EVIDENCE_NAME.exec(name);
  if (evidence !== null) {
    return { kind: "evidence", scope: evidence[1] ?? "", round: null, seat: null };
  }
  return null;
};

type Line = { readonly text: string; readonly fenced: boolean };

const splitBlocks = (
  lines: readonly Line[],
  opener: string,
  indentedOnly: boolean,
): { readonly blocks: readonly Block[]; readonly loose: readonly string[] } => {
  const blocks: string[][] = [];
  const loose: string[] = [];
  for (const { text, fenced } of lines) {
    if (text.trim() === "") {
      continue;
    }
    const last = blocks.at(-1);
    if (!fenced && text.startsWith(opener)) {
      blocks.push([text.trimEnd()]);
    } else if (
      last !== undefined &&
      (fenced || !indentedOnly || text[0] === " " || text[0] === "\t")
    ) {
      if (!fenced) {
        last.push(text.trimEnd());
      }
    } else {
      loose.push(text.trim());
    }
  }
  return { blocks, loose };
};

export const parseText = (name: string, text: string): ParsedReview => {
  const lines = splitLines(text);
  const head: Line[] = [];
  const sections: { readonly heading: string; readonly body: Line[] }[] = [];
  let fenced = false;
  for (const text of lines.slice(1)) {
    const fence = FENCE.test(text);
    if (!(fenced || fence) && text.startsWith("## ")) {
      sections.push({ heading: text.slice(3).trim(), body: [] });
    } else {
      (sections.at(-1)?.body ?? head).push({ text, fenced: fenced || fence });
    }
    if (fence) {
      fenced = !fenced;
    }
  }
  const kind = reviewKind(name);
  const first = lines[0];
  const answers = splitBlocks(head, "- ", true);
  return {
    kind: kind?.kind ?? null,
    scope: kind?.scope ?? null,
    round: kind?.round ?? null,
    seat: kind?.seat ?? null,
    title: first !== undefined && first.startsWith("# ") ? first : null,
    seats: head
      .filter((line) => !line.fenced && line.text.startsWith("Seats:"))
      .map((line) => line.text),
    answers: answers.blocks,
    loose: answers.loose,
    sections: sections.map(
      ({ heading, body }: { readonly heading: string; readonly body: readonly Line[] }) => {
        const split = FINDING_SECTIONS.includes(heading)
          ? splitBlocks(body, "### ", false)
          : splitBlocks(body, "- ", true);
        return {
          heading,
          lines: body.map((line) => line.text.trim()).filter((line) => line !== ""),
          blocks: split.blocks,
          loose: split.loose,
        };
      },
    ),
  };
};

export const parseReview = (dir: ReviewDir, key: string): ParsedReview =>
  parseText(baseName(key), dir[key] ?? "");

export const section = (parsed: ParsedReview, heading: string): Section =>
  parsed.sections.find((s) => s.heading === heading) ?? NO_SECTION;

export type Answer = { readonly id: string; readonly answer: string; readonly text: string };

export const answered = (parsed: ParsedReview): readonly Answer[] =>
  parsed.answers.flatMap((block): readonly Answer[] => {
    const found = ANSWER.exec(block[0] ?? "");
    return found === null
      ? []
      : [{ id: found[1] ?? "", answer: found[2] ?? "", text: block.join("\n") }];
  });

export const openAfter = (parsed: ParsedReview): OpenFindings => {
  const still = new Map<string, string>();
  for (const block of section(parsed, "Earlier findings").blocks) {
    const found = MARK.exec(block[0] ?? "");
    if (found !== null && found[2] !== undefined) {
      still.set(found[1] ?? "", found[2]);
    }
  }
  const r = parsed.round ?? 0;
  section(parsed, "New findings").blocks.forEach((block, i) => {
    if (new RegExp(`^### R${r}\\.${i + 1} \\S`, "u").test(block[0] ?? "")) {
      still.set(`R${r}.${i + 1}`, "new");
    }
  });
  return still;
};

export const has = (dir: ReviewDir, key: string): boolean => dir[key] !== undefined;

const reviewNames = (dir: ReviewDir): readonly string[] =>
  Object.keys(dir)
    .filter((key) => key.startsWith("review/"))
    .map(baseName);

export const scopeState = (dir: ReviewDir, scope: string): ScopeState => {
  const rounds = reviewNames(dir)
    .map(reviewKind)
    .filter((kind) => kind !== null && kind.kind === "round" && kind.scope === scope)
    .map((kind) => kind?.round ?? 0)
    .toSorted((x, y) => x - y);
  const files = rounds.map((r) => parseReview(dir, `review/${scope}-round-${r}.md`));
  const last = rounds.at(-1) ?? 0;
  const lastFile = files.at(-1);
  const verdict = lastFile === undefined ? null : (section(lastFile, "Verdict").lines[0] ?? null);
  const still = lastFile === undefined ? [] : [...openAfter(lastFile).keys()];
  const marks = files.map(openAfter);
  const replyKey = `review/${scope}-round-${last}-reply.md`;
  const answers = new Map(
    has(dir, replyKey)
      ? answered(parseReview(dir, replyKey)).map((answer) => [answer.id, answer.answer] as const)
      : [],
  );
  return {
    scope,
    round: last + 1,
    cap: rounds.length >= CAP && verdict !== "approve",
    verdict,
    open: still.map((id) => ({
      id,
      stood: marks.filter((mark) => {
        const state = mark.get(id);
        return state === "stands" || state === "stands again";
      }).length,
      reply: answers.get(id) ?? null,
    })),
  };
};

export const runArgs = (line: string): RunArgs | null => {
  const parts = words(line);
  if (parts.length !== 5 || FORBIDDEN.some((c) => line.includes(c))) {
    return null;
  }
  const [script = "", sub, wt = "", seat = "", probe = ""] = parts;
  if (
    script.startsWith("/") &&
    script.endsWith("/flow.sh") &&
    sub === "run" &&
    wt.startsWith("/") &&
    SEAT_NAMES.includes(seat) &&
    probe.startsWith(`${wt.replace(/\/+$/u, "")}/work-reports/`)
  ) {
    return { script, wt, seat, probe };
  }
  return null;
};

export const fields = (
  block: Block,
  names: readonly string[],
): Readonly<Record<string, readonly string[]>> =>
  Object.fromEntries(
    names.map((name) => [
      name,
      block
        .slice(1)
        .filter((text) => text.startsWith(`${name}:`))
        .map((text) => text.slice(name.length + 1).trim()),
    ]),
  );

export const findingReasons = (block: Block, names: readonly string[]): ReadonlySet<string> => {
  const got = fields(block, names);
  const reasons = new Set<string>();
  if (Object.values(got).some((values) => values.length !== 1)) {
    reasons.add("finding");
  }
  const commands = got["Command"] ?? [];
  if (
    !commands.every(
      (c) =>
        c.length > 1 && c.startsWith("`") && c.endsWith("`") && runArgs(c.slice(1, -1)) !== null,
    )
  ) {
    reasons.add("command");
  }
  return reasons;
};

export const entryOk = (block: Block, reproduced: boolean): boolean => {
  const subs = new Set(
    block.slice(1).flatMap((text) => {
      const found = SUB_BULLET.exec(text);
      return found === null ? [] : [found[1] ?? ""];
    }),
  );
  if (reproduced) {
    return (block[0] ?? "").startsWith("- ran:") && subs.has("saw");
  }
  return (subs.has("ran") && subs.has("saw")) || subs.has("not run");
};

export const holds = (s: Section): boolean => {
  if (s.heading !== null && FREE_SECTIONS.includes(s.heading)) {
    return s.lines.length > 0;
  }
  return s.blocks.length > 0 || (s.lines.length === 1 && s.lines[0] === "None.");
};

const wantedSections = (
  kind: string,
  scope: string | null,
  r: number | null,
  headings: readonly string[],
): readonly string[] => {
  if (kind === "seat") {
    return ["Findings", "Not run", ...(scope === "integration" && r === 1 ? ["Walk"] : [])];
  }
  if (kind === "evidence") {
    return [
      "Acceptance criteria",
      ...["Flows", "Reproduced first"].filter((h) => headings.includes(h)),
    ];
  }
  return [];
};

const sameList = (x: readonly string[], y: readonly string[]): boolean =>
  x.length === y.length && x.every((item, i) => item === y[i]);

export type LintResult = { readonly kind: string | null; readonly reasons: readonly string[] };

export const lintReasons = (dir: ReviewDir, key: string): LintResult => {
  const named = reviewKind(baseName(key));
  if (named === null || named.kind === "round") {
    return { kind: null, reasons: ["name"] };
  }
  const parsed = parseReview(dir, key);
  const kind = parsed.kind ?? "";
  const scope = parsed.scope ?? "";
  const r = parsed.round ?? 0;
  const headings = parsed.sections.map((s) => s.heading ?? "");
  const want = wantedSections(kind, parsed.scope, parsed.round, headings);
  const found = new Set<string>();
  if (parsed.title === null || !sameList(headings, want) || !parsed.sections.every(holds)) {
    found.add("sections");
  }
  if (kind === "seat" || kind === "evidence") {
    for (const s of parsed.sections) {
      if (
        s.heading !== null &&
        ENTRY_SECTIONS.includes(s.heading) &&
        !s.blocks.every((b) => entryOk(b, s.heading === "Reproduced first"))
      ) {
        found.add("entry");
      }
    }
  }
  if (kind === "seat") {
    section(parsed, "Findings").blocks.forEach((block, i) => {
      if (!new RegExp(`^### ${i + 1}\\. \\S`, "u").test(block[0] ?? "")) {
        found.add("id");
      }
      for (const reason of findingReasons(block, ["Command", "Printed", "Required"])) {
        found.add(reason);
      }
    });
  }
  if (kind === "reply") {
    const got = answered(parsed);
    const fixed = got.filter((answer) => answer.answer === "fixed").map((answer) => answer.text);
    if (parsed.loose.length > 0 || got.length !== parsed.answers.length) {
      found.add("line");
    }
    if (fixed.some((text) => !(text.includes("ran:") && text.includes("saw:")))) {
      found.add("ran");
    }
    const round = `review/${scope}-round-${r}.md`;
    if (has(dir, round)) {
      const before = openAfter(parseReview(dir, round));
      const ids = new Set(got.map((answer) => answer.id));
      if ([...before.keys()].some((id) => !ids.has(id))) {
        found.add("missing");
      }
      if (
        got.some(
          (answer) => before.get(answer.id) === "stands again" && !answer.text.includes("assumed:"),
        )
      ) {
        found.add("assumed");
      }
    } else {
      found.add("no-round");
    }
    if (fixed.length > 0 && !has(dir, `review/${scope}-round-${r}-evidence.md`)) {
      found.add("no-evidence");
    }
  }
  return { kind, reasons: ordered(found) };
};

export const codeSpan = (text: string): string => {
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map((run) => run[0].length));
  const ticks = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${ticks}${pad}${text}${pad}${ticks}`;
};

export const printed = (result: ProbeResult): string => {
  const shown = splitLines(result.output)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const lastLine = shown.at(-1);
  return `exit ${result.exit}${lastLine === undefined ? "" : `, ${codeSpan(lastLine)}`}`;
};

export const droppedLine = (seat: string, why: string, numbers: readonly number[]): string => {
  const what =
    why === "exit-0"
      ? "the command exited 0, so the failure did not show"
      : `the command could not be run again, ${why}`;
  return `- ${seat}: ${numbers.length}, ${what} (finding${numbers.length > 1 ? "s" : ""} ${numbers.join(", ")})`;
};

export const draftText = (
  scope: string,
  r: number,
  earlierLines: readonly string[],
  newBlocks: readonly string[],
  droppedLines: readonly string[],
): string =>
  `# ${scope}, round ${r}, draft\n\n## Earlier findings\n\n${earlierLines.join("\n") || "None."}\n\n## New findings\n\n${newBlocks.join("\n\n") || "None."}\n\n## Dropped\n\n${droppedLines.join("\n")}\n`;

export type RecordCounts = {
  readonly tasks: number;
  readonly taskRounds: number;
  readonly integrationRounds: number;
  readonly findings: number;
};

type RoundName = { readonly scope: string; readonly name: string };

export const recordCounts = (dir: ReviewDir): RecordCounts => {
  const counted = reviewNames(dir).flatMap((name): readonly RoundName[] => {
    const kind = reviewKind(name);
    return kind !== null && kind.kind === "round" && kind.scope !== "merge"
      ? [{ scope: kind.scope, name }]
      : [];
  });
  const tasks = new Set(
    counted.filter(({ scope }) => scope !== "integration").map(({ scope }) => scope),
  );
  const integrationRounds = counted.filter(({ scope }) => scope === "integration").length;
  const findings = counted.reduce(
    (sum, { name }) =>
      sum + section(parseReview(dir, `review/${name}`), "New findings").blocks.length,
    0,
  );
  return {
    tasks: tasks.size,
    taskRounds: counted.length - integrationRounds,
    integrationRounds,
    findings,
  };
};
