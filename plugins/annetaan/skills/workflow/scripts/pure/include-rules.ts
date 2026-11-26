export const LIST = ".worktreeinclude";

const FINDER = ".DS_Store";

const isFinderFile = (path: string): boolean => path.split("/").at(-1) === FINDER;

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const pattern = (path: string, never: boolean): string => {
  const body = path.replace(/[\\*?[\r]/g, (c) => (c === "\r" ? "[\r]" : `\\${c}`));
  const stem = body.replace(/ +$/, "");
  const line = `/${stem}${"\\ ".repeat(body.length - stem.length)}`;
  return never ? `!${line}` : line;
};

export const decidedRules = (text: string): string =>
  text
    .split("\n")
    .map((line) => (line.startsWith("!") ? line.slice(1) : line))
    .join("\n");

export type IncludeResult = {
  readonly copied: readonly string[];
  readonly notIgnored: readonly string[];
  readonly unlisted: readonly string[];
};

export type IncludeSets = {
  readonly matched: ReadonlySet<string>;
  readonly candidates: ReadonlySet<string>;
  readonly decided: ReadonlySet<string>;
  readonly ignored: ReadonlySet<string>;
  readonly present: ReadonlySet<string>;
};

export const sortOut = (sets: IncludeSets): IncludeResult => ({
  copied: [...sets.matched]
    .filter((p) => sets.ignored.has(p) && !sets.present.has(p))
    .toSorted(byName),
  notIgnored: [...sets.matched].filter((p) => !sets.ignored.has(p)).toSorted(byName),
  unlisted: [...sets.candidates]
    .filter(
      (p) =>
        sets.ignored.has(p) &&
        !sets.decided.has(p) &&
        !sets.present.has(p) &&
        p !== LIST &&
        !isFinderFile(p),
    )
    .toSorted(byName),
});

export const nulSplit = (out: string): readonly string[] => out.split("\0").filter((p) => p !== "");
