import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { setTimeout } from "node:timers/promises";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/workflow/scripts/flow.sh");
const scripts = dirname(script);
const levelSh = join(scripts, "level.sh");
const reviewFiles = join(scripts, "../review-files.md");
const skills = join(scripts, "../..");
const throughDots = `${scripts}/../scripts/flow.sh`;

const tmp = mkdtempSync(join(tmpdir(), "flow-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
mkdirSync(home);
const env = {
  ...process.env,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const bin = join(tmp, "bin");
const fakePath = `${bin}:${process.env["PATH"] ?? ""}`;

const work = join(tmp, "work");
const main = join(realpathSync(tmp), "work");
const wt = join(main, ".claude/worktrees/run-test");
const a = join(main, ".claude/worktrees/review-run-test-a");
const b = join(main, ".claude/worktrees/review-run-test-b");
const report = join(wt, "work-reports/2026-01-01-0000-aaaaaaa");

const gitResult = (cwd: string, ...args: readonly string[]) =>
  spawnSync("git", args, { cwd, env, encoding: "utf8" });

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = gitResult(cwd, ...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

git(tmp, "config", "--global", "init.defaultBranch", "main");

const read = (path: string): string => readFileSync(path, "utf8");

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const captured = (text: string): string => text.replace(/\n+$/, "");

const lines = (text: string): string[] => {
  const all = text.split("\n");
  return all.at(-1) === "" ? all.slice(0, -1) : all;
};

const hasLine = (path: string, line: string): boolean => lines(read(path)).includes(line);

const isDir = (path: string): boolean =>
  statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;

const excerpt = (text: string, from: RegExp, to?: RegExp): string => {
  const all = lines(text);
  const start = all.findIndex((line) => from.test(line));
  if (start === -1) {
    return "";
  }
  const end = to === undefined ? -1 : all.findIndex((line, i) => i > start && to.test(line));
  return captured(all.slice(start, end === -1 ? undefined : end + 1).join("\n"));
};

const printed = (result: SpawnSyncReturns<string>): string => {
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return result.stdout;
};

const flow = (...args: readonly string[]) =>
  spawnSync("bash", [script, ...args], { cwd: main, env, encoding: "utf8" });

const flowJson = (...args: readonly string[]) => JSON.parse(printed(flow(...args)));

const refused = (...args: readonly string[]): void => {
  const result = flow(...args);
  assert.equal(result.status, 1, `flow.sh ${args.join(" ")}: ${result.stdout}${result.stderr}`);
};

const notZero = (...args: readonly string[]): void => {
  assert.notEqual(flow(...args).status, 0, `flow.sh ${args.join(" ")} exited 0`);
};

type Ran = { code: number | null; stdout: string; stderr: string };

const runAsync = (...args: readonly string[]) =>
  new Promise<Ran>((resolve, reject) => {
    const child = spawn("bash", [script, ...args], { cwd: main, env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });

const setup = (): void => {
  rmSync(work, { recursive: true, force: true });
  git(tmp, "init", "-q", work);
  write(join(main, "a"), "one\n");
  write(join(main, "c"), "cee\n");
  git(main, "add", "a", "c");
  git(main, "commit", "-q", "-m", "init");
  appendFileSync(
    join(main, ".git/info/exclude"),
    "work-reports/\n.claude/worktrees/\nnode_modules/\n",
  );
  git(main, "worktree", "add", "-q", "--detach", ".claude/worktrees/run-test", "HEAD");
};

const dirty = (): void => {
  write(join(wt, "a"), "two\n");
  write(join(wt, "c"), "staged\n");
  git(wt, "add", "c");
  write(join(wt, "b"), "new\n");
  write(join(wt, "node_modules/x"), "dep\n");
};

const probe = (seat: string, name: string, text: string): string => {
  const dir = join(report, "seats", seat, name);
  write(join(dir, "run.sh"), `${text}\n`);
  return dir;
};

const begun = (...args: readonly string[]): string => flowJson("begin", wt, ...args).workdir;

const mergeInProgress = (): string => {
  write(join(wt, "a"), "side\n");
  git(wt, "commit", "-q", "-am", "side");
  const beforeMerge = captured(git(wt, "rev-parse", "HEAD"));
  git(main, "branch", "other", "HEAD");
  git(main, "checkout", "-q", "other");
  write(join(main, "a"), "other\n");
  git(main, "commit", "-q", "-am", "other");
  assert.notEqual(gitResult(wt, "merge", "-q", "other").status, 0, "the merge did not conflict");
  assert.ok(existsSync(join(main, ".git/worktrees/run-test/MERGE_HEAD")), "no merge in progress");
  return beforeMerge;
};

test("run puts the seat at a snapshot holding the changed and the untracked files and no ignored one, and leaves the run's status and index as they were", () => {
  setup();
  dirty();
  const statusBefore = git(wt, "status", "--porcelain");
  const indexBefore = git(wt, "diff", "--cached");
  const p = probe("a", "list", "cat a c b; ls node_modules 2>&1 || true; git rev-parse HEAD");
  const out = flowJson("run", wt, "a", p);
  assert.equal(out.status, "ran");
  assert.equal(out.seat, "a");
  assert.equal(out.exit, 0);
  const snap: string = out.snapshot;
  assert.equal(git(wt, "rev-parse", `${snap}^`), git(wt, "rev-parse", "HEAD"));
  assert.equal(captured(git(a, "rev-parse", "HEAD")), snap);
  assert.equal(gitResult(a, "symbolic-ref", "-q", "HEAD").stdout, "");
  assert.equal(captured(read(join(a, "a"))), "two");
  assert.equal(captured(read(join(a, "c"))), "staged");
  assert.equal(captured(read(join(a, "b"))), "new");
  assert.ok(!existsSync(join(a, "node_modules")), "seat a holds an ignored file");
  assert.deepEqual(lines(out.output).slice(0, 3), ["two", "staged", "new"]);
  assert.equal(git(wt, "status", "--porcelain"), statusBefore);
  assert.equal(git(wt, "diff", "--cached"), indexBefore);
  assert.ok(!existsSync(b), "run created seat b");
});

test("run copies the probe's tree over the snapshot, runs run.sh at the seat's root, and prints its exit and its last 40 lines", () => {
  setup();
  dirty();
  const p = probe(
    "b",
    "tree",
    "pwd; cat t/new.test; for i in $(seq 1 50); do echo line$i; done; exit 3",
  );
  write(join(p, "tree/t/new.test"), "fixture\n");
  const out = flowJson("run", wt, "b", p);
  assert.equal(out.exit, 3);
  assert.equal(out.lines, 52);
  assert.equal(lines(out.output).length, 40);
  assert.equal(lines(out.output).at(-1), "line50");
  assert.equal(captured(read(join(b, "t/new.test"))), "fixture");
  assert.ok(!existsSync(join(wt, "t")), "the probe's tree reached the run");
  const where = flowJson("run", wt, "b", probe("b", "where", "pwd"));
  assert.equal(captured(where.output), b);
});

test("a second run removes what the first left untracked, restores a tracked edit, and keeps ignored files", () => {
  setup();
  dirty();
  printed(
    flow(
      "run",
      wt,
      "a",
      probe(
        "a",
        "first",
        "echo repro > repro.sh; mkdir -p node_modules; echo dep > node_modules/y; echo edit > a; echo mine > d",
      ),
    ),
  );
  write(join(wt, "a"), "three\n");
  write(join(wt, "d"), "fromrun\n");
  const out = flowJson("run", wt, "a", probe("a", "second", "cat a d"));
  assert.deepEqual(lines(out.output), ["three", "fromrun"]);
  assert.ok(!existsSync(join(a, "repro.sh")), "second run kept an untracked file of the first");
  assert.equal(captured(read(join(a, "node_modules/y"))), "dep");
  assert.equal(captured(read(join(a, "a"))), "three");
  assert.equal(captured(read(join(a, "d"))), "fromrun");
});

test("a new seat worktree holds the listed ignored files", () => {
  setup();
  appendFileSync(join(main, ".git/info/exclude"), ".env.local\n.env.other\n.worktreeinclude\n");
  write(join(main, ".env.local"), "secret\n");
  write(join(main, ".env.other"), "other\n");
  write(join(main, ".worktreeinclude"), "/.env.local\n");
  const out = flowJson("run", wt, "a", probe("a", "env", "cat .env.local; git status --porcelain"));
  assert.equal(out.exit, 0);
  assert.equal(captured(out.output), "secret");
  assert.ok(!existsSync(join(a, ".env.other")), "seat a holds an unlisted file");
});

test("the same tree gives the same snapshot", () => {
  setup();
  dirty();
  const p = probe("a", "same", "true");
  const first = flowJson("run", wt, "a", p).snapshot;
  const second = flowJson("run", wt, "b", p).snapshot;
  assert.equal(first, second);
});

test("run after the working tree changed runs on the new tree", () => {
  setup();
  dirty();
  const p = probe("a", "tree", "cat a");
  const out = flowJson("run", wt, "a", p);
  assert.equal(captured(out.output), "two");
  write(join(wt, "a"), "four\n");
  const changed = flowJson("run", wt, "a", p);
  assert.equal(captured(changed.output), "four");
  assert.notEqual(changed.snapshot, out.snapshot);
});

test("run during a merge in progress leaves MERGE_HEAD in place", () => {
  setup();
  mergeInProgress();
  const out = flowJson(
    "run",
    wt,
    "a",
    probe("a", "merge", "git diff --name-only --diff-filter=U; head -1 a"),
  );
  assert.equal(out.status, "ran");
  assert.ok(existsSync(join(main, ".git/worktrees/run-test/MERGE_HEAD")), "run removed MERGE_HEAD");
  assert.notEqual(git(wt, "diff", "--name-only", "--diff-filter=U"), "");
});

test("run stops with outside, no-script, busy and unknown, a lock file nobody holds is no lock, and a run that ended frees its seat", async () => {
  setup();
  dirty();
  const p = probe("a", "ok", "true");
  assert.equal(flowJson("run", wt, "a", tmp).reason, "outside");
  mkdirSync(join(wt, "work-reports-x"), { recursive: true });
  assert.equal(flowJson("run", wt, "a", join(wt, "work-reports-x")).reason, "outside");
  mkdirSync(join(report, "seats/a/empty"), { recursive: true });
  assert.equal(flowJson("run", wt, "a", join(report, "seats/a/empty")).reason, "no-script");
  write(join(main, ".git/panel-run-test-a.lock"), "stale\n");
  assert.equal(flowJson("run", wt, "a", p).status, "ran");
  const marker = join(tmp, "held");
  const slow = runAsync("run", wt, "a", probe("a", "slow", `touch '${marker}'; sleep 3`));
  for (let poll = 0; poll < 20; poll += 1) {
    if (existsSync(marker)) {
      break;
    }
    await setTimeout(200);
  }
  assert.equal(flowJson("run", wt, "a", p).reason, "busy");
  assert.equal(flowJson("run", wt, "b", p).status, "ran");
  const held = await slow;
  assert.equal(held.code, 0, held.stderr);
  assert.equal(JSON.parse(held.stdout).status, "ran");
  assert.equal(flowJson("run", wt, "a", probe("a", "fails", "exit 7")).exit, 7);
  assert.equal(flowJson("run", wt, "a", p).status, "ran");
  assert.equal(flowJson("run", tmp, "a", p).reason, "unknown");
  notZero("run", wt, "c", p);
});

test("a seat whose .git is gone is refused, and run leaves the main clone alone", () => {
  setup();
  dirty();
  const p = probe("a", "ok", "true");
  printed(flow("run", wt, "a", p));
  rmSync(join(a, ".git"));
  write(join(main, "a"), "mainedit\n");
  const branchBefore = git(main, "rev-parse", "--abbrev-ref", "HEAD");
  notZero("run", wt, "a", p);
  assert.equal(git(main, "rev-parse", "--abbrev-ref", "HEAD"), branchBefore);
  assert.equal(captured(read(join(main, "a"))), "mainedit");
});

const noSeatRegistered = (): void => {
  assert.ok(
    !git(main, "worktree", "list", "--porcelain").includes("review-"),
    "close left a registered seat",
  );
};

test("close removes seats a and b, and prints an empty list when there is none", () => {
  setup();
  const none = flowJson("close", wt);
  assert.equal(none.status, "closed");
  assert.deepEqual(none.removed, []);
  dirty();
  const p = probe("a", "ok", "echo repro > repro.sh");
  printed(flow("run", wt, "a", p));
  printed(flow("run", wt, "b", p));
  assert.deepEqual(flowJson("close", wt).removed, [a, b]);
  assert.ok(!existsSync(a) && !existsSync(b), "close left a seat");
  noSeatRegistered();
  assert.ok(isDir(wt), "close removed the run's worktree");
});

test("close removes a lone seat a", () => {
  setup();
  dirty();
  printed(flow("run", wt, "a", probe("a", "ok", "true")));
  assert.deepEqual(flowJson("close", wt).removed, [a]);
  assert.ok(!existsSync(a), "close left seat a");
  noSeatRegistered();
});

test("close after the run's worktree is gone still removes the seats", () => {
  setup();
  const p = probe("a", "ok", "true");
  printed(flow("run", wt, "a", p));
  printed(flow("run", wt, "b", p));
  git(main, "worktree", "remove", "--force", wt);
  assert.deepEqual(flowJson("close", wt).removed, [a, b]);
  assert.ok(!existsSync(a) && !existsSync(b), "close after gone left a seat");
  noSeatRegistered();
});

test("a trailing slash in <WT> changes nothing, a relative <WT> and a wrong argument count are refused", () => {
  setup();
  dirty();
  const p = probe("a", "ok", "true");
  assert.equal(flowJson("run", `${wt}/`, "a", p).status, "ran");
  assert.ok(isDir(a) && !existsSync(join(wt, "review--a")), "a seat landed in the wrong place");
  assert.deepEqual(flowJson("close", `${wt}/`).removed, [a]);
  notZero("run", "relative/wt", "a", p);
  notZero("open", wt);
  notZero("run", wt, "a");
});

test("a finding end to end: a probe that fails, the same line again, a change in the run's worktree, the same line passing", () => {
  setup();
  dirty();
  const p = probe("a", "finding", 'test "$(cat a)" = fixed || { echo "a is $(cat a)"; exit 1; }');
  const out = flowJson("run", wt, "a", p);
  assert.equal(out.exit, 1);
  assert.equal(captured(out.output), "a is two");
  const again = flowJson("run", wt, "a", p);
  assert.deepEqual([again.exit, again.output], [out.exit, out.output]);
  write(join(wt, "a"), "fixed\n");
  assert.equal(flowJson("run", wt, "a", p).exit, 0);
});

test("two runs of one seat started together give one ran and one busy, eight times", async () => {
  setup();
  dirty();
  const slow = probe("a", "slow", "sleep 1");
  printed(flow("run", wt, "a", slow));
  for (let trial = 1; trial <= 8; trial += 1) {
    const both = await Promise.all([
      runAsync("run", wt, "a", slow),
      runAsync("run", wt, "a", slow),
    ]);
    const statuses = both.map((one) => {
      assert.equal(one.code, 0, `trial ${trial}: ${one.stdout}${one.stderr}`);
      assert.equal(one.stderr, "", `trial ${trial}`);
      const d = JSON.parse(one.stdout);
      return `${d.status}:${d.reason ?? ""}`;
    });
    assert.ok(
      ["ran: stop:busy", "stop:busy ran:"].includes(statuses.join(" ")),
      `trial ${trial}: two runs of one seat at once gave: ${statuses.join(" ")}`,
    );
  }
});

test("begin makes the work directory with review/, seats/ and run.json, and status reads back what begin wrote", () => {
  setup();
  const out = flowJson("begin", wt, "--level", "high", "--source", "default");
  assert.equal(out.status, "ok");
  const start: string = out.start;
  assert.equal(start, captured(git(wt, "rev-parse", "HEAD")));
  const workdir: string = out.workdir;
  const prefix = `${wt}/work-reports/`;
  assert.ok(workdir.startsWith(prefix), workdir);
  assert.match(
    workdir.slice(prefix.length),
    new RegExp(`^\\d{4}-\\d{2}-\\d{2}-\\d{4}-${start.slice(0, 7)}$`),
  );
  assert.ok(
    isDir(join(workdir, "review")) &&
      isDir(join(workdir, "seats")) &&
      existsSync(join(workdir, "run.json")),
    "begin did not make review/, seats/ and run.json",
  );
  const d = flowJson("status", wt);
  assert.deepEqual(
    [d.status, d.start, d.workdir, d.level, d.source, d.issue, d.parent],
    ["ok", start, workdir, "high", "default", null, null],
  );
});

test("begin records the level and source it is given, unchanged, in run.json and in status", () => {
  setup();
  for (const [level, source] of [
    ["standard", "override"],
    ["high", "file"],
  ] as const) {
    const out = flowJson("begin", wt, "--level", level, "--source", source);
    assert.deepEqual([out.level, out.source], [level, source]);
    const runJson = JSON.parse(read(join(out.workdir, "run.json")));
    assert.deepEqual([runJson.level, runJson.source], [level, source]);
    const d = flowJson("status", wt);
    assert.deepEqual([d.level, d.source], [level, source]);
  }
});

test("begin writes --issue and --parent to run.json, and refuses a missing --level or --source, --level 4, --level 2, --source other, --issue without --parent and a relative <WT>", () => {
  setup();
  printed(
    flow("begin", wt, "--level", "high", "--source", "default", "--issue", "12", "--parent", "88"),
  );
  const d = flowJson("status", wt);
  assert.deepEqual([d.issue, d.parent], [12, 88]);
  refused("begin", wt, "--source", "default");
  refused("begin", wt, "--level", "high");
  refused("begin", wt, "--level", "4", "--source", "default");
  refused("begin", wt, "--level", "2", "--source", "default");
  refused("begin", wt, "--level", "high", "--source", "other");
  refused("begin", wt, "--level", "high", "--source", "default", "--issue", "12");
  refused("begin", "relative/wt", "--level", "high", "--source", "default");
});

test("begin stops with not-ignored and writes nothing when work-reports/ is not ignored", () => {
  setup();
  const exclude = join(main, ".git/info/exclude");
  const kept = lines(read(exclude)).filter((line) => line !== "work-reports/");
  writeFileSync(exclude, kept.map((line) => `${line}\n`).join(""));
  assert.equal(
    flowJson("begin", wt, "--level", "high", "--source", "default").reason,
    "not-ignored",
  );
  assert.ok(
    !existsSync(join(wt, "work-reports")),
    "begin wrote under work-reports/ when it is not ignored",
  );
});

test("begin during a merge in progress takes the commit the merge started on", () => {
  setup();
  const beforeMerge = mergeInProgress();
  assert.equal(flowJson("begin", wt, "--level", "high", "--source", "default").start, beforeMerge);
  assert.ok(
    existsSync(join(main, ".git/worktrees/run-test/MERGE_HEAD")),
    "begin removed MERGE_HEAD",
  );
});

test("a second begin on the same commit in the same minute makes <name>-2, and status reads the second", () => {
  let first = "";
  let second = "";
  let runJsonBefore = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    setup();
    first = begun("--level", "high", "--source", "default");
    runJsonBefore = read(join(first, "run.json"));
    second = begun("--level", "standard", "--source", "override");
    if (second === `${first}-2`) {
      break;
    }
    assert.notEqual(attempt, 3, `a second begin made ${second}, not ${first}-2`);
  }
  assert.equal(read(join(first, "run.json")), runJsonBefore);
  assert.equal(flowJson("status", wt).workdir, second);
});

test("status reads the run.json written last, past a later name and past directories with no run.json", () => {
  setup();
  const workdir = begun("--level", "high", "--source", "default");
  const later = join(wt, "work-reports/9999-12-31-2359-fffffff");
  mkdirSync(later, { recursive: true });
  mkdirSync(join(wt, "work-reports/9999-12-31-2359-design"), { recursive: true });
  write(
    join(later, "run.json"),
    '{"start": "fffffff", "level": "standard", "source": "file", "issue": null, "parent": null}\n',
  );
  const t = new Date(2000, 0, 1, 0, 0);
  utimesSync(join(later, "run.json"), t, t);
  assert.equal(flowJson("status", wt).workdir, workdir);
});

test("status stops with no-run when no directory holds a run.json, and begin stops with unknown outside a worktree", () => {
  setup();
  assert.equal(flowJson("status", wt).reason, "no-run");
  assert.equal(flowJson("begin", tmp, "--level", "high", "--source", "default").reason, "unknown");
});

const CMD =
  "`/abs/skills/workflow/scripts/flow.sh run /abs/wt a /abs/wt/work-reports/2026-09-19-1346-a1b2c3d/seats/a/probe`";
const bareCMD = CMD.replaceAll("`", "");

const passes = (path: string, kind: string): void => {
  const d = flowJson("lint", path);
  assert.deepEqual([d.status, d.ok, d.kind, d.reasons], ["ok", true, kind, []], `lint ${path}`);
};

const gives = (path: string, reasons: readonly string[]): void => {
  const d = flowJson("lint", path);
  assert.deepEqual([d.ok, d.reasons], [false, reasons], `lint ${path}`);
};

type Pair = readonly [string, string];

const swap = (path: string, ...pairs: readonly Pair[]): void => {
  const text = pairs.reduce((acc, [old, replacement]) => {
    const parts = acc.split(old);
    assert.equal(parts.length, 2, `${JSON.stringify(old)} is not in ${path} once`);
    return parts.join(replacement);
  }, read(path));
  writeFileSync(path, text);
};

const breaks = (file: string, reason: string, ...pairs: readonly Pair[]): void => {
  const good = captured(read(file));
  swap(file, ...pairs);
  const d = flowJson("lint", file);
  assert.deepEqual(
    [d.ok, d.reasons],
    [false, [reason]],
    `lint ${file} did not give only ${reason}`,
  );
  writeFileSync(file, `${good}\n`);
  passes(file, d.kind);
};

const evidenceFile = (path: string): void => {
  write(
    path,
    `# Evidence

## Acceptance criteria

- the tests pass
  - ran: bash tests/run.sh
  - saw: ok
- the browser flow works
  - not run: no browser here

## Flows

- sign out, then sign in again
  - ran: bash tests/signin.sh
  - saw: 3 passed

## Reproduced first

- ran: bash tests/retry.sh before the fix
  - saw: FAIL stops at zero attempts
`,
  );
};

const seatFile = (path: string, findings?: "none" | "one", extra = ""): void => {
  const body =
    findings === "none"
      ? "None."
      : `### 1. the cache keeps a stale value\n\nCommand: ${CMD}\nPrinted: exit 1, stale\nRequired: the value is fresh`;
  write(path, `# Seat\n\n## Findings\n\n${body}\n\n## Not run\n\nNone.\n${extra}\n`);
};

const WALK = `
## Walk

- the tests pass
  - ran: bash tests/run.sh
  - saw: ok
- the browser flow works
  - not run: no browser here`;

const finding = (id: string): string =>
  `### ${id} the cache keeps a stale value\n\nFound by: a, b\nCommand: ${CMD}\nPrinted: exit 1, stale\nRequired: the value is fresh\nBreaks: the second sign-in shows the old value\n`;

const twoFindings = (first: string, second: string): string =>
  captured(`${finding(first)}\n${finding(second)}`);

const roundFile = (path: string, earlier: string, fresh: string, verdict: string): void => {
  write(
    path,
    `# Round\n\nSeats: a on opus, b on fable\n\n## Earlier findings\n\n${earlier}\n\n## New findings\n\n${fresh}\n\n## Dropped\n\n- a: none\n- b: none\n\n## Not run\n\nNone.\n\n## Verdict\n\n${verdict}\n`,
  );
};

const replyFile = (path: string, ...answers: readonly string[]): void => {
  write(path, `# Reply\n\n${answers.map((line) => `${line}\n`).join("")}`);
};

const FIXED = `fixed: the cache is cleared on sign-out. ran: ${CMD}; saw: exit 0`;

test("the examples in review-files.md pass lint, and round writes the round example from the draft and judgement examples", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  const R = join(W, "review");
  roundFile(
    join(R, "task-2-round-1.md"),
    "None.",
    twoFindings("R1.1", "R1.2"),
    "changes-requested",
  );
  const judgement = join(W, "drafts/task-2-round-2-judgement.md");
  const names = new Map([
    ["# Task 2, evidence", join(R, "task-2-evidence.md")],
    ["# Task 2, round 1, seat a", join(R, "task-2-round-1-a.md")],
    ["# task-2, round 2, draft", join(W, "drafts/task-2-round-2.md")],
    ["Seats: a on opus, b on fable", judgement],
  ]);
  const blocks = new Map(
    [...read(reviewFiles).matchAll(/^```markdown\n([\s\S]*?)^```$/gm)].map(
      ([, block = ""]) => [block.split("\n", 1)[0] ?? "", block] as const,
    ),
  );
  for (const [first, path] of names) {
    write(path, blocks.get(first) ?? "");
  }
  const d = flowJson("round", wt, "task-2", judgement);
  assert.deepEqual(
    [d.status, d.verdict, d.open],
    ["ok", "changes-requested", ["R1.2", "R2.1"]],
    JSON.stringify(d),
  );
  assert.equal(read(d.round), blocks.get("# task-2, round 2"));
  write(join(R, "task-2-round-2-reply.md"), blocks.get("# Task 2, round 2, reply") ?? "");
  passes(join(R, "task-2-evidence.md"), "evidence");
  passes(join(R, "task-2-round-1-a.md"), "seat");
  copyFileSync(join(R, "task-2-evidence.md"), join(R, "task-2-round-2-evidence.md"));
  passes(join(R, "task-2-round-2-reply.md"), "reply");
});

test("lint names each reason of a seat file", () => {
  const D = join(tmp, "lint/seat/review");
  const one = join(D, "task-5-round-1-a.md");
  const none = join(D, "task-5-round-1-b.md");
  const walked = join(D, "integration-round-1-a.md");
  seatFile(one);
  passes(one, "seat");
  seatFile(none, "none");
  passes(none, "seat");
  seatFile(walked, "one", WALK);
  passes(walked, "seat");
  breaks(one, "sections", ["## Not run", "## Skipped"]);
  breaks(one, "sections", ["# Seat", "Seat"]);
  breaks(none, "sections", ["## Findings\n\nNone.", "## Findings\n\nnone"]);
  breaks(one, "sections", [
    "None.",
    "None.\n\n## Walk\n\n- the tests pass\n  - not run: no browser",
  ]);
  breaks(walked, "sections", ["## Walk", "## Walking"]);
  breaks(one, "id", ["### 1. ", "### 2. "]);
  breaks(one, "id", ["### 1. ", "### F1. "]);
  breaks(one, "finding", ["Required: the value is fresh", ""]);
  breaks(one, "finding", ["Printed: exit 1, stale", "Printed: exit 1, stale\nPrinted: again"]);
  breaks(one, "command", ["/abs/wt a", "$(pwd) a"]);
  breaks(one, "command", [CMD, bareCMD]);
  breaks(one, "command", ["/abs/wt a /abs/wt/work-reports", "/abs/wt a /abs/other/work-reports"]);
  breaks(one, "command", ["/seats/a/probe", "/seats/a/probe extra"]);
  breaks(walked, "entry", ["  - saw: ok\n", ""]);
  breaks(walked, "entry", ["  - not run: no browser here", "  - skipped"]);
});

test("lint names each reason of a reply", () => {
  const D = join(tmp, "lint/reply/review");
  const first = join(D, "task-3-round-1-reply.md");
  const second = join(D, "task-3-round-2-reply.md");
  roundFile(
    join(D, "task-3-round-1.md"),
    "None.",
    twoFindings("R1.1", "R1.2"),
    "changes-requested",
  );
  roundFile(
    join(D, "task-3-round-2.md"),
    `- R1.1 resolved\n- R1.2 stands again: ran: ${CMD}; saw: exit 1; the value still stays`,
    "None.",
    "changes-requested",
  );
  evidenceFile(join(D, "task-3-round-1-evidence.md"));
  evidenceFile(join(D, "task-3-round-2-evidence.md"));
  replyFile(
    first,
    `- R1.1 ${FIXED}`,
    "  the second line of the answer",
    "- R1.2 disagree: the value is meant to stay",
  );
  replyFile(
    second,
    `- R1.2 fixed: assumed: both fixes took the value to come from the cache; ran: ${CMD}; saw: exit 0; the store is cleared too`,
  );
  passes(first, "reply");
  passes(second, "reply");
  breaks(first, "sections", [
    "the value is meant to stay",
    "the value is meant to stay\n\n## Notes",
  ]);
  breaks(first, "sections", ["# Reply", "Reply"]);
  replyFile(join(D, "task-3-round-9-reply.md"), "- R9.1 disagree: there is no such round");
  gives(join(D, "task-3-round-9-reply.md"), ["no-round"]);
  breaks(first, "line", [
    "- R1.2 disagree:",
    "R1.3 disagree: a line with no dash\n- R1.2 disagree:",
  ]);
  breaks(first, "line", ["- R1.2 disagree:", "- R1.3 rejected: no such answer\n- R1.2 disagree:"]);
  breaks(first, "line", ["# Reply\n", "# Reply\n  an indented line under no answer\n"]);
  breaks(first, "missing", ["- R1.2 disagree:", "- R1.3 disagree:"]);
  breaks(second, "missing", ["- R1.2 fixed:", "- R1.1 fixed:"]);
  breaks(first, "ran", [`ran: ${CMD}; saw: exit 0`, "checked it"]);
  breaks(first, "ran", ["; saw: exit 0", ""]);
  breaks(
    first,
    "ran",
    [`ran: ${CMD}; saw: exit 0`, "checked it"],
    ["- R1.2 disagree:", "- R1.1 disagree: the rest of it\n- R1.2 disagree:"],
  );
  breaks(second, "assumed", ["assumed: both fixes took the value to come from the cache; ", ""]);
  rmSync(join(D, "task-3-round-1-evidence.md"));
  gives(first, ["no-evidence"]);
  replyFile(
    first,
    "- R1.1 disagree: the value is meant to stay",
    "- R1.2 disagree: the value is meant to stay",
  );
  passes(first, "reply");
});

test("lint names each reason of an evidence file", () => {
  const D = join(tmp, "lint/evidence/review");
  const file = join(D, "task-6-evidence.md");
  evidenceFile(file);
  evidenceFile(join(D, "merge-round-2-evidence.md"));
  passes(file, "evidence");
  passes(join(D, "merge-round-2-evidence.md"), "evidence");
  breaks(file, "sections", ["## Flows", "## Shared state"]);
  breaks(file, "sections", ["## Acceptance criteria", "## Criteria"]);
  breaks(file, "sections", [
    "## Reproduced first\n\n- ran: bash tests/retry.sh before the fix\n  - saw: FAIL stops at zero attempts",
    "## Reproduced first",
  ]);
  breaks(file, "sections", ["## Flows", "## Reproduced first\n\nNone.\n\n## Flows"]);
  breaks(file, "entry", ["  - ran: bash tests/run.sh\n", ""]);
  breaks(file, "entry", ["  - not run: no browser here", "  - skipped: no browser here"]);
  breaks(file, "entry", ["  - saw: 3 passed", "  saw: 3 passed"]);
  breaks(file, "entry", [
    "- ran: bash tests/retry.sh before the fix",
    "- bash tests/retry.sh before the fix",
  ]);
  breaks(file, "entry", ["  - saw: FAIL stops at zero attempts", "  - ran: again"]);
});

test("lint passes each file of a two-round review in the order it is written", () => {
  const D = join(tmp, "lint/flow/review");
  evidenceFile(join(D, "task-1-evidence.md"));
  passes(join(D, "task-1-evidence.md"), "evidence");
  seatFile(join(D, "task-1-round-1-a.md"));
  passes(join(D, "task-1-round-1-a.md"), "seat");
  seatFile(join(D, "task-1-round-1-b.md"), "none");
  passes(join(D, "task-1-round-1-b.md"), "seat");
  roundFile(join(D, "task-1-round-1.md"), "None.", captured(finding("R1.1")), "changes-requested");
  evidenceFile(join(D, "task-1-round-1-evidence.md"));
  passes(join(D, "task-1-round-1-evidence.md"), "evidence");
  replyFile(join(D, "task-1-round-1-reply.md"), `- R1.1 ${FIXED}`);
  passes(join(D, "task-1-round-1-reply.md"), "reply");
  seatFile(join(D, "task-1-round-2-a.md"), "none");
  passes(join(D, "task-1-round-2-a.md"), "seat");
  seatFile(join(D, "task-1-round-2-b.md"), "none");
  passes(join(D, "task-1-round-2-b.md"), "seat");
});

test("lint stops on a missing file and names a file outside Names", () => {
  const D = join(tmp, "lint/names/review");
  const missing = flowJson("lint", join(D, "task-1-evidence.md"));
  assert.deepEqual([missing.status, missing.reason], ["stop", "no-file"]);
  mkdirSync(join(D, "task-1-round-1.md"), { recursive: true });
  const directory = flowJson("lint", join(D, "task-1-round-1.md"));
  assert.deepEqual([directory.status, directory.reason], ["stop", "no-file"]);
  write(join(D, "notes.md"), "# Notes\n");
  const notes = flowJson("lint", join(D, "notes.md"));
  assert.deepEqual(
    [notes.status, notes.ok, notes.kind, notes.reasons],
    ["ok", false, null, ["name"]],
  );
  evidenceFile(join(D, "integration-evidence.md"));
  gives(join(D, "integration-evidence.md"), ["name"]);
  roundFile(join(D, "task-2-round-1.md"), "None.", captured(finding("R1.1")), "changes-requested");
  const round = flowJson("lint", join(D, "task-2-round-1.md"));
  assert.deepEqual(
    [round.status, round.ok, round.kind, round.reasons],
    ["ok", false, null, ["name"]],
  );
  refused("lint");
  refused("lint", "relative.md");
  refused("lint", join(D, "notes.md"), join(D, "notes.md"));
});

const scoped = (scope: string) => flowJson("status", wt, scope);

const noSuchScope = (...args: readonly string[]): void => {
  const result = flow(...args);
  assert.notEqual(result.status, 0, `flow.sh ${args.join(" ")} exited 0`);
  assert.equal(
    captured(result.stdout + result.stderr),
    `flow: no such scope: ${args.at(-1) ?? ""}`,
  );
};

test("status reports round, cap, verdict and open for a scope", () => {
  setup();
  const R = join(begun("--level", "high", "--source", "default"), "review");
  assert.deepEqual(Object.keys(flowJson("status", wt)), [
    "status",
    "start",
    "workdir",
    "level",
    "source",
    "issue",
    "parent",
  ]);
  let d = scoped("task-1");
  assert.deepEqual(Object.keys(d), [
    "status",
    "start",
    "workdir",
    "level",
    "source",
    "issue",
    "parent",
    "scope",
    "round",
    "cap",
    "verdict",
    "open",
  ]);
  assert.deepEqual([d.scope, d.round, d.cap, d.verdict, d.open], ["task-1", 1, false, null, []]);
  assert.deepEqual(
    [d.start, d.level, d.source],
    [captured(git(wt, "rev-parse", "HEAD")), "high", "default"],
  );
  roundFile(
    join(R, "task-1-round-1.md"),
    "None.",
    `${captured(finding("R1.1"))}\n${captured(finding("R1.2"))}`,
    "changes-requested",
  );
  d = scoped("task-1");
  assert.deepEqual(
    [d.round, d.cap, d.verdict, d.open],
    [
      2,
      false,
      "changes-requested",
      [
        { id: "R1.1", stood: 0, reply: null },
        { id: "R1.2", stood: 0, reply: null },
      ],
    ],
  );
  replyFile(
    join(R, "task-1-round-1-reply.md"),
    `- R1.1 ${FIXED}`,
    "- R1.2 disagree: the value is meant to stay",
  );
  assert.deepEqual(scoped("task-1").open, [
    { id: "R1.1", stood: 0, reply: "fixed" },
    { id: "R1.2", stood: 0, reply: "disagree" },
  ]);
  roundFile(
    join(R, "task-1-round-2.md"),
    `- R1.1 resolved\n- R1.2 stands: ran: ${CMD}; saw: exit 1; the value has to go.`,
    "None.",
    "changes-requested",
  );
  d = scoped("task-1");
  assert.deepEqual(
    [d.round, d.verdict, d.open],
    [3, "changes-requested", [{ id: "R1.2", stood: 1, reply: null }]],
  );
  replyFile(join(R, "task-1-round-2-reply.md"), "- R1.2 disagree: the value is meant to stay");
  roundFile(
    join(R, "task-1-round-3.md"),
    `- R1.2 stands again: ran: ${CMD}; saw: exit 1; the value still has to go.`,
    "None.",
    "changes-requested",
  );
  d = scoped("task-1");
  assert.deepEqual([d.round, d.cap, d.open], [4, false, [{ id: "R1.2", stood: 2, reply: null }]]);
  for (const bad of ["task-x", "task-0", "review"]) {
    noSuchScope("status", wt, bad);
  }
  refused("status", wt, "task-1", "task-2");
  refused("status", "relative/wt", "task-1");
});

const rounds = (R: string, scope: string, from: number, to: number): void => {
  for (let r = from; r <= to; r += 1) {
    roundFile(
      join(R, `${scope}-round-${r}.md`),
      r === 1 ? "None." : `- R${r - 1}.1 resolved`,
      captured(finding(`R${r}.1`)),
      "changes-requested",
    );
  }
};

test("status counts the cap the same for task, integration and merge", () => {
  setup();
  const R = join(begun("--level", "high", "--source", "default"), "review");
  for (const scope of ["task-1", "integration", "merge"]) {
    rounds(R, scope, 1, 4);
    let d = scoped(scope);
    assert.deepEqual([d.round, d.cap], [5, false], `${scope} cap after four rounds`);
    rounds(R, scope, 5, 5);
    d = scoped(scope);
    assert.deepEqual(
      [d.round, d.cap, d.verdict],
      [6, true, "changes-requested"],
      `${scope} cap after five rounds`,
    );
    rounds(R, scope, 6, 6);
    d = scoped(scope);
    assert.deepEqual([d.round, d.cap], [7, true], `${scope} cap after six rounds`);
    rmSync(join(R, `${scope}-round-6.md`));
    roundFile(join(R, `${scope}-round-5.md`), "- R4.1 resolved", "None.", "approve");
    d = scoped(scope);
    assert.deepEqual(
      [d.round, d.cap, d.verdict, d.open],
      [6, false, "approve", []],
      `${scope} cap when round 5 approves`,
    );
  }
  const d = scoped("task-2");
  assert.deepEqual([d.round, d.cap, d.verdict, d.open], [1, false, null, []]);
});

test("status refuses a bad scope before begin, and stops with no-run on a good one", () => {
  setup();
  assert.equal(flowJson("status", wt, "task-1").reason, "no-run");
  noSuchScope("status", wt, "task-x");
});

const ranLine = (seat: string, dir: string): string => `\`${script} run ${wt} ${seat} ${dir}\``;

const findingsFile = (path: string, ...pairs: readonly Pair[]): void => {
  const body = pairs
    .map(
      ([title, command], i) =>
        `### ${i + 1}. ${title}\n\nCommand: ${command}\nPrinted: exit 1\nRequired: the design holds\n\n`,
    )
    .join("");
  write(path, `# Seat\n\n## Findings\n\n${body === "" ? "None." : body}\n\n## Not run\n\nNone.\n`);
};

const verified = (scope: string) => flowJson("verify", wt, scope);

const orNone = (entries: readonly string[]): readonly string[] =>
  entries.length > 0 ? entries : ["None."];

const judgementOf = (draft: string): string => {
  const text = lines(read(draft));
  const kept = text.flatMap((line) => {
    const id = /^### (R\d+\.\d+) /.exec(line)?.[1];
    return id === undefined
      ? []
      : [`- ${id}`, "  Required: the design holds", "  Breaks: the flow fails"];
  });
  const stands = text.flatMap((line) => {
    const id = /^- (R\d+\.\d+) stands/.exec(line)?.[1];
    return id === undefined ? [] : [`- ${id} stands: it still fails`];
  });
  return [
    "Seats: a on opus, b on fable",
    "",
    "## Keep",
    "",
    ...orNone(kept),
    "",
    "## Drop",
    "",
    "None.",
    "",
    "## Earlier",
    "",
    ...orNone(stands),
    "",
    "## Not run",
    "",
    "None.",
    "",
  ].join("\n");
};

const judgementFile = (scope: string, text: string): string => {
  const { workdir, round } = scoped(scope);
  const path = join(workdir, "drafts", `${scope}-round-${round}-judgement.md`);
  write(path, text);
  return path;
};

const roundFromJudgement = (scope: string) => {
  const { workdir, round } = scoped(scope);
  const judgement = judgementOf(join(workdir, "drafts", `${scope}-round-${round}.md`));
  const d = flowJson("round", wt, scope, judgementFile(scope, judgement));
  assert.equal(d.status, "ok", JSON.stringify(d));
  return d;
};

test("verify sorts the findings of both seats by the probe's exit", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  const R = join(W, "review");
  const fails = probe(
    "a",
    "fails",
    "printf '%s\\n' 'the value is two' 'last `tick`' '' '   '; exit 1",
  );
  const later = probe("a", "later", "echo fine");
  const other = probe("b", "other", "echo b sees it; exit 2");
  findingsFile(
    join(R, "task-1-round-1-a.md"),
    ["the value is two", ranLine("a", fails)],
    ["the value is fine", ranLine("a", later)],
  );
  findingsFile(join(R, "task-1-round-1-b.md"), ["b sees it", ranLine("b", other)]);
  passes(join(R, "task-1-round-1-a.md"), "seat");
  passes(join(R, "task-1-round-1-b.md"), "seat");
  let d = verified("task-1");
  assert.deepEqual(
    [d.status, d.scope, d.round, d.draft, d.dropouts, d.earlier],
    ["ok", "task-1", 1, `${W}/drafts/task-1-round-1.md`, [], []],
  );
  assert.deepEqual(
    d.new.map((f: { id: string; seat: string; number: number; title: string; exit: number }) => [
      f.id,
      f.seat,
      f.number,
      f.title,
      f.exit,
    ]),
    [
      ["R1.1", "a", 1, "the value is two", 1],
      ["R1.2", "b", 1, "b sees it", 2],
    ],
  );
  assert.deepEqual(
    [d.new[0].command, lines(d.new[0].output).at(-1)],
    [`${script} run ${wt} a ${fails}`, "   "],
  );
  assert.deepEqual(
    d.dropped.map(
      (f: { seat: string; number: number; title: string; command: string; why: string }) => [
        f.seat,
        f.number,
        f.title,
        f.command,
        f.why,
      ],
    ),
    [["a", 2, "the value is fine", `${script} run ${wt} a ${later}`, "exit-0"]],
  );
  const draft = join(W, "drafts/task-1-round-1.md");
  assert.equal(
    read(draft),
    `# task-1, round 1, draft

## Earlier findings

None.

## New findings

### R1.1 the value is two

Found by: a
Command: ${ranLine("a", fails)}
Printed: exit 1, \`\` last \`tick\` \`\`

### R1.2 b sees it

Found by: b
Command: ${ranLine("b", other)}
Printed: exit 2, \`b sees it\`

## Dropped

- a: 1, the command exited 0, so the failure did not show (finding 2)
- b: none
`,
  );
  writeFileSync(join(later, "run.sh"), "echo now it fails; exit 1\n");
  d = verified("task-1");
  assert.deepEqual(
    [
      ...d.new.map((f: { id: string; seat: string; number: number }) => [f.id, f.seat, f.number]),
      d.dropped,
    ],
    [["R1.1", "a", 1], ["R1.2", "a", 2], ["R1.3", "b", 1], []],
  );
  assert.ok(hasLine(draft, "### R1.3 b sees it"), "the second verify did not overwrite the draft");
  assert.ok(hasLine(draft, "- a: none"), "the second verify kept the old dropped line");
  roundFromJudgement("task-1");
});

const ids = (findings: readonly { id: string }[]) => findings.map((f) => f.id);

test("verify lists a seat with no file as a dropout", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  const R = join(W, "review");
  findingsFile(join(R, "task-1-round-1-a.md"), [
    "the value is two",
    ranLine("a", probe("a", "fails", "echo two; exit 1")),
  ]);
  let d = verified("task-1");
  assert.deepEqual([d.dropouts, ids(d.new), d.dropped], [["b"], ["R1.1"], []]);
  assert.ok(hasLine(join(W, "drafts/task-1-round-1.md"), "- b: no seat file"));
  roundFromJudgement("task-1");
  d = verified("merge");
  assert.deepEqual(
    [d.scope, d.round, d.draft, d.dropouts, d.new, d.dropped],
    ["merge", 1, `${W}/drafts/merge-round-1.md`, ["a", "b"], [], []],
  );
  const mergeDraft = join(W, "drafts/merge-round-1.md");
  assert.equal(
    lines(excerpt(read(mergeDraft), /^## New findings/, /^## Dropped/)).filter(
      (line) => line === "None.",
    ).length,
    1,
  );
  assert.ok(hasLine(mergeDraft, "- a: no seat file") && hasLine(mergeDraft, "- b: no seat file"));
});

test("verify at standard reads seat a alone", () => {
  setup();
  const W = begun("--level", "standard", "--source", "default");
  const R = join(W, "review");
  findingsFile(join(R, "task-1-round-1-a.md"), [
    "the value is two",
    ranLine("a", probe("a", "fails", "echo two; exit 1")),
  ]);
  const d = verified("task-1");
  assert.deepEqual([d.dropouts, ids(d.new), d.dropped], [[], ["R1.1"], []]);
  assert.equal(
    excerpt(read(join(W, "drafts/task-1-round-1.md")), /^## Dropped/),
    "## Dropped\n\n- a: none",
  );
  roundFromJudgement("task-1");
  assert.deepEqual(verified("merge").dropouts, ["a"]);
  assert.ok(
    !lines(read(join(W, "drafts/merge-round-1.md"))).some((line) => line.startsWith("- b:")),
    "the merge draft at standard names seat b",
  );
});

test("verify drops a command that cannot be run again", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  const R = join(W, "review");
  const empty = join(report, "seats/a/empty");
  mkdirSync(empty, { recursive: true });
  const bare = `${script} run ${wt} a ${probe("a", "bare", "exit 1")}`;
  findingsFile(
    join(R, "task-1-round-1-a.md"),
    ["no script", ranLine("a", empty)],
    ["no backticks", bare],
    ["it fails", ranLine("a", probe("a", "fails", "echo two; exit 1"))],
    ["no script again", ranLine("a", empty)],
  );
  const d = verified("task-1");
  assert.deepEqual(
    d.dropped.map((f: { number: number; command: string; why: string }) => [
      f.number,
      f.command,
      f.why,
    ]),
    [
      [1, `${script} run ${wt} a ${empty}`, "no-script"],
      [2, bare, "command"],
      [4, `${script} run ${wt} a ${empty}`, "no-script"],
    ],
  );
  assert.deepEqual(
    d.new.map((f: { id: string; number: number }) => [f.id, f.number]),
    [["R1.1", 3]],
  );
  assert.equal(
    excerpt(read(join(W, "drafts/task-1-round-1.md")), /^## Dropped/),
    "## Dropped\n\n- a: 2, the command could not be run again, no-script (findings 1, 4)\n- a: 1, the command could not be run again, command (finding 2)\n- b: no seat file",
  );
  roundFromJudgement("task-1");
});

test("verify marks earlier findings resolved, stands and stands again", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  const R = join(W, "review");
  const fixme = probe("a", "fixme", 'test "$(cat a)" = fixed || { echo "a is $(cat a)"; exit 1; }');
  const still = probe("a", "still", "echo still broken; exit 1");
  const meant = probe("a", "meant", "echo meant to be; exit 1");
  findingsFile(
    join(R, "task-1-round-1-a.md"),
    ["a is not fixed", ranLine("a", fixme)],
    ["still broken", ranLine("a", still)],
    ["meant to be", ranLine("a", meant)],
  );
  findingsFile(join(R, "task-1-round-1-b.md"));
  assert.deepEqual(ids(verified("task-1").new), ["R1.1", "R1.2", "R1.3"]);
  roundFromJudgement("task-1");
  evidenceFile(join(R, "task-1-round-1-evidence.md"));
  replyFile(
    join(R, "task-1-round-1-reply.md"),
    `- R1.1 ${FIXED}`,
    `- R1.2 ${FIXED}`,
    "- R1.3 disagree: the value is meant to stay",
  );
  write(join(wt, "a"), "fixed\n");
  findingsFile(join(R, "task-1-round-2-a.md"));
  findingsFile(join(R, "task-1-round-2-b.md"));
  let d = verified("task-1");
  assert.deepEqual(
    [
      d.round,
      d.earlier.map((f: { id: string; state: string; exit: number; reply: string }) => [
        f.id,
        f.state,
        f.exit,
        f.reply,
      ]),
      d.new,
    ],
    [
      2,
      [
        ["R1.1", "resolved", 0, "fixed"],
        ["R1.2", "stands", 1, "fixed"],
        ["R1.3", "stands", 1, "disagree"],
      ],
      [],
    ],
  );
  assert.equal(
    excerpt(read(join(W, "drafts/task-1-round-2.md")), /^## Earlier findings/, /^## New findings/),
    `## Earlier findings

- R1.1 resolved: ran: ${ranLine("a", fixme)}; saw: exit 0
- R1.2 stands: ran: ${ranLine("a", still)}; saw: exit 1, \`still broken\`
- R1.3 stands: ran: ${ranLine("a", meant)}; saw: exit 1, \`meant to be\`; reply: disagree

## New findings`,
  );
  roundFromJudgement("task-1");
  evidenceFile(join(R, "task-1-round-2-evidence.md"));
  replyFile(
    join(R, "task-1-round-2-reply.md"),
    `- R1.2 fixed: assumed: the value came from the cache; ran: ${CMD}; saw: exit 0`,
    "- R1.3 disagree: the value is meant to stay",
  );
  findingsFile(join(R, "task-1-round-3-a.md"));
  findingsFile(join(R, "task-1-round-3-b.md"));
  d = verified("task-1");
  assert.deepEqual(
    [
      d.round,
      d.earlier.map((f: { id: string; state: string; reply: string }) => [f.id, f.state, f.reply]),
    ],
    [
      3,
      [
        ["R1.2", "stands again", "fixed"],
        ["R1.3", "stands again", "disagree"],
      ],
    ],
  );
  assert.equal(
    excerpt(read(join(W, "drafts/task-1-round-3.md")), /^## Earlier findings/, /^## New findings/),
    `## Earlier findings

- R1.2 stands again: ran: ${ranLine("a", still)}; saw: exit 1, \`still broken\`
- R1.3 stands again: ran: ${ranLine("a", meant)}; saw: exit 1, \`meant to be\`; reply: disagree

## New findings`,
  );
  roundFromJudgement("task-1");
  passes(join(R, "task-1-round-1-reply.md"), "reply");
  passes(join(R, "task-1-round-2-reply.md"), "reply");
  replyFile(
    join(R, "task-1-round-3-reply.md"),
    "- R1.2 disagree: the value is meant to stay",
    "- R1.3 disagree: the value is meant to stay",
  );
  gives(join(R, "task-1-round-3-reply.md"), ["assumed"]);
  replyFile(
    join(R, "task-1-round-3-reply.md"),
    "- R1.2 disagree: assumed: both took the cache for the source; the value is meant to stay",
  );
  gives(join(R, "task-1-round-3-reply.md"), ["missing"]);
});

test("verify exits 1 when an earlier finding's probe is gone", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  const R = join(W, "review");
  const gone = probe("a", "gone", "echo two; exit 1");
  findingsFile(join(R, "task-1-round-1-a.md"), ["the value is two", ranLine("a", gone)]);
  verified("task-1");
  roundFromJudgement("task-1");
  rmSync(gone, { recursive: true });
  const result = flow("verify", wt, "task-1");
  assert.equal(result.status, 1, result.stdout);
  assert.ok(result.stderr.startsWith("flow: R1."), result.stderr);
  assert.ok(
    !existsSync(join(W, "drafts/task-1-round-2.md")),
    "verify wrote a draft after an earlier probe was gone",
  );
});

test("verify refuses a bad scope before begin, and stops with no-run on a good one", () => {
  setup();
  const d = flowJson("verify", wt, "task-1");
  assert.deepEqual([d.status, d.reason], ["stop", "no-run"]);
  noSuchScope("verify", wt, "task-x");
  refused("verify", wt);
  refused("verify", wt, "task-1", "x");
  refused("verify", "relative/wt", "task-1");
});

const draftFinding = (id: string, seat: string, title: string, shown = "exit 1"): string =>
  `### ${id} ${title}\n\nFound by: ${seat}\nCommand: ${CMD}\nPrinted: ${shown}`;

const draftFile = (
  W: string,
  scope: string,
  r: number,
  earlier: readonly string[],
  fresh: readonly string[],
  dropped: readonly string[] = ["- a: none", "- b: none"],
): void => {
  write(
    join(W, "drafts", `${scope}-round-${r}.md`),
    `# ${scope}, round ${r}, draft\n\n## Earlier findings\n\n${orNone(earlier).join("\n")}\n\n## New findings\n\n${orNone(fresh).join("\n\n")}\n\n## Dropped\n\n${dropped.join("\n")}\n`,
  );
};

const NONE_JUDGED =
  "Seats: a on opus\n\n## Keep\n\nNone.\n\n## Drop\n\nNone.\n\n## Earlier\n\nNone.\n\n## Not run\n\nNone.\n";

test("round writes the round file from the draft and the judgement", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  const R = join(W, "review");
  roundFile(
    join(R, "task-1-round-1.md"),
    "None.",
    `${twoFindings("R1.1", "R1.2")}\n\n${captured(finding("R1.3"))}`,
    "changes-requested",
  );
  draftFile(
    W,
    "task-1",
    2,
    [
      `- R1.1 resolved: ran: ${CMD}; saw: exit 0`,
      `- R1.2 stands again: ran: ${CMD}; saw: exit 1, \`stale\``,
      `- R1.3 stands: ran: ${CMD}; saw: exit 1, \`kept\`; reply: disagree`,
    ],
    [
      draftFinding("R2.1", "a", "the cache keeps a stale value", "exit 1, `stale`"),
      draftFinding("R2.2", "b", "the second sign-in sees the old value"),
      draftFinding("R2.3", "b", "the log is long", "exit 2"),
    ],
    ["- a: none", "- b: 1, the command exited 0, so the failure did not show (finding 2)"],
  );
  const judgement = judgementFile(
    "task-1",
    [
      "Seats: a on opus, b on fable",
      "",
      "## Keep",
      "",
      "- R2.2, R2.1",
      "  Required: sign-in reads the cache after sign-out",
      "  Breaks: the second sign-in never fetches the value",
      "",
      "## Drop",
      "",
      "- R2.3: the length of the log breaks no intent",
      "",
      "## Earlier",
      "",
      "- R1.2 stands: `retryJob` has to check it first",
      "- R1.3 resolved: the value is meant to stay",
      "",
      "## Not run",
      "",
      "- `npm run e2e`: no browser here",
      "",
    ].join("\n"),
  );
  const d = flowJson("round", wt, "task-1", judgement);
  const path = join(R, "task-1-round-2.md");
  assert.deepEqual(d, {
    status: "ok",
    round: path,
    verdict: "changes-requested",
    open: ["R1.2", "R2.1"],
    cap: false,
  });
  assert.equal(
    read(path),
    `# task-1, round 2

Seats: a on opus, b on fable

## Earlier findings

- R1.1 resolved: ran: ${CMD}; saw: exit 0
- R1.2 stands again: ran: ${CMD}; saw: exit 1, \`stale\`; \`retryJob\` has to check it first
- R1.3 resolved: ran: ${CMD}; saw: exit 1, \`kept\`; the value is meant to stay

## New findings

### R2.1 the second sign-in sees the old value

Found by: a, b
Command: ${CMD}
Printed: exit 1
Required: sign-in reads the cache after sign-out
Breaks: the second sign-in never fetches the value

## Dropped

- a: none
- b: 1, the command exited 0, so the failure did not show (finding 2)
- b: R2.3, the length of the log breaks no intent

## Not run

- \`npm run e2e\`: no browser here

## Verdict

changes-requested
`,
  );
  const s = scoped("task-1");
  assert.deepEqual(
    [s.round, s.verdict, s.open],
    [
      3,
      "changes-requested",
      [
        { id: "R1.2", stood: 1, reply: null },
        { id: "R2.1", stood: 0, reply: null },
      ],
    ],
  );
});

test("round stops with no-evidence naming the file, and gives approve once the file is there", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  const R = join(W, "review");
  const approves = (scope: string, wanted: string, provide: () => void): void => {
    const judgement = judgementFile(scope, NONE_JUDGED);
    const r = scoped(scope).round;
    const d = flowJson("round", wt, scope, judgement);
    assert.deepEqual(
      [d.status, d.reason, d.file, d.message],
      ["stop", "no-evidence", join(W, wanted), `approve needs ${join(W, wanted)}`],
      scope,
    );
    assert.equal(scoped(scope).round, r, `${scope} wrote a round file on no-evidence`);
    provide();
    const again = flowJson("round", wt, scope, judgement);
    assert.deepEqual(
      [again.status, again.verdict, again.open, again.cap],
      ["ok", "approve", [], false],
      scope,
    );
    assert.equal(scoped(scope).verdict, "approve", scope);
  };

  draftFile(W, "task-1", 1, [], []);
  approves("task-1", "review/task-1-evidence.md", () =>
    evidenceFile(join(R, "task-1-evidence.md")),
  );

  evidenceFile(join(R, "task-2-evidence.md"));
  roundFile(join(R, "task-2-round-1.md"), "None.", captured(finding("R1.1")), "changes-requested");
  replyFile(join(R, "task-2-round-1-reply.md"), `- R1.1 ${FIXED}`);
  draftFile(W, "task-2", 2, [`- R1.1 resolved: ran: ${CMD}; saw: exit 0`], []);
  approves("task-2", "review/task-2-round-1-evidence.md", () =>
    evidenceFile(join(R, "task-2-round-1-evidence.md")),
  );

  draftFile(W, "integration", 1, [], []);
  approves("integration", "review/integration-round-1-a.md", () => {
    seatFile(join(R, "integration-round-1-a.md"), "none");
    const stopped = flowJson(
      "round",
      wt,
      "integration",
      join(W, "drafts/integration-round-1-judgement.md"),
    );
    assert.equal(stopped.reason, "no-evidence", "a seat file with no walk gave approve");
    seatFile(join(R, "integration-round-1-b.md"), "none", WALK);
  });
  assert.ok(!existsSync(join(R, "integration-evidence.md")), "an evidence file was written");

  draftFile(W, "merge", 1, [], []);
  approves("merge", "review/merge-evidence.md", () => evidenceFile(join(R, "merge-evidence.md")));
});

test("round stops with no-draft and judgement, with each why", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  const R = join(W, "review");
  roundFile(
    join(R, "task-1-round-1.md"),
    "None.",
    twoFindings("R1.1", "R1.2"),
    "changes-requested",
  );
  const good = [
    "Seats: a on opus, b on fable",
    "",
    "## Keep",
    "",
    "- R2.1",
    "  Required: the value is fresh",
    "  Breaks: the second sign-in shows the old value",
    "",
    "## Drop",
    "",
    "- R2.2: the log length breaks no intent",
    "",
    "## Earlier",
    "",
    "- R1.1 stands: it still fails",
    "",
    "## Not run",
    "",
    "None.",
    "",
  ].join("\n");
  const judgement = judgementFile("task-1", good);
  let d = flowJson("round", wt, "task-1", judgement);
  assert.deepEqual([d.status, d.reason], ["stop", "no-draft"]);
  draftFile(
    W,
    "task-1",
    2,
    [`- R1.1 stands: ran: ${CMD}; saw: exit 1`, `- R1.2 resolved: ran: ${CMD}; saw: exit 0`],
    [draftFinding("R2.1", "a", "the value is stale"), draftFinding("R2.2", "b", "the log is long")],
  );
  const cases: readonly (readonly [string, string, number, string, string])[] = [
    ["## Drop", "## Dropped", 9, "shape", ""],
    ["- R2.2: the log length breaks no intent", "None.", 3, "unjudged", " R2.2"],
    ["- R2.2:", "- R2.1:", 11, "twice", " R2.1"],
    ["- R2.1\n", "- R1.1\n", 5, "unknown-id", " R1.1"],
    ["- R1.1 stands: it still fails", "None.", 13, "no-reason", " R1.1"],
    ["- R1.1 stands:", "- R1.1 resolved:", 15, "not-disagree", " R1.1"],
  ];
  for (const [old, replacement, line, why, id] of cases) {
    assert.equal(good.split(old).length, 2, old);
    write(judgement, good.replace(old, replacement));
    d = flowJson("round", wt, "task-1", judgement);
    assert.deepEqual(
      [d.status, d.reason, d.line, d.why, d.message],
      ["stop", "judgement", line, why, `${judgement} line ${line}: ${why}${id}`],
    );
    assert.ok(!existsSync(join(R, "task-1-round-2.md")), `${why} wrote the round file`);
  }
  write(judgement, good);
  assert.equal(flowJson("round", wt, "task-1", judgement).verdict, "changes-requested");
  d = flowJson("round", wt, "task-1", judgement);
  assert.deepEqual([d.status, d.reason], ["stop", "no-draft"]);
});

test("round prints cap after the fifth round without approve", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  for (let r = 1; r <= 5; r += 1) {
    draftFile(W, "task-1", r, r === 1 ? [] : [`- R${r - 1}.1 resolved: ran: ${CMD}; saw: exit 0`], [
      draftFinding(`R${r}.1`, "a", "the value is stale"),
    ]);
    const d = roundFromJudgement("task-1");
    assert.deepEqual(
      [d.verdict, d.open, d.cap],
      ["changes-requested", [`R${r}.1`], r === 5],
      `round ${r}`,
    );
  }
  assert.deepEqual([scoped("task-1").round, scoped("task-1").cap], [6, true]);
});

