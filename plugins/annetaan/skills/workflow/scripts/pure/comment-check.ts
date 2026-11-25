import { DIGIT, WORD, escapeRegExp, wordBoundary } from "../../../../scripts/pure/text.ts";

export type Language = "shell" | "python" | "js" | "ts" | "go" | "rust" | "css" | "html";

export type Entry = {
  readonly kind: "comment" | "doc" | "suppression";
  readonly line: number;
  readonly end: number;
  readonly text: string;
};

export type Judged =
  | { readonly read: true; readonly entries: readonly Entry[] }
  | { readonly read: false };

export type Args = { readonly library: boolean; readonly every: boolean; readonly ref: string };

export type Scanned = {
  readonly path: string;
  readonly judged: Judged;
  readonly added: ReadonlySet<number> | null;
};

export type FixEntry = {
  readonly path: string;
  readonly line: number;
  readonly text: string;
  readonly kind: Entry["kind"];
};

export type Listed = { readonly path: string; readonly line: number; readonly text: string };

export type Report = {
  readonly status: "found" | "clean";
  readonly ref: string | null;
  readonly scanned: number;
  readonly fix: readonly FixEntry[];
  readonly doc: readonly Listed[];
  readonly existing: readonly Listed[];
  readonly unread: readonly string[];
};

type Found = {
  readonly line: number;
  readonly end: number;
  readonly text: string;
  readonly full: string;
  readonly doc: boolean;
};

type Span = readonly [number, number];

type Scan = { readonly found: readonly Found[]; readonly blanked: readonly Span[] };

class Unreadable extends Error {}

const EXTENSIONS: ReadonlyMap<string, Language> = new Map([
  [".sh", "shell"],
  [".bash", "shell"],
  [".zsh", "shell"],
  [".py", "python"],
  [".js", "js"],
  [".mjs", "js"],
  [".cjs", "js"],
  [".jsx", "js"],
  [".tsx", "js"],
  [".ts", "ts"],
  [".mts", "ts"],
  [".cts", "ts"],
  [".go", "go"],
  [".rs", "rust"],
  [".css", "css"],
  [".html", "html"],
]);

