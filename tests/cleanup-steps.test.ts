import { test } from "node:test";
import assert from "node:assert/strict";
import { losses, targetKind, updateStep } from "../plugins/annetaan/scripts/pure/cleanup-steps.ts";

test("updateStep is absent without a local branch", () => {
  assert.deepEqual(updateStep({ tip: null, target: "t", tipIsAncestor: false, holder: null }), {
    action: "absent",
  });
});

test("updateStep is current when the local tip is the target", () => {
  assert.deepEqual(updateStep({ tip: "t", target: "t", tipIsAncestor: true, holder: "/w" }), {
    action: "current",
    sha: "t",
  });
});

test("updateStep fast-forwards a tip behind the target, in the worktree that holds it", () => {
  assert.deepEqual(updateStep({ tip: "a", target: "t", tipIsAncestor: true, holder: "/w" }), {
    action: "fast-forward",
    from: "a",
    to: "t",
    worktree: "/w",
  });
});

test("updateStep reports a diverged tip", () => {
  assert.deepEqual(updateStep({ tip: "a", target: "t", tipIsAncestor: false, holder: null }), {
    action: "diverged",
    sha: "a",
    to: "t",
    worktree: null,
  });
});

test("losses names uncommitted work, submodule work and commits nothing else holds", () => {
  assert.deepEqual(losses({ dirty: false, submodules: false, branch: null, detached: false }), []);
  assert.deepEqual(
    losses({
      dirty: true,
      submodules: true,
      branch: { state: "closed", tip: "a", heldOnOrigin: true },
      detached: false,
    }),
    ["uncommitted", "submodules", "commits"],
  );
});

test("losses counts the commits of a branch with no pull request only when origin holds none of them", () => {
  const facts = (heldOnOrigin: boolean, tip: string | null) => ({
    dirty: false,
    submodules: false,
    branch: { state: "no-pr", tip, heldOnOrigin },
    detached: false,
  });
  assert.deepEqual(losses(facts(false, "a")), ["commits"]);
  assert.deepEqual(losses(facts(true, "a")), []);
  assert.deepEqual(losses(facts(false, null)), []);
  assert.deepEqual(
    losses({
      dirty: false,
      submodules: false,
      branch: { state: "merged", tip: "a", heldOnOrigin: false },
      detached: false,
    }),
    [],
  );
});

test("a detached HEAD that no ref on origin holds loses commits", () => {
  assert.deepEqual(losses({ dirty: false, submodules: false, branch: null, detached: true }), [
    "commits",
  ]);
  assert.deepEqual(
    losses({
      dirty: false,
      submodules: false,
      branch: { state: "closed", tip: "a", heldOnOrigin: false },
      detached: true,
    }),
    ["commits"],
  );
});

test("targetKind takes run-* and propose-* and nothing else", () => {
  assert.equal(targetKind("run-2026-01-01-0000"), "run");
  assert.equal(targetKind("propose-x-2"), "propose");
  for (const name of ["review-run-x-a", "pj-1", "run-", "run-a/b"]) {
    assert.equal(targetKind(name), null);
  }
});
