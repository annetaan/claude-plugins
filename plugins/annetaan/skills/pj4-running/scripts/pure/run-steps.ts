import type {
  IssueView,
  ParentView,
  PullRequest,
  WaitsOnEntry,
} from "../../../pj1-plan/scripts/pure/project-view.ts";

export type JsonObject = Readonly<Record<string, unknown>>;

export type RuleFacts = {
  readonly ruleset: readonly unknown[] | null;
  readonly protected: unknown;
  readonly classic: JsonObject | null;
  readonly codeowners: boolean;
  readonly view: JsonObject;
};

export type MergeRules = {
  readonly selfMerge: "ok" | "unknown";
  readonly blockedBy: readonly string[];
  readonly requiredChecks: "yes" | "no" | "unknown";
  readonly mergeMethod: string | null;
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const truthy = (value: unknown): boolean =>
  !(
    value === undefined ||
    value === null ||
    value === false ||
    value === 0 ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (isObject(value) && Object.keys(value).length === 0)
  );

const count = (value: unknown): number => (typeof value === "number" ? value : 0);

const METHODS: readonly (readonly [string, string])[] = [
  ["squash", "squashMergeAllowed"],
  ["merge", "mergeCommitAllowed"],
  ["rebase", "rebaseMergeAllowed"],
];

export const mergeRules = (facts: RuleFacts): MergeRules => {
  const rulesRead = facts.ruleset !== null;
  const rules = (facts.ruleset ?? []).map((rule) => (isObject(rule) ? rule : {}));
  const types = rules.map((rule) => rule["type"]);
  const prs = rules
    .filter((rule) => rule["type"] === "pull_request")
    .map((rule) => (isObject(rule["parameters"]) ? rule["parameters"] : {}));
  const classic = facts.classic !== null && truthy(facts.classic) ? facts.classic : null;
  const blockedBy = [
    ...(prs.some((p) => count(p["required_approving_review_count"]) > 0) ? ["rule-approvals"] : []),
    ...(facts.codeowners && prs.some((p) => truthy(p["require_code_owner_review"]))
      ? ["rule-code-owners"]
      : []),
    ...(types.includes("merge_queue") ? ["merge-queue"] : []),
    ...(classic !== null && count(classic["requiredApprovingReviewCount"]) > 0
      ? ["classic-approvals"]
      : []),
    ...(classic !== null && facts.codeowners && truthy(classic["requiresCodeOwnerReviews"])
      ? ["classic-code-owners"]
      : []),
  ];
  const classicKnown = facts.protected === false || facts.classic !== null;
  const known = rulesRead && classicKnown;
  const requiredChecks =
    types.includes("required_status_checks") ||
    (classic !== null && truthy(classic["requiresStatusChecks"]))
      ? "yes"
      : known
        ? "no"
        : "unknown";
  let methods = METHODS.filter(([, flag]) => truthy(facts.view[flag])).map(([method]) => method);
  if (types.includes("required_linear_history")) {
    methods = methods.filter((m) => m !== "merge");
  }
  for (const p of prs) {
    const allowed = p["allowed_merge_methods"];
    if (Array.isArray(allowed) && allowed.length > 0) {
      methods = methods.filter((m) => allowed.includes(m));
    }
  }
  return {
    selfMerge: known ? "ok" : "unknown",
    blockedBy,
    requiredChecks,
    mergeMethod: methods[0] ?? null,
  };
};

export type Due = "already" | "due" | "not-due" | "unknown";

const closedOr = (state: string, merged: boolean): Due =>
  state === "CLOSED" ? "already" : merged ? "due" : "not-due";

export type DueFacts = {
  readonly parent: Pick<ParentView, "number" | "state" | "merged"> & {
    readonly waitsOn: readonly Pick<WaitsOnEntry, "number" | "state" | "merged">[];
  };
  readonly issues: readonly (Pick<IssueView, "number" | "state"> & {
    readonly pr: Pick<PullRequest, "state"> | null;
  })[];
};

export const due = (proj: DueFacts, n: number): Due => {
  const parent = proj.parent;
  if (n === parent.number) {
    return closedOr(parent.state, parent.merged);
  }
  const waited = parent.waitsOn.find((d) => d.number === n);
  if (waited !== undefined) {
    return closedOr(waited.state, waited.merged);
  }
  const issue = proj.issues.find((i) => i.number === n);
  if (issue === undefined) {
    return "unknown";
  }
  return closedOr(issue.state, issue.pr !== null && issue.pr.state === "MERGED");
};
