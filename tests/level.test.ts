import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/workflow/scripts/level.sh");

const tmp = mkdtempSync(join(tmpdir(), "level-"));
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
const ghArgs = join(tmp, "gh-args");

const origin = join(tmp, "origin.git");
const seed = join(tmp, "seed");
const clone = join(tmp, "clone");
const plain = join(tmp, "plain");
const FILE = ".claude/annetaan-level.md";

const gitResult = (cwd: string, ...args: readonly string[]) =>
  spawnSync("git", args, { cwd, env, encoding: "utf8" });

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = gitResult(cwd, ...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

const captured = (text: string): string => text.replace(/\n+$/, "");

const lines = (text: string): string[] => {
  const all = text.split("\n");
  return all.at(-1) === "" ? all.slice(0, -1) : all;
};

const printed = (result: SpawnSyncReturns<string>): string => {
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return result.stdout;
};

git(tmp, "init", "-q", "--bare", "-b", "trunk", origin);
assert.equal(gitResult(tmp, "clone", "-q", origin, seed).status, 0);
git(seed, "checkout", "-q", "-b", "trunk");
writeFileSync(join(seed, "README.md"), "readme\n");
git(seed, "add", "README.md");
git(seed, "commit", "-q", "-m", "init");
git(seed, "push", "-q", "origin", "trunk");
git(tmp, "clone", "-q", origin, clone);
git(clone, "checkout", "-q", "-b", "feat");

mkdirSync(bin);
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
printf '%s\\n' "$*" > "$FX_GH_ARGS"
if [ -n "\${FX_GH_FAIL:-}" ]; then echo "gh: not logged in" >&2; exit 1; fi
printf '%s\\n' "$FX_GH_JSON"
`,
  { mode: 0o755 },
);

const publish = (text: string | Buffer): void => {
  mkdirSync(join(seed, ".claude"), { recursive: true });
  writeFileSync(join(seed, FILE), Buffer.concat([Buffer.from(text), Buffer.from("\n")]));
  git(seed, "add", FILE);
  git(seed, "commit", "-q", "-m", "level");
  git(seed, "push", "-q", "origin", "trunk");
};

const levelFile = (level: string, evaluated: string, reviewBy: string): string =>
  `---\nlevel: ${level}\nevaluated: ${evaluated}\nreview-by: ${reviewBy}\n---\nrationale`;

type Shown = {
  level: string;
  source: string;
  warning: string | null;
  ref: string;
  evaluated: string;
  reviewBy: string;
  agents: Record<string, { model: string; effort: string }>;
  seats: string[];
};

const showIn = (dir: string, ...args: readonly string[]): Shown =>
  JSON.parse(
    printed(spawnSync("bash", [script, "show", dir, ...args], { cwd: tmp, env, encoding: "utf8" })),
  );

const show = (...args: readonly string[]): Shown => showIn(clone, ...args);

const levelSource = (d: Shown): string => `${d.level} ${d.source}`;

const oneLineWarning = (d: Shown): void => {
  assert.equal(typeof d.warning, "string", JSON.stringify(d));
  assert.ok(!(d.warning ?? "").includes("\n"), JSON.stringify(d));
};

const exitsOne = (...args: readonly string[]): void => {
  const result = spawnSync("bash", [script, ...args], { cwd: tmp, env, encoding: "utf8" });
  assert.equal(result.status, 1, `level.sh ${args.join(" ")}: ${result.stdout}${result.stderr}`);
};

type Fixture = { json: string; fail?: boolean };

const history = (dir: string, fx: Fixture) =>
  spawnSync("bash", [script, "history", dir], {
    cwd: tmp,
    env: {
      ...env,
      PATH: fakePath,
      FX_GH_ARGS: ghArgs,
      FX_GH_JSON: fx.json,
      ...(fx.fail === true ? { FX_GH_FAIL: "1" } : {}),
    },
    encoding: "utf8",
  });

const listHistory = (fx: Fixture) => JSON.parse(printed(history(clone, fx)));

const dot = "·";
const line = (
  level: string,
  source: string,
  t: number,
  tr: number,
  ir: number,
  f: number,
): string =>
  `Level: ${level} (${source}) ${dot} tasks ${t} ${dot} task rounds ${tr} ${dot} integration rounds ${ir} ${dot} findings ${f}`;

const prs = JSON.stringify([
  {
    number: 1,
    url: "u1",
    mergedAt: "2026-11-10T00:00:00Z",
    body: `Implements #3\nPart of #1\n\n${line("high", "default", 9, 9, 9, 9)}\n\nbody\n\n${line("standard", "file", 2, 3, 2, 4)}\n`,
  },
  {
    number: 2,
    url: "u2",
    mergedAt: "2026-11-05T00:00:00Z",
    body: `x\n\n${line("high", "override", 1, 2, 0, 3)}`,
  },
  { number: 3, url: "u3", mergedAt: "2026-11-06T00:00:00Z", body: "no line here" },
  {
    number: 4,
    url: "u4",
    mergedAt: "2026-11-08T00:00:00Z",
    body: `a\r\n\r\n${line("standard", "file", 3, 4, 1, 1)}\r\n`,
  },
  {
    number: 5,
    url: "u5",
    mergedAt: "2026-11-09T00:00:00Z",
    body: line("standard", "override", 0, 0, 1, 0),
  },
  {
    number: 6,
    url: "u6",
    mergedAt: "2026-11-11T00:00:00Z",
    body: `x\n\nLevel: 2 (file) ${dot} tasks 1 ${dot} task rounds 1 ${dot} integration rounds 0 ${dot} findings 0\n`,
  },
]);

