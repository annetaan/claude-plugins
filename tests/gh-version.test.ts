import { test } from "node:test";
import assert from "node:assert/strict";
import { requiredGh } from "../plugins/annetaan/scripts/pure/gh-version.ts";

test("requiredGh accepts 2.99.0 and later, comparing the parts as numbers", () => {
  assert.deepEqual(
    requiredGh("gh version 2.99.0 (2026-01-01)\nhttps://github.com/cli/cli/releases/tag/v2.99.0\n"),
    { kind: "ok", version: "2.99.0" },
  );
  assert.deepEqual(requiredGh("gh version 2.100.0"), { kind: "ok", version: "2.100.0" });
  assert.deepEqual(requiredGh("gh version 3.0.0"), { kind: "ok", version: "3.0.0" });
});

test("requiredGh refuses a version under 2.99.0 and one it cannot read", () => {
  assert.deepEqual(requiredGh("gh version 2.98.9"), {
    kind: "old",
    message: "gh 2.99.0 or later is required, found 2.98.9",
  });
  assert.deepEqual(requiredGh("command not found"), {
    kind: "old",
    message: "gh 2.99.0 or later is required, found an unknown version",
  });
});
