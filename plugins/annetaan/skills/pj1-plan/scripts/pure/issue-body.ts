import { DIGIT, WORD, squeeze, wordBoundary } from "../../../../scripts/pure/text.ts";
import { ROADMAP_PATHS } from "./roadmap-file.ts";

export const SECTIONS: readonly string[] = [
  "Goal",
  "Design",
  "Acceptance criteria",
  "Decisions",
  "Out of scope",
];
const PARENT_SECTIONS: readonly string[] = ["Goal", "Design", "Decisions", "Out of scope"];

const ENTRY_RE = /^\s*[-*]\s+`([^`]+)`\s+\((added|changed|deleted)\):\s*(.+)$/su;
const IDENT_RE = new RegExp(`^[A-Za-z_$][${WORD}$]*(?:\\.[A-Za-z_$][${WORD}$]*)*$`, "u");
const OPTION_RE = /^\s*[-*]\s+\[([ xX])\]\s/u;
const DECISION_RE = new RegExp(`^###\\s+D${DIGIT}+\\.`, "u");
const BASE_RE = /^Base:\s*`?([^`\s]+)`?\s+from\s+`?([^`\s]+)`?\s*$/u;
const ROADMAP_RE = /^Roadmap:\s*`([^`]+)`\s+(\S.*?)\s*$/su;
const ORDER_RE = new RegExp(`^\\s*${DIGIT}+\\.\\s+#(${DIGIT}+)${wordBoundary("after")}`, "u");
const IMPLEMENTS_RE = new RegExp(`^Implements #(${DIGIT}+)\\s*$`, "u");
const COUNT_RE = new RegExp(`(?:\\s*\\(${DIGIT}+/${DIGIT}+\\))+\\s*$`, "u");
const PARENT_BASE_RE = new RegExp(`^Base: \`pj/${DIGIT}+\` from \`[^\`\\s]+\`\\s*$`, "u");
const ORDER_LINE_RE = new RegExp(`^${DIGIT}+\\. #${DIGIT}+$`, "u");
const ONLY_YOU_KNOW_RE = /^Only you know:\s*\S/u;
const URL_RE = new RegExp(`${wordBoundary("before")}[a-z][a-z0-9+.-]*://\\S+`, "gu");
const LINE_ANCHOR_RE = /#L\d+\b/;
const PATH_LINE_RE = /(?<![\w.:/-])(?=[\w./-]*[A-Za-z])[\w.-]*[./][\w./-]*:\d+\b/;
const HEADING_RE = /^##\s+(.+?)\s*$/su;
const BULLET_RE = /^\s*[-*]\s/u;
const SPAN_RE = /`([^`\n]+)`/gu;
const CALL_RE = /\(.*\)$/su;
const LEFT_BROKEN_RE = /^###\s+Left broken\s*$/u;
const DOCUMENT_SUFFIXES: readonly string[] = [".md", ".mdx", ".markdown", ".rst", ".adoc"];

const isSpace = (char: string): boolean => char !== "" && squeeze(char) === "";

const startsWithSpace = (line: string): boolean => isSpace(line.slice(0, 1));

const stripNewlines = (text: string): string => text.replace(/^\n+/u, "").replace(/\n+$/u, "");

const toNumber = (digits: string): number => Number(digits.normalize("NFKC"));

const linesOf = (text: string | null): readonly string[] =>
  (text ?? "").replaceAll("\r\n", "\n").split("\n");

const bareLines = (text: string | null): readonly string[] =>
  (text ?? "").replaceAll("\r", "").split("\n");

export const unfenced = (text: string | null): readonly string[] => {
  const out: string[] = [];
  let fence = false;
  for (const line of linesOf(text)) {
    if (line.trimStart().startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (!fence) {
      out.push(line);
    }
  }
  return out;
};

export const headOf = (body: string | null): readonly string[] => {
  const lines = unfenced(body);
  const end = lines.findIndex((line) => line.startsWith("## "));
  return end === -1 ? lines : lines.slice(0, end);
};

export type BaseLine = { readonly base: string; readonly from: string };

export const baseOf = (body: string | null): BaseLine | null => {
  for (const line of headOf(body)) {
    const found = BASE_RE.exec(line);
    if (found !== null) {
      return { base: found[1] ?? "", from: found[2] ?? "" };
    }
  }
  return null;
};

export type RoadmapLine = { readonly path: string; readonly entry: string };

export const roadmapPath = (line: string): RoadmapLine | null => {
  const found = ROADMAP_RE.exec(line);
  if (found === null) {
    return null;
  }
  const written = (found[1] ?? "").trim();
  const path = written.startsWith("./") ? written.slice(2) : written;
  return ROADMAP_PATHS.includes(path) ? { path, entry: found[2] ?? "" } : null;
};

export const roadmapOf = (body: string | null): RoadmapLine | null => {
  const line = headOf(body).find((l) => ROADMAP_RE.test(l));
  return line === undefined ? null : roadmapPath(line);
};

export type Heading = { readonly index: number; readonly title: string };

export const headings = (lines: readonly string[]): readonly Heading[] => {
  const out: Heading[] = [];
  let fence = false;
  for (const [index, line] of lines.entries()) {
    if (line.trimStart().startsWith("```")) {
      fence = !fence;
    } else if (!fence) {
      const found = HEADING_RE.exec(line);
      if (found !== null) {
        out.push({ index, title: found[1] ?? "" });
      }
    }
  }
  return out;
};

