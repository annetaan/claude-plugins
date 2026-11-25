import { DIGIT } from "../../../../scripts/pure/text.ts";

export const ROADMAP_PATHS: readonly string[] = [
  "roadmap.md",
  "ROADMAP.md",
  "doc/roadmap.md",
  "doc/ROADMAP.md",
  "docs/roadmap.md",
  "docs/ROADMAP.md",
];

export type RoadmapEntry = {
  readonly heading: string;
  readonly start: number;
  readonly end: number;
};

export type RoadmapReason =
  | { readonly code: "duplicate-heading"; readonly line: number; readonly heading: string }
  | { readonly code: "empty-heading"; readonly line: number }
  | { readonly code: "title-after-entry"; readonly line: number }
  | { readonly code: "several-titles"; readonly line: number }
  | { readonly code: "setext-heading"; readonly line: number; readonly heading: string }
  | { readonly code: "no-file" }
  | { readonly code: "several-files" };

export type RoadmapParse = {
  readonly entries: readonly RoadmapEntry[];
  readonly reasons: readonly RoadmapReason[];
};

const HEADING = /^##\s+(.+?)\s*$/su;
const TITLE = /^#\s+\S/u;
const UNDERLINE = /^\s{0,3}(?:=+|-+)\s*$/u;
const NUMBERED = new RegExp(`^\\s{0,3}${DIGIT}{1,9}[.)](?:\\s|$)`, "u");
const QUOTED_STARTS: readonly string[] = ["#", ">", "-", "*", "+", "|"];

const frontMatterEnd = (lines: readonly string[]): number => {
  if (lines[0]?.trim() !== "---") {
    return 0;
  }
  const close = lines.findIndex(
    (line, j) => j > 0 && (line.trim() === "---" || line.trim() === "..."),
  );
  return close === -1 ? 0 : close + 1;
};

export const roadmapParse = (text: string | null): RoadmapParse => {
  const all = (text ?? "").replaceAll("\r", "").split("\n");
  const lines = all.at(-1) === "" ? all.slice(0, -1) : all;
  const entries: { heading: string; start: number; end: number }[] = [];
  const reasons: RoadmapReason[] = [];
  const seen = new Set<string>();
  let titles = 0;
  let fence = false;
  let prev = "";
  for (let n = frontMatterEnd(lines); n < lines.length; n += 1) {
    const line = lines[n] ?? "";
    if (line.trimStart().startsWith("```")) {
      fence = !fence;
      prev = "";
      continue;
    }
    if (fence) {
      continue;
    }
    const found = !line.startsWith("###") && line.trim() !== "##" ? HEADING.exec(line) : null;
    if (found !== null) {
      const heading = found[1] ?? "";
      const last = entries.at(-1);
      if (last !== undefined) {
        last.end = n;
      }
      entries.push({ heading, start: n + 1, end: lines.length });
      if (seen.has(heading)) {
        reasons.push({ code: "duplicate-heading", line: n + 1, heading });
      }
      seen.add(heading);
    } else if (line.trim() === "##") {
      reasons.push({ code: "empty-heading", line: n + 1 });
    } else if (TITLE.test(line)) {
      if (entries.length > 0) {
        reasons.push({ code: "title-after-entry", line: n + 1 });
      } else {
        titles += 1;
        if (titles === 2) {
          reasons.push({ code: "several-titles", line: n + 1 });
        }
      }
    } else if (
      UNDERLINE.test(line) &&
      prev.trim() !== "" &&
      !QUOTED_STARTS.some((start) => prev.trimStart().startsWith(start)) &&
      !NUMBERED.test(prev) &&
      !UNDERLINE.test(prev)
    ) {
      reasons.push({ code: "setext-heading", line: n, heading: prev.trim() });
    }
    prev = line;
  }
  return { entries, reasons };
};

export type RoadmapFiles = {
  readonly files: readonly string[];
  readonly path: string | null;
  readonly reasons: readonly RoadmapReason[];
};

export const roadmapFiles = (found: readonly string[]): RoadmapFiles => {
  const files = ROADMAP_PATHS.filter((path) => found.includes(path));
  if (files.length === 0) {
    return { files, path: null, reasons: [{ code: "no-file" }] };
  }
  if (files.length > 1) {
    return { files, path: null, reasons: [{ code: "several-files" }] };
  }
  return { files, path: files[0] ?? null, reasons: [] };
};