const LICENCE = /copyright|licen[sc]e/iu;
const COMMENT_START = /^(?:#|\/\/|\/\*|<!--)/u;
const OPENER = String.raw`^(?:#|//+|/\*+|<!--)(?:\s|\*)*`;
const SUPPRESSION_COMMENT = new RegExp(
  OPENER +
    String.raw`(?:shellcheck\s+disable=` +
    String.raw`|noqa${wordBoundary("after")}` +
    String.raw`|type:\s*ignore` +
    String.raw`|pylint:\s*disable` +
    String.raw`|pyright:\s*ignore` +
    String.raw`|pragma:\s*no cover` +
    String.raw`|nosec${wordBoundary("after")}` +
    "|eslint-disable" +
    "|oxlint-disable" +
    "|@ts-ignore" +
    "|@ts-nocheck" +
    "|biome-ignore" +
    "|prettier-ignore" +
    "|oxfmt-ignore" +
    String.raw`|(?:istanbul|c8|v8)\s+ignore` +
    "|nolint" +
    "|lint:ignore)",
  "u",
);
const DIRECTIVE = new RegExp(
  String.raw`^#[ \t]*(?:shellcheck${wordBoundary("after")}(?!\s+disable=)|(?:-\*-\s*)?coding[:=]|type:\s*(?!ignore)|fmt:)` +
    String.raw`|^///[ \t]*<reference` +
    "|^//go:" +
    String.raw`|^//[ \t]*\+build` +
    String.raw`|^/\*[ \t]*globals?\s` +
    "|" +
    OPENER +
    "(?:@ts-expect-error|@ts-check|@jsx|[@#]__PURE__|eslint-env|@vitest-environment|@jest-environment)",
  "u",
);
const JS_SKIP = new RegExp(
  String.raw`\.skip\(|${wordBoundary("before")}x(?:it|describe|test)\(`,
  "u",
);
const CODE_SUPPRESSION: ReadonlyMap<Language, RegExp> = new Map([
  ["js", JS_SKIP],
  ["ts", JS_SKIP],
  ["html", JS_SKIP],
  [
    "python",
    new RegExp(
      String.raw`@pytest\.mark\.skip${wordBoundary("after")}|@pytest\.mark\.xfail|@unittest\.skip\(`,
      "u",
    ),
  ],
  ["rust", /#!?\[(?:ignore|allow\()/u],
]);
const JS_KEYWORDS_BEFORE_REGEX: ReadonlySet<string> = new Set(
  "return typeof case do else in of instanceof new delete void throw yield await".split(" "),
);
const JS_WORD = new RegExp(String.raw`(?:(?!${DIGIT})[${WORD}]|\$)[${WORD}$]*`, "uy");
const JSX_OPEN = new RegExp(String.raw`<(?:>|[A-Za-z_$][${WORD}$.:-]*(?=[\s/>]))`, "uy");
const JS_NUMBER = new RegExp(String.raw`${DIGIT}[${WORD}.]*`, "uy");
const DIGIT_AT = new RegExp(DIGIT, "uy");
const LETTER_AT = /\p{L}/uy;
const RUST_RAW = /b?r(#*)"/uy;
const RUST_WORD = new RegExp(String.raw`[${WORD}]+`, "uy");
const GO_DECLARATION = new RegExp(
  String.raw`^(?:package${wordBoundary("after")}|func\s+(?:\([^)]*\)\s*)?[A-Z]|(?:type|var|const)\s+[A-Z])`,
  "u",
);
const HEREDOC = /<<(-?)[ \t]*(?:'([^'\n]*)'|"([^"\n]*)"|\\?([^\s;|&<>()'"\\]+))/uy;
const PYTHON_WORD = /(?:^|[\s/;|&(])python3?(?=\s|$)/u;
const HTML_TOKEN = new RegExp(
  String.raw`<!--|<(script|style)${wordBoundary("after")}([^>]*)>`,
  "giu",
);
const HTML_SCRIPT_TYPE = /type\s*=\s*["']?([^"'\s>]+)/iu;
const SCRIPT_CLOSE = /<\/script/giu;
const STYLE_CLOSE = /<\/style/giu;
const HUNK = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm;
const PY_WORD = new RegExp(String.raw`[${WORD}]+`, "uy");
const PY_PREFIX = /(?:[rR][bBfFtT]|[bBfFtT][rR]|[rRuUbBfFtT])(?=["'])/y;

const lineStarts = (text: string): readonly number[] => {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) {
    starts.push(i + 1);
  }
  return starts;
};

const lineAt = (starts: readonly number[], index: number): number => {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((starts[middle] ?? 0) <= index) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};

const firstLine = (text: string): string => {
  const end = text.indexOf("\n");
  return end < 0 ? text : text.slice(0, end);
};

const record = (
  starts: readonly number[],
  text: string,
  start: number,
  end: number,
  doc: boolean,
): Found => {
  const full = text.slice(start, end);
  return {
    line: lineAt(starts, start),
    end: lineAt(starts, Math.max(start, end - 1)),
    text: firstLine(full).trimEnd(),
    full,
    doc,
  };
};

const shifted = (found: readonly Found[], lines: number, doc: boolean | null): readonly Found[] =>
  found.map((f) => ({
    ...f,
    line: f.line + lines,
    end: f.end + lines,
    doc: doc ?? f.doc,
  }));

const moved = (spans: readonly Span[], by: number): readonly Span[] =>
  spans.map(([start, end]) => [start + by, end + by] as const);

const blankText = (text: string, spans: readonly Span[]): string => {
  const chars = text.split("");
  for (const [start, end] of spans) {
    for (let k = start; k < end; k += 1) {
      if (chars[k] !== "\n") {
        chars[k] = " ";
      }
    }
  }
  return chars.join("");
};

const lineEnd = (text: string, i: number): number => {
  const end = text.indexOf("\n", i);
  return end < 0 ? text.length : end;
};

const skipQuoted = (text: string, i: number, multiline: boolean): number => {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") {
      j += 2;
    } else if (c === quote) {
      return j + 1;
    } else if (c === "\n" && !multiline) {
      return j;
    } else {
      j += 1;
    }
  }
  return text.length;
};

const blockEnd = (text: string, i: number, nested: boolean): number => {
  let depth = 1;
  let j = i + 2;
  while (j < text.length) {
    if (nested && text.startsWith("/*", j)) {
      depth += 1;
      j += 2;
    } else if (text.startsWith("*/", j)) {
      depth -= 1;
      j += 2;
      if (depth === 0) {
        return j;
      }
    } else {
      j += 1;
    }
  }
  throw new Unreadable("unterminated block comment");
};

const templateChunk = (
  text: string,
  start: number,
): { readonly next: number; readonly opened: boolean } => {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
    } else if (text[i] === "`") {
      return { next: i + 1, opened: false };
    } else if (text.startsWith("${", i)) {
      return { next: i + 2, opened: true };
    } else {
      i += 1;
    }
  }
  throw new Unreadable("unterminated template literal");
};

const jsxOpens = (text: string, i: number): boolean => {
  JSX_OPEN.lastIndex = i;
  const m = JSX_OPEN.exec(text);
  if (m === null) {
    return false;
  }
  const after = i + m[0].length;
  const closing = new RegExp(`</${escapeRegExp(m[0].slice(1))}\\s*>`, "gu");
  closing.lastIndex = after;
  if (closing.test(text)) {
    return true;
  }
  let depth = 0;
  let j = after;
  while (j < text.length) {
    const c = text[j];
    if (c === "'" || c === '"') {
      j = skipQuoted(text, j, true);
      continue;
    }
    if (c === "{") {
      depth += 1;
    } else if (c === "}") {
      depth -= 1;
    } else if (c === ">" && depth === 0) {
      return text[j - 1] === "/";
    }
    j += 1;
  }
  return false;
};

const jsRegexEnd = (text: string, i: number): number | null => {
  let j = i + 1;
  let inClass = false;
  while (j < text.length) {
    const c = text[j];
    if (c === "\n") {
      return null;
    }
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "[") {
      inClass = true;
    } else if (c === "]") {
      inClass = false;
    } else if (c === "/" && !inClass) {
      return j + 1;
    }
    j += 1;
  }
  return null;
};

