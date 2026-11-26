import type { StatusObject } from "../../../../scripts/status.ts";

export type CleanupParent = {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly base: string;
  readonly from: string;
  readonly merged: boolean;
  readonly projectPr?: string | null;
};

export const notMerged = (p: number, parent: CleanupParent): StatusObject | null =>
  parent.merged
    ? null
    : {
        status: "stop",
        reason: "not-merged",
        message: `#${p} is not merged: its pull request into ${parent.from} has not merged yet`,
        projectPr: parent.projectPr ?? null,
      };

export type ProjectPull = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
};

export const projectPull = (parent: CleanupParent): ProjectPull | null => {
  const url = parent.projectPr ?? null;
  const found = url === null ? null : /\/pull\/([0-9]+)$/u.exec(url);
  return url === null || found === null
    ? null
    : { number: Number(found[1]), title: parent.title, url };
};

export type ProjectTarget = {
  readonly kind: "project";
  readonly name: string;
  readonly worktrees: readonly string[];
  readonly branch: string;
  readonly pr: ProjectPull | null;
  readonly state: "merged" | "not-merged";
  readonly project: { readonly number: number; readonly title: string };
};

export const projectTarget = (
  parent: CleanupParent,
  worktrees: readonly string[],
): ProjectTarget => ({
  kind: "project",
  name: `#${parent.number}`,
  worktrees,
  branch: parent.base,
  pr: projectPull(parent),
  state: parent.merged ? "merged" : "not-merged",
  project: { number: parent.number, title: parent.title },
});

export type LocalBase =
  | { readonly action: "delete" }
  | { readonly action: "keep"; readonly why: "checked-out"; readonly worktree: string }
  | { readonly action: "keep"; readonly why: "unpushed" };

export type LocalBaseFacts = {
  readonly otherHolder: string | null;
  readonly contained: boolean;
};

export const localBaseStep = (facts: LocalBaseFacts): LocalBase => {
  if (facts.otherHolder !== null) {
    return { action: "keep", why: "checked-out", worktree: facts.otherHolder };
  }
  return facts.contained ? { action: "delete" } : { action: "keep", why: "unpushed" };
};
