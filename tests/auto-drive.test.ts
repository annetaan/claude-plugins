import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Next } from "../plugins/annetaan/skills/pj1-plan/scripts/pure/project-view.ts";
import {
  beginLine,
  child,
  endedLine,
  progress,
  ran,
  start,
  startedLine,
  stepLine,
  stepPaths,
  type Child,
  type Drive,
} from "../plugins/annetaan/skills/pj-auto/scripts/pure/drive.ts";
import {
  baseRules,
  blocks,
  judge,
  settingsOf,
  type FileLists,
  type Lists,
} from "../plugins/annetaan/skills/pj-auto/scripts/pure/rules.ts";

const root = join(import.meta.dirname, "..");
const autoSh = join(root, "plugins/annetaan/skills/pj-auto/scripts/auto.sh");

const view = (
  next: Next["next"],
  fingerprint: string,
  issue: number | null = null,
  why = "w",
): Next => ({ next, why, issue, url: null, fingerprint });

const out = (fields: Readonly<Record<string, unknown>>): string => JSON.stringify(fields);

const drive0: Drive = { i: 0, doctorKeys: [], noLine: [] };

const paths = stepPaths("/log", 1, "running");

const doneChild: Child = {
  code: 0,
  out: out({ is_error: false, result: "all good\nunattended: done" }),
  err: "",
};

const walk = (
  views: readonly Next[],
  childOf: (i: number) => Child,
): readonly Readonly<Record<string, unknown>>[] => {
  const lines: Readonly<Record<string, unknown>>[] = [startedLine("/log", "/main", 7)];
  let drive = drive0;
  let at = 0;
  let cur = views[at];
  for (;;) {
    assert.ok(cur !== undefined);
    const s = start(drive, cur, false);
    if (s.kind === "end") {
      lines.push(endedLine(s.end, drive.noLine, null, [], "/log"));
      return lines;
    }
    drive = s.drive;
    const p = stepPaths("/log", drive.i, s.run);
    lines.push(beginLine(drive.i, s.run, cur, "t", p, "/log"));
    const r = ran(drive, s.skill, cur, childOf(drive.i), p);
    if (r.kind === "end") {
      lines.push(endedLine(r.end, drive.noLine, drive.i, r.denials, "/log"));
      return lines;
    }
    drive = r.drive;
    lines.push(stepLine(drive.i, s.run, cur, "t", "/log", r.result, r.denials));
    at += 1;
    const n = views[at];
    assert.ok(n !== undefined);
    const stalled = progress(cur, n, drive.i);
    if (stalled !== null) {
      lines.push(endedLine(stalled, drive.noLine, null, [], "/log"));
      return lines;
    }
    cur = n;
  }
};

const runningThenDone: readonly Next[] = [
  view("running", "f1", 1),
  view("running", "f2", 2),
  view("done", "f3"),
];

test("a drive of done steps ends as done", () => {
  const lines = walk(runningThenDone, () => doneChild);
  assert.deepEqual(
    lines.map((line) => line["status"]),
    ["started", "begin", "step", "begin", "step", "ended"],
  );
  const last = lines.at(-1);
  assert.equal(last?.["reason"], "done");
  assert.equal(last?.["i"], null);
  assert.deepEqual(last?.["noLine"], []);
  assert.deepEqual(Object.keys(lines[1] ?? {}), [
    "status",
    "i",
    "run",
    "why",
    "issue",
    "at",
    "dir",
    "out",
    "err",
    "log",
  ]);
  assert.deepEqual(Object.keys(lines[2] ?? {}), [
    "status",
    "i",
    "run",
    "why",
    "issue",
    "at",
    "log",
    "result",
    "denials",
  ]);
  assert.deepEqual(Object.keys(last ?? {}), [
    "status",
    "reason",
    "next",
    "message",
    "noLine",
    "i",
    "denials",
    "log",
  ]);
  assert.deepEqual(Object.keys(lines[0] ?? {}), ["status", "log", "main", "project"]);
  assert.equal(lines[3]?.["out"], "/log/2-running.json");
});

