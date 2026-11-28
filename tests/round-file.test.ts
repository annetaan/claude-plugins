import { test } from "node:test";
import assert from "node:assert/strict";
import { parseText } from "../plugins/annetaan/skills/workflow/scripts/pure/review-file.ts";
import {
  evidenceWanted,
  judgementFault,
  parseJudgement,
  roundText,
  type Judgement,
  type JudgementFault,
} from "../plugins/annetaan/skills/workflow/scripts/pure/round-file.ts";

const draftText = [
  "# task-1, round 2, draft",
  "",
  "## Earlier findings",
  "",
  "- R1.1 resolved: ran: `one.sh`; saw: exit 0",
  "- R1.2 stands: ran: `two.sh`; saw: exit 1, `壊れる`",
  "- R1.3 stands again: ran: `three.sh`; saw: exit 1; reply: disagree",
  "- R1.4 resolved: ran: `four.sh`; saw: exit 0; reply: disagree",
  "",
  "## New findings",
  "",
  "### R2.1 キャッシュが古い値を返す",
  "",
  "Found by: a",
  "Command: `a.sh`",
  "Printed: exit 1, `古い`",
  "",
  "### R2.2 二回目のサインインで値がない",
  "",
  "Found by: b",
  "Command: `b.sh`",
  "Printed: exit 1",
  "",
  "### R2.3 ログが多い",
  "",
  "Found by: b",
  "Command: `c.sh`",
  "Printed: exit 2",
  "",
  "## Dropped",
  "",
  "- a: none",
  "- b: none",
  "",
].join("\n");

const draft = parseText("task-1-round-2.md", draftText);

const judgementText = [
  "Seats: a on opus, b on fable",
  "",
  "## Keep",
  "",
  "- R2.2, R2.1",
  "  Required: サインインはキャッシュを読む",
  "  Breaks: 二回目のサインインが値を取らない",
  "",
  "## Drop",
  "",
  "- R2.3: ログの量は意図を壊さない",
  "",
  "## Earlier",
  "",
  "- R1.2 stands: `retryJob` は最初の呼び出しの前に確かめる",
  "- R1.3 resolved: 値は残す設計",
  "- R1.4 resolved: 設計どおり",
  "",
  "## Not run",
  "",
  "- `npm run e2e`: ブラウザがない",
  "",
].join("\n");

const changed = (...pairs: readonly (readonly [string, string])[]): string =>
  pairs.reduce((text, [old, replacement]) => {
    assert.equal(text.split(old).length, 2, `${old} is not in the judgement once`);
    return text.replace(old, replacement);
  }, judgementText);

const judged = (text: string): Judgement => {
  const parsed = parseJudgement(text);
  assert.ok(!("why" in parsed), JSON.stringify(parsed));
  return parsed;
};

const shapeAt = (text: string): number => {
  const parsed = parseJudgement(text);
  assert.ok("why" in parsed, JSON.stringify(parsed));
  assert.deepEqual([parsed.why, parsed.id], ["shape", null]);
  return parsed.line;
};

test("parseJudgement reads a judgement written in Japanese", () => {
  assert.deepEqual(judged(judgementText), {
    seats: "Seats: a on opus, b on fable",
    keep: [
      {
        ids: ["R2.2", "R2.1"],
        required: "サインインはキャッシュを読む",
        breaks: "二回目のサインインが値を取らない",
        line: 5,
      },
    ],
    drop: [{ id: "R2.3", reason: "ログの量は意図を壊さない", line: 11 }],
    earlier: [
      {
        id: "R1.2",
        word: "stands",
        reason: "`retryJob` は最初の呼び出しの前に確かめる",
        line: 15,
      },
      { id: "R1.3", word: "resolved", reason: "値は残す設計", line: 16 },
      { id: "R1.4", word: "resolved", reason: "設計どおり", line: 17 },
    ],
    notRun: ["- `npm run e2e`: ブラウザがない"],
    keepLine: 3,
    earlierLine: 13,
  });
  const empty = judged(
    "Seats: a on opus\n\n## Keep\n\nNone.\n\n## Drop\n\nNone.\n\n## Earlier\n\nNone.\n\n## Not run\n\nNone.\n",
  );
  assert.deepEqual([empty.keep, empty.drop, empty.earlier, empty.notRun], [[], [], [], []]);
});

