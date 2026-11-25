import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HANDOVER,
  MARKERS,
  markerProblem,
} from "../plugins/annetaan/skills/pj1-plan/scripts/pure/comment-markers.ts";

test("markerProblem passes a text that starts with each marker", () => {
  for (const marker of MARKERS) {
    assert.equal(markerProblem("c.md", `${marker} Resolved.\n`), null, marker);
  }
  assert.equal(markerProblem("c.md", `${HANDOVER}\n- a line\n`), null);
});

test("markerProblem names the file when no marker starts the text", () => {
  assert.equal(markerProblem("c.md", "No marker here.\n"), "c.md does not start with a marker");
  assert.equal(
    markerProblem("c.md", " **[pj3-doctor]** indented\n"),
    "c.md does not start with a marker",
  );
  assert.equal(markerProblem("c.md", ""), "c.md does not start with a marker");
});