test("round refuses a wrong argument count and a relative or missing judgement path", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  const judgement = judgementFile("task-1", NONE_JUDGED);
  refused("round", wt, "task-1");
  refused("round", wt, "task-1", judgement, "x");
  refused("round", "relative/wt", "task-1", judgement);
  refused("round", wt, "task-1", "drafts/task-1-round-1-judgement.md");
  const missing = flow("round", wt, "task-1", join(W, "drafts/none.md"));
  assert.deepEqual(
    [missing.status, captured(missing.stderr)],
    [1, `flow: no such file: ${join(W, "drafts/none.md")}`],
  );
  const scope = flow("round", wt, "task-x", judgement);
  assert.deepEqual([scope.status, captured(scope.stderr)], [1, "flow: no such scope: task-x"]);
});

const recorded = () => flowJson("record", wt);

const reviewed = (R: string): void => {
  roundFile(
    join(R, "task-1-round-1.md"),
    "None.",
    twoFindings("R1.1", "R1.2"),
    "changes-requested",
  );
  roundFile(join(R, "task-1-round-2.md"), "- R1.1 resolved\n- R1.2 resolved", "None.", "approve");
  roundFile(join(R, "task-2-round-1.md"), "None.", captured(finding("R1.1")), "changes-requested");
  seatFile(join(R, "integration-round-1-a.md"), "none", WALK);
  roundFile(
    join(R, "integration-round-1.md"),
    "None.",
    captured(finding("R1.1")),
    "changes-requested",
  );
  roundFile(join(R, "integration-round-2.md"), "- R1.1 resolved", "None.", "approve");
  roundFile(join(R, "merge-round-1.md"), "None.", captured(finding("R1.1")), "changes-requested");
  seatFile(join(R, "task-1-round-1-a.md"));
  replyFile(join(R, "task-1-round-1-reply.md"), "- R1.1 disagree: meant", "- R1.2 disagree: meant");
};