export const rawSections = (
  body: string | null,
): { readonly order: readonly string[]; readonly sections: ReadonlyMap<string, string> } => {
  const lines = linesOf(body);
  const heads = headings(lines);
  const sections = new Map<string, string>();
  for (const [k, head] of heads.entries()) {
    const end = heads[k + 1]?.index ?? lines.length;
    sections.set(head.title, lines.slice(head.index + 1, end).join("\n"));
  }
  return { order: heads.map((head) => head.title), sections };
};

export const splitSections = (
  body: string | null,
): { readonly order: readonly string[]; readonly sections: ReadonlyMap<string, string> } => {
  const raw = rawSections(body);
  return {
    order: raw.order,
    sections: new Map(
      [...raw.sections].map(([name, text]: readonly [string, string]) => [
        name,
        unfenced(text).join("\n").trim(),
      ]),
    ),
  };
};

export const orderOf = (body: string | null): readonly number[] =>
  (splitSections(body).sections.get("Order") ?? "").split("\n").flatMap((line) => {
    const found = ORDER_RE.exec(line);
    return found === null ? [] : [toNumber(found[1] ?? "")];
  });

export const implementsOf = (body: string | null): number | null => {
  const line = linesOf(body).find((l) => l.trim() !== "");
  if (line === undefined) {
    return null;
  }
  const found = IMPLEMENTS_RE.exec(line);
  return found === null ? null : toNumber(found[1] ?? "");
};

const endAfter = (heads: readonly Heading[], start: number, length: number): number =>
  heads.find((head) => head.index > start)?.index ?? length;

export const withOrder = (body: string | null, numbers: readonly number[]): string => {
  const lines = bareLines(body);
  const heads = headings(lines);
  const block = [
    "## Order",
    "",
    ...(numbers.length > 0 ? [...numbers.map((n, k) => `${k + 1}. #${n}`), ""] : []),
  ];
  const start = heads.find((head) => head.title === "Order")?.index;
  const first = heads[0]?.index;
  let out: readonly string[];
  if (start !== undefined) {
    out = [
      ...lines.slice(0, start),
      ...block,
      ...lines.slice(endAfter(heads, start, lines.length)),
    ];
  } else if (first !== undefined) {
    out = [...lines.slice(0, first), ...block, ...lines.slice(first)];
  } else {
    const text = lines.join("\n").replace(/\n+$/u, "");
    out = [...(text === "" ? [] : [text, ""]), ...block];
  }
  return `${out.join("\n").replace(/\n+$/u, "")}\n`;
};

export type Sectioned =
  | { readonly kind: "ok"; readonly text: string }
  | { readonly kind: "error"; readonly message: string };

export const withSections = (body: string | null, newText: string, path: string): Sectioned => {
  const lines = bareLines(body);
  const goal = headings(lines).find((head) => head.title === "Goal")?.index;
  if (goal === undefined) {
    return { kind: "error", message: "the parent body has no ## Goal heading" };
  }
  const fresh = newText.replaceAll("\r", "").split("\n");
  const filled = [...fresh.keys()].filter((k) => (fresh[k] ?? "").trim() !== "");
  const first = filled[0];
  const last = filled.at(-1);
  if (first === undefined || last === undefined || (fresh[first] ?? "").trimEnd() !== "## Goal") {
    return { kind: "error", message: `${path} does not start at ## Goal` };
  }
  return {
    kind: "ok",
    text: `${[...lines.slice(0, goal), ...fresh.slice(first, last + 1)].join("\n")}\n`,
  };
};

