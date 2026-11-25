import { DIGIT, splitLines, squeeze, wordBoundary } from "../../../../scripts/pure/text.ts";
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
  readonly approve: { readonly allowed: boolean; readonly why: readonly string[] };
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
const ROUND_SECTIONS: readonly string[] = [
  "Earlier findings",
  "New findings",
  "Dropped",
  "Not run",
  "Verdict",
];
const FREE_SECTIONS: readonly string[] = ["Not run", "Dropped"];
const ENTRY_SECTIONS: readonly string[] = [
  "Acceptance criteria",
  "Flows",
  "Reproduced first",
  "Walk",
];
export const NO_SECTION: Section = { heading: null, lines: [], blocks: [], loose: [] };
const FOUND_BY: readonly string[] = ["a", "b", "a, b"];
const FINDING_ID = `R${POSITIVE}\\.${POSITIVE}`;
const EARLIER_ID = new RegExp(`^- (${FINDING_ID})${wordBoundary("after")}`, "u");
const MARK = new RegExp(
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
  "seats",
  "no-round",
  "mark",
  "earlier-missing",
  "verdict",
  "approve-open",
  "approve-no-evidence",
  "draft",
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

const has = (dir: ReviewDir, key: string): boolean => dir[key] !== undefined;

export const approveBlockers = (
  dir: ReviewDir,
  scope: string,
  r: number,
  openCount: number,
): readonly string[] => {
  const blockers = openCount > 0 ? ["approve-open"] : [];
  let evidence: boolean | null = null;
  for (let j = r - 1; j > 0; j -= 1) {
    const reply = `review/${scope}-round-${j}-reply.md`;
    if (
      has(dir, reply) &&
      answered(parseReview(dir, reply)).some((answer) => answer.answer === "fixed")
    ) {
      evidence = has(dir, `review/${scope}-round-${j}-evidence.md`);
      break;
    }
  }
  if (evidence === null) {
    evidence =
      scope === "integration"
        ? SEATS.some((seat) => {
            const key = `review/integration-round-1-${seat}.md`;
            return has(dir, key) && section(parseReview(dir, key), "Walk") !== NO_SECTION;
          })
        : has(dir, `review/${scope}-evidence.md`);
  }
  return evidence ? blockers : [...blockers, "approve-no-evidence"];
};

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
  const blockers = approveBlockers(dir, scope, last + 1, still.length);
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
    approve: { allowed: blockers.length === 0, why: blockers },
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
  const foundBy = got["Found by"];
  if (
    Object.values(got).some((values) => values.length !== 1) ||
    (foundBy !== undefined && !FOUND_BY.includes(foundBy[0] ?? ""))
  ) {
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
  if (s.heading === "Verdict") {
    return true;
  }
  if (s.heading !== null && FREE_SECTIONS.includes(s.heading)) {
    return s.lines.length > 0;
  }
  return s.blocks.length > 0 || (s.lines.length === 1 && s.lines[0] === "None.");
};

export const copied = (line: string, want: string | undefined): boolean => {
  if (want === undefined) {
    return false;
  }
  const disagree = want.endsWith(DISAGREE);
  const base = disagree ? want.slice(0, -DISAGREE.length) : want;
  const starts = [base];
  const status = MARK.exec(base);
  if (disagree && status !== null && status[2] !== undefined) {
    const at = 3 + (status[1] ?? "").length;
    starts.push(`${base.slice(0, at)}resolved${base.slice(at + status[2].length)}`);
  }
  return starts.some((start) => line === start || line.startsWith(`${start};`));
};

const sameFields = (
  x: Readonly<Record<string, readonly string[]>>,
  y: Readonly<Record<string, readonly string[]>>,
): boolean => JSON.stringify(x) === JSON.stringify(y);

export const draftReasons = (
  dir: ReviewDir,
  key: string,
  earlier: readonly string[],
  added: readonly Block[],
): ReadonlySet<string> => {
  const draft = `drafts/${baseName(key)}`;
  if (!has(dir, draft)) {
    return new Set(["draft"]);
  }
  const parsed = parseReview(dir, draft);
  const lines = new Map(
    section(parsed, "Earlier findings").blocks.flatMap((block) => {
      const found = EARLIER_ID.exec(block[0] ?? "");
      return found === null ? [] : [[found[1] ?? "", block[0] ?? ""] as const];
    }),
  );
  const names = ["Command", "Printed"];
  const pairs = section(parsed, "New findings").blocks.map((block) => fields(block, names));
  const earlierOk = earlier.every((line) =>
    copied(line, lines.get(EARLIER_ID.exec(line)?.[1] ?? "")),
  );
  const newOk = added.every((block) => {
    const got = fields(block, names);
    return pairs.some((pair) => sameFields(pair, got));
  });
  return earlierOk && newOk ? new Set() : new Set(["draft"]);
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
  if (kind === "round") {
    return ROUND_SECTIONS;
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
  if (reviewKind(baseName(key)) === null) {
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
  let before: OpenFindings | null = null;
  if ((kind === "round" || kind === "reply") && (kind === "reply" || r > 1)) {
    const prior = `review/${scope}-round-${kind === "reply" ? r : r - 1}.md`;
    if (has(dir, prior)) {
      before = openAfter(parseReview(dir, prior));
    } else {
      found.add("no-round");
    }
  }
  if (kind === "round") {
    if (parsed.seats.length !== 1) {
      found.add("seats");
    }
    const listedIds = new Set<string>();
    const marked: string[] = [];
    const kept: Block[] = [];
    for (const block of section(parsed, "Earlier findings").blocks) {
      if (r === 1) {
        found.add("id");
        continue;
      }
      const first = block[0] ?? "";
      const id = EARLIER_ID.exec(first)?.[1];
      if (id !== undefined) {
        listedIds.add(id);
        if (before !== null && !before.has(id)) {
          found.add("id");
        }
      }
      if (!MARK.test(first)) {
        found.add("mark");
      } else if (before !== null && id !== undefined && before.has(id)) {
        marked.push(first);
      }
    }
    if (before !== null && [...before.keys()].some((id) => !listedIds.has(id))) {
      found.add("earlier-missing");
    }
    section(parsed, "New findings").blocks.forEach((block, i) => {
      const numbered = new RegExp(`^### R${r}\\.${i + 1} \\S`, "u").test(block[0] ?? "");
      if (!numbered) {
        found.add("id");
      }
      const reasons = findingReasons(block, [
        "Found by",
        "Command",
        "Printed",
        "Required",
        "Breaks",
      ]);
      for (const reason of reasons) {
        found.add(reason);
      }
      if (numbered && reasons.size === 0) {
        kept.push(block);
      }
    });
    for (const reason of draftReasons(dir, key, marked, kept)) {
      found.add(reason);
    }
    const verdict = section(parsed, "Verdict").lines;
    const only = verdict.length === 1 ? verdict[0] : undefined;
    if (only !== "approve" && only !== "changes-requested") {
      found.add("verdict");
    } else if (only === "approve") {
      for (const reason of approveBlockers(dir, scope, r, openAfter(parsed).size)) {
        found.add(reason);
      }
    }
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
    if (before !== null) {
      const ids = new Set(got.map((answer) => answer.id));
      if ([...before.keys()].some((id) => !ids.has(id))) {
        found.add("missing");
      }
      const prior = before;
      if (
        got.some(
          (answer) => prior.get(answer.id) === "stands again" && !answer.text.includes("assumed:"),
        )
      ) {
        found.add("assumed");
      }
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

export type RecordCounts =
  | { readonly failed: readonly string[] }
  | {
      readonly failed: readonly [];
      readonly tasks: number;
      readonly taskRounds: number;
      readonly integrationRounds: number;
      readonly findings: number;
    };

type RoundName = { readonly scope: string; readonly round: number; readonly name: string };

export const recordCounts = (dir: ReviewDir): RecordCounts => {
  const rounds = reviewNames(dir)
    .flatMap((name): readonly RoundName[] => {
      const kind = reviewKind(name);
      return kind !== null && kind.kind === "round"
        ? [{ scope: kind.scope, round: kind.round ?? 0, name }]
        : [];
    })
    .toSorted((x, y) =>
      x.scope !== y.scope
        ? x.scope < y.scope
          ? -1
          : 1
        : x.round !== y.round
          ? x.round - y.round
          : x.name < y.name
            ? -1
            : x.name > y.name
              ? 1
              : 0,
    );
  const failed = rounds.flatMap(({ name }) => {
    const { reasons } = lintReasons(dir, `review/${name}`);
    return reasons.length > 0 ? [`${name}: ${reasons.join(", ")}`] : [];
  });
  if (failed.length > 0) {
    return { failed };
  }
  const counted = rounds.filter(({ scope }) => scope !== "merge");
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
    failed: [],
    tasks: tasks.size,
    taskRounds: counted.length - integrationRounds,
    integrationRounds,
    findings,
  };
};