const LINE = "Level: standard (file) · tasks 2 · task rounds 3 · integration rounds 2 · findings 4";
const logWant = `Implements #3\nPart of #1\n\n## What changed\n\nthe body\n\n${LINE}\n`;
let recordW = "";
let logBefore = "";

test("record: writes the head from --issue and --parent and the Level: line with the counts", () => {
  setup();
  recordW = begun("--level", "standard", "--source", "file", "--issue", "3", "--parent", "1");
  reviewed(join(recordW, "review"));
  write(join(recordW, "log.md"), "## What changed\n\nthe body\n\n\n");
  const d = recorded();
  assert.deepEqual([d.status, d.line], ["ok", LINE]);
  assert.equal(read(join(recordW, "log.md")), logWant);
});

test("record: run twice leaves one head and one Level: line", () => {
  assert.equal(recorded().status, "ok");
  const log = read(join(recordW, "log.md"));
  assert.equal(log, logWant);
  assert.deepEqual(
    [
      lines(log).filter((line) => line.startsWith("Implements ")).length,
      lines(log).filter((line) => line.startsWith("Level: ")).length,
    ],
    [1, 1],
  );
});

test("record: a head copied from another pull request is replaced", () => {
  write(join(recordW, "log.md"), "Implements #99\n\nPart of #98\n\n## What changed\n\nthe body\n");
  assert.equal(recorded().status, "ok");
  assert.equal(read(join(recordW, "log.md")), logWant);
});