const scanJs = (text: string, jsx: boolean): Scan => {
  const starts = lineStarts(text);
  const found: Found[] = [];
  const blanked: [number, number][] = [];
  const blank = (start: number, end: number): void => {
    const last = blanked.at(-1);
    if (last !== undefined && last[1] === start) {
      last[1] = end;
    } else {
      blanked.push([start, end]);
    }
  };
  const stack: { kind: "text" | "tag" | "expr" | "tpl"; count: number }[] = [];
  const n = text.length;
  let i = 0;
  let regexOk = true;
  if (text.startsWith("#!")) {
    i = lineEnd(text, 0);
    blank(0, i);
  }
  while (i < n) {
    const c = text[i] ?? "";
    const two = text.slice(i, i + 2);
    const top = stack.at(-1);
    const kind = top?.kind ?? "js";
    if (kind === "text") {
      if (two === "</") {
        const end = text.indexOf(">", i);
        if (end < 0) {
          throw new Unreadable("unterminated JSX");
        }
        stack.pop();
        i = end + 1;
        regexOk = false;
      } else if (c === "<" && jsxOpens(text, i)) {
        stack.push({ kind: "tag", count: 0 });
        i += 1;
      } else if (c === "{") {
        stack.push({ kind: "expr", count: 0 });
        i += 1;
        regexOk = true;
      } else {
        blank(i, i + 1);
        i += 1;
      }
    } else if (" \t\r\n".includes(c)) {
      i += 1;
    } else if (two === "//") {
      const end = lineEnd(text, i);
      found.push(record(starts, text, i, end, false));
      blank(i, end);
      i = end;
    } else if (two === "/*") {
      const end = blockEnd(text, i, false);
      const doc = text.startsWith("/**", i) && !text.startsWith("/**/", i);
      found.push(record(starts, text, i, end, doc));
      blank(i, end);
      i = end;
    } else if (kind === "tag" && top !== undefined) {
      if (two === "/>") {
        stack.pop();
        i += 2;
        regexOk = false;
      } else if (c === ">") {
        top.kind = "text";
        top.count = 0;
        i += 1;
      } else if (c === "'" || c === '"') {
        const end = text.indexOf(c, i + 1);
        if (end < 0) {
          throw new Unreadable("unterminated JSX attribute");
        }
        blank(i, end + 1);
        i = end + 1;
      } else if (c === "{") {
        stack.push({ kind: "expr", count: 0 });
        i += 1;
        regexOk = true;
      } else {
        i += 1;
      }
    } else if (c === "'" || c === '"') {
      const end = skipQuoted(text, i, false);
      blank(i, end);
      i = end;
      regexOk = false;
    } else if (c === "`") {
      const chunk = templateChunk(text, i);
      blank(i, chunk.next);
      i = chunk.next;
      if (chunk.opened) {
        stack.push({ kind: "tpl", count: 0 });
      }
      regexOk = chunk.opened;
    } else if (c === "{") {
      if (top !== undefined) {
        top.count += 1;
      }
      i += 1;
      regexOk = true;
    } else if (c === "}") {
      if (top !== undefined && top.count === 0) {
        stack.pop();
        if (top.kind === "tpl") {
          const chunk = templateChunk(text, i);
          blank(i, chunk.next);
          i = chunk.next;
          if (chunk.opened) {
            stack.push({ kind: "tpl", count: 0 });
          }
        } else {
          i += 1;
        }
        regexOk = false;
        continue;
      }
      if (top !== undefined) {
        top.count -= 1;
      }
      i += 1;
      regexOk = false;
    } else if (c === "<" && jsx && regexOk && jsxOpens(text, i)) {
      stack.push({ kind: "tag", count: 0 });
      i += 1;
    } else if (c === "/" && regexOk) {
      const end = jsRegexEnd(text, i);
      if (end === null) {
        i += 1;
      } else {
        blank(i, end);
        i = end;
        regexOk = false;
      }
    } else if ((c === "+" || c === "-") && text[i + 1] === c) {
      i += 2;
    } else if (c === "/") {
      i += 1;
      regexOk = true;
    } else {
      JS_WORD.lastIndex = i;
      const word = JS_WORD.exec(text);
      DIGIT_AT.lastIndex = i;
      if (word !== null) {
        regexOk = JS_KEYWORDS_BEFORE_REGEX.has(word[0]);
        i += word[0].length;
      } else if (DIGIT_AT.test(text)) {
        JS_NUMBER.lastIndex = i;
        i += JS_NUMBER.exec(text)?.[0].length ?? 1;
        regexOk = false;
      } else {
        regexOk = c !== ")" && c !== "]";
        i += 1;
      }
    }
  }
  if (
    stack.some(
      (open: Readonly<(typeof stack)[number]>) => open.kind === "text" || open.kind === "tag",
    )
  ) {
    throw new Unreadable("unterminated JSX");
  }
  return { found, blanked };
};