test("parseJudgement gives shape at the first line out of the format", () => {
  assert.equal(shapeAt(changed(["Seats: a on opus, b on fable", ""])), 3);
  assert.equal(
    shapeAt(
      changed(["## Drop", "## Moved"], ["## Earlier", "## Drop"], ["## Moved", "## Earlier"]),
    ),
    9,
  );
  assert.equal(shapeAt(judgementText.split("\n## Not run")[0] ?? ""), 17);
  assert.equal(
    shapeAt(changed(["ログの量は意図を壊さない", "ログの量は意図を壊さない\nNone."])),
    12,
  );
  assert.equal(shapeAt(changed(["  Breaks:", "  Required: 二つ目\n  Breaks:"])), 7);
  assert.equal(shapeAt(changed(["  Required: サインインはキャッシュを読む", "  Required:"])), 6);
  assert.equal(shapeAt(changed(["  Breaks: 二回目のサインインが値を取らない", "  Breaks: "])), 7);
  assert.equal(shapeAt(changed(["  Breaks:", "  Notes: 余計な行\n  Breaks:"])), 7);
  assert.equal(shapeAt(changed(["  Breaks: 二回目のサインインが値を取らない\n", ""])), 5);
  assert.equal(shapeAt(changed(["- R2.3: ログの量は意図を壊さない", "- R2.3: "])), 11);
  assert.equal(shapeAt(changed(["- R1.3 resolved:", "- R1.3 fixed:"])), 16);
  assert.equal(shapeAt(changed(["## Not run\n\n- `npm", "## Not run\n\n`npm"])), 21);
  assert.equal(shapeAt(changed(["## Drop\n\n- R2.3: ログの量は意図を壊さない\n", "## Drop\n"])), 9);
  assert.equal(shapeAt(""), 1);
});

const faultOf = (text: string): JudgementFault | null => judgementFault(judged(text), draft);

test("judgementFault names each why", () => {
  assert.equal(faultOf(judgementText), null);
  assert.deepEqual(faultOf(changed(["- R2.2, R2.1", "- R1.2, R2.1"])), {
    line: 5,
    why: "unknown-id",
    id: "R1.2",
  });
  assert.deepEqual(faultOf(changed(["- R1.4 resolved:", "- R1.4 stands:"])), {
    line: 17,
    why: "unknown-id",
    id: "R1.4",
  });
  assert.deepEqual(
    faultOf(changed(["- R1.3 resolved:", "- R1.1 resolved: 直った\n- R1.3 resolved:"])),
    {
      line: 16,
      why: "unknown-id",
      id: "R1.1",
    },
  );
  assert.deepEqual(faultOf(changed(["- R2.3:", "- R2.1:"])), {
    line: 11,
    why: "twice",
    id: "R2.1",
  });
  assert.deepEqual(
    faultOf(changed(["- R1.3 resolved:", "- R1.2 stands: もう一度\n- R1.3 resolved:"])),
    {
      line: 16,
      why: "twice",
      id: "R1.2",
    },
  );
  assert.deepEqual(faultOf(changed(["- R1.2 stands:", "- R1.2 resolved:"])), {
    line: 15,
    why: "not-disagree",
    id: "R1.2",
  });
  assert.deepEqual(faultOf(changed(["- R2.3: ログの量は意図を壊さない", "None."])), {
    line: 3,
    why: "unjudged",
    id: "R2.3",
  });
  assert.deepEqual(
    faultOf(changed(["- R1.2 stands: `retryJob` は最初の呼び出しの前に確かめる\n", ""])),
    { line: 13, why: "no-reason", id: "R1.2" },
  );
  assert.deepEqual(
    faultOf(
      changed(
        ["- R1.2 stands: `retryJob` は最初の呼び出しの前に確かめる\n", ""],
        ["- R2.3: ログの量は意図を壊さない", "None."],
      ),
    ),
    { line: 13, why: "no-reason", id: "R1.2" },
  );
});

