import { escapeRegExp, SPACE, squeeze } from "../../../../scripts/pure/text.ts";
import type { FenceRecord } from "./sidecar-text.ts";

export type Quote = {
  readonly text: string;
  readonly verbatim: boolean;
  readonly record: FenceRecord | null;
};

export type Placement = "found" | "order" | "missing";

type Match = { readonly start: number; readonly end: number };

type Fence = { readonly mark: string; readonly length: number };

const opening = (line: string): Fence | null => {
  const match = /^\s*(`{3,}|~{3,})/u.exec(line);
  const run = match?.[1];
  return run === undefined ? null : { mark: run.charAt(0), length: run.length };
};

const closes = (line: string, fence: Fence): boolean => {
  const match = /^\s*(`{3,}|~{3,})\s*$/u.exec(line);
  const run = match?.[1];
  return run !== undefined && run.charAt(0) === fence.mark && run.length >= fence.length;
};

const findRecord = (document: string, record: FenceRecord, from: number): Match | null => {
  const raw = document.split("\n");
  const lines = raw.map((line) => line.replace(/\r$/u, ""));
  let offset = 0;
  let open: Fence | null = null;
  for (const [index, line] of lines.entries()) {
    const start = offset;
    offset += (raw[index] ?? "").length + 1;
    if (open !== null) {
      open = closes(line, open) ? null : open;
      continue;
    }
    open = opening(line);
    if (open !== null && start >= from && line === record.first) {
      const next = lines[index + 1];
      if (next === record.second) {
        return { start, end: offset + next.length };
      }
    }
  }
  return null;
};

const findVerbatim = (document: string, text: string, from: number): Match | null => {
  const start = document.indexOf(text, from);
  return start === -1 ? null : { start, end: start + text.length };
};

const findProse = (document: string, text: string, from: number): Match | null => {
  const pattern = new RegExp(squeeze(text).split(" ").map(escapeRegExp).join(`[${SPACE}]+`), "gu");
  pattern.lastIndex = from;
  const match = pattern.exec(document);
  return match === null ? null : { start: match.index, end: match.index + match[0].length };
};

const find = (document: string, quote: Quote, from: number): Match | null => {
  if (quote.record !== null) {
    return findRecord(document, quote.record, from);
  }
  return quote.verbatim
    ? findVerbatim(document, quote.text, from)
    : findProse(document, quote.text, from);
};

export const locate = (document: string, quotes: readonly Quote[]): readonly Placement[] => {
  const placements: Placement[] = [];
  let cursor = 0;
  for (const quote of quotes) {
    if (quote.record === null && squeeze(quote.text) === "") {
      placements.push("missing");
      continue;
    }
    const match = find(document, quote, cursor);
    if (match !== null) {
      placements.push("found");
      cursor = match.end;
    } else {
      placements.push(find(document, quote, 0) === null ? "missing" : "order");
    }
  }
  return placements;
};