export const designSection = (body: string | null): string => {
  const lines = bareLines(body);
  const heads = headings(lines);
  const start = heads.find((head) => head.title === "Design")?.index;
  if (start === undefined) {
    return "";
  }
  return stripNewlines(lines.slice(start, endAfter(heads, start, lines.length)).join("\n"));
};

const unfencedIndexes = (lines: readonly string[]): readonly number[] => {
  const out: number[] = [];
  let fence = false;
  for (const [k, line] of lines.entries()) {
    if (line.trimStart().startsWith("```")) {
      fence = !fence;
    } else if (!fence) {
      out.push(k);
    }
  }
  return out;
};

const isChecked = (mark: string | undefined): boolean => mark === "x" || mark === "X";

export const cutDecision = (block: readonly string[]): string => {
  const open = unfencedIndexes(block);
  const parts: string[] = [block[0] ?? ""];
  for (const k of open) {
    const found = OPTION_RE.exec(block[k] ?? "");
    if (found !== null && isChecked(found[1])) {
      let end = block.length;
      for (let j = k + 1; j < block.length; j += 1) {
        const line = block[j] ?? "";
        if (line.trim() !== "" && (!startsWithSpace(line) || OPTION_RE.test(line))) {
          end = j;
          break;
        }
      }
      parts.push(stripNewlines(block.slice(k, end).join("\n")));
    }
  }
  parts.push(
    ...open
      .map((k) => block[k] ?? "")
      .filter((line) => line.startsWith("Decided:"))
      .slice(0, 1),
  );
  return parts.join("\n\n");
};

export const cutDecisions = (text: string): string => {
  const lines = text.split("\n");
  const starts = unfencedIndexes(lines).filter((k) => DECISION_RE.test(lines[k] ?? ""));
  const first = starts[0];
  if (first === undefined) {
    return text;
  }
  const head = stripNewlines(lines.slice(0, first).join("\n"));
  const cut = starts.map((a, k) => cutDecision(lines.slice(a, starts[k + 1] ?? lines.length)));
  return [...(head === "" ? [] : [head]), ...cut].join("\n\n");
};

export type Titled = {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
};

export type Broken = { readonly check: string; readonly issue: number };

export const approvedDesign = (
  issue: Titled,
  parent: Titled,
  waited: readonly Titled[],
  broken: readonly Broken[],
): string => {
  const lines = bareLines(issue.body);
  const heads = headings(lines);
  const goal = heads.find((head) => head.title === "Goal")?.index ?? 0;
  const dec = heads.find((head) => head.title === "Decisions")?.index;
  let own: readonly string[];
  if (dec === undefined) {
    own = lines.slice(goal);
  } else {
    const end = endAfter(heads, dec, lines.length);
    const cut = cutDecisions(stripNewlines(lines.slice(dec + 1, end).join("\n")));
    own = [...lines.slice(goal, dec + 1), "", cut, "", ...lines.slice(end)];
  }
  const parts = [
    `# Issue #${issue.number}: ${issue.title.replace(COUNT_RE, "")}`,
    stripNewlines(own.join("\n")),
    `# Parent #${parent.number}: ${parent.title}`,
    designSection(parent.body),
    ...waited.flatMap((q) => [
      `# Waited-on project #${q.number}: ${q.title}`,
      designSection(q.body),
    ]),
    "# Left broken on the base branch",
    broken.length > 0
      ? broken.map((b) => `- \`${b.check}\` (left by #${b.issue})`).join("\n")
      : "None.",
  ];
  return `${parts.filter((part) => part !== "").join("\n\n")}\n`;
};

const spansIn = (text: string): readonly string[] =>
  [...text.matchAll(SPAN_RE)].map((found) => found[1] ?? "");

export const spansOf = (desc: string): readonly string[] => {
  const out: string[] = [];
  for (const raw of spansIn(desc)) {
    const span = raw.trim().replace(CALL_RE, "");
    if (IDENT_RE.test(span) && !out.includes(span)) {
      out.push(span);
    }
  }
  return out;
};

export const isDocument = (path: string): boolean => {
  const lower = path.toLowerCase();
  return DOCUMENT_SUFFIXES.some((suffix) => lower.endsWith(suffix));
};

export type FileEntry = {
  readonly path: string;
  readonly kind: "added" | "changed" | "deleted";
  readonly spans: readonly string[];
};

export const symbols = (entry: FileEntry, paths: ReadonlySet<string>): readonly string[] => {
  const out: string[] = [];
  for (const span of entry.spans) {
    if (paths.has(span)) {
      continue;
    }
    const symbol = span.split(".").at(-1) ?? span;
    if (!out.includes(symbol)) {
      out.push(symbol);
    }
  }
  return out;
};

