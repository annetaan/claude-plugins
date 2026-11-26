import { splitLines } from "./text.ts";

export type WorktreeEntry = {
  readonly path: string;
  readonly prunable: boolean;
  readonly branch: string | null;
};

const WORKTREE = "worktree ";
const BRANCH = "branch refs/heads/";

export const parseWorktreeList = (text: string): readonly WorktreeEntry[] =>
  text.split("\n\n").flatMap((block): readonly WorktreeEntry[] => {
    const [first, ...rest] = splitLines(block);
    if (first === undefined || !first.startsWith(WORKTREE)) {
      return [];
    }
    const branch = rest.find((line) => line.startsWith(BRANCH));
    return [
      {
        path: first.slice(WORKTREE.length),
        prunable: rest.some((line) => line.startsWith("prunable")),
        branch: branch === undefined ? null : branch.slice(BRANCH.length),
      },
    ];
  });

const PROJECT_WORKTREE =
  /^pj-([0-9]+)-([0-9]+|sync)-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{4}(?:-[0-9]+)?$/u;

export const projectWorktree = (
  name: string,
): { readonly p: number; readonly k: number | null } | null => {
  const found = PROJECT_WORKTREE.exec(name);
  if (found === null) {
    return null;
  }
  const [, p, k] = found;
  return { p: Number(p), k: k === "sync" ? null : Number(k) };
};