test("roundText writes merged findings, earlier reasons and drop lines", () => {
  assert.equal(
    roundText("task-1", 2, draft, judged(judgementText), "changes-requested"),
    [
      "# task-1, round 2",
      "",
      "Seats: a on opus, b on fable",
      "",
      "## Earlier findings",
      "",
      "- R1.1 resolved: ran: `one.sh`; saw: exit 0",
      "- R1.2 stands: ran: `two.sh`; saw: exit 1, `壊れる`; `retryJob` は最初の呼び出しの前に確かめる",
      "- R1.3 resolved: ran: `three.sh`; saw: exit 1; 値は残す設計",
      "- R1.4 resolved: ran: `four.sh`; saw: exit 0; 設計どおり",
      "",
      "## New findings",
      "",
      "### R2.1 二回目のサインインで値がない",
      "",
      "Found by: a, b",
      "Command: `b.sh`",
      "Printed: exit 1",
      "Required: サインインはキャッシュを読む",
      "Breaks: 二回目のサインインが値を取らない",
      "",
      "## Dropped",
      "",
      "- a: none",
      "- b: none",
      "- b: R2.3, ログの量は意図を壊さない",
      "",
      "## Not run",
      "",
      "- `npm run e2e`: ブラウザがない",
      "",
      "## Verdict",
      "",
      "changes-requested",
      "",
    ].join("\n"),
  );
  const first = parseText(
    "task-1-round-1.md",
    "# task-1, round 1, draft\n\n## Earlier findings\n\nNone.\n\n## New findings\n\nNone.\n\n## Dropped\n\n- a: none\n",
  );
  const none = judged(
    "Seats: a on opus\n\n## Keep\n\nNone.\n\n## Drop\n\nNone.\n\n## Earlier\n\nNone.\n\n## Not run\n\nNone.\n",
  );
  assert.equal(
    roundText("task-1", 1, first, none, "approve"),
    "# task-1, round 1\n\nSeats: a on opus\n\n## Earlier findings\n\nNone.\n\n## New findings\n\nNone.\n\n## Dropped\n\n- a: none\n\n## Not run\n\nNone.\n\n## Verdict\n\napprove\n",
  );
});

test("evidenceWanted names the evidence of the latest code change", () => {
  assert.equal(evidenceWanted({}, "task-1", 1), "review/task-1-evidence.md");
  assert.equal(evidenceWanted({ "review/task-1-evidence.md": "x" }, "task-1", 1), null);
  const fixed = {
    "review/task-1-evidence.md": "x",
    "review/task-1-round-1-reply.md": "# 返信\n\n- R1.1 fixed: 直した。ran: `t.sh`; saw: exit 0\n",
    "review/task-1-round-2-reply.md": "# 返信\n\n- R1.1 disagree: 設計どおり\n",
  };
  assert.equal(evidenceWanted(fixed, "task-1", 3), "review/task-1-round-1-evidence.md");
  assert.equal(
    evidenceWanted({ ...fixed, "review/task-1-round-1-evidence.md": "x" }, "task-1", 3),
    null,
  );
  assert.equal(evidenceWanted({}, "integration", 1), "review/integration-round-1-a.md");
  const seat = "# Seat\n\n## Findings\n\nNone.\n\n## Not run\n\nNone.\n";
  assert.equal(
    evidenceWanted({ "review/integration-round-1-a.md": seat }, "integration", 1),
    "review/integration-round-1-a.md",
  );
  assert.equal(
    evidenceWanted(
      {
        "review/integration-round-1-b.md": `${seat}\n## Walk\n\n- 通した\n  - ran: t.sh\n  - saw: ok\n`,
      },
      "integration",
      1,
    ),
    null,
  );
  assert.equal(evidenceWanted({}, "merge", 1), "review/merge-evidence.md");
  assert.equal(evidenceWanted({ "review/merge-evidence.md": "x" }, "merge", 1), null);
});
