import { test } from "node:test";
import assert from "node:assert/strict";
import {
  historyGroups,
  parseLevelFile,
  perTask,
  showFields,
} from "../plugins/annetaan/skills/workflow/scripts/pure/level-file.ts";

const file = (level: string, evaluated: string, reviewBy: string): string =>
  `---\nlevel: ${level}\nevaluated: ${evaluated}\nreview-by: ${reviewBy}\n---\n\n# Level\n`;

test("parseLevelFile reads the level and the two dates from the front matter", () => {
  assert.deepEqual(parseLevelFile(file("high", "2026-01-01", "2026-04-01")), {
    invalid: null,
    level: "high",
    evaluated: "2026-01-01",
    reviewBy: "2026-04-01",
  });
});

test("parseLevelFile names what is wrong", () => {
  assert.deepEqual(parseLevelFile("level: high\n"), {
    invalid: "no front matter between two --- lines",
  });
  assert.deepEqual(parseLevelFile(file("low", "2026-01-01", "2026-04-01")), {
    invalid: "level is not standard or high",
  });
  assert.deepEqual(parseLevelFile(file("high", "2026-02-30", "2026-04-01")), {
    invalid: "evaluated and review-by are not both dates as YYYY-MM-DD",
  });
});

test("showFields warns when review-by has passed and an override wins", () => {
  const read = {
    problem: null,
    ref: "origin/main",
    text: file("high", "2026-01-01", "2026-04-01"),
  };
  const late = showFields(read, null, "2026-05-01");
  assert.equal(late["level"], "high");
  assert.equal(late["source"], "file");
  assert.match(String(late["warning"]), /review-by 2026-04-01 has passed/);
  const overridden = showFields(read, "standard", "2026-02-01");
  assert.equal(overridden["source"], "override");
  assert.equal(overridden["warning"], null);
  assert.deepEqual(overridden["seats"], ["a"]);
});

test("perTask rounds half to even on the binary value, as Python's round does", () => {
  assert.equal(perTask(1, 8), 0.12);
  assert.equal(perTask(3, 8), 0.38);
  assert.equal(perTask(1, 3), 0.33);
  assert.equal(perTask(2, 1), 2);
  assert.equal(perTask(1, 0), null);
});

const record = (level: string, source: string, tasks: number, rounds: number, findings: number) =>
  `Level: ${level} (${source}) · tasks ${tasks} · task rounds ${rounds} · integration rounds 1 · findings ${findings}`;

test("historyGroups keeps the last Level: line of each pull request and groups by level and source", () => {
  const history = historyGroups([
    {
      number: 3,
      url: "u3",
      mergedAt: "2026-01-03T00:00:00Z",
      body: `${record("high", "file", 1, 3, 2)}\r\n`,
    },
    {
      number: 1,
      url: "u1",
      mergedAt: "2026-01-01T00:00:00Z",
      body: `${record("standard", "default", 9, 9, 9)}\n${record("standard", "file", 2, 3, 1)}`,
    },
    {
      number: 2,
      url: "u2",
      mergedAt: "2026-01-02T00:00:00Z",
      body: `Level: odd\n${record("standard", "file", 2, 2, 0)}`,
    },
    { number: 4, url: "u4", mergedAt: "2026-01-04T00:00:00Z", body: "no record" },
  ]);
  assert.deepEqual(
    history.runs.map((r) => r.pr),
    [1, 2, 3],
  );
  assert.deepEqual(history.unread, [{ pr: 2, line: "Level: odd" }]);
  assert.deepEqual(history.groups, [
    {
      level: "standard",
      source: "file",
      runs: 2,
      tasks: 4,
      taskRounds: 5,
      integrationRounds: 2,
      findings: 1,
      sendBacks: 1,
      sendBacksPerTask: 0.25,
      findingsPerTask: 0.25,
    },
    {
      level: "high",
      source: "file",
      runs: 1,
      tasks: 1,
      taskRounds: 3,
      integrationRounds: 1,
      findings: 2,
      sendBacks: 2,
      sendBacksPerTask: 2,
      findingsPerTask: 2,
    },
  ]);
});
