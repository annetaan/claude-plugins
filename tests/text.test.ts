import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIGIT,
  escapeRegExp,
  splitLines,
  squeeze,
  WORD,
  wordBoundary,
} from "../plugins/annetaan/scripts/pure/text.ts";

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);

test("splitLines splits on \\r\\n as one break", () => {
  assert.deepEqual(splitLines("a\r\nb\rc\nd"), ["a", "b", "c", "d"]);
});

test("splitLines splits on the line separator", () => {
  assert.deepEqual(splitLines(`a${LINE_SEPARATOR}b`), ["a", "b"]);
});

test("splitLines drops one trailing empty piece and keeps an inner one", () => {
  assert.deepEqual(splitLines("a\n"), ["a"]);
  assert.deepEqual(splitLines("a\n\n"), ["a", ""]);
  assert.deepEqual(splitLines(""), []);
  assert.deepEqual(splitLines("\n"), [""]);
});

test("squeeze joins the words split on any whitespace, full-width spaces included", () => {
  assert.equal(squeeze(`  a${IDEOGRAPHIC_SPACE}${IDEOGRAPHIC_SPACE}b\t\nc  `), "a b c");
  assert.equal(squeeze(" \n "), "");
});

test("WORD, DIGIT and wordBoundary treat Japanese as word characters", () => {
  assert.ok(new RegExp(`^[${WORD}]+$`, "u").test("計算"));
  assert.ok(new RegExp(`^${DIGIT}$`, "u").test("1"));
  assert.ok(!new RegExp(`#(${DIGIT}+)${wordBoundary("after")}`, "u").test("#12です"));
  assert.ok(new RegExp(`#(${DIGIT}+)${wordBoundary("after")}`, "u").test("#12 です"));
  assert.ok(!new RegExp(`${wordBoundary("before")}foo`, "u").test("日foo"));
});

test("escapeRegExp makes every pattern character literal", () => {
  const text = "a.b*c?(d)[e]{f}|g\\h^$/+";
  assert.ok(new RegExp(`^${escapeRegExp(text)}$`, "u").test(text));
});
