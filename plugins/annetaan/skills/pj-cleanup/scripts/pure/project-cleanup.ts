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

export type ProjectSummary = {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly base: string;
  readonly from: string;
};

export const projectSummary = (parent: CleanupParent): ProjectSummary => ({
  number: parent.number,
  title: parent.title,
  state: parent.state,
  base: parent.base,
  from: parent.from,
});

export const listEntry = (parent: CleanupParent): Readonly<Record<string, unknown>> => ({
  number: parent.number,
  title: parent.title,
  state: parent.state,
  merged: parent.merged,
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