test("start ends the drive on a stop, user, done and the doctor cap", () => {
  const stopped = start(drive0, view("running", "f"), true);
  assert.equal(stopped.kind === "end" && stopped.end.reason, "stop-requested");
  assert.equal(stopped.kind === "end" && stopped.end.message, "stopped at the user's word");
  const user = start(drive0, view("user", "f", null, "split"), false);
  assert.deepEqual(user, {
    kind: "end",
    end: { reason: "user", next: view("user", "f", null, "split"), message: "split" },
  });
  const done = start(drive0, view("done", "f"), false);
  assert.equal(done.kind === "end" && done.end.reason, "done");
  let drive = drive0;
  for (const i of [1, 2]) {
    const s = start(drive, view("doctor", "f", 5), false);
    assert.equal(s.kind, "run");
    if (s.kind === "run") {
      assert.equal(s.run, "doctor");
      assert.equal(s.skill, "pj3-doctor");
      assert.equal(s.drive.i, i);
      drive = s.drive;
    }
  }
  const capped = start(drive, view("doctor", "f", 5), false);
  assert.equal(capped.kind === "end" && capped.end.reason, "doctor-cap");
  assert.equal(capped.kind === "end" && capped.end.message, "pj3-doctor already ran twice on 5");
  const order = start(drive0, view("doctor", "f"), false);
  assert.deepEqual(order.kind === "run" && order.drive.doctorKeys, ["order"]);
  const running = start(drive0, view("running", "f", 3), false);
  assert.equal(running.kind === "run" && running.skill, "pj4-running");
});

test("an unchanged fingerprint ends as no-progress", () => {
  const n = view("running", "same", 4);
  assert.deepEqual(progress(view("running", "same", 3), n, 3), {
    reason: "no-progress",
    next: n,
    message: "the state did not change after step 3",
  });
  assert.equal(progress(view("running", "a"), view("running", "b"), 3), null);
});

const failedMessage = `pj4-running failed: see ${paths.err} and ${paths.out}`;

const ranOne = (c: Child) =>
  ran({ ...drive0, i: 1 }, "pj4-running", view("running", "f"), c, paths);

test("a failed run ends as child-failed", () => {
  const denied = out({
    is_error: false,
    result: "unattended: done",
    permission_denials: [{ tool_name: "Bash", tool_input: { command: "make test" } }],
  });
  const cases: readonly [Child, readonly unknown[]][] = [
    [{ code: 1, out: denied, err: "" }, [{ tool: "Bash", input: "make test" }]],
    [{ code: 0, out: "not json", err: "" }, []],
    [{ code: 0, out: out({ is_error: true, result: "unattended: done" }), err: "" }, []],
  ];
  for (const [c, denials] of cases) {
    const r = ranOne(c);
    assert.equal(r.kind, "end");
    if (r.kind === "end") {
      assert.equal(r.end.reason, "child-failed");
      assert.equal(r.end.message, failedMessage);
      assert.deepEqual(r.end.next, view("running", "f"));
      assert.deepEqual(r.denials, denials);
    }
  }
});

test("needs-user ends the drive with the run's last line", () => {
  const r = ranOne({
    code: 0,
    out: out({ is_error: false, result: "stuck\nunattended: needs-user テストが拒否されました\n" }),
    err: "",
  });
  assert.equal(r.kind, "end");
  if (r.kind === "end") {
    assert.equal(r.end.reason, "needs-user");
    assert.equal(r.end.message, "unattended: needs-user テストが拒否されました");
  }
});

const BACKGROUND = [
  "before",
  'Background tasks still running 10m after the last turn (shell "テストを確認"); stopping them. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.',
  "after",
].join("\n");

test("background tasks end a run with no last line as bg-killed", () => {
  const working = out({ is_error: false, result: "working on it" });
  const drive = { ...drive0, i: 1 };
  const killed = ran(
    drive,
    "pj4-running",
    view("running", "f"),
    { code: 0, out: working, err: BACKGROUND },
    paths,
  );
  assert.equal(killed.kind, "end");
  if (killed.kind === "end") {
    assert.equal(killed.end.reason, "bg-killed");
    assert.ok(killed.end.message.includes('shell "テストを確認"'), killed.end.message);
    assert.ok(killed.end.message.startsWith("claude -p stopped the background tasks of step 1,"));
    const line = endedLine(killed.end, drive.noLine, drive.i, killed.denials, "/log");
    assert.deepEqual(line.noLine, []);
    assert.equal(line.i, 1);
  }
  const done = ranOne({ ...doneChild, err: BACKGROUND });
  assert.equal(done.kind === "step" && done.result, "done");
  const noLine = ranOne({ code: 0, out: working, err: "" });
  assert.equal(noLine.kind, "step");
  if (noLine.kind === "step") {
    assert.equal(noLine.result, "no-line");
    assert.deepEqual(noLine.drive.noLine, [1]);
  }
  const lines = walk(runningThenDone, () => ({ code: 0, out: working, err: "" }));
  assert.deepEqual(
    lines.filter((line) => line["status"] === "step").map((line) => line["result"]),
    ["no-line", "no-line"],
  );
  assert.deepEqual(lines.at(-1)?.["noLine"], [1, 2]);
  assert.equal(lines.at(-1)?.["reason"], "done");
});

