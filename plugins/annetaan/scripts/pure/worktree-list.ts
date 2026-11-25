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
