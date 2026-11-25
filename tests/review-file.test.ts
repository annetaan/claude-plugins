import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lintReasons,
  scopeState,
  type ReviewDir,
} from "../plugins/annetaan/skills/workflow/scripts/pure/review-file.ts";

const command = "`/x/flow.sh run /wt a /wt/work-reports/2026-01-01-0000-aaaaaaa/seats/a/p`";

const seatFile = [
  "# task-1, round 1, seat a",
  "",
  "## Findings",
  "",
  "### 1. 入力が空のとき壊れる",
  "",
  `Command: ${command}`,
  "Printed: exit 1",
  "Required: 空の入力を受け付ける",
  "",
  "## Not run",
  "",
  "なし。",
  "",
].join("\n");

const roundFile = (r: number, earlier: readonly string[], title: string): string =>
  [
    `# task-1, round ${r}`,
    "",
    "Seats: a",
    "",
    "## Earlier findings",
    "",
    ...(earlier.length > 0 ? earlier : ["None."]),
    "",
    "## New findings",
    "",
    `### R${r}.1 ${title}`,
    "",
    "Found by: a",
    `Command: ${command}`,
    "Printed: exit 1",
    "Required: 直す",
    "Breaks: 設計の意図",
    "",
    "## Dropped",
    "",
    "- a: none",
    "",
    "## Not run",
    "",
    "None.",
    "",
    "## Verdict",
    "",
    "changes-requested",
    "",
  ].join("\n");

test("lintReasons passes a seat file whose finding title is written in Japanese", () => {
  const dir: ReviewDir = { "review/task-1-round-1-a.md": seatFile };
  assert.deepEqual(lintReasons(dir, "review/task-1-round-1-a.md"), { kind: "seat", reasons: [] });
});

test("lintReasons takes - R2.1修正 for no earlier finding, and - R2.1 resolved for one", () => {
  const two = roundFile(2, [], "日本語のタイトル");
  const glued: ReviewDir = {
    "review/task-1-round-2.md": two,
    "review/task-1-round-3.md": roundFile(3, ["- R2.1修正 resolved"], "次の指摘"),
  };
  const gluedReasons = lintReasons(glued, "review/task-1-round-3.md").reasons;
  assert.ok(gluedReasons.includes("mark"), gluedReasons.join(", "));
  assert.ok(gluedReasons.includes("earlier-missing"), gluedReasons.join(", "));
  const spaced: ReviewDir = {
    "review/task-1-round-2.md": two,
    "review/task-1-round-3.md": roundFile(3, ["- R2.1 resolved: 直った"], "次の指摘"),
  };
  const spacedReasons = lintReasons(spaced, "review/task-1-round-3.md").reasons;
  assert.ok(!spacedReasons.includes("mark"), spacedReasons.join(", "));
  assert.ok(!spacedReasons.includes("earlier-missing"), spacedReasons.join(", "));
});

test("lintReasons names a file that is no review file", () => {
  assert.deepEqual(lintReasons({}, "review/notes.md"), { kind: null, reasons: ["name"] });
});

test("scopeState reads a finding titled in Japanese, its stands mark and the reply", () => {
  const dir: ReviewDir = {
    "review/task-1-round-1.md": roundFile(1, [], "日本語のタイトル"),
    "review/task-1-round-2.md": roundFile(2, ["- R1.1 stands: まだ壊れる"], "別の指摘"),
    "review/task-1-round-2-reply.md": [
      "# task-1, round 2, reply",
      "",
      "- R1.1 fixed: 空の入力を通した。ran: `bash t.sh`; saw: ok",
      "- R2.1 disagree: 設計どおり",
      "",
    ].join("\n"),
    "review/task-1-evidence.md": "# evidence\n",
  };
  const state = scopeState(dir, "task-1");
  assert.equal(state.round, 3);
  assert.equal(state.verdict, "changes-requested");
  assert.equal(state.cap, false);
  assert.deepEqual(state.open, [
    { id: "R1.1", stood: 1, reply: "fixed" },
    { id: "R2.1", stood: 0, reply: "disagree" },
  ]);
  assert.deepEqual(state.approve, {
    allowed: false,
    why: ["approve-open", "approve-no-evidence"],
  });
});

test("scopeState sorts rounds as numbers", () => {
  const dir: ReviewDir = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [
      `review/task-1-round-${i + 1}.md`,
      roundFile(i + 1, [], "指摘"),
    ]),
  );
  const state = scopeState(dir, "task-1");
  assert.equal(state.round, 11);
  assert.equal(state.cap, true);
  assert.deepEqual(
    state.open.map((one) => one.id),
    ["R10.1"],
  );
});
