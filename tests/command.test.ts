import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../plugins/annetaan/scripts/command.ts";

const BOM = String.fromCharCode(0xfeff);
const REPLACEMENT = String.fromCharCode(0xfffd);

test("run keeps a leading byte order mark", () => {
  const result = run([
    "bash",
    "-c",
    "printf '\\357\\273\\277out\\377'; printf '\\357\\273\\277err' >&2",
  ]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, `${BOM}out${REPLACEMENT}`);
  assert.equal(result.stderr, `${BOM}err`);
});
