import { test } from "node:test";
import assert from "node:assert/strict";
import {
  roadmapFiles,
  roadmapParse,
} from "../plugins/annetaan/skills/pj1-plan/scripts/pure/roadmap-file.ts";

test("a heading in Japanese is an entry", () => {
  const parsed = roadmapParse("# ロードマップ\n\n## 設計\n\n本文。\n\n## 実装\n\n本文。\n");
  assert.deepEqual(parsed.entries, [
    { heading: "設計", start: 3, end: 6 },
    { heading: "実装", start: 7, end: 9 },
  ]);
  assert.deepEqual(parsed.reasons, []);
});

test("a setext underline is a reason, and a list item above a rule is not", () => {
  assert.deepEqual(roadmapParse("# R\n\n設計\n----\n").reasons, [
    { code: "setext-heading", line: 3, heading: "設計" },
  ]);
  assert.deepEqual(roadmapParse("# R\n\n- 項目\n---\n").reasons, []);
  assert.deepEqual(roadmapParse("# R\n\n1. 項目\n===\n").reasons, []);
});

test("a duplicate heading, an empty one and a second title are reasons", () => {
  assert.deepEqual(roadmapParse("# A\n# B\n\n## X\n\n## X\n\n##\n").reasons, [
    { code: "several-titles", line: 2 },
    { code: "duplicate-heading", line: 6, heading: "X" },
    { code: "empty-heading", line: 8 },
  ]);
});

test("a heading inside a fence or in front matter is no entry", () => {
  assert.deepEqual(roadmapParse("---\ntitle: x\n---\n```\n## 中\n```\n## 外\n").entries, [
    { heading: "外", start: 7, end: 7 },
  ]);
});

test("roadmapFiles takes one file, and names none or several", () => {
  assert.deepEqual(roadmapFiles(["docs/roadmap.md"]), {
    files: ["docs/roadmap.md"],
    path: "docs/roadmap.md",
    reasons: [],
  });
  assert.deepEqual(roadmapFiles([]).reasons, [{ code: "no-file" }]);
  assert.deepEqual(roadmapFiles(["ROADMAP.md", "roadmap.md"]), {
    files: ["roadmap.md", "ROADMAP.md"],
    path: null,
    reasons: [{ code: "several-files" }],
  });
});
