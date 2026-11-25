import { test } from "node:test";
import assert from "node:assert/strict";
import { atLeast, ghVersion } from "../plugins/annetaan/scripts/pure/gh-version.ts";

test("ghVersion reads the version gh --version prints, and null from anything else", () => {
  assert.deepEqual(
    ghVersion("gh version 2.94.0 (2026-01-01)\nhttps://github.com/cli/cli/releases/tag/v2.94.0\n"),
    [2, 94, 0],
  );
  assert.equal(ghVersion("command not found"), null);
});

test("atLeast compares the parts as numbers against 2.94.0 and 2.99.0", () => {
  assert.ok(atLeast([2, 94, 0], [2, 94, 0]));
  assert.ok(!atLeast([2, 94, 0], [2, 99, 0]));
  assert.ok(atLeast([2, 100, 0], [2, 99, 0]));
  assert.ok(atLeast([3, 0, 0], [2, 99, 0]));
  assert.ok(!atLeast([2, 98, 9], [2, 99, 0]));
});