const DENIED =
  '{"is_error":false,"result":"stuck\\nunattended: needs-user make test was refused","permission_denials":[{"tool_name":"Bash","tool_use_id":"t1","tool_input":{"command":"make test","description":"d"}},{"tool_name":"Write","tool_use_id":"t2","tool_input":{"file_path":"/etc/x","content":"c"}},{"tool_name":"WebFetch","tool_use_id":"t3","tool_input":{"url":"https://example.com"}}]}';
const DONE_DENIED =
  '{"is_error":false,"result":"ok\\nunattended: done","permission_denials":[{"tool_name":"Bash","tool_use_id":"t1","tool_input":{"command":"make test","description":"d"}}]}';

test("refused calls carry tool and input", () => {
  const r = ranOne({ code: 0, out: DENIED, err: "" });
  assert.equal(r.kind, "end");
  if (r.kind === "end") {
    assert.equal(r.end.reason, "needs-user");
    const line = endedLine(r.end, [], 1, r.denials, "/log");
    assert.equal(line.i, 1);
    assert.deepEqual(line.denials, [
      { tool: "Bash", input: "make test" },
      { tool: "Write", input: "/etc/x" },
      { tool: "WebFetch", input: '{"url":"https://example.com"}' },
    ]);
  }
  const lines = walk(runningThenDone, () => ({ code: 0, out: DONE_DENIED, err: "" }));
  const steps = lines.filter((line) => line["status"] === "step");
  assert.equal(steps.length, 2);
  for (const step of steps) {
    assert.deepEqual(step["denials"], [{ tool: "Bash", input: "make test" }]);
  }
  assert.equal(lines.at(-1)?.["reason"], "done");
  assert.equal(lines.at(-1)?.["i"], null);
  assert.deepEqual(lines.at(-1)?.["denials"], []);
  const clean = walk(runningThenDone, () => doneChild).filter(
    (line) => line["status"] === "step" || line["status"] === "ended",
  );
  assert.equal(clean.length, 3);
  for (const line of clean) {
    assert.deepEqual(line["denials"], []);
  }
  const odd = ranOne({
    code: 0,
    out: out({
      is_error: false,
      result: "unattended: done",
      permission_denials: ["x", 1, { tool_input: { file_path: "/a" } }],
    }),
    err: "",
  });
  assert.deepEqual(odd.denials, [{ tool: null, input: "/a" }]);
});

test("the child runs in auto mode with the base rules granted", () => {
  const c = child("pj4-running", 7, "/log/1-running", null, baseRules("/s"));
  assert.deepEqual(c.argv.slice(0, 3), [
    "claude",
    "-p",
    "/annetaan:pj4-running 7 unattended tmp=/log/1-running",
  ]);
  assert.equal(c.argv[c.argv.indexOf("--permission-mode") + 1], "auto");
  assert.deepEqual(
    c.argv.slice(c.argv.indexOf("--allowedTools") + 1, c.argv.indexOf("--add-dir")),
    baseRules("/s"),
  );
  assert.equal(baseRules("/s").length, 9);
  assert.deepEqual(c.argv.slice(-4), ["--add-dir", "/log/1-running", "--output-format", "json"]);
  assert.deepEqual(c.env, { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "3600000" });
  const high = child("pj3-doctor", 7, "/log/1-doctor", "high", baseRules("/s"));
  assert.equal(high.argv[2], "/annetaan:pj3-doctor 7 unattended tmp=/log/1-doctor level=high");
});

const lists = (deny: readonly string[] = [], ask: readonly string[] = []): Lists => ({ deny, ask });

