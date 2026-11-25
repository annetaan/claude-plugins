import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listEntry,
  localBaseStep,
  notMerged,
  projectSummary,
} from "../plugins/annetaan/skills/pj-cleanup/scripts/pure/project-cleanup.ts";

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

test("the list entry and the summary carry the project's fields", () => {
  assert.deepEqual(listEntry(parent), { number: 7, title: "P", state: "OPEN", merged: false });
  assert.deepEqual(projectSummary(parent), {
    number: 7,
    title: "P",
    state: "OPEN",
    base: "pj/7",
    from: "main",
  });
});