const rustQuote = (
  text: string,
  i: number,
): { readonly next: number; readonly span: Span | null } => {
  if (text[i + 1] === "\\") {
    const close = text.indexOf("'", i + 3);
    if (close >= 0) {
      return { next: close + 1, span: [i, close + 1] };
    }
  } else if (text[i + 2] === "'") {
    return { next: i + 3, span: [i, i + 3] };
  }
  return { next: i + 1, span: null };
};

const letterAt = (text: string, i: number): boolean => {
  LETTER_AT.lastIndex = i;
  return LETTER_AT.test(text);
};

const scanClike = (text: string, language: "go" | "rust" | "css"): Scan => {
  const starts = lineStarts(text);
  const found: Found[] = [];
  const blanked: Span[] = [];
  const n = text.length;
  const rust = language === "rust";
  let i = 0;
  while (i < n) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    if (two === "//" && language !== "css") {
      const end = lineEnd(text, i);
      const doc =
        rust &&
        ((text.startsWith("///", i) && !text.startsWith("////", i)) || text.startsWith("//!", i));
      found.push(record(starts, text, i, end, doc));
      blanked.push([i, end]);
      i = end;
    } else if (two === "/*") {
      const end = blockEnd(text, i, rust);
      const doc =
        rust &&
        ((text.startsWith("/**", i) &&
          !text.startsWith("/**/", i) &&
          !text.startsWith("/***", i)) ||
          text.startsWith("/*!", i));
      found.push(record(starts, text, i, end, doc));
      blanked.push([i, end]);
      i = end;
    } else if (c === '"' || (c === "'" && !rust)) {
      const end = skipQuoted(text, i, rust);
      blanked.push([i, end]);
      i = end;
    } else if (c === "`" && language === "go") {
      const end = text.indexOf("`", i + 1);
      if (end < 0) {
        throw new Unreadable("unterminated raw string");
      }
      blanked.push([i, end + 1]);
      i = end + 1;
    } else if (rust && c === "'") {
      const quoted = rustQuote(text, i);
      if (quoted.span !== null) {
        blanked.push(quoted.span);
      }
      i = quoted.next;
    } else if (rust && (c === "_" || letterAt(text, i))) {
      RUST_RAW.lastIndex = i;
      const raw = RUST_RAW.exec(text);
      if (raw === null) {
        RUST_WORD.lastIndex = i;
        i += RUST_WORD.exec(text)?.[0].length ?? 1;
        continue;
      }
      const closing = `"${raw[1] ?? ""}`;
      const close = text.indexOf(closing, i + raw[0].length);
      if (close < 0) {
        throw new Unreadable("unterminated raw string");
      }
      const end = close + closing.length;
      blanked.push([i, end]);
      i = end;
    } else {
      i += 1;
    }
  }
  return { found, blanked };
};

const scanGo = (text: string): Scan => {
  const scan = scanClike(text, "go");
  const lines = text.split("\n");
  const marked = new Set<number>();
  const standalone = scan.found.flatMap((f, index) =>
    f.full.startsWith("//") && (lines[f.line - 1] ?? "").trimStart().startsWith("//")
      ? [index]
      : [],
  );
  let group: number[] = [];
  for (const index of [...standalone, null]) {
    const last = group.at(-1);
    const lastLine = last === undefined ? null : (scan.found[last]?.line ?? null);
    const line = index === null ? null : (scan.found[index]?.line ?? null);
    if (lastLine !== null && (line === null || line !== lastLine + 1)) {
      if (GO_DECLARATION.test(lines[lastLine] ?? "")) {
        for (const member of group) {
          marked.add(member);
        }
      }
      group = [];
    }
    if (index !== null) {
      group.push(index);
    }
  }
  return {
    found: scan.found.map((f, index) => (marked.has(index) ? { ...f, doc: true } : f)),
    blanked: scan.blanked,
  };
};

type Part = {
  readonly string: boolean;
  readonly value: string;
  readonly start: number;
  readonly stop: number;
};

type PyString = { readonly end: number; readonly comments: readonly Span[] };