const judged = (
  rule: string,
  user: Lists = lists(),
  project: Lists = lists(),
  local: Lists = lists(),
) => {
  const files: readonly FileLists[] = [
    { file: "/u", lists: user },
    { file: "/p", lists: project },
    { file: "/l", lists: local },
  ];
  return judge(rule, files, "/h");
};

const granted = (rule: string) => ({ rule, verdict: "granted", file: null, by: null });

const blocked = (rule: string, file: string, by: string) => ({
  rule,
  verdict: "blocked",
  file,
  by,
});

test("blocks keeps the verdicts of the Python rules", () => {
  const [gh = "", git = "", , , , , , , read = ""] = baseRules("/t/skills");
  assert.equal(gh, "Bash(gh:*)");
  assert.equal(read, "Read(//t/skills/**)");
  assert.deepEqual(judged(gh, lists(["Bash(gh:*)"])), blocked(gh, "/u", "Bash(gh:*)"));
  assert.deepEqual(judged(git, lists(["Bash(gh:*)"])), granted(git));
  const allowOnly = settingsOf('{"permissions": {"allow": ["Bash(ghx:*)", "Bash(gh:*)"]}}');
  assert.ok(!("error" in allowOnly));
  assert.deepEqual(judged(gh, allowOnly), granted(gh));
  for (const form of ["Bash(gh *)", "Bash", "Bash(*)", "Bash(gh pr:*)", "Bash(gh pr merge)"]) {
    assert.deepEqual(judged(gh, lists(), lists(), lists([], [form])), blocked(gh, "/l", form));
  }
  assert.deepEqual(judged(gh, lists([], ["Bash(ghx:*)", "Bash(g:*)"])), granted(gh));
  assert.deepEqual(
    judged(gh, lists([], ["Bash(gh pr:*)"]), lists(), lists(["Bash(gh pr merge)"])),
    blocked(gh, "/l", "Bash(gh pr merge)"),
  );
  assert.deepEqual(judged(read, lists(["Read(//t/**)"])), blocked(read, "/u", "Read(//t/**)"));
  assert.deepEqual(
    judged(read, lists([], ["Read(//t/skills/pj-auto/**)"])),
    blocked(read, "/u", "Read(//t/skills/pj-auto/**)"),
  );
  assert.equal(blocks("Read(~/skills/**)", "Read(//h/skills/**)", "/h"), true);
  assert.equal(blocks("Read(~/skills/**)", "Read(//h/skills/**)", "/x"), false);
  assert.equal(blocks("Read(//t/日本語/**)", "Read(//t/日本語/skills/**)", "/h"), true);
  assert.equal(blocks("Read(//t/日本語/**)", "Read(//t/日本語x/skills/**)", "/h"), false);
  const broken = settingsOf("{");
  assert.ok("error" in broken && broken.error !== "");
  assert.deepEqual(settingsOf('{"permissions":{"deny":["a",1]}}'), { deny: ["a"], ask: [] });
});

test("every script the pj skills call has a base rule", () => {
  const skills = join(root, "plugins/annetaan/skills");
  const prefix = `Bash(${skills}/`;
  const suffix = ":*)";
  const ruled = new Set(
    baseRules(skills)
      .filter((rule) => rule.startsWith(prefix) && rule.endsWith(suffix))
      .map((rule) => rule.slice(prefix.length, -suffix.length)),
  );
  const call = /\$[A-Z]+(?:\/\.\.\/([a-z0-9-]+))?\/scripts\/([A-Za-z0-9_-]+\.[a-z]+)/gu;
  const unruled = new Set<string>();
  for (const skill of ["pj1-plan", "pj3-doctor", "pj4-running", "workflow"]) {
    const dir = join(skills, skill);
    for (const name of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
      if (!name.endsWith(".md")) {
        continue;
      }
      for (const found of readFileSync(join(dir, name), "utf8").matchAll(call)) {
        const needed = `${found[1] ?? skill}/scripts/${found[2] ?? ""}`;
        if (
          !ruled.has(needed) &&
          needed !== "workflow/scripts/worktree.sh" &&
          needed !== "workflow/scripts/include.sh"
        ) {
          unruled.add(needed);
        }
      }
    }
  }
  assert.deepEqual([...unruled], []);
});

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const which = (name: string): string => {
  const found = (process.env["PATH"] ?? "")
    .split(delimiter)
    .filter((dir) => dir !== "")
    .map((dir) => join(dir, name))
    .find(isExecutable);
  if (found === undefined) {
    throw new Error(`no ${name} on the PATH`);
  }
  return found;
};

