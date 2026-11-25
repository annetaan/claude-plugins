import { escapeRegExp, splitLines, wordBoundary } from "../../../../scripts/pure/text.ts";

const TRIGGER = /^(\s*)(?:-\s*)?["']?(pull_request(?:_target)?)["']?\s*(:|$)/u;
const ON = /^["']?on["']?\s*:(.*)$/u;
const FILTER = /^(\s*)(branches|branches-ignore)\s*:\s*(.*)$/u;
const PULL_REQUEST = new RegExp(
  `${wordBoundary("before")}pull_request(?:_target)?${wordBoundary("after")}`,
  "u",
);

export const glob = (pattern: string): string => {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i] ?? "";
    if (pattern.startsWith("**", i)) {
      out += ".*";
      i += 2;
      continue;
    }
    if (c === "*") {
      out += "[^/]*";
    } else if (c === "?" || c === "+") {
      out += c;
    } else if (c === "[" && pattern.slice(i).includes("]")) {
      const j = pattern.indexOf("]", i);
      out += pattern.slice(i, j + 1);
      i = j;
    } else if (c === "\\" && i + 1 < pattern.length) {
      i += 1;
      out += escapeRegExp(pattern[i] ?? "");
    } else {
      out += escapeRegExp(c);
    }
    i += 1;
  }
  return out;
};

export type FlowList = { readonly items: readonly string[]; readonly closed: boolean };

export const flowList = (text: string): FlowList => {
  const items: string[] = [];
  let item = "";
  let quote: string | null = null;
  let depth = 0;
  for (const c of text) {
    if (quote !== null) {
      if (c === quote) {
        quote = null;
      } else {
        item += c;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "[") {
      depth += 1;
      if (depth === 1) {
        continue;
      }
    } else if (c === "]") {
      depth -= 1;
      if (depth === 0) {
        return {
          items: [...items, item].map((s) => s.trim()).filter((s) => s !== ""),
          closed: true,
        };
      }
    } else if (c === "," && depth === 1) {
      items.push(item);
      item = "";
      continue;
    }
    item += c;
  }
  return { items: [], closed: false };
};

const stripQuotes = (text: string): string => text.replace(/^['"]+|['"]+$/gu, "");

export const letsThrough = (kind: string, patterns: readonly string[], base: string): boolean => {
  const hits = patterns
    .filter((p) => new RegExp(`^(?:${glob(p.replace(/^!+/u, ""))})$`, "u").test(base))
    .map((p) => !p.startsWith("!"));
  if (kind === "branches-ignore") {
    return hits.length === 0;
  }
  return hits.at(-1) ?? false;
};

export const uncommented = (line: string): string => {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charAt(i);
    if (quote !== null) {
      if (c === quote) {
        quote = null;
      }
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/u.test(line.charAt(i - 1)))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
};

const indentOf = (line: string): number => line.length - line.trimStart().length;

const triggerLets = (
  lines: readonly string[],
  n: number,
  indent: number,
  base: string,
): boolean => {
  let kind: string | null = null;
  let patterns: readonly string[] = [];
  let child: number | null = null;
  let collecting = false;
  let flow: string | null = null;
  for (const below of lines.slice(n + 1)) {
    if (below.trim() === "") {
      continue;
    }
    const depth = indentOf(below);
    if (depth <= indent) {
      break;
    }
    if (flow !== null) {
      flow += ` ${below.trim()}`;
      const found = flowList(flow);
      patterns = found.items;
      if (found.closed) {
        flow = null;
      }
      continue;
    }
    child ??= depth;
    const filter = FILTER.exec(below);
    if (filter !== null && depth === child) {
      kind = filter[2] ?? null;
      const value = (filter[3] ?? "").trim();
      patterns = value === "" ? [] : [stripQuotes(value)];
      collecting = value === "";
      if (value.startsWith("[")) {
        const found = flowList(value);
        patterns = found.items;
        flow = found.closed ? null : value;
      }
      continue;
    }
    if (collecting && depth >= child && below.trim().startsWith("- ")) {
      patterns = [...patterns, stripQuotes(below.trim().slice(2).trim())];
      continue;
    }
    collecting = false;
  }
  return kind === null || letsThrough(kind, patterns, base);
};

export const triggers = (text: string, base: string): boolean => {
  const lines = splitLines(text).map(uncommented);
  for (const [n, line] of lines.entries()) {
    const on = ON.exec(line);
    if (on !== null && PULL_REQUEST.test(on[1] ?? "")) {
      return true;
    }
    const trigger = TRIGGER.exec(line);
    if (trigger !== null && triggerLets(lines, n, (trigger[1] ?? "").length, base)) {
      return true;
    }
  }
  return false;
};