const isKind = (kind: string): kind is FileEntry["kind"] =>
  kind === "added" || kind === "changed" || kind === "deleted";

export const fileList = (
  design: string,
): { readonly files: readonly FileEntry[]; readonly bad: number } => {
  const entries: string[] = [];
  for (const line of design.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    if (BULLET_RE.test(line)) {
      entries.push(line.trim());
    } else if (entries.length > 0 && startsWithSpace(line)) {
      entries.push(`${entries.pop() ?? ""} ${line.trim()}`);
    } else {
      break;
    }
  }
  const files: FileEntry[] = [];
  let bad = 0;
  for (const entry of entries) {
    const found = ENTRY_RE.exec(entry);
    const kind = found?.[2] ?? "";
    if (found === null || !isKind(kind)) {
      bad += 1;
      continue;
    }
    const written = (found[1] ?? "").trim();
    const path = written.startsWith("./") ? written.slice(2) : written;
    files.push({ path, kind, spans: spansOf(found[3] ?? "") });
  }
  return { files, bad };
};

export const leftBroken = (
  design: string,
): { readonly checks: readonly string[]; readonly bad: boolean } => {
  const lines = design.split("\n");
  const k = lines.findIndex((line) => LEFT_BROKEN_RE.test(line));
  if (k === -1) {
    return { checks: [], bad: false };
  }
  const bullets: string[] = [];
  for (const line of lines.slice(k + 1)) {
    if (line.startsWith("###")) {
      break;
    }
    if (BULLET_RE.test(line)) {
      bullets.push(line.trim());
    } else if (bullets.length > 0 && line.trim() !== "" && startsWithSpace(line)) {
      bullets.push(`${bullets.pop() ?? ""} ${line.trim()}`);
    }
  }
  const checks: string[] = [];
  let bad = bullets.length === 0;
  for (const bullet of bullets) {
    const check = (spansIn(bullet)[0] ?? "").trim();
    if (check === "") {
      bad = true;
    } else if (!checks.includes(check)) {
      checks.push(check);
    }
  }
  return { checks, bad };
};

export const criteriaSpans = (sections: ReadonlyMap<string, string>): readonly string[] =>
  (sections.get("Acceptance criteria") ?? "")
    .split("\n")
    .filter((line) => BULLET_RE.test(line))
    .flatMap((line) => spansIn(line).map((span) => span.trim()));

export type Decision = {
  readonly checked: number;
  readonly options: number;
  readonly recommended: number;
  readonly onlyYouKnow: boolean;
  readonly optionLines: boolean;
};

export const decisions = (text: string): readonly Decision[] => {
  const out: {
    checked: number;
    options: number;
    recommended: number;
    onlyYouKnow: boolean;
    optionLines: boolean;
  }[] = [];
  const lines = text.split("\n");
  let fence = false;
  for (const [k, line] of lines.entries()) {
    if (line.trimStart().startsWith("```")) {
      fence = !fence;
      continue;
    }
    if (fence) {
      continue;
    }
    if (DECISION_RE.test(line)) {
      out.push({ checked: 0, options: 0, recommended: 0, onlyYouKnow: false, optionLines: true });
      continue;
    }
    const d = out.at(-1);
    if (d === undefined) {
      continue;
    }
    if (ONLY_YOU_KNOW_RE.test(line)) {
      d.onlyYouKnow = true;
    }
    const found = OPTION_RE.exec(line);
    if (found !== null) {
      d.options += 1;
      d.checked += isChecked(found[1]) ? 1 : 0;
      d.recommended += line.includes("(recommended)") ? 1 : 0;
      const under = lines.slice(k + 1).find((l) => l.trim() !== "") ?? "";
      if (!startsWithSpace(under) || OPTION_RE.test(under)) {
        d.optionLines = false;
      }
    }
  }
  return out;
};

export type DecisionCounts = {
  readonly total: number;
  readonly settled: number;
  readonly open: number;
  readonly contradictory: number;
};

export const decisionCounts = (decs: readonly Decision[]): DecisionCounts => ({
  total: decs.length,
  settled: decs.filter((d) => d.checked === 1).length,
  open: decs.filter((d) => d.checked === 0).length,
  contradictory: decs.filter((d) => d.checked > 1).length,
});

export type ParsedBody = {
  readonly head: readonly string[];
  readonly lineNumber: boolean;
  readonly order: readonly string[];
  readonly sections: ReadonlyMap<string, string>;
  readonly files: readonly FileEntry[];
  readonly badEntries: number;
  readonly decs: readonly Decision[];
  readonly broken: readonly string[];
  readonly badBroken: boolean;
  readonly criteria: readonly string[];
  readonly stub: boolean;
};

