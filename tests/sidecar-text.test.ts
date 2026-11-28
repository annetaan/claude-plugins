import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { locate } from "../plugins/annetaan/skills/doc-meta/scripts/pure/locate.ts";
import {
  FIELDS,
  headerLine,
  ROLES,
  WEIGHTS,
} from "../plugins/annetaan/skills/doc-meta/scripts/pure/sidecar-text.ts";
import { syncSidecar } from "../plugins/annetaan/skills/doc-meta/scripts/pure/sync.ts";

const formatMd = join(import.meta.dirname, "../plugins/annetaan/skills/doc-meta/format.md");

const section = (text: string, heading: string): readonly string[] => {
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  assert.notEqual(start, -1, `format.md has no ${heading}`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end === -1 ? undefined : end);
};

const captured = (lines: readonly string[], pattern: RegExp): readonly string[] =>
  lines.flatMap((line) => {
    const word = pattern.exec(line)?.[1];
    return word === undefined ? [] : [word];
  });

test("the roles, weights, fields and header match format.md", () => {
  const text = readFileSync(formatMd, "utf8");
  assert.deepEqual(captured(section(text, "## Roles"), /^\| `([a-z]+)` \|/u), ROLES);
  assert.deepEqual(
    new Set(captured(section(text, "## Weight"), /^- `([^`]+)`:/u)),
    new Set(WEIGHTS),
  );
  assert.deepEqual(captured(section(text, "## `## Document`"), /^- `([^`]+)`:/u), FIELDS);
  const header = section(text, "## Header comment");
  const fence = header.indexOf("```");
  assert.equal(
    header[fence + 1],
    headerLine("/absolute/path/skills/doc-meta/format.md"),
    "the line inside the fence under ## Header comment",
  );
  assert.equal(header[fence + 2], "```");
});

const blocksFile = (texts: readonly string[]): string =>
  texts.map((text, index) => `### ${index + 1}\n> ${text}\n`).join("\n");

const resync = (
  before: readonly string[],
  after: readonly string[],
): Extract<ReturnType<typeof syncSidecar>, { kind: "ok" }> => {
  const first = syncSidecar({
    document: before.join(" "),
    blocks: blocksFile(before),
    sidecar: null,
    formatPath: "/f/format.md",
  });
  assert.ok(first.kind === "ok", JSON.stringify(first));
  const second = syncSidecar({
    document: after.join(" "),
    blocks: blocksFile(after),
    sidecar: first.text,
    formatPath: "/f/format.md",
  });
  assert.ok(second.kind === "ok", JSON.stringify(second));
  return second;
};

test("anchors never pair backwards", () => {
  const result = resync(["Alpha one.", "Beta two."], ["Beta two.", "Alpha one."]);
  assert.deepEqual(result.unchanged, ["b002"]);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.new, ["b003"]);
  assert.deepEqual(result.deleted, ["b001"]);
});

test("a gap pairs by position", () => {
  const result = resync(
    ["Alpha one.", "Xray.", "Yankee.", "Beta two."],
    ["Alpha one.", "Papa.", "Quebec.", "Romeo.", "Beta two."],
  );
  assert.deepEqual(result.unchanged, ["b001", "b004"]);
  assert.deepEqual(result.changed, ["b002", "b003"]);
  assert.deepEqual(result.new, ["b005"]);
  assert.deepEqual(result.deleted, []);
});

const prose = (text: string): { text: string; verbatim: false; record: null } => ({
  text,
  verbatim: false,
  record: null,
});

test("locate searches from the end of the block before", () => {
  const document = "Intro. It works. See below. It works. Done.";
  assert.deepEqual(
    locate(document, ["Intro.", "It works.", "See below.", "It works.", "Done."].map(prose)),
    ["found", "found", "found", "found", "found"],
  );
  assert.deepEqual(locate(document, ["See below.", "It works.", "Done."].map(prose)), [
    "found",
    "found",
    "found",
  ]);
  assert.deepEqual(locate(document, ["See below.", "Intro.", "Done.", "Gone."].map(prose)), [
    "found",
    "order",
    "found",
    "missing",
  ]);
});

test("a three-line record is found by its first two lines inside a fence", () => {
  const record = { first: "```python", second: "def f():" };
  const quote = { text: "", verbatim: true, record };
  const body = Array.from({ length: 11 }, (_, index) => `    x${index} = ${index}`);
  const fence = ["```python", "def f():", ...body, "```"].join("\n");
  assert.deepEqual(locate(`Text.\n\n${fence}\n`, [quote]), ["found"]);
  const nested = ["~~~~", fence, "~~~~"].join("\n");
  assert.deepEqual(locate(`Text.\n\n${nested}\n`, [quote]), ["missing"]);
  const apart = ["```python", "print()", "```", "def f():"].join("\n");
  assert.deepEqual(locate(apart, [quote]), ["missing"]);
});