const commentEnd = (text: string, i: number): number => {
  let j = i;
  while (j < text.length && text[j] !== "\n" && text[j] !== "\r") {
    j += 1;
  }
  return j;
};

const wordAt = (text: string, i: number): string | null => {
  PY_WORD.lastIndex = i;
  return PY_WORD.exec(text)?.[0] ?? null;
};

const prefixAt = (text: string, i: number): string | null => {
  PY_PREFIX.lastIndex = i;
  return PY_PREFIX.exec(text)?.[0] ?? null;
};

const specEnd = (text: string, i: number): PyString => {
  const comments: Span[] = [];
  let j = i;
  while (j < text.length) {
    const c = text[j];
    if (c === "{") {
      const field = fieldEnd(text, j + 1);
      comments.push(...field.comments);
      j = field.end;
    } else if (c === "}") {
      return { end: j + 1, comments };
    } else {
      j += 1;
    }
  }
  throw new Unreadable("unterminated f-string field");
};

const fieldEnd = (text: string, i: number): PyString => {
  const comments: Span[] = [];
  let depth = 0;
  let j = i;
  while (j < text.length) {
    const c = text[j] ?? "";
    const word = wordAt(text, j);
    if (c === "#") {
      const end = commentEnd(text, j);
      comments.push([j, end]);
      j = end;
    } else if (c === "'" || c === '"' || (word !== null && prefixAt(text, j) !== null)) {
      const inner = pyString(text, j);
      comments.push(...inner.comments);
      j = inner.end;
    } else if (word !== null) {
      j += word.length;
    } else if ("([{".includes(c)) {
      depth += 1;
      j += 1;
    } else if (c === "}" && depth === 0) {
      return { end: j + 1, comments };
    } else if (")]}".includes(c)) {
      depth = Math.max(0, depth - 1);
      j += 1;
    } else if (c === ":" && depth === 0) {
      const spec = specEnd(text, j + 1);
      return { end: spec.end, comments: [...comments, ...spec.comments] };
    } else {
      j += 1;
    }
  }
  throw new Unreadable("unterminated f-string field");
};

const escapeEnd = (text: string, j: number, formatted: boolean, raw: boolean): number => {
  const next = text[j + 1];
  if (text.startsWith("\r\n", j + 1)) {
    return j + 3;
  }
  if (formatted && (next === "{" || next === "}")) {
    return j + 1;
  }
  if (formatted && !raw && next === "N" && text[j + 2] === "{") {
    const close = text.indexOf("}", j + 3);
    return close < 0 ? text.length : close + 1;
  }
  return j + 2;
};

const pyString = (text: string, start: number): PyString => {
  const prefix = prefixAt(text, start) ?? "";
  const open = start + prefix.length;
  const quote = text[open] ?? "";
  const closer = text.startsWith(quote.repeat(3), open) ? quote.repeat(3) : quote;
  const formatted = /[fFtT]/u.test(prefix);
  const raw = /[rR]/u.test(prefix);
  const comments: Span[] = [];
  let j = open + closer.length;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") {
      j = escapeEnd(text, j, formatted, raw);
    } else if (text.startsWith(closer, j)) {
      return { end: j + closer.length, comments };
    } else if (c === "\n" && closer.length === 1) {
      throw new Unreadable("unterminated string");
    } else if (formatted && text.startsWith("{{", j)) {
      j += 2;
    } else if (formatted && c === "{") {
      const field = fieldEnd(text, j + 1);
      comments.push(...field.comments);
      j = field.end;
    } else {
      j += 1;
    }
  }
  throw new Unreadable("unterminated string");
};

const headerColon = (logical: readonly Part[]): number | null => {
  const head = logical[0]?.value;
  if (!(head === "def" || head === "class" || (head === "async" && logical[1]?.value === "def"))) {
    return null;
  }
  let depth = 0;
  for (const [k, part] of logical.entries()) {
    if (part.string) {
      continue;
    }
    if ("([{".includes(part.value)) {
      depth += 1;
    } else if (")]}".includes(part.value)) {
      depth -= 1;
    } else if (part.value === ":" && depth === 0) {
      return k;
    }
  }
  return null;
};

const statement = (
  starts: readonly number[],
  text: string,
  logical: readonly Part[],
  docAllowed: boolean,
): { readonly found: Found | null; readonly afterHeader: boolean } => {
  const colon = headerColon(logical);
  const first = logical[0];
  const last = logical.at(-1);
  const afterColon = colon === null ? [] : logical.slice(colon + 1);
  const afterHeader = colon === logical.length - 1;
  if (first === undefined || last === undefined) {
    return { found: null, afterHeader };
  }
  if (logical.every((part) => part.string)) {
    return { found: record(starts, text, first.start, last.stop, docAllowed), afterHeader };
  }
  const docStart = afterColon[0];
  if (docStart !== undefined && afterColon.every((part) => part.string)) {
    return { found: record(starts, text, docStart.start, last.stop, true), afterHeader };
  }
  return { found: null, afterHeader };
};

