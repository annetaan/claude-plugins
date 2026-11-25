import { test } from "node:test";
import assert from "node:assert/strict";
import {
  due,
  mergeRules,
  type DueFacts,
  type RuleFacts,
} from "../plugins/annetaan/skills/pj4-running/scripts/pure/run-steps.ts";

const squashOnly = {
  squashMergeAllowed: true,
  mergeCommitAllowed: false,
  rebaseMergeAllowed: false,
};
const allMethods = { squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true };

const facts = (extra: Partial<RuleFacts>): RuleFacts => ({
  ruleset: [],
  protected: false,
  classic: null,
  codeowners: false,
  view: squashOnly,
  ...extra,
});

test("an unprotected branch with no rules lets the run merge itself, with no required check", () => {
  assert.deepEqual(mergeRules(facts({})), {
    selfMerge: "ok",
    blockedBy: [],
    requiredChecks: "no",
    mergeMethod: "squash",
  });
});

test("an unreadable ruleset leaves selfMerge and requiredChecks unknown", () => {
  const found = mergeRules(facts({ ruleset: null }));
  assert.equal(found.selfMerge, "unknown");
  assert.equal(found.requiredChecks, "unknown");
});

test("a protected branch with no readable classic rule is unknown", () => {
  assert.equal(mergeRules(facts({ protected: true })).selfMerge, "unknown");
  assert.equal(
    mergeRules(facts({ protected: true, classic: { requiredApprovingReviewCount: 0 } })).selfMerge,
    "ok",
  );
});

test("ruleset approvals, code owners and a merge queue block the self-merge", () => {
  const found = mergeRules(
    facts({
      codeowners: true,
      ruleset: [
        {
          type: "pull_request",
          parameters: { required_approving_review_count: 1, require_code_owner_review: true },
        },
        { type: "merge_queue" },
      ],
    }),
  );
  assert.deepEqual(found.blockedBy, ["rule-approvals", "rule-code-owners", "merge-queue"]);
});

test("a code-owner review blocks only when a CODEOWNERS file exists", () => {
  const ruleset = [{ type: "pull_request", parameters: { require_code_owner_review: true } }];
  assert.deepEqual(mergeRules(facts({ ruleset })).blockedBy, []);
  const classic = { requiresCodeOwnerReviews: true, requiredApprovingReviewCount: 2 };
  assert.deepEqual(mergeRules(facts({ protected: true, classic })).blockedBy, [
    "classic-approvals",
  ]);
  assert.deepEqual(mergeRules(facts({ protected: true, classic, codeowners: true })).blockedBy, [
    "classic-approvals",
    "classic-code-owners",
  ]);
});

test("required checks come from the ruleset or the classic rule", () => {
  assert.equal(
    mergeRules(facts({ ruleset: [{ type: "required_status_checks" }] })).requiredChecks,
    "yes",
  );
  assert.equal(
    mergeRules(facts({ protected: true, classic: { requiresStatusChecks: true } })).requiredChecks,
    "yes",
  );
});

test("linear history and allowed methods narrow the merge method", () => {
  assert.equal(mergeRules(facts({ view: allMethods })).mergeMethod, "squash");
  const linear = mergeRules(
    facts({
      view: { squashMergeAllowed: false, mergeCommitAllowed: true, rebaseMergeAllowed: true },
      ruleset: [{ type: "required_linear_history" }],
    }),
  );
  assert.equal(linear.mergeMethod, "rebase");
  const allowed = mergeRules(
    facts({
      view: allMethods,
      ruleset: [{ type: "pull_request", parameters: { allowed_merge_methods: ["merge"] } }],
    }),
  );
  assert.equal(allowed.mergeMethod, "merge");
  const none = mergeRules(
    facts({
      ruleset: [{ type: "pull_request", parameters: { allowed_merge_methods: ["rebase"] } }],
    }),
  );
  assert.equal(none.mergeMethod, null);
});

const project: DueFacts = {
  parent: {
    number: 1,
    state: "OPEN",
    merged: true,
    waitsOn: [
      { number: 5, state: "OPEN", merged: false },
      { number: 6, state: "CLOSED", merged: true },
    ],
  },
  issues: [
    { number: 2, state: "OPEN", pr: { state: "MERGED" } },
    { number: 3, state: "OPEN", pr: { state: "OPEN" } },
    { number: 4, state: "CLOSED", pr: null },
    { number: 7, state: "OPEN", pr: null },
  ],
};

test("due tells the parent, a waited-on project and a sub-issue apart", () => {
  assert.equal(due(project, 1), "due");
  assert.equal(due(project, 5), "not-due");
  assert.equal(due(project, 6), "already");
  assert.equal(due(project, 2), "due");
  assert.equal(due(project, 3), "not-due");
  assert.equal(due(project, 4), "already");
  assert.equal(due(project, 7), "not-due");
  assert.equal(due(project, 9), "unknown");
  assert.equal(due({ ...project, parent: { ...project.parent, merged: false } }, 1), "not-due");
});
