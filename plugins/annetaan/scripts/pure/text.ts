export const WORD = "\\p{L}\\p{N}_";

export const DIGIT = "\\p{Nd}";

export const wordBoundary = (side: "before" | "after"): string =>
  side === "before" ? `(?<![${WORD}])` : `(?![${WORD}])`;

export const escapeRegExp = (text: string): string => text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

const LINE_BREAKS: ReadonlySet<number> = new Set([
  0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x85, 0x2028, 0x2029,
]);

const SPACES: ReadonlySet<number> = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000,
]);

export const SPACE = [...SPACES].map((code) => `\\u{${code.toString(16)}}`).join("");

const splitOn = (text: string, at: ReadonlySet<number>): readonly string[] => {
  const pieces: string[] = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (at.has(code)) {
      pieces.push(text.slice(start, i));
      i += code === 0x0d && text.charCodeAt(i + 1) === 0x0a ? 2 : 1;
      start = i;
    } else {
      i += 1;
    }
  }
  pieces.push(text.slice(start));
  return pieces;
};

export const splitLines = (text: string): readonly string[] => {
  const pieces = splitOn(text, LINE_BREAKS);
  return pieces.at(-1) === "" ? pieces.slice(0, -1) : pieces;
};

export const squeeze = (text: string): string =>
  splitOn(text, SPACES)
    .filter((piece) => piece !== "")
    .join(" ");