test("show: no file on origin gives standard from default with no warning", () => {
  const d = show();
  assert.equal(d.level, "standard");
  assert.equal(d.source, "default");
  assert.equal(d.warning, null);
  assert.equal(d.ref, "origin/trunk");
});

test("show: the file on origin's default branch gives its level from file", () => {
  publish(levelFile("high", "2026-11-20", "2099-02-18"));
  const d = show();
  assert.equal(levelSource(d), "high file");
  assert.equal(`${d.evaluated} ${d.reviewBy}`, "2026-11-20 2099-02-18");
  assert.equal(d.warning, null);
});

test("show: a working-tree or feature-branch copy is ignored", () => {
  mkdirSync(join(clone, ".claude"), { recursive: true });
  writeFileSync(join(clone, FILE), levelFile("standard", "2026-11-20", "2099-02-18"));
  git(clone, "add", FILE);
  git(clone, "commit", "-q", "-m", "local level");
  assert.equal(levelSource(show()), "high file");
});

test("show: <level> overrides with source override", () => {
  assert.equal(levelSource(show("standard")), "standard override");
});

test("show: a past review-by warns and keeps the level", () => {
  publish(levelFile("standard", "2020-01-01", "2020-03-31"));
  const d = show();
  assert.equal(levelSource(d), "standard file");
  assert.ok(d.warning?.includes("review-by 2020-03-31 has passed"), JSON.stringify(d));
});

test("show: an invalid file, a numeric level included, falls back to standard with a warning", () => {
  publish(levelFile("2", "2026-11-20", "2099-02-18"));
  const numeric = show();
  assert.equal(levelSource(numeric), "standard default");
  assert.ok(
    numeric.warning?.includes(`origin/trunk:${FILE}: level is not standard or high; ignored`),
    JSON.stringify(numeric),
  );
  publish(levelFile("high", "yesterday", "2099-02-18"));
  const date = show();
  assert.equal(levelSource(date), "standard default");
  assert.ok(date.warning?.includes("ignored"), JSON.stringify(date));
  publish(
    Buffer.concat([
      Buffer.from("---\nlevel: high"),
      Buffer.from([0xe9]),
      Buffer.from("\nevaluated: 2026-11-20\nreview-by: 2099-02-18\n---\nrationale"),
    ]),
  );
  const latin = show();
  assert.equal(levelSource(latin), "standard default");
  oneLineWarning(latin);
});

test("show: a byte that is not UTF-8 in the rationale keeps the file's level", () => {
  publish(
    Buffer.concat([
      Buffer.from(`${levelFile("standard", "2026-11-20", "2099-02-18")}\nRationale: caf`),
      Buffer.from([0xe9]),
      Buffer.from(" in latin-1"),
    ]),
  );
  assert.equal(levelSource(show()), "standard file");
});

test("show: an unreachable origin falls back to standard with a one-line warning", () => {
  git(clone, "remote", "set-url", "origin", join(tmp, "gone.git"));
  const d = show();
  assert.equal(levelSource(d), "standard default");
  assert.ok(d.warning?.includes("cannot read origin's default branch"), JSON.stringify(d));
  assert.ok(d.warning?.includes("; level standard unless overridden"), JSON.stringify(d));
  oneLineWarning(d);
  assert.equal(levelSource(show("standard")), "standard override");
  git(clone, "remote", "set-url", "origin", origin);
  const noOrigin = join(tmp, "no-origin");
  git(tmp, "init", "-q", noOrigin);
  const bare = showIn(noOrigin);
  assert.equal(levelSource(bare), "standard default");
  oneLineWarning(bare);
});

test("show: a numeric level and a directory outside a clone exit 1", () => {
  for (const n of ["1", "2", "3", "4"]) {
    exitsOne("show", clone, n);
  }
  mkdirSync(plain);
  exitsOne("show", plain);
});

const levels = ["standard", "high"] as const;

