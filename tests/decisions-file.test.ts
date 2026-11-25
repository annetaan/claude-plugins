import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decisionBody,
  decisionEntries,
  filedIssue,
  filedNames,
} from "../plugins/annetaan/skills/workflow/scripts/pure/decisions-file.ts";

const text = [
  "# Decisions",
  "",
  "## セッションを Redis に置く",
  "",
  "Area: infrastructure",
  "",
  "### What was decided",
  "",
  "セッションは共有の Redis に移す。",
  "",
  "### Other options and why this one",
  "",
  "スティッキーセッションではデプロイのたびに全員がログアウトする。",
  "",
  "### Where it landed",
  "",
  "- `src/session/store.ts`",
  "",
  "### To overturn it",
  "",
  "```text",
  "/annetaan:workflow セッションをプロセスのメモリに戻す。",
  "```",
  "",
].join("\n");

test("decisionEntries reads an entry written in Japanese with no reason", () => {
  const { reasons, entries } = decisionEntries(text);
  assert.deepEqual(reasons, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.title, "セッションを Redis に置く");
  assert.equal(entries[0]?.area, "infrastructure");
  assert.deepEqual(entries[0]?.parts["What was decided"], ["セッションは共有の Redis に移す。"]);
});

test("decisionEntries gives area and landed on a Japanese area and an unquoted path", () => {
  const broken = text
    .split("Area: infrastructure")
    .join("Area: インフラ")
    .split("- `src/session/store.ts`")
    .join("- src/session/store.ts");
  assert.deepEqual(decisionEntries(broken).reasons, ["area", "landed"]);
});

test("decisionEntries takes None. alone, and refuses an empty file", () => {
  assert.deepEqual(decisionEntries("# Decisions\n\nNone.\n"), { reasons: [], entries: [] });
  assert.deepEqual(decisionEntries("# Decisions\n").reasons, ["sections"]);
});

test("decisionBody writes the area and the pull request into the issue body", () => {
  const [entry] = decisionEntries(text).entries;
  assert.ok(entry !== undefined);
  assert.equal(
    decisionBody(entry, 42),
    [
      "## What was decided",
      "",
      "Area: infrastructure",
      "",
      "セッションは共有の Redis に移す。",
      "",
      "## Other options and why this one",
      "",
      "スティッキーセッションではデプロイのたびに全員がログアウトする。",
      "",
      "## Where it landed",
      "",
      "Pull request: #42",
      "",
      "- `src/session/store.ts`",
      "",
      "## To overturn it",
      "",
      "```text",
      "/annetaan:workflow セッションをプロセスのメモリに戻す。",
      "```",
      "",
    ].join("\n"),
  );
  const filed = filedIssue(entry, "https://github.com/o/r/issues/7\n");
  assert.deepEqual(filed, {
    title: "セッションを Redis に置く",
    number: 7,
    url: "https://github.com/o/r/issues/7",
  });
  assert.equal(filedNames([filed]), "#7 セッションを Redis に置く");
  assert.equal(filedNames([]), "none");
});