const scanPython = (text: string): Scan => {
  const starts = lineStarts(text);
  const found: Found[] = [];
  const blanked: Span[] = [];
  const n = text.length;
  let logical: Part[] = [];
  let first = true;
  let afterHeader = false;
  let depth = 0;
  let i = 0;
  const close = (): void => {
    if (logical.length === 0) {
      return;
    }
    const ended = statement(starts, text, logical, first || afterHeader);
    if (ended.found !== null) {
      found.push(ended.found);
    }
    afterHeader = ended.afterHeader;
    first = false;
    logical = [];
  };
  while (i < n) {
    const c = text[i] ?? "";
    const word = wordAt(text, i);
    if (c === "#") {
      const end = commentEnd(text, i);
      found.push(record(starts, text, i, end, false));
      blanked.push([i, end]);
      i = end;
    } else if (c === "\\" && (text[i + 1] === "\n" || text.startsWith("\r\n", i + 1))) {
      i += text[i + 1] === "\n" ? 2 : 3;
      if (i >= n) {
        throw new Unreadable("backslash-newline at the end of the file");
      }
    } else if (c === "\n") {
      if (depth === 0) {
        close();
      }
      i += 1;
    } else if (c === "'" || c === '"' || (word !== null && prefixAt(text, i) !== null)) {
      const string = pyString(text, i);
      for (const [start, end] of string.comments) {
        found.push(record(starts, text, start, end, false));
      }
      blanked.push([i, string.end]);
      logical.push({ string: true, value: text.slice(i, string.end), start: i, stop: string.end });
      i = string.end;
    } else if (word !== null) {
      logical.push({ string: false, value: word, start: i, stop: i + word.length });
      i += word.length;
    } else if (" \t\f\r".includes(c)) {
      i += 1;
    } else if (text.startsWith(":=", i)) {
      logical.push({ string: false, value: ":=", start: i, stop: i + 2 });
      i += 2;
    } else {
      if ("([{".includes(c)) {
        depth += 1;
      } else if (")]}".includes(c)) {
        depth = Math.max(0, depth - 1);
      }
      logical.push({ string: false, value: c, start: i, stop: i + 1 });
      i += 1;
    }
  }
  if (depth > 0) {
    throw new Unreadable("a bracket is still open at the end of the file");
  }
  close();
  return { found, blanked };
};

type Pending = {
  readonly delimiter: string;
  readonly stripTabs: boolean;
  readonly python: boolean;
};

const consumeHeredocs = (
  text: string,
  starts: readonly number[],
  pending: readonly Pending[],
  from: number,
): {
  readonly next: number;
  readonly found: readonly Found[];
  readonly blanked: readonly Span[];
} => {
  const found: Found[] = [];
  const blanked: Span[] = [];
  let i = from;
  for (const { delimiter, stripTabs, python } of pending) {
    const bodyStart = i;
    for (;;) {
      if (i >= text.length) {
        throw new Unreadable("unterminated heredoc");
      }
      const end = lineEnd(text, i);
      const line = text.slice(i, end).replace(/\r+$/u, "");
      if ((stripTabs ? line.replace(/^\t+/u, "") : line) === delimiter) {
        break;
      }
      i = end + 1;
    }
    if (python) {
      const inner = scanPython(text.slice(bodyStart, i));
      found.push(...shifted(inner.found, lineAt(starts, bodyStart) - 1, null));
      blanked.push(...moved(inner.blanked, bodyStart));
    } else {
      blanked.push([bodyStart, i]);
    }
    i = lineEnd(text, i) + 1;
  }
  return { next: i, found, blanked };
};