export const parseBody = (body: string | null): ParsedBody => {
  const { order, sections } = splitSections(body);
  const design = sections.get("Design") ?? "";
  const { files, bad } = fileList(design);
  const broken = leftBroken(design);
  const text = unfenced(body).join("\n");
  return {
    head: headOf(body),
    lineNumber: LINE_ANCHOR_RE.test(text) || PATH_LINE_RE.test(text.replace(URL_RE, " ")),
    order,
    sections,
    files,
    badEntries: bad,
    decs: decisions(rawSections(body).sections.get("Decisions") ?? ""),
    broken: broken.checks,
    badBroken: broken.bad,
    criteria: criteriaSpans(sections),
    stub: design === "To be drawn.",
  };
};

export type LintResult = { readonly ok: boolean; readonly reasons: readonly string[] };

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, k) => item === b[k]);

export const decisionReasons = (parsed: ParsedBody): readonly string[] => {
  const decs = parsed.decs;
  const text = parsed.sections.get("Decisions") ?? "";
  return [
    ...((decs.length === 0 && text !== "None.") ||
    decs.some((d) => d.options < 2 || d.options > 4 || d.recommended !== 1)
      ? ["decision-shape"]
      : []),
    ...(decs.some((d) => !d.onlyYouKnow) ? ["only-you-know"] : []),
    ...(decs.some((d) => d.checked === 0) ? ["decisions-open"] : []),
    ...(decs.some((d) => d.checked > 1) ? ["decisions-contradictory"] : []),
  ];
};

const result = (reasons: readonly string[]): LintResult => ({
  ok: reasons.length === 0,
  reasons,
});

export const lint = (
  parsed: ParsedBody,
  paths: ReadonlySet<string> = new Set(),
  holdingNames: ReadonlySet<string> = new Set(),
): LintResult => {
  if (parsed.stub) {
    return { ok: false, reasons: ["stub"] };
  }
  const known = new Set([...parsed.files.map((f) => f.path), ...paths]);
  const criteria = (parsed.sections.get("Acceptance criteria") ?? "")
    .split("\n")
    .filter((line) => BULLET_RE.test(line));
  return result([
    ...(sameList(parsed.order, SECTIONS) ? [] : ["sections"]),
    ...(parsed.files.length === 0 ? ["no-files"] : []),
    ...(parsed.badEntries > 0 ? ["file-entry"] : []),
    ...(parsed.files.some(
      (f) => f.kind === "changed" && holdingNames.has(f.path) && symbols(f, known).length === 0,
    )
      ? ["no-symbols"]
      : []),
    ...(criteria.length === 0 || criteria.some((line) => !line.includes("`")) ? ["criteria"] : []),
    ...(parsed.badBroken ? ["breakage-entry"] : []),
    ...(parsed.lineNumber ? ["line-number"] : []),
    ...(parsed.decs.some((d) => !d.optionLines) ? ["option-shape"] : []),
    ...decisionReasons(parsed),
  ]);
};

export const parentLint = (parsed: ParsedBody): LintResult => {
  const heads = parsed.order;
  const goal = heads.indexOf("Goal");
  return result([
    ...(parsed.head.some((line) => PARENT_BASE_RE.test(line)) ? [] : ["base"]),
    ...(parsed.head.some((line) => line.startsWith("Roadmap:") && roadmapPath(line) === null)
      ? ["roadmap"]
      : []),
    ...((parsed.sections.get("Order") ?? "")
      .split("\n")
      .some((line) => line.trim() !== "" && !ORDER_LINE_RE.test(line.trimEnd()))
      ? ["order"]
      : []),
    ...(!sameList(
      heads.filter((head) => head !== "Order"),
      PARENT_SECTIONS,
    ) || heads.some((head, k) => head === "Order" && k > goal)
      ? ["sections"]
      : []),
    ...decisionReasons(parsed),
  ]);
};

export const titled = (title: string, counts: DecisionCounts): string => {
  const bare = title.replace(COUNT_RE, "");
  return counts.settled < counts.total ? `${bare} (${counts.settled}/${counts.total})` : bare;
};

export const sameWords = (
  before: string,
  after: string,
): { readonly ok: boolean; readonly lint: LintResult } => {
  const words = (text: string): string => squeeze(text.replaceAll("`", ""));
  return { ok: words(before) === words(after), lint: lint(parseBody(after)) };
};