test("show: agents holds the levelled agents with the table's values at standard and high", () => {
  const want = {
    standard: {
      "workflow-design": ["opus", "medium"],
      "pj-planner": ["opus", "medium"],
      "pj-reviewer": ["opus", "medium"],
      "workflow-worker": ["opus", "medium"],
      "pj-issue-writer": ["opus", "medium"],
      "workflow-reviewer-a": ["opus", "high"],
    },
    high: {
      "workflow-design": ["fable", "medium"],
      "pj-planner": ["fable", "medium"],
      "pj-reviewer": ["fable", "medium"],
      "workflow-worker": ["opus", "high"],
      "pj-issue-writer": ["opus", "high"],
      "workflow-reviewer-a": ["opus", "high"],
      "workflow-reviewer-b": ["fable", "medium"],
    },
  };
  for (const level of levels) {
    const got = Object.fromEntries(
      Object.entries(show(level).agents).map(([name, agent]) => [
        name,
        [agent.model, agent.effort],
      ]),
    );
    assert.deepEqual(got, want[level], level);
  }
});

test("show: seat b is in agents only at high", () => {
  for (const level of levels) {
    assert.equal("workflow-reviewer-b" in show(level).agents, level === "high", level);
  }
});

test("show: seats is a at standard and a, b at high", () => {
  for (const level of levels) {
    assert.deepEqual(show(level).seats, level === "high" ? ["a", "b"] : ["a"], level);
  }
});

test("history: no file on origin gives since null and no --search", () => {
  git(seed, "rm", "-q", FILE);
  git(seed, "commit", "-q", "-m", "no level");
  git(seed, "push", "-q", "origin", "trunk");
  const d = listHistory({ json: "[]" });
  assert.equal(d.status, "ok");
  assert.equal(d.since, null);
  const args = readFileSync(ghArgs, "utf8");
  assert.ok(!args.includes("--search"), args);
  assert.ok(
    lines(args).includes("pr list --state merged --limit 1000 --json number,url,body,mergedAt"),
    args,
  );
});

test("history: evaluated on origin gives --search merged:>2026-11-01 and since", () => {
  publish(levelFile("standard", "2026-11-01", "2099-02-18"));
  const d = listHistory({ json: "[]" });
  assert.equal(d.since, "2026-11-01");
  const args = readFileSync(ghArgs, "utf8");
  assert.ok(args.includes("--search merged:>2026-11-01"), args);
});

test("history: runs and groups split by level and source, standard before high, sendBacks = taskRounds - tasks", () => {
  const d = listHistory({ json: prs });
  assert.equal(d.prs, 6);
  assert.deepEqual(
    d.runs.map((run: { pr: number }) => run.pr),
    [2, 4, 5, 1],
  );
  assert.deepEqual(d.runs.at(-1), {
    pr: 1,
    url: "u1",
    mergedAt: "2026-11-10T00:00:00Z",
    level: "standard",
    source: "file",
    tasks: 2,
    taskRounds: 3,
    integrationRounds: 2,
    findings: 4,
  });
  assert.deepEqual(d.groups, [
    {
      level: "standard",
      source: "file",
      runs: 2,
      tasks: 5,
      taskRounds: 7,
      integrationRounds: 3,
      findings: 5,
      sendBacks: 2,
      sendBacksPerTask: 0.4,
      findingsPerTask: 1,
    },
    {
      level: "standard",
      source: "override",
      runs: 1,
      tasks: 0,
      taskRounds: 0,
      integrationRounds: 1,
      findings: 0,
      sendBacks: 0,
      sendBacksPerTask: null,
      findingsPerTask: null,
    },
    {
      level: "high",
      source: "override",
      runs: 1,
      tasks: 1,
      taskRounds: 2,
      integrationRounds: 0,
      findings: 3,
      sendBacks: 1,
      sendBacksPerTask: 1,
      findingsPerTask: 3,
    },
  ]);
});

test("history: a numeric Level: line is in unread and in no run", () => {
  assert.deepEqual(listHistory({ json: prs }).unread, [
    {
      pr: 6,
      line: "Level: 2 (file) · tasks 1 · task rounds 1 · integration rounds 0 · findings 0",
    },
  ]);
});

test("history: gh failing gives stop gh", () => {
  const failing = JSON.parse(printed(history(clone, { json: "[]", fail: true })));
  assert.equal(`${failing.status} ${failing.reason}`, "stop gh");
  assert.ok(String(failing.message).includes("gh: not logged in"), JSON.stringify(failing));
  const notJson = listHistory({ json: "not json" });
  assert.equal(`${notJson.status} ${notJson.reason}`, "stop gh");
});

test("history: no <dir>, a directory outside a clone or a missing one exits 1 without running gh", () => {
  exitsOne("history");
  rmSync(ghArgs, { force: true });
  assert.equal(history(plain, { json: "[]" }).status, 1);
  const missing = history(join(tmp, "missing"), { json: "[]" });
  assert.equal(missing.status, 1, `${missing.stdout}${missing.stderr}`);
  assert.notEqual(captured(missing.stderr), "");
  assert.ok(!captured(missing.stderr).includes("\n"), missing.stderr);
  assert.ok(!existsSync(ghArgs), existsSync(ghArgs) ? readFileSync(ghArgs, "utf8") : "");
});