const scanShell = (text: string): Scan => {
  const starts = lineStarts(text);
  const found: Found[] = [];
  const blanked: Span[] = [];
  const stack: ("dq" | "cs" | "pe" | "arith" | "paren")[] = [];
  let pending: Pending[] = [];
  let closedPlain = -1;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i] ?? "";
    const top = stack.at(-1);
    if (c === "\\") {
      i += 2;
    } else if (top === "dq") {
      if (c === '"') {
        stack.pop();
        i += 1;
      } else if (text.startsWith("$(", i)) {
        stack.push("cs");
        i += 2;
      } else if (text.startsWith("${", i)) {
        stack.push("pe");
        i += 2;
      } else {
        i += 1;
      }
    } else if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) {
        throw new Unreadable("unterminated quote");
      }
      i = end + 1;
    } else if (c === '"') {
      stack.push("dq");
      i += 1;
    } else if (c === "$") {
      const next = text[i + 1];
      if (next === "'") {
        let j = i + 2;
        while (j < n && text[j] !== "'") {
          j += text[j] === "\\" ? 2 : 1;
        }
        if (j >= n) {
          throw new Unreadable("unterminated quote");
        }
        i = j + 1;
      } else if (text.startsWith("$((", i)) {
        stack.push("arith");
        i += 3;
      } else if (next === "(") {
        stack.push("cs");
        i += 2;
      } else if (next === "{") {
        stack.push("pe");
        i += 2;
      } else if (next !== undefined && "#?$!@*-_".includes(next)) {
        i += 2;
      } else {
        i += 1;
      }
    } else if (c === "(") {
      if (text.startsWith("((", i)) {
        stack.push("arith");
        i += 2;
      } else {
        stack.push("paren");
        i += 1;
      }
    } else if (c === ")") {
      if (top === "arith" && text.startsWith("))", i)) {
        stack.pop();
        i += 2;
        continue;
      }
      if (top === "paren") {
        closedPlain = i;
      }
      if (top === "cs" || top === "paren") {
        stack.pop();
      }
      i += 1;
    } else if (c === "}" && top === "pe") {
      stack.pop();
      i += 1;
    } else if (
      c === "#" &&
      top !== "pe" &&
      (i === 0 ||
        " \t\r\n;|&(".includes(text[i - 1] ?? "") ||
        (text[i - 1] === ")" && closedPlain === i - 1))
    ) {
      const end = lineEnd(text, i);
      found.push(record(starts, text, i, end, false));
      blanked.push([i, end]);
      i = end;
    } else if (c === "\n") {
      i += 1;
      if (pending.length > 0) {
        const bodies = consumeHeredocs(text, starts, pending, i);
        found.push(...bodies.found);
        blanked.push(...bodies.blanked);
        i = bodies.next;
        pending = [];
      }
    } else if (c === "<" && text.startsWith("<<<", i)) {
      i += 3;
    } else if (c === "<" && top !== "arith" && text.startsWith("<<", i)) {
      HEREDOC.lastIndex = i;
      const m = HEREDOC.exec(text);
      if (m === null) {
        i += 1;
        continue;
      }
      const prefix = text.slice(text.slice(0, i).lastIndexOf("\n") + 1, i);
      pending.push({
        delimiter: m[2] ?? m[3] ?? m[4] ?? "",
        stripTabs: m[1] === "-",
        python: PYTHON_WORD.test(prefix),
      });
      i += m[0].length;
    } else {
      i += 1;
    }
  }
  if (pending.length > 0) {
    throw new Unreadable("heredoc without a body");
  }
  return { found, blanked };
};

const scanHtml = (text: string): Scan => {
  const starts = lineStarts(text);
  const found: Found[] = [];
  const blanked: Span[] = [];
  let i = 0;
  for (;;) {
    HTML_TOKEN.lastIndex = i;
    const m = HTML_TOKEN.exec(text);
    if (m === null) {
      break;
    }
    const after = m.index + m[0].length;
    if (m[0] === "<!--") {
      const close = text.indexOf("-->", after);
      if (close < 0) {
        throw new Unreadable("unterminated comment");
      }
      const end = close + 3;
      found.push(record(starts, text, m.index, end, false));
      blanked.push([m.index, end]);
      i = end;
      continue;
    }
    const tag = (m[1] ?? "").toLowerCase();
    const closing = tag === "script" ? SCRIPT_CLOSE : STYLE_CLOSE;
    closing.lastIndex = after;
    const close = closing.exec(text);
    if (close === null) {
      throw new Unreadable(`unterminated ${tag}`);
    }
    i = close.index;
    const declared = HTML_SCRIPT_TYPE.exec(m[2] ?? "")?.[1];
    if (
      tag === "script" &&
      declared !== undefined &&
      !declared.toLowerCase().includes("script") &&
      declared !== "module"
    ) {
      continue;
    }
    const inner =
      tag === "script"
        ? scanJs(text.slice(after, i), false)
        : scanClike(text.slice(after, i), "css");
    found.push(...shifted(inner.found, lineAt(starts, after) - 1, false));
    blanked.push(...moved(inner.blanked, after));
  }
  return { found, blanked };
};

const scan = (language: Language, text: string): Scan => {
  switch (language) {
    case "shell":
      return scanShell(text);
    case "python":
      return scanPython(text);
    case "js":
      return scanJs(text, true);
    case "ts":
      return scanJs(text, false);
    case "go":
      return scanGo(text);
    case "rust":
    case "css":
      return scanClike(text, language);
    case "html":
      return scanHtml(text);
  }
};

