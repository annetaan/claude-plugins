import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  dropsOnMove,
  freeName,
  isStamped,
  landings,
  oldReports,
  REPORTS_KEPT,
  stampOf,
} from "../plugins/annetaan/scripts/pure/reports.ts";
import { moveReports, stampedIn } from "../plugins/annetaan/scripts/work-reports.ts";

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
  const found = landings(taken, [OLD_IN, OLDEST, NEW_IN].toSorted());
  assert.deepEqual(found, [
    { report: OLD_IN, dest: OLD_IN },
    { report: OLDEST, dest: `${OLDEST}-2` },
    { report: NEW_IN, dest: NEW_IN },
  ]);
  assert.deepEqual(
    oldReports(
      seeded,
      found.map((l) => l.dest),
    ),
    [OLD_IN, OLDEST, `${OLDEST}-2`, SECOND],
  );
});

test("two incoming reports that collide on one name both get a free name", () => {
  assert.deepEqual(landings(["a"], ["a", "a-2"]), [
    { report: "a", dest: "a-2" },
    { report: "a-2", dest: "a-2-2" },
  ]);
  assert.deepEqual(landings(["a", "a-2"], ["a"]), [{ report: "a", dest: "a-3" }]);
});

test("dropsOnMove drops node_modules and directories holding .git, and nothing else", () => {
  assert.ok(dropsOnMove("node_modules", []));
  assert.ok(dropsOnMove("node_modules", ["p"]));
  assert.ok(dropsOnMove("repo", [".git", "a"]));
  assert.ok(!dropsOnMove("work", ["keep.ts", "node_modules"]));
  assert.ok(!dropsOnMove("probe", ["run.sh", "tree"]));
  assert.ok(!dropsOnMove("node_modules2", []));
  assert.ok(!dropsOnMove("x", [".gitignore", ".github"]));
});

test("moveReports leaves node_modules and nested git repositories under scratch/ and seats/ behind", () => {
  const name = "2026-02-01-0000-moved";
  const main = join(tmp, "move-main");
  const wt = join(tmp, "move-wt");
  const report = join(wt, "work-reports", name);
  const files: Readonly<Record<string, string>> = {
    "log.md": "log",
    "review/task-1-round-1.md": "round",
    "scratch/work/keep.ts": "keep",
    "scratch/work/node_modules/p/index.js": "dep",
    "scratch/work/repo/.git/HEAD": "ref: refs/heads/main",
    "seats/a/probe/run.sh": "probe",
    "seats/a/clone/.git": "gitdir: /elsewhere/.git/worktrees/clone",
  };
  mkdirSync(main);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(report, path)), { recursive: true });
    writeFileSync(join(report, path), text);
  }
  const landed = join(main, "work-reports", name);
  assert.deepEqual(moveReports(main, wt), [landed]);
  for (const kept of [
    "log.md",
    "review/task-1-round-1.md",
    "scratch/work/keep.ts",
    "seats/a/probe/run.sh",
  ]) {
    assert.ok(existsSync(join(landed, kept)), kept);
  }
  for (const dropped of ["scratch/work/node_modules", "scratch/work/repo", "seats/a/clone"]) {
    assert.ok(!existsSync(join(landed, dropped)), dropped);
  }
});

test("moveReports moves a report that is a symbolic link as it is, and prunes nothing in its target", () => {
  const name = "2026-02-01-0000-link";
  const main = join(tmp, "link-main");
  const wt = join(tmp, "link-wt");
  const outside = join(tmp, "link-outside");
  const dependency = join(outside, "scratch", "work", "node_modules", "p", "index.js");
  mkdirSync(main);
  mkdirSync(join(wt, "work-reports"), { recursive: true });
  mkdirSync(dirname(dependency), { recursive: true });
  writeFileSync(dependency, "dep");
  symlinkSync(outside, join(wt, "work-reports", name));
  assert.deepEqual(moveReports(main, wt), [join(main, "work-reports", name)]);
  assert.ok(existsSync(dependency));
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

test("freeName returns the name, or the first free -<n>", () => {
  assert.equal(freeName("run", "s", []), "run-s");
  assert.equal(freeName("run", "s", ["run-s"]), "run-s-2");
  assert.equal(freeName("run", "s", ["run-s", "run-s-2"]), "run-s-3");
});
