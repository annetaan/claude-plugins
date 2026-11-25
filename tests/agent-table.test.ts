import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENTS,
  LEVEL_SEATS,
  parseRecordLine,
  recordLine,
} from "../plugins/annetaan/skills/workflow/scripts/pure/agent-table.ts";

test("recordLine and parseRecordLine round trip", () => {
  const fields = {
    level: "high",
    source: "override",
    tasks: 3,
    taskRounds: 12,
    integrationRounds: 2,
    findings: 107,
  };
  const line = recordLine(fields);
  assert.equal(
    line,
    "Level: high (override) · tasks 3 · task rounds 12 · integration rounds 2 · findings 107",
  );
  assert.deepEqual(parseRecordLine(line), fields);
});

test("parseRecordLine refuses an unknown level, an unknown source and a trailing word", () => {
  const line = recordLine({
    level: "standard",
    source: "file",
    tasks: 1,
    taskRounds: 1,
    integrationRounds: 0,
    findings: 0,
  });
  assert.notEqual(parseRecordLine(line), null);
  assert.equal(parseRecordLine(line.split("standard").join("low")), null);
  assert.equal(parseRecordLine(line.split("(file)").join("(guess)")), null);
  assert.equal(parseRecordLine(`${line} more`), null);
});

test("every level seats a, and seat b runs only at high", () => {
  assert.deepEqual(LEVEL_SEATS, { standard: ["a"], high: ["a", "b"] });
  assert.deepEqual(Object.keys(AGENTS["workflow-reviewer-b"] ?? {}), ["high"]);
});