const byPosition = (a: Found, b: Found): number => {
  for (const [x, y] of [
    [a.line, b.line],
    [a.end, b.end],
  ] as const) {
    if (x !== y) {
      return x - y;
    }
  }
  for (const [x, y] of [
    [a.text, b.text],
    [a.full, b.full],
  ] as const) {
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return Number(a.doc) - Number(b.doc);
};

const licenceBlock = (found: readonly Found[], blank: string): ReadonlySet<Found> => {
  const firstCode = blank.split("\n").findIndex((line) => line.trim() !== "");
  const block: Found[] = [];
  let edge = 0;
  for (const f of found.toSorted(byPosition)) {
    if (f.line === 1 && f.full.startsWith("#!")) {
      continue;
    }
    if ((firstCode >= 0 && f.line >= firstCode + 1) || !COMMENT_START.test(f.full)) {
      break;
    }
    if (block.length > 0 && f.line > edge + 1) {
      break;
    }
    block.push(f);
    edge = f.end;
  }
  return LICENCE.test(block.map((f) => f.full).join("\n")) ? new Set(block) : new Set();
};

export const languageOf = (path: string): Language | null => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  if (base.startsWith(".") || base.includes(".config.")) {
    return null;
  }
  return EXTENSIONS.get(base.slice(base.lastIndexOf("."))) ?? null;
};

export const judge = (language: Language, text: string): Judged => {
  let scanned: Scan;
  try {
    scanned = scan(language, text);
  } catch (error) {
    if (error instanceof Unreadable) {
      return { read: false };
    }
    throw error;
  }
  const blank = blankText(text, scanned.blanked);
  const protectedFound = licenceBlock(scanned.found, blank);
  const entries: Entry[] = [];
  for (const f of scanned.found) {
    if (protectedFound.has(f) || (f.line === 1 && f.full.startsWith("#!"))) {
      continue;
    }
    if (SUPPRESSION_COMMENT.test(f.full)) {
      entries.push({ kind: "suppression", line: f.line, end: f.end, text: f.text });
    } else if (DIRECTIVE.test(f.full)) {
      continue;
    } else {
      entries.push({ kind: f.doc ? "doc" : "comment", line: f.line, end: f.end, text: f.text });
    }
  }
  const pattern = CODE_SUPPRESSION.get(language);
  if (pattern !== undefined) {
    const source = text.split("\n");
    for (const [index, line] of blank.split("\n").entries()) {
      if (pattern.test(line)) {
        const number = index + 1;
        entries.push({
          kind: "suppression",
          line: number,
          end: number,
          text: (source[index] ?? "").trim(),
        });
      }
    }
  }
  return { read: true, entries };
};

export const changedPaths = (parts: readonly string[]): ReadonlyMap<string, string> => {
  const changed = new Map<string, string>();
  let i = 0;
  for (;;) {
    const status = parts[i];
    const first = parts[i + 1];
    if (status === undefined || first === undefined) {
      return changed;
    }
    if (status.startsWith("R") || status.startsWith("C")) {
      changed.set(parts[i + 2] ?? first, first);
      i += 3;
    } else {
      changed.set(first, first);
      i += 2;
    }
  }
};

export const addedLines = (diff: string): ReadonlySet<number> => {
  const lines = new Set<number>();
  for (const m of diff.matchAll(HUNK)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let line = start; line < start + count; line += 1) {
      lines.add(line);
    }
  }
  return lines;
};

export const parseArgs = (argv: readonly string[]): Args | null => {
  let library = false;
  let every = false;
  const refs: string[] = [];
  for (const a of argv) {
    if (a === "--library") {
      library = true;
    } else if (a === "--all") {
      every = true;
    } else if (a.startsWith("-")) {
      return null;
    } else {
      refs.push(a);
    }
  }
  if (refs.length > 1 || (every && refs.length > 0)) {
    return null;
  }
  return { library, every, ref: refs[0] ?? "HEAD" };
};

const byPathAndLine = (a: Listed, b: Listed): number =>
  a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1;

export const buildReport = (args: Args, files: readonly Scanned[]): Report => {
  const fix: FixEntry[] = [];
  const doc: Listed[] = [];
  const existing: Listed[] = [];
  const unread: string[] = [];
  let scanned = 0;
  for (const { path, judged, added } of files) {
    if (!judged.read) {
      unread.push(path);
      continue;
    }
    scanned += 1;
    for (const { kind, line, end, text } of judged.entries) {
      if (kind === "suppression") {
        const touched =
          added === null ||
          Array.from({ length: end - line + 1 }, (_, k) => line + k).some((n) => added.has(n));
        if (touched) {
          fix.push({ path, line, text, kind });
        } else {
          existing.push({ path, line, text });
        }
      } else if (kind === "doc" && args.library) {
        doc.push({ path, line, text });
      } else {
        fix.push({ path, line, text, kind });
      }
    }
  }
  return {
    status: fix.length > 0 || unread.length > 0 ? "found" : "clean",
    ref: args.every ? null : args.ref,
    scanned,
    fix: fix.toSorted(byPathAndLine),
    doc: doc.toSorted(byPathAndLine),
    existing: existing.toSorted(byPathAndLine),
    unread,
  };
};
