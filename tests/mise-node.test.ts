import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

test("mise.toml pins the Node.js that the test job of test.yml sets up", () => {
  const pinned = /^node = "([^"]+)"$/mu.exec(read("mise.toml"))?.[1];
  const job = /^ {2}test:\n((?: {4}.*\n|\n)*)/mu.exec(read(".github/workflows/test.yml"))?.[1];
  const ci = job === undefined ? undefined : /^ +node-version: (\S+)$/mu.exec(job)?.[1];
  assert.notEqual(pinned, undefined, 'mise.toml has no node = "<version>" line');
  assert.notEqual(ci, undefined, "the test job of .github/workflows/test.yml sets no node-version");
  assert.equal(pinned, ci);
});