const bashPath = which("bash");
const gitPath = which("git");
const dirnamePath = which("dirname");
const psPath = which("ps");
const sleepPath = which("sleep");

const tmp = mkdtempSync(join(tmpdir(), "auto-drive-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const repo = join(tmp, "repo");
mkdirSync(home);
assert.equal(spawnSync(gitPath, ["init", "-q", "-b", "main", repo]).status, 0);

let made = 0;

const fresh = (name: string): string => {
  made += 1;
  const dir = join(tmp, `${name}${made}`);
  mkdirSync(dir);
  return dir;
};

const bin = (fakes: Readonly<Record<string, string>>): string => {
  const dir = fresh("bin");
  symlinkSync(process.execPath, join(dir, basename(process.execPath)));
  for (const tool of [gitPath, bashPath, dirnamePath]) {
    symlinkSync(tool, join(dir, basename(tool)));
  }
  for (const [name, body] of Object.entries(fakes)) {
    writeFileSync(join(dir, name), body, { mode: 0o755 });
  }
  return dir;
};

const env = (binDir: string, extra: Readonly<Record<string, string>> = {}) => ({
  PATH: binDir,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CEILING_DIRECTORIES: tmp,
  ...extra,
});

const drive = (
  args: readonly string[],
  cwd: string,
  environment: Readonly<Record<string, string>>,
) => spawnSync(bashPath, [autoSh, ...args], { cwd, env: environment, encoding: "utf8" });

const jsonLines = (text: string): readonly Readonly<Record<string, unknown>>[] =>
  text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Readonly<Record<string, unknown>>);

const neverRun = "#!/bin/sh\nexit 1\n";

test("bad arguments exit 1", () => {
  const e = env(bin({ claude: neverRun }));
  const log = fresh("log");
  const cases: readonly [readonly string[], string | null][] = [
    [["7", "--log", log, "--level", "4"], null],
    [["7", "--log", log, "--level", "2"], null],
    [["7", "--log", log, "--tier", "1"], null],
    [["x7", "--log", log], "auto: the project must be a number: x7\n"],
    [["7", "--log", join(tmp, "missing")], `auto: no such directory: ${join(tmp, "missing")}\n`],
  ];
  for (const [args, stderr] of cases) {
    const result = drive(args, repo, e);
    assert.equal(result.status, 1, args.join(" "));
    assert.equal(result.stdout, "");
    if (stderr === null) {
      assert.ok(result.stderr.startsWith("usage: auto.sh"), result.stderr);
    } else {
      assert.equal(result.stderr, stderr);
    }
  }
  const rules = drive(["--rules", "Bash(gh:*)"], repo, e);
  assert.equal(rules.status, 1);
  assert.equal(rules.stdout, "");
  assert.ok(rules.stderr.startsWith("usage: auto.sh"), rules.stderr);
});

test("the drive ends before any step without a repository or claude", () => {
  const noRepoLog = fresh("log");
  const noRepo = drive(["7", "--log", noRepoLog], tmp, env(bin({ claude: neverRun })));
  assert.equal(noRepo.status, 0, noRepo.stderr);
  const noRepoLines = jsonLines(noRepo.stdout);
  assert.deepEqual(
    noRepoLines.map((line) => line["status"]),
    ["started", "ended"],
  );
  assert.equal(noRepoLines[0]?.["main"], "");
  assert.equal(noRepoLines[1]?.["reason"], "not-a-repo");
  assert.equal(readFileSync(join(noRepoLog, "drive.jsonl"), "utf8"), noRepo.stdout);

  const noClaudeLog = fresh("log");
  const noClaude = drive(["7", "--log", noClaudeLog], repo, env(bin({})));
  assert.equal(noClaude.status, 0, noClaude.stderr);
  const noClaudeLines = jsonLines(noClaude.stdout);
  assert.deepEqual(
    noClaudeLines.map((line) => line["status"]),
    ["started", "ended"],
  );
  assert.equal(noClaudeLines[1]?.["reason"], "no-claude");
  assert.equal(noClaudeLines[1]?.["message"], "the claude CLI is not installed");
  assert.equal(readFileSync(join(noClaudeLog, "drive.jsonl"), "utf8"), noClaude.stdout);
});

test("a failing project read ends the drive as project", () => {
  const fake = fresh("fake");
  const called = join(fake, "called");
  const target = join(fake, "target");
  const binDir = bin({
    claude: neverRun,
    caffeinate: `#!/bin/sh\n${psPath} -o command= -p "$3" > '${target}'\necho "$*" > '${called}'\n`,
    gh: `#!/bin/sh\nfor _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25; do\n  [ -s '${called}' ] && break\n  ${sleepPath} 0.2\ndone\nexit 1\n`,
  });
  const log = fresh("log");
  const result = drive(["7", "--log", log], repo, env(binDir));
  assert.equal(result.status, 0, result.stderr);
  const lines = jsonLines(result.stdout);
  assert.deepEqual(
    lines.map((line) => line["status"]),
    ["started", "ended"],
  );
  const ended = lines[1];
  assert.equal(ended?.["reason"], "project");
  assert.equal(ended?.["next"], null);
  assert.ok(String(ended?.["message"]).startsWith("project: "), String(ended?.["message"]));
  assert.match(readFileSync(called, "utf8"), /^-i -w \d+\n$/u);
  assert.ok(readFileSync(target, "utf8").includes("pj-auto/scripts/auto.ts"));
  assert.equal(readFileSync(join(log, "drive.jsonl"), "utf8"), result.stdout);
});

test("--rules judges the base rules against the settings files", () => {
  const config = join(tmp, "config");
  mkdirSync(config);
  mkdirSync(join(repo, ".claude"));
  const e = env(bin({}), { CLAUDE_CONFIG_DIR: config });
  const local = join(repo, ".claude", "settings.local.json");
  const user = join(config, "settings.json");
  const rules = () => {
    const result = drive(["--rules"], repo, e);
    assert.equal(result.status, 0, result.stderr);
    const lines = jsonLines(result.stdout);
    assert.equal(lines.length, 1);
    const [line] = lines;
    assert.ok(line !== undefined);
    return line as {
      readonly status: string;
      readonly main: string;
      readonly base: readonly Readonly<Record<string, unknown>>[];
      readonly settings: readonly Readonly<Record<string, unknown>>[];
    };
  };

  const plain = rules();
  assert.deepEqual(Object.keys(plain), ["status", "main", "base", "settings"]);
  assert.equal(plain.status, "rules");
  assert.equal(plain.base.length, 9);
  for (const verdict of plain.base) {
    assert.deepEqual(Object.keys(verdict), ["rule", "verdict", "file", "by"]);
    assert.equal(verdict["verdict"], "granted");
    assert.equal(verdict["file"], null);
    assert.equal(verdict["by"], null);
  }
  const main = plain.main;
  assert.deepEqual(
    plain.settings.map((entry) => Object.keys(entry)),
    [
      ["file", "exists", "error"],
      ["file", "exists", "error"],
      ["file", "exists", "error"],
    ],
  );
  assert.deepEqual(
    plain.settings.map((entry) => entry["file"]),
    [user, join(main, ".claude", "settings.json"), join(main, ".claude", "settings.local.json")],
  );
  const skills = join(root, "plugins/annetaan/skills");
  assert.deepEqual(
    plain.base.map((verdict) => verdict["rule"]),
    baseRules(skills),
  );

  writeFileSync(local, '{"permissions": {"ask": ["Bash(gh *)"]}}\n');
  assert.deepEqual(rules().base[0], {
    rule: "Bash(gh:*)",
    verdict: "blocked",
    file: join(main, ".claude", "settings.local.json"),
    by: "Bash(gh *)",
  });

  writeFileSync(local, '{"permissions": {"deny": ["Bash(gh:*)"]}\n');
  const broken = rules();
  assert.equal(broken.base[0]?.["verdict"], "granted");
  const withError = broken.settings.filter((entry) => entry["error"] !== null);
  assert.equal(withError.length, 1);
  assert.equal(withError[0]?.["file"], join(main, ".claude", "settings.local.json"));
  assert.equal(withError[0]?.["exists"], true);
  assert.ok(String(withError[0]?.["error"]) !== "");
  rmSync(local);

  writeFileSync(user, '{"permissions": {"deny": ["Bash(git:*)"]}}\n');
  assert.deepEqual(rules().base[1], {
    rule: "Bash(git:*)",
    verdict: "blocked",
    file: user,
    by: "Bash(git:*)",
  });
});
