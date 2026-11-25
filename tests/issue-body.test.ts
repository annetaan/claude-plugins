import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decisionCounts,
  lint,
  orderOf,
  parentLint,
  parseBody,
  spansOf,
  titled,
} from "../plugins/annetaan/skills/pj1-plan/scripts/pure/issue-body.ts";

const decision = (box: string): string =>
  `### D1. どちらの名前にするか\n\n呼び出し側が変わる。\n\nOnly you know: 呼び出し側の名前。\n\n- [${box}] \`bar\` (recommended)\n  - 公開名は \`bar\`\n- [ ] \`baz\`\n  - 公開名は \`baz\`\n`;

const body = (design: string, decisions = "None."): string =>
  `## Goal\n\n名前を変える。\n\n## Design\n\n${design}\n\n## Acceptance criteria\n\n- \`foo\` が変わる。\n\n## Decisions\n\n${decisions}\n\n## Out of scope\n\nなし。\n`;

const parent = (order: string): string =>
  `Base: \`pj/1\` from \`main\`\n\n## Order\n\n${order}\n\n## Goal\n\nx\n\n## Design\n\ny\n\n## Decisions\n\nNone.\n\n## Out of scope\n\nz\n`;

test("a body in the format passes the lint", () => {
  assert.deepEqual(lint(parseBody(body("- `src/app.ts` (changed): `foo` を変える。"))), {
    ok: true,
    reasons: [],
  });
});

test("a stub fails with stub alone", () => {
  assert.deepEqual(lint(parseBody(body("To be drawn."))), { ok: false, reasons: ["stub"] });
});

test("a pointer by line number fails line-number, a URL with a port does not", () => {
  assert.deepEqual(lint(parseBody(body("- `src/app.ts` (changed): see src/app.ts:12"))).reasons, [
    "line-number",
  ]);
  assert.deepEqual(
    lint(parseBody(body("- `src/app.ts` (changed): see http://localhost:8080/x"))).reasons,
    [],
  );
});

test("an open decision written in Japanese fails decisions-open and counts as open", () => {
  const parsed = parseBody(body("- `src/app.ts` (changed): `foo`", decision(" ")));
  assert.deepEqual(lint(parsed).reasons, ["decisions-open"]);
  assert.deepEqual(decisionCounts(parsed.decs), {
    total: 1,
    settled: 0,
    open: 1,
    contradictory: 0,
  });
  assert.equal(titled("名前を変える (0/2)", decisionCounts(parsed.decs)), "名前を変える (0/1)");
});

test("1. #12です under ## Order is no order line", () => {
  assert.deepEqual(orderOf(parent("1. #12です")), []);
  assert.deepEqual(orderOf(parent("1. #12\n2. #3")), [12, 3]);
  assert.deepEqual(parentLint(parseBody(parent("1. #12です"))).reasons, ["order"]);
  assert.deepEqual(parentLint(parseBody(parent("1. #12"))), { ok: true, reasons: [] });
});

test("a parent with no Base: line and its Order after Goal fails base and sections", () => {
  const text =
    "## Goal\n\nx\n\n## Order\n\n1. #2\n\n## Design\n\ny\n\n## Decisions\n\nNone.\n\n## Out of scope\n\nz\n";
  assert.deepEqual(parentLint(parseBody(text)).reasons, ["base", "sections"]);
});

test("a span in Japanese is no symbol, and a symbol with Japanese letters is kept whole", () => {
  assert.deepEqual(spansOf("`計算` を呼ぶ"), []);
  assert.deepEqual(spansOf("`foo日本` を呼ぶ"), ["foo日本"]);
  assert.deepEqual(spansOf("`parse()` と `a.b` と `parse`"), ["parse", "a.b"]);
});
