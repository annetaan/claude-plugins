import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decidedRules,
  nulSplit,
  pattern,
  sortOut,
} from "../plugins/annetaan/skills/workflow/scripts/pure/include-rules.ts";

test("pattern anchors the path and escapes glob characters", () => {
  assert.equal(pattern("a[1]*.local.toml", false), "/a\\[1]\\*.local.toml");
  assert.equal(pattern("what?\\x", true), "!/what\\?\\\\x");
});

test("pattern writes a carriage return as a bracket and escapes trailing spaces", () => {
  assert.equal(pattern("Icon\r", false), "/Icon[\r]");
  assert.equal(pattern("a b  ", false), "/a b\\ \\ ");
});

test("decidedRules turns every negated line into a plain one", () => {
  assert.equal(decidedRules("/a\n!/b\n"), "/a\n/b\n");
});

test("sortOut copies the matched ignored files not present, and lists the undecided ignored ones", () => {
  const found = sortOut({
    matched: new Set(["b", "a", "secret"]),
    candidates: new Set(["a", "b", "c", "d", "present", ".worktreeinclude"]),
    decided: new Set(["a", "b", "d"]),
    ignored: new Set(["a", "b", "c", "d", "present", ".worktreeinclude"]),
    present: new Set(["b", "present"]),
  });
  assert.deepEqual(found, { copied: ["a"], notIgnored: ["secret"], unlisted: ["c"] });
});

test("nulSplit drops empty pieces", () => {
  assert.deepEqual(nulSplit("a\0b\0\0"), ["a", "b"]);
});
