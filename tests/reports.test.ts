import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isStamped,
  landings,
  oldReports,
  REPORTS_KEPT,
  stampOf,
} from "../plugins/annetaan/scripts/pure/reports.ts";
import { stampedIn } from "../plugins/annetaan/scripts/work-reports.ts";

const OLDEST = "2026-01-01-0000-r000";
const SECOND = "2026-01-01-0100-r001";
const NEWEST = "2026-01-05-0400-r100";
const NEW_IN = "2099-12-31-2359-incoming";
const OLD_IN = "2000-01-01-0000-incoming";

const two = (n: number): string => String(n).padStart(2, "0");

const seeded: readonly string[] = Array.from({ length: 101 }, (_, i) => {
  const at = new Date(Date.UTC(2026, 0, 1, i));
  const stamp = `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}-${two(at.getUTCHours())}00`;
  return `${stamp}-r${String(i).padStart(3, "0")}`;
});

const tmp = mkdtempSync(join(tmpdir(), "reports-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

test("the seeded reports run from the oldest to the newest stamp", () => {
  assert.equal(seeded[0], OLDEST);
  assert.equal(seeded[1], SECOND);
  assert.equal(seeded[100], NEWEST);
});

test("only a directory whose name starts with a stamp counts, not a file, a symlink or another directory", () => {
  const root = join(tmp, "work-reports");
  mkdirSync(root);
  for (const name of seeded) {
    mkdirSync(join(root, name));
  }
  mkdirSync(join(root, "notes"));
  writeFileSync(join(root, ".DS_Store"), "");
  writeFileSync(join(root, "2099-01-01-0000-file"), "");
  mkdirSync(join(tmp, "elsewhere"));
  symlinkSync(join(tmp, "elsewhere"), join(root, "2000-01-01-0000-link"));
  assert.deepEqual(stampedIn(root), seeded);
});

test("the reports beyond the 100 newest by stamp are old", () => {
  assert.equal(REPORTS_KEPT, 100);
  assert.deepEqual(oldReports(seeded), [OLDEST]);
});

test("incoming reports count in under the names they move in as, a collision renamed", () => {
  const taken = [...seeded, "notes", ".DS_Store", "2099-01-01-0000-file", "2000-01-01-0000-link"];
  const found = landings(taken, [OLD_IN, OLDEST, NEW_IN].toSorted(), "wf-test");
  assert.deepEqual(found, [
    { report: OLD_IN, dest: OLD_IN },
    { report: OLDEST, dest: `${OLDEST}-wf-test` },
    { report: NEW_IN, dest: NEW_IN },
  ]);
  assert.deepEqual(
    oldReports(
      seeded,
      found.map((l) => l.dest),
    ),
    [OLD_IN, OLDEST, `${OLDEST}-wf-test`, SECOND],
  );
});

test("two incoming reports that collide on one name both get a free name", () => {
  assert.deepEqual(landings(["a"], ["a", "a-wt"], "wt"), [
    { report: "a", dest: "a-wt" },
    { report: "a-wt", dest: "a-wt-wt" },
  ]);
});

test("isStamped takes a stamp alone or followed by a dash, and nothing else", () => {
  assert.ok(isStamped("2026-01-01-0000"));
  assert.ok(isStamped("2026-01-01-0000-x"));
  assert.ok(!isStamped("2026-01-01-0000x"));
  assert.ok(!isStamped("notes"));
});

test("stampOf writes the local time as YYYY-MM-DD-HHMM", () => {
  assert.equal(stampOf(new Date(2026, 0, 2, 3, 4)), "2026-01-02-0304");
  assert.equal(stampOf(new Date(2026, 10, 25, 12, 44)), "2026-11-25-1244");
});
