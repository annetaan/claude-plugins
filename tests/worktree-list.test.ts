import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorktreeList } from "../plugins/annetaan/scripts/pure/worktree-list.ts";

test("parseWorktreeList reads a branch, a detached entry and a prunable one", () => {
  const text = [
    "worktree /repo",
    "HEAD 1111111111111111111111111111111111111111",
    "branch refs/heads/main",
    "",
    "worktree /repo/.claude/worktrees/run-a",
    "HEAD 2222222222222222222222222222222222222222",
    "detached",
    "",
    "worktree /repo/.claude/worktrees/run-b",
    "HEAD 3333333333333333333333333333333333333333",
    "branch refs/heads/feat/x",
    "prunable gitdir file points to non-existent location",
    "",
  ].join("\n");
  assert.deepEqual(parseWorktreeList(text), [
    { path: "/repo", prunable: false, branch: "main" },
    { path: "/repo/.claude/worktrees/run-a", prunable: false, branch: null },
    { path: "/repo/.claude/worktrees/run-b", prunable: true, branch: "feat/x" },
  ]);
});

test("parseWorktreeList reads nothing from empty text", () => {
  assert.deepEqual(parseWorktreeList(""), []);
});