test("record: level.sh history reads the recorded log.md back", () => {
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), '#!/usr/bin/env bash\nprintf "%s\\n" "$FX_GH_JSON"\n', {
    mode: 0o755,
  });
  const ghJson = JSON.stringify([
    { number: 9, url: "u9", mergedAt: "2026-11-12T00:00:00Z", body: read(join(recordW, "log.md")) },
  ]);
  const d = JSON.parse(
    printed(
      spawnSync("bash", [levelSh, "history", wt], {
        cwd: main,
        env: { ...env, FX_GH_JSON: ghJson, PATH: fakePath },
        encoding: "utf8",
      }),
    ),
  );
  assert.deepEqual(
    [
      d.since,
      ...d.runs.map(
        (r: {
          pr: number;
          level: string;
          source: string;
          tasks: number;
          taskRounds: number;
          integrationRounds: number;
          findings: number;
        }) => [r.pr, r.level, r.source, r.tasks, r.taskRounds, r.integrationRounds, r.findings],
      ),
    ],
    [null, [9, "standard", "file", 2, 3, 2, 4]],
  );
});

test("record counts round files it cannot lint", () => {
  const R = join(recordW, "review");
  logBefore = read(join(recordW, "log.md"));
  swap(join(R, "task-2-round-1.md"), ["### R1.1 the", "### F1. the"]);
  swap(join(R, "merge-round-1.md"), ["changes-requested", "changes requested: R1.1"]);
  assert.ok(!existsSync(join(recordW, "drafts")), "the round files have drafts");
  const d = recorded();
  assert.deepEqual([d.status, d.line], ["ok", LINE]);
  assert.equal(read(join(recordW, "log.md")), logBefore);
});

