import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../plugins/annetaan/skills/workflow/scripts/pure/prompt-template.ts";

const template = [
  "Start <WT>.",
  "<if issue>",
  "Issue #<n>.",
  "<if task>",
  "Task <k> of issue #<n>.",
  "<end>",
  "<if merge>",
  "Merge.",
  "<end>",
  "<end>",
  "",
  "",
  "",
  "End $1 <unknown>.",
].join("\n");

test("render keeps a nested block only when every block around it holds", () => {
  assert.equal(
    render(
      template,
      [
        ["WT", "/w"],
        ["n", "7"],
        ["k", "2"],
      ],
      ["issue", "task"],
    ),
    "Start /w.\nIssue #7.\nTask 2 of issue #7.\n\nEnd $1 <unknown>.",
  );
});

test("render drops a nested block whose outer block does not hold", () => {
  assert.equal(
    render(template, [["WT", "/w"]], ["task", "merge"]),
    "Start /w.\n\nEnd $1 <unknown>.",
  );
});

test("render puts a value holding $& in as it is", () => {
  assert.equal(render("<WT>", [["WT", "a$&b$1"]], []), "a$&b$1");
});
