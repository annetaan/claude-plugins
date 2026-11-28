export const fileLines = (text: string): readonly string[] => {
  const lines = text.split(/\r?\n/u);
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
};

export const ROLES = [
  "heading",
  "claim",
  "evidence",
  "example",
  "definition",
  "restatement",
  "transition",
  "scaffold",
  "caveat",
  "instruction",
  "verbatim",
] as const;

export const WEIGHTS = ["★☆☆", "★★☆", "★★★"] as const;

export const FIELDS = [
  "purpose",
  "reader",
  "style",
  "source language",
  "blocks",
  "weights",
  "max id",
] as const;

export const headerLine = (formatPath: string): string =>
  `<!-- flag: [keep] [delete] [edit] [question], then free text. Format: ${formatPath} -->`;

export const ID = "b[0-9]{3,}";

export const parseId = (word: string): number | null => {
  const digits = new RegExp(`^${ID}$`, "u").test(word) ? word.slice(1) : null;
  return digits === null ? null : Number(digits);
};

export const formatId = (n: number): string => `b${String(n).padStart(3, "0")}`;

export type NewBlock = {
  readonly n: number;
  readonly verbatim: boolean;
  readonly quoted: readonly string[];
};

export type SidecarBlock = {
  readonly line: number;
  readonly id: string | null;
  readonly heading: string;
  readonly lines: readonly string[];
};

export type Sidecar = {
  readonly document: readonly string[];
  readonly blocks: readonly SidecarBlock[];
};

export type FenceRecord = { readonly first: string; readonly second: string };

const withoutTrailingBlanks = (lines: readonly string[]): readonly string[] => {
  let end = lines.length;
  while (end > 0 && lines[end - 1]?.trim() === "") {
    end -= 1;
  }
  return lines.slice(0, end);
};

const sidecarBlock = (line: number, lines: readonly string[]): SidecarBlock => {
  const heading = (lines[0] ?? "").slice("### ".length);
  const word = heading.split(" ")[0] ?? "";
  return {
    line,
    id: parseId(word) === null ? null : word,
    heading,
    lines: withoutTrailingBlanks(lines),
  };
};

export const parseSidecar = (text: string): Sidecar => {
  const document: string[] = [];
  const blocks: SidecarBlock[] = [];
  let section = "";
  let open: { readonly line: number; readonly lines: string[] } | null = null;
  const close = (): void => {
    if (open !== null) {
      blocks.push(sidecarBlock(open.line, open.lines));
      open = null;
    }
  };
  fileLines(text).forEach((line, index) => {
    if (line.startsWith("## ")) {
      close();
      section = line;
    } else if (section === "## Document") {
      document.push(line);
    } else if (section === "## Blocks") {
      if (line.startsWith("### ")) {
        close();
        open = { line: index + 1, lines: [line] };
      } else if (line === "---") {
        close();
      } else if (open !== null) {
        open.lines.push(line);
      }
    }
  });
  close();
  return { document, blocks };
};

export const quotedLines = (block: SidecarBlock): readonly string[] => {
  const body = block.lines.slice(1);
  const end = body.findIndex((line) => !line.startsWith(">"));
  return end === -1 ? body : body.slice(0, end);
};

const unquote = (line: string): string => {
  if (line === ">") {
    return "";
  }
  return line.startsWith("> ") ? line.slice(2) : line;
};

export const quoteText = (quoted: readonly string[]): string => quoted.map(unquote).join("\n");

export const fenceRecord = (quoted: readonly string[]): FenceRecord | null => {
  const [first, second, third] = quoted.map(unquote);
  if (quoted.length !== 3 || first === undefined || second === undefined || third === undefined) {
    return null;
  }
  const opens = /^\s*(`{3,}|~{3,})/u.test(first);
  const counts = /^\.\.\. [0-9]+ more lines$/u.test(third);
  return opens && counts ? { first, second } : null;
};

type Draft = {
  readonly n: number;
  readonly verbatim: boolean;
  readonly line: number;
  readonly quoted: string[];
};

export const parseBlocksFile = (
  text: string,
): readonly (NewBlock | "---")[] | { readonly line: number } => {
  const heading = /^### ([0-9]+)( verbatim)?$/u;
  const items: (NewBlock | "---")[] = [];
  let count = 0;
  let draft: Draft | null = null;
  let last: "start" | "block" | "break" = "start";
  let breakLine = 0;
  const finish = (): void => {
    if (draft !== null) {
      items.push({ n: draft.n, verbatim: draft.verbatim, quoted: draft.quoted });
      draft = null;
    }
  };
  for (const [index, line] of fileLines(text).entries()) {
    const number = index + 1;
    if (draft !== null && draft.quoted.length === 0 && !line.startsWith(">")) {
      return { line: draft.line + 1 };
    }
    const match = heading.exec(line);
    if (match !== null) {
      finish();
      count += 1;
      if (Number(match[1]) !== count) {
        return { line: number };
      }
      draft = { n: count, verbatim: match[2] !== undefined, line: number, quoted: [] };
      last = "block";
    } else if (line.startsWith(">") && draft !== null) {
      draft.quoted.push(line);
    } else if (line === "---") {
      finish();
      if (last !== "block") {
        return { line: number };
      }
      items.push("---");
      last = "break";
      breakLine = number;
    } else if (line.trim() === "") {
      finish();
    } else {
      return { line: number };
    }
  }
  if (draft !== null && draft.quoted.length === 0) {
    return { line: draft.line + 1 };
  }
  finish();
  if (count === 0) {
    return { line: 1 };
  }
  return last === "break" ? { line: breakLine } : items;
};
