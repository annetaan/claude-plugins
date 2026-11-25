export type UpdateStep =
  | { readonly action: "none" }
  | { readonly action: "absent" }
  | { readonly action: "current"; readonly sha: string }
  | {
      readonly action: "fast-forward";
      readonly from: string;
      readonly to: string;
      readonly worktree: string | null;
    }
  | {
      readonly action: "diverged";
      readonly sha: string;
      readonly to: string;
      readonly worktree: string | null;
    };

export type UpdateFacts = {
  readonly tip: string | null;
  readonly target: string;
  readonly tipIsAncestor: boolean;
  readonly holder: string | null;
};

export const updateStep = (facts: UpdateFacts): UpdateStep => {
  if (facts.tip === null) {
    return { action: "absent" };
  }
  if (facts.tip === facts.target) {
    return { action: "current", sha: facts.tip };
  }
  if (facts.tipIsAncestor) {
    return { action: "fast-forward", from: facts.tip, to: facts.target, worktree: facts.holder };
  }
  return { action: "diverged", sha: facts.tip, to: facts.target, worktree: facts.holder };
};

export type BranchFacts = {
  readonly state: string;
  readonly tip: string | null;
  readonly heldOnOrigin: boolean;
};

export type LossFacts = {
  readonly dirty: boolean;
  readonly submodules: boolean;
  readonly branch: BranchFacts | null;
};

const losesCommits = (branch: BranchFacts | null): boolean =>
  branch !== null &&
  (branch.state === "closed" ||
    (branch.state === "no-pr" && branch.tip !== null && !branch.heldOnOrigin));

export const losses = (facts: LossFacts): readonly string[] => [
  ...(facts.dirty ? ["uncommitted"] : []),
  ...(facts.submodules ? ["submodules"] : []),
  ...(losesCommits(facts.branch) ? ["commits"] : []),
];