test("record: no log.md gives stop no-log, no review/ gives stop no-review", () => {
  const R = join(recordW, "review");
  rmSync(R, { recursive: true });
  let d = recorded();
  assert.deepEqual([d.status, d.reason], ["stop", "no-review"]);
  assert.equal(read(join(recordW, "log.md")), logBefore);
  rmSync(join(recordW, "log.md"));
  mkdirSync(R);
  d = recorded();
  assert.deepEqual([d.status, d.reason], ["stop", "no-log"]);
  assert.ok(!existsSync(join(recordW, "log.md")), "record without log.md wrote one");
});

test("record: without --issue the top of log.md is left alone", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  write(
    join(W, "log.md"),
    "Implements #7\r\n\r\nbody\r\nLevel: high (file) · tasks 1 · task rounds 1 · integration rounds 0 · findings 0\r\n",
  );
  const line =
    "Level: high (default) · tasks 0 · task rounds 0 · integration rounds 0 · findings 0";
  assert.equal(recorded().line, line);
  assert.deepEqual(
    readFileSync(join(W, "log.md")),
    Buffer.from(`Implements #7\r\n\r\nbody\n\n${line}\n`),
  );
});

test("record: no run.json gives stop no-run, and a missing, relative or extra argument exits 1", () => {
  setup();
  const d = recorded();
  assert.deepEqual([d.status, d.reason], ["stop", "no-run"]);
  refused("record");
  refused("record", "relative/wt");
  refused("record", wt, "extra");
});

