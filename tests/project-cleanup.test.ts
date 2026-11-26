import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localBaseStep,
  notMerged,
  projectPull,
  projectTarget,
} from "../plugins/annetaan/skills/cleanup/scripts/pure/project-cleanup.ts";

const parent = {
  number: 7,
  title: "P",
  state: "OPEN",
  base: "pj/7",
  from: "main",
  merged: false,
  projectPr: "https://github.com/o/r/pull/9",
};

test("a project not merged stops with not-merged and its pull request", () => {
  assert.deepEqual(notMerged(7, parent), {
    status: "stop",
    reason: "not-merged",
    message: "#7 is not merged: its pull request into main has not merged yet",
    projectPr: "https://github.com/o/r/pull/9",
  });
});

test("a merged project does not stop", () => {
  assert.equal(notMerged(7, { ...parent, merged: true }), null);
});

test("a project with no pull request stops with a null projectPr", () => {
  const { projectPr: _, ...bare } = parent;
  assert.equal(notMerged(7, bare)?.["projectPr"], null);
});

test("the local base is kept when another worktree has it checked out", () => {
  assert.deepEqual(localBaseStep({ otherHolder: "/w", contained: true }), {
    action: "keep",
    why: "checked-out",
    worktree: "/w",
  });
});

test("the local base is deleted when origin holds it", () => {
  assert.deepEqual(localBaseStep({ otherHolder: null, contained: true }), { action: "delete" });
});

test("the local base is kept when it holds commits origin does not", () => {
  assert.deepEqual(localBaseStep({ otherHolder: null, contained: false }), {
    action: "keep",
    why: "unpushed",
  });
});

test("projectTarget carries the project, its base and its worktrees", () => {
  const worktrees = ["pj-7-2-2026-01-01-0000", "pj-7-sync-2026-01-01-0000"];
  assert.deepEqual(projectTarget(parent, worktrees), {
    kind: "project",
    name: "#7",
    worktrees,
    branch: "pj/7",
    pr: { number: 9, title: "P", url: "https://github.com/o/r/pull/9" },
    state: "not-merged",
    project: { number: 7, title: "P" },
  });
  assert.deepEqual(projectTarget({ ...parent, merged: true, projectPr: null }, []), {
    kind: "project",
    name: "#7",
    worktrees: [],
    branch: "pj/7",
    pr: null,
    state: "merged",
    project: { number: 7, title: "P" },
  });
});

test("projectPull reads the number from the project pull request's URL, and null without one", () => {
  assert.deepEqual(projectPull(parent), {
    number: 9,
    title: "P",
    url: "https://github.com/o/r/pull/9",
  });
  assert.equal(projectPull({ ...parent, projectPr: null }), null);
  const { projectPr: _, ...bare } = parent;
  assert.equal(projectPull(bare), null);
  assert.equal(projectPull({ ...parent, projectPr: "https://github.com/o/r/issues/9" }), null);
});