const PLACEHOLDER =
  /<(skills|WT|MAIN|branch|WORKDIR|START|head|progress|scope|round|last|k|prev|seat|n|P)>/;

const prompted = (...args: readonly string[]) => {
  const json = JSON.parse(
    printed(
      spawnSync("bash", [throughDots, "prompt", wt, ...args], { cwd: main, env, encoding: "utf8" }),
    ),
  );
  const path: string = json.path;
  assert.equal(json.status, "ok", `prompt ${args.join(" ")}`);
  assert.ok(existsSync(path), `prompt ${args.join(" ")}: no file at ${path}`);
  const text = read(path);
  const logLines = lines(git(wt, "log", "--oneline"));
  const left = lines(text).filter((line) => !logLines.includes(line) && PLACEHOLDER.test(line));
  assert.deepEqual(left, [], `prompt ${args.join(" ")} left a placeholder`);
  assert.ok(
    !lines(text).some((line) => /^(<if |<end>)/.test(line)),
    `prompt ${args.join(" ")} left a block line`,
  );
  const want = `Your working directory must be the worktree \`${wt}\`. Run \`git rev-parse --show-toplevel\` first. When it prints anything else, call \`EnterWorktree(path: "${wt}")\` before anything else, or, when that tool is not available, start every command with \`cd ${wt}\` and keep Edit and Write paths under \`${wt}\`. Never touch \`${main}\`.`;
  assert.equal(lines(text).at(-1), want);
  return { json, path, text };
};

const holds = (text: string, part: string): void => {
  assert.ok(text.includes(part), `lacks: ${part}`);
};

const lacks = (text: string, part: string): void => {
  assert.ok(!text.includes(part), `holds: ${part}`);
};

test("prompt writes each kind's file with the paths, the worktree line, the progress and the issue lines filled, and agent, model and effort from run.json's level", () => {
  setup();
  git(wt, "checkout", "-q", "-b", "feat");
  const W = begun("--level", "high", "--source", "default", "--issue", "12", "--parent", "88");
  write(join(wt, "a"), "more\n");
  git(wt, "commit", "-q", "-am", "the first task");
  const logLine = captured(git(wt, "log", "--oneline", "-1"));
  roundFile(
    join(W, "review/task-1-round-1.md"),
    "None.",
    captured(finding("R1.1")),
    "changes-requested",
  );
  const agents = JSON.parse(
    printed(spawnSync("bash", [levelSh, "show", wt, "high"], { cwd: main, env, encoding: "utf8" })),
  );
  const calls: readonly (readonly [string, string, string])[] = [
    ["work task-1", "work-task-1", "workflow-worker"],
    ["seat task-1 a", "seat-task-1-a", "workflow-reviewer-a"],
    ["seat task-1 b", "seat-task-1-b", "workflow-reviewer-b"],
    ["again task-1", "again-task-1", ""],
    ["respond task-1", "respond-task-1", ""],
    ["commit task-1", "commit-task-1", ""],
    ["detail task-2", "detail-task-2", ""],
    ["report", "report", "workflow-worker"],
    ["design", "design", "workflow-design"],
    ["decisions", "decisions", "workflow-reviewer-a"],
  ];
  for (const [args, name, agent] of calls) {
    const words = args.split(" ");
    const { json, path, text } = prompted(...words);
    assert.equal(path, `${W}/prompts/${name}.md`);
    lacks(text, "../");
    if (words[0] !== "commit") {
      holds(text, `${skills}/workflow/`);
    }
    const want =
      agent === ""
        ? [null, null, null]
        : [agent, agents.agents[agent].model, agents.agents[agent].effort];
    assert.deepEqual([json.agent, json.model, json.effort], want, `prompt ${args}`);
  }
  const prompt = (name: string) => read(join(W, `prompts/${name}.md`));
  for (const name of ["work-task-1", "seat-task-1-a", "report"]) {
    holds(prompt(name), logLine);
  }
  let text = prompt("work-task-1");
  holds(text, `Detail design for this task: ${W}/detail/task-1.md`);
  holds(text, "Branch: feat");
  holds(text, "This run comes from issue #12.");
  text = prompt("seat-task-1-b");
  holds(text, `Run a probe with: ${skills}/workflow/scripts/flow.sh run ${wt} b <probe dir>`);
  holds(text, "The design is issue #12. Its checked decisions bind.");
  holds(text, `Adaptations: ${W}/adaptations.md`);
  text = prompt("again-task-1");
  holds(text, `Adaptations: ${W}/adaptations.md`);
  holds(text, "`task-1-round-2-a.md`");
  holds(prompt("respond-task-1"), `The review is ${W}/review/task-1-round-1.md.`);
  holds(prompt("commit-task-1"), "`# Issue #12: `");
  text = prompt("detail-task-2");
  holds(text, "Task 1 passed review");
  holds(text, `${W}/detail/task-2.md`);
  holds(prompt("report"), "List the adaptations");
  text = prompt("decisions");
  holds(text, "**Judging the decisions**");
  holds(text, `Design: ${W}/design.md`);
  holds(text, `The diff: ${W}/changes.diff`);
  holds(text, `Write: ${W}/decisions.md`);
  text = prompt("design");
  holds(text, "The issue: #12");
  holds(text, "The parent: #88");
  holds(text, "`project.sh 88 --check 12`");
  holds(text, `${skills}/pj1-plan/scripts/project.sh`);
});

test("prompt picks the merge lines for the merge scope, the integration lines for integration, and no issue line without --issue", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  let { text } = prompted("work", "merge");
  holds(text, `Design, plan and detail: ${W}/merge.md`);
  holds(text, `Start point START: ${captured(git(wt, "rev-parse", "HEAD"))}`);
  holds(text, "`merge-evidence.md`");
  lacks(text, "Branch:");
  lacks(text, "Design: ");
  lacks(text, "Detail design");
  ({ text } = prompted("seat", "merge", "a"));
  holds(text, "MERGE_HEAD");
  holds(text, "The evidence is `merge-evidence.md`.");
  holds(text, "Write your seat file as `merge-round-1-a.md`");
  ({ text } = prompted("commit", "merge"));
  holds(text, "git commit --no-edit");
  lacks(text, "Turn its changes");
  ({ text } = prompted("seat", "integration", "b"));
  holds(text, "This is the integration review.");
  holds(text, "under `## Walk`");
  holds(text, "Write your seat file as `integration-round-1-b.md`");
  lacks(text, "Detail design");
  lacks(text, "MERGE_HEAD");
  roundFile(
    join(W, "review/integration-round-1.md"),
    "None.",
    captured(finding("R1.1")),
    "changes-requested",
  );
  ({ text } = prompted("work", "integration"));
  holds(text, "Every task of the plan is committed, and the integration review asked for changes.");
  holds(text, `The review is ${W}/review/integration-round-1.md.`);
  holds(text, "`integration-round-1-reply.md`");
  holds(text, "Branch: none");
  lacks(text, "Detail design");
  ({ text } = prompted("commit", "integration"));
  holds(text, "integration review fixes");
  for (const name of readdirSync(join(W, "prompts")).filter((file) => file.endsWith(".md"))) {
    const each = read(join(W, "prompts", name));
    lacks(each, "issue #");
    lacks(each, "Adaptations");
  }
});

test("prompt gives a seat the round 1 wording in round 1 and the restart wording from round 2 on", () => {
  setup();
  const W = begun("--level", "high", "--source", "default");
  let { text } = prompted("seat", "task-1", "a");
  holds(text, "The evidence is `task-1-evidence.md`.");
  holds(text, "Write your seat file as `task-1-round-1-a.md`");
  lacks(text, "You start in round");
  roundFile(
    join(W, "review/task-1-round-1.md"),
    "None.",
    captured(finding("R1.1")),
    "changes-requested",
  );
  ({ text } = prompted("seat", "task-1", "a"));
  holds(
    text,
    "The reply of the last round is `task-1-round-1-reply.md`, and the round file of the last round is `task-1-round-1.md`.",
  );
  holds(text, "You start in round 2.");
  holds(text, "Write your seat file as `task-1-round-2-a.md`");
  lacks(text, "`task-1-evidence.md`");
  roundFile(
    join(W, "review/integration-round-1.md"),
    "None.",
    captured(finding("R1.1")),
    "changes-requested",
  );
  ({ text } = prompted("seat", "integration", "a"));
  holds(text, "You start in round 2.");
  lacks(text, "## Walk");
});

test("prompt keeps the text of a placeholder inside a commit subject as it is, and a second call overwrites the file", () => {
  setup();
  begun("--level", "standard", "--source", "default");
  write(join(wt, "a"), "more\n");
  git(wt, "commit", "-q", "-am", "fix <WT> and <k> in the prompt");
  const { path, text } = prompted("work", "task-1");
  holds(text, "fix <WT> and <k> in the prompt");
  writeFileSync(path, "stale\n");
  prompted("work", "task-1");
  assert.equal(read(path), text);
});

test("prompt stops with no-run, and exits 1 on a bad kind, scope, seat or argument count, on detail task-1, on seat b at standard, on design without --issue, and on again, respond and work integration before the scope's first round file", () => {
  setup();
  const d = flowJson("prompt", wt, "work", "task-1");
  assert.deepEqual([d.status, d.reason], ["stop", "no-run"]);
  printed(flow("begin", wt, "--level", "standard", "--source", "default"));
  refused("prompt", wt);
  refused("prompt", wt, "bogus", "task-1");
  refused("prompt", wt, "work");
  refused("prompt", wt, "work", "task-1", "a");
  refused("prompt", wt, "report", "task-1");
  refused("prompt", wt, "design", "task-1");
  refused("prompt", wt, "decisions", "task-1");
  refused("prompt", wt, "seat", "task-1");
  refused("prompt", wt, "seat", "task-1", "c");
  refused("prompt", "relative/wt", "work", "task-1");
  refused("prompt", wt, "work", "task-x");
  refused("prompt", wt, "work", "review");
  refused("prompt", wt, "detail", "task-1");
  refused("prompt", wt, "detail", "integration");
  refused("prompt", wt, "seat", "task-1", "b");
  refused("prompt", wt, "design");
  refused("prompt", wt, "again", "task-1");
  refused("prompt", wt, "respond", "task-1");
  refused("prompt", wt, "work", "integration");
  assert.ok(
    !existsSync(join(flowJson("status", wt).workdir, "prompts")),
    "a refused prompt wrote prompts/",
  );
});

const decisionsFile = (path: string): void => {
  write(
    path,
    `# Decisions

## Keep sessions in Redis

Area: infrastructure

### What was decided

Sessions move to a shared Redis instance.

### Other options and why this one

Sticky sessions would still sign everyone out on a deploy.

### Where it landed

- \`src/session/store.ts\`
- \`infra/redis.tf\`: the instance

### To overturn it

\`\`\`text
/annetaan:workflow Keep sessions in process memory again and remove infra/redis.tf.
\`\`\`

## Add the date library

Area: technology

### What was decided

Dates are parsed with one library.

\`\`\`text
### not a heading inside a fence
\`\`\`

### Other options and why this one

The built-in parser reads time zones differently per runtime.

### Where it landed

- \`package.json\`

### To overturn it

\`\`\`
/annetaan:workflow Parse dates with the built-in parser and drop the library from package.json.
\`\`\`
`,
  );
};

test("lint: decisions.md with None. or full entries passes as kind decisions", () => {
  const D = join(tmp, "lint/decisions");
  const example = /^````markdown\n([\s\S]*?)^````$/m.exec(read(reviewFiles));
  assert.ok(example !== null, "review-files.md holds no decisions example");
  write(join(D, "example/decisions.md"), example[1] ?? "");
  passes(join(D, "example/decisions.md"), "decisions");
  write(join(D, "none/decisions.md"), "# Decisions\n\nNone.\n");
  passes(join(D, "none/decisions.md"), "decisions");
  decisionsFile(join(D, "full/decisions.md"));
  passes(join(D, "full/decisions.md"), "decisions");
});

test("lint: decisions.md gives sections, area, parts, landed and overturn, one per break", () => {
  const D = join(tmp, "lint/decisions");
  const F = join(D, "full/decisions.md");
  breaks(F, "sections", ["# Decisions", "# Decision"]);
  breaks(F, "sections", ["# Decisions\n", "# Decisions\n\nNotes first.\n"]);
  breaks(F, "sections", ["# Decisions\n", "# Decisions\n\nNone.\n"]);
  breaks(F, "sections", ["## Add the date library", "## Keep sessions in Redis"]);
  write(join(D, "none/decisions.md"), "# Decisions\n\nNone.\nMore.\n");
  gives(join(D, "none/decisions.md"), ["sections"]);
  write(join(D, "none/decisions.md"), "# Decisions\n");
  gives(join(D, "none/decisions.md"), ["sections"]);
  breaks(F, "area", ["Area: infrastructure", "Area: infra"]);
  breaks(F, "area", ["Area: technology", "Area technology"]);
  breaks(F, "parts", [
    "### Other options and why this one\n\nThe built-in",
    "### Other options\n\nThe built-in",
  ]);
  breaks(F, "parts", ["Sessions move to a shared Redis instance.", ""]);
  breaks(F, "parts", ["Area: technology\n", "Area: technology\n\nA stray line.\n"]);
  breaks(F, "parts", [
    "### Where it landed\n\n- `package.json`\n\n### To overturn it",
    "### To overturn it\n\n```\n/annetaan:workflow Move it.\n```\n\n### Where it landed\n\n- `package.json`\n\n### To overturn it",
  ]);
  breaks(F, "landed", ["- `package.json`", "- package.json"]);
  breaks(F, "landed", ["- `package.json`", ""]);
  breaks(F, "landed", ["- `src/session/store.ts`", "the store, `src/session/store.ts`"]);
  breaks(F, "overturn", ["/annetaan:workflow Parse dates", "/workflow Parse dates"]);
  breaks(F, "overturn", [
    "/annetaan:workflow Keep sessions in process memory again and remove infra/redis.tf.\n```",
    "/annetaan:workflow Keep sessions in process memory again and remove infra/redis.tf.\n```\n\nRun it from main.",
  ]);
  breaks(F, "overturn", [
    "```\n/annetaan:workflow Parse dates with the built-in parser and drop the library from package.json.\n```",
    "/annetaan:workflow Parse dates with the built-in parser and drop the library from package.json.",
  ]);
  breaks(F, "overturn", [
    "/annetaan:workflow Parse dates with the built-in parser and drop the library from package.json.",
    "/annetaan:workflow ",
  ]);
});

const fake = join(tmp, "fake");

const decided = (): string => {
  rmSync(fake, { recursive: true, force: true });
  mkdirSync(fake, { recursive: true });
  writeFileSync(join(fake, "gh.log"), "");
  writeFileSync(join(fake, "labels"), "");
  writeFileSync(join(fake, "next"), "40\n");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env bash
echo "$PWD $*" >> '${fake}/gh.log'
case "$1 $2" in
  "label create")
    if grep -qxF -- "$3" '${fake}/labels'; then
      echo "label with name \\"$3\\" already exists; use \\\`--force\\\` to update its color and description" >&2
      exit 1
    fi
    echo "$3" >> '${fake}/labels' ;;
  "issue create")
    if [ "$4" = "$(cat '${fake}/fail-title' 2>/dev/null)" ]; then
      echo "HTTP 502: the server is down" >&2
      exit 1
    fi
    n=$(( $(cat '${fake}/next') + 1 ))
    echo "$n" > '${fake}/next'
    cat > '${fake}/body-'"$n"
    echo "Creating issue in o/r"
    echo "https://github.com/o/r/issues/$n" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
  setup();
  return begun("--level", "standard", "--source", "default");
};

const filing = () =>
  JSON.parse(
    printed(
      spawnSync("bash", [script, "decisions", wt, "7"], {
        cwd: main,
        env: { ...env, PATH: fakePath },
        encoding: "utf8",
      }),
    ),
  );

const ghLog = (): string => read(join(fake, "gh.log"));

type Filed = { title: string; number: number; url: string };

const triples = (filed: readonly Filed[]) => filed.map((i) => [i.title, i.number, i.url]);

const FILED = [
  ["Keep sessions in Redis", 41, "https://github.com/o/r/issues/41"],
  ["Add the date library", 42, "https://github.com/o/r/issues/42"],
];

test("decisions: None. files nothing and creates no label", () => {
  const W = decided();
  write(join(W, "decisions.md"), "# Decisions\n\nNone.\n");
  const d = filing();
  assert.deepEqual([d.status, d.filed], ["ok", []]);
  assert.equal(ghLog(), "", "decisions on None. called gh");
  assert.equal(read(join(fake, "labels")), "", "decisions on None. created a label");
});

test("decisions: one issue per entry labelled decision, Pull request: #<m> under Where it landed, label made sure first, already-exists tolerated", () => {
  let W = "";
  for (const existing of ["no", "yes"]) {
    W = decided();
    if (existing === "yes") {
      writeFileSync(join(fake, "labels"), "decision\n");
    }
    decisionsFile(join(W, "decisions.md"));
    assert.deepEqual(triples(filing().filed), FILED);
    assert.deepEqual(
      lines(ghLog()),
      [
        `${wt} label create decision --color FBCA04 --description A design decision a workflow run made on its own. Read it, then close it.`,
        `${wt} issue create --title Keep sessions in Redis --label decision --body-file -`,
        `${wt} issue create --title Add the date library --label decision --body-file -`,
      ],
      `decisions with the label existing ${existing}`,
    );
    assert.equal(captured(read(join(fake, "labels"))), "decision");
  }
  const bodyWant = [
    "## What was decided",
    "",
    "Area: infrastructure",
    "",
    "Sessions move to a shared Redis instance.",
    "",
    "## Other options and why this one",
    "",
    "Sticky sessions would still sign everyone out on a deploy.",
    "",
    "## Where it landed",
    "",
    "Pull request: #7",
    "",
    "- `src/session/store.ts`",
    "- `infra/redis.tf`: the instance",
    "",
    "## To overturn it",
    "",
    "```text",
    "/annetaan:workflow Keep sessions in process memory again and remove infra/redis.tf.",
    "```",
  ];
  assert.equal(read(join(fake, "body-41")), bodyWant.map((line) => `${line}\n`).join(""));
  const second = lines(read(join(fake, "body-42")));
  assert.equal(second.filter((line) => line.startsWith("## ")).length, 4);
  assert.ok(
    second.includes("### not a heading inside a fence"),
    "the second body lost its fenced block",
  );
  assert.deepEqual(triples(JSON.parse(read(join(W, "decisions.json")))), FILED);
});

test("decisions: a second run files nothing twice", () => {
  writeFileSync(join(fake, "gh.log"), "");
  assert.deepEqual(triples(filing().filed), FILED);
  assert.equal(ghLog(), "", "decisions rerun called gh");
});

test("decisions: a failed gh call stops gh, and the next run files only the rest", () => {
  const W = decided();
  decisionsFile(join(W, "decisions.md"));
  writeFileSync(join(fake, "fail-title"), "Add the date library\n");
  const d = filing();
  assert.deepEqual([d.status, d.reason], ["stop", "gh"]);
  assert.match(d.message, /HTTP 502: the server is down[\s\S]*#41 Keep sessions in Redis/);
  assert.deepEqual(
    JSON.parse(read(join(W, "decisions.json"))).map((i: Filed) => i.number),
    [41],
  );
  rmSync(join(fake, "fail-title"));
  writeFileSync(join(fake, "gh.log"), "");
  assert.deepEqual(
    filing().filed.map((i: Filed) => i.number),
    [41, 42],
  );
  const log = lines(ghLog());
  assert.equal(log.filter((line) => line.includes("issue create")).length, 1, ghLog());
  assert.ok(
    log.some((line) => line.includes("issue create --title Add the date library ")),
    ghLog(),
  );
});

test("decisions: no decisions.md stops no-decisions, a malformed one stops malformed, both with no gh call", () => {
  const W = decided();
  let d = filing();
  assert.deepEqual([d.status, d.reason], ["stop", "no-decisions"]);
  decisionsFile(join(W, "decisions.md"));
  swap(
    join(W, "decisions.md"),
    ["Area: technology", "Area: frontend"],
    ["- `package.json`", "- package.json"],
  );
  d = filing();
  assert.deepEqual([d.status, d.reason], ["stop", "malformed"]);
  assert.ok(captured(d.message).endsWith("area, landed"), d.message);
  assert.equal(ghLog(), "", "decisions called gh on no or a malformed decisions.md");
  assert.ok(
    !existsSync(join(W, "decisions.json")),
    "decisions wrote decisions.json on a malformed file",
  );
});

test("decisions: a non-number pr exits 1 with usage", () => {
  refused("decisions", wt, "abc");
  refused("decisions", wt, "0");
  refused("decisions", wt, "00");
  refused("decisions", wt, "07");
  refused("decisions", wt, "-3");
  refused("decisions", wt, "");
  refused("decisions", wt);
  refused("decisions", wt, "7", "8");
  refused("decisions", "relative/wt", "7");
  assert.equal(ghLog(), "", "a refused decisions called gh");
});
