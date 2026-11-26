import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cap } from "../plugins/annetaan/skills/pr-humans/scripts/pure/cap.ts";
import {
  bySessionStart,
  matchSession,
  type Session,
} from "../plugins/annetaan/skills/pr-humans/scripts/pure/gather.ts";
import {
  checkboxEvents,
  linkedIssueNumbers,
  type GraphqlPullRequest,
  type PullRequestView,
} from "../plugins/annetaan/skills/pr-humans/scripts/pure/github.ts";
import { knownValues, lint } from "../plugins/annetaan/skills/pr-humans/scripts/pure/privacy.ts";
import {
  MARKER,
  pickRecord,
  previousBody,
  recordedBy,
} from "../plugins/annetaan/skills/pr-humans/scripts/pure/record.ts";

const script = join(
  import.meta.dirname,
  "../plugins/annetaan/skills/pr-humans/scripts/pr-humans.sh",
);

const tmp = mkdtempSync(join(tmpdir(), "pr-humans-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
const fake = join(tmp, "fake");
const projects = join(tmp, "projects");
const logs = join(projects, "-work-r");
const repo = join(tmp, "repo");
for (const dir of [home, bin, fake, logs, repo]) {
  mkdirSync(dir, { recursive: true });
}

const env: Readonly<NodeJS.ProcessEnv> = {
  ...process.env,
  PATH: `${bin}:${process.env["PATH"] ?? ""}`,
  HOME: home,
  PR_HUMANS_PROJECTS: projects,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CEILING_DIRECTORIES: tmp,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

const calls = join(fake, "calls.log");

writeFileSync(
  join(bin, "gh"),
  [
    "#!/usr/bin/env bash",
    `FAKE='${fake}'`,
    'printf \'%s\\n\' "$*" >>"$FAKE/calls.log"',
    'case "$*" in',
    '  "repo view"*) echo \'{"nameWithOwner":"o/r"}\' ;;',
    '  "api graphql"*"pullRequest(number"*) cat "$FAKE/pr.json" ;;',
    '  "api graphql"*"issue(number"*) cat "$FAKE/issue.json" ;;',
    '  "api user") echo \'{"login":"me"}\' ;;',
    '  "api --paginate"*) cat "$FAKE/comments.json" ;;',
    '  "api -X PATCH"* | "api -X POST"*)',
    '    cat >"$FAKE/payload.json"',
    '    echo \'{"html_url":"https://github.com/o/r/pull/7#issuecomment-1"}\'',
    "    ;;",
    '  *) echo "unexpected: $*" >&2; exit 1 ;;',
    "esac",
    "",
  ].join("\n"),
);
chmodSync(join(bin, "gh"), 0o755);

const gitInit = spawnSync("git", ["init", "-q", repo], { env, encoding: "utf8" });
assert.equal(gitInit.status, 0, gitInit.stderr);
const root = realpathSync(repo);

type Ran = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

const prHumans = (
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: Readonly<NodeJS.ProcessEnv> } = {},
): Ran => {
  rmSync(calls, { force: true });
  const result = spawnSync(script, args, {
    cwd: options.cwd ?? tmp,
    env: options.env ?? env,
    encoding: "utf8",
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

const parsed = (ran: Ran, code = 0): Record<string, unknown> => {
  assert.equal(ran.code, code, ran.stderr);
  return JSON.parse(ran.stdout) as Record<string, unknown>;
};

const ghCalls = (): string => (existsSync(calls) ? readFileSync(calls, "utf8") : "");

const writeRows = (name: string, rows: readonly unknown[]): string => {
  const path = join(logs, `${name}.jsonl`);
  writeFileSync(path, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
  return path;
};

const put = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const base = {
  sessionId: "s1",
  entrypoint: "cli",
  cwd: root,
  gitBranch: "feat/x",
  isSidechain: false,
};
const user1 = (content: unknown, extra: Readonly<Record<string, unknown>> = {}) => ({
  ...base,
  type: "user",
  timestamp: "2026-11-16T01:00:00Z",
  message: { role: "user", content },
  ...extra,
});
const assistant1 = (text: string) => ({
  ...base,
  type: "assistant",
  timestamp: "2026-11-16T01:00:01Z",
  message: { role: "assistant", content: [{ type: "text", text }] },
});

const mainLog = writeRows("11111111-2222-3333-4444-555555555555", [
  user1("Add the export button\n<system-reminder>ignore me</system-reminder>"),
  user1(
    "<command-message>annetaan:workflow</command-message>\n<command-name>/annetaan:workflow</command-name>\n<command-args>export button</command-args>",
  ),
  user1("<system-reminder>only a reminder</system-reminder>"),
  user1("Another Claude session sent a message: hi"),
  user1([{ type: "tool_result", tool_use_id: "t1", content: "answered" }], {
    toolUseResult: {
      questions: [],
      answers: { "Approve the design?": "Approve" },
      annotations: {},
    },
  }),
  user1([
    {
      type: "tool_result",
      tool_use_id: "t2",
      is_error: true,
      content: "The user doesn't want to proceed with this tool use. the user said: use CSV",
    },
  ]),
  user1("[Request interrupted by user]"),
  user1("subagent prompt", { isSidechain: true }),
  user1("meta", { isMeta: true }),
  assistant1("Opened https://github.com/o/r/pull/7"),
  {
    type: "pr-link",
    sessionId: "s1",
    prNumber: 7,
    prUrl: "https://github.com/o/r/pull/7",
    prRepository: "o/r",
    timestamp: "2026-11-16T01:00:02Z",
  },
  user1(
    "<command-name>/annetaan:pr-humans</command-name>\n<command-args>https://github.com/o/r/pull/70</command-args>",
  ),
  assistant1("Gathering."),
  user1([{ type: "tool_result", tool_use_id: "t3", content: "answered" }], {
    toolUseResult: { questions: [], answers: { "Post it?": "Yes" }, annotations: {} },
  }),
  user1([
    {
      type: "tool_result",
      tool_use_id: "t4",
      is_error: true,
      content: "The user doesn't want to proceed with this tool use. the user said: not yet",
    },
  ]),
  user1("[Request interrupted by user]"),
]);

writeFileSync(
  join(logs, "other.jsonl"),
  [
    '{"type":"user","sessionId":"s2","entrypoint":"cli","cwd":"/elsewhere","gitBranch":"main","timestamp":"2026-11-17T00:00:00Z","message":{"role":"user","content":"<command-name>/annetaan:pr-humans</command-name>\\n<command-args>7</command-args>"}}',
    '{"type":"assistant","sessionId":"s2","cwd":"/elsewhere","gitBranch":"main","timestamp":"2026-11-17T00:00:01Z","message":{"role":"assistant","content":[{"type":"text","text":"Recorded https://github.com/o/r/pull/7"}]}}',
    "",
  ].join("\n"),
);
writeFileSync(
  join(logs, "onlyrun.jsonl"),
  [
    `{"type":"user","sessionId":"s5","entrypoint":"cli","cwd":"${root}","gitBranch":"feat/x","timestamp":"2026-11-17T01:00:00Z","message":{"role":"user","content":"<command-name>/annetaan:pr-humans</command-name>\\n<command-args></command-args>"}}`,
    `{"type":"assistant","sessionId":"s5","cwd":"${root}","gitBranch":"feat/x","timestamp":"2026-11-17T01:00:01Z","message":{"role":"assistant","content":[{"type":"text","text":"Recorded https://github.com/o/r/pull/7"}]}}`,
    "",
  ].join("\n"),
);
writeFileSync(
  join(logs, "plan.jsonl"),
  [
    `{"type":"user","sessionId":"s3","entrypoint":"cli","cwd":"${root}","gitBranch":"main","timestamp":"2026-11-10T00:00:00Z","message":{"role":"user","content":"Plan https://github.com/o/r/issues/5 please"}}`,
    "",
  ].join("\n"),
);
writeFileSync(
  join(logs, "fifty.jsonl"),
  [
    `{"type":"user","sessionId":"s4","entrypoint":"cli","cwd":"${root}","gitBranch":"main","timestamp":"2026-11-10T00:00:00Z","message":{"role":"user","content":"Look at https://github.com/o/r/issues/50"}}`,
    "",
  ].join("\n"),
);

let tick = 0;
const stamp = (): string => {
  tick += 1;
  return `2026-11-18T00:00:${String(tick).padStart(2, "0")}Z`;
};
const base2 = { entrypoint: "cli", cwd: "/elsewhere", gitBranch: "main", isSidechain: false };
const user = (content: unknown, extra: Readonly<Record<string, unknown>> = {}) => ({
  ...base2,
  type: "user",
  timestamp: stamp(),
  message: { role: "user", content },
  ...extra,
});
const assistant = (...parts: readonly unknown[]) => ({
  ...base2,
  type: "assistant",
  timestamp: stamp(),
  message: { role: "assistant", content: parts },
});
const text = (t: string) => ({ type: "text", text: t });
const skill = (name: string) => ({
  type: "tool_use",
  id: "tu",
  name: "Skill",
  input: { skill: name, args: "" },
});
const command = (name: string, args: string) =>
  user(`<command-name>${name}</command-name>\n<command-args>${args}</command-args>`);
const answer = () =>
  user([{ type: "tool_result", tool_use_id: "t", content: "ok" }], {
    toolUseResult: { questions: [], answers: { "Post it?": "Yes" }, annotations: {} },
  });
const link = (n: number) => ({
  type: "pr-link",
  sessionId: "x",
  prNumber: n,
  prUrl: `https://github.com/o/r/pull/${n}`,
  prRepository: "o/r",
  timestamp: stamp(),
});

const afterrun = writeRows("afterrun", [
  command("/annetaan:pr-humans", "70"),
  answer(),
  assistant(text("Done")),
  user("Now look at https://github.com/o/r/pull/7"),
  command("/annetaan:workflow", "x"),
]);
const skillrun = writeRows("skillrun", [
  user("Record PR 7 with pr-humans: https://github.com/o/r/pull/7"),
  assistant(text("Recording https://github.com/o/r/pull/7"), skill("annetaan:pr-humans")),
  answer(),
  assistant(text("Posted https://github.com/o/r/pull/7")),
]);
writeRows("otherpr", [
  command("/annetaan:pr-humans", "70"),
  assistant(text("Recorded 70")),
  user("Next, https://github.com/o/r/pull/7 needs a fix"),
  assistant(text("ok")),
]);
const otherskill = writeRows("otherskill", [
  user("Fix https://github.com/o/r/pull/7"),
  assistant(skill("annetaan:workflow")),
  assistant(text("ok")),
]);
const cmdbetween = writeRows("cmdbetween", [
  user("Fix https://github.com/o/r/pull/7"),
  command("/annetaan:workflow", "x"),
  assistant(skill("annetaan:pr-humans")),
  answer(),
]);
const twolinks = writeRows("twolinks", [
  user("Work on it"),
  link(7),
  assistant(text("opened")),
  link(8),
]);

const unicodeLogs = join(tmp, "unicode");
mkdirSync(unicodeLogs);
const lineSeparator = String.fromCodePoint(0x2028);
const ideographicSpace = String.fromCodePoint(0x3000);
const separated = join(unicodeLogs, "separated.jsonl");
writeFileSync(
  separated,
  [user(`first${lineSeparator}second`), user("third")].map((row) => JSON.stringify(row)).join("\n"),
);

type Turns = { readonly turns: readonly Record<string, unknown>[] };

const sessionsOf = (path: string): Record<string, unknown> & Turns =>
  parsed(prHumans(["sessions-of", path])) as Record<string, unknown> & Turns;

const kinds = (log: Turns): readonly unknown[] => log.turns.map((turn) => turn["kind"]);

test("sessions-of reads the turn kinds of a session", () => {
  const log = sessionsOf(mainLog);
  assert.equal(log["entrypoint"], "cli");
  assert.deepEqual(log["branches"], ["feat/x"]);
  assert.deepEqual(log["prLinks"], [{ repo: "o/r", number: 7, at: "2026-11-16T01:00:02Z" }]);
  assert.deepEqual(kinds(log), ["message", "command", "answer", "refusal", "interrupt"]);
  assert.equal(log.turns[0]?.["text"], "Add the export button");
  assert.equal(log.turns[1]?.["command"], "/annetaan:workflow");
  assert.equal(log.turns[1]?.["args"], "export button");
  assert.deepEqual(log.turns[2]?.["answers"], [
    { question: "Approve the design?", answer: "Approve" },
  ]);
  assert.match(String(log.turns[3]?.["text"]), /use CSV/u);
  assert.ok(!("talk" in log) && !("cwds" in log), "talk and cwds not printed");
});

test("sessions-of reads a log with CRLF line ends as with LF", () => {
  const crlf = join(unicodeLogs, "crlf.jsonl");
  writeFileSync(crlf, readFileSync(mainLog, "utf8").replaceAll("\n", "\r\n"));
  assert.deepEqual(sessionsOf(crlf), sessionsOf(mainLog));
});

test("sessions-of leaves runs of pr-humans out", () => {
  assert.deepEqual(kinds(sessionsOf(afterrun)), ["message", "command"]);
  assert.deepEqual(sessionsOf(skillrun).turns, []);
  assert.deepEqual(kinds(sessionsOf(otherskill)), ["message"]);
  assert.deepEqual(kinds(sessionsOf(cmdbetween)), ["message", "command"]);
});

test("sessions-of keeps two pr-links in order with their time", () => {
  const links = sessionsOf(twolinks)["prLinks"] as readonly Record<string, unknown>[];
  assert.deepEqual(
    links.map((l) => [l["repo"], l["number"]]),
    [
      ["o/r", 7],
      ["o/r", 8],
    ],
  );
  assert.ok(String(links[0]?.["at"]) < String(links[1]?.["at"]));
});

test("sessions-of keeps a message holding U+2028 as one turn", () => {
  const log = sessionsOf(separated);
  assert.deepEqual(kinds(log), ["message", "message"]);
  assert.equal(log.turns[0]?.["text"], `first${lineSeparator}second`);
});

const graphqlPullRequest = (comments: readonly unknown[]) => ({
  data: {
    viewer: { login: "me" },
    repository: {
      pullRequest: {
        number: 7,
        title: "Export button",
        url: "https://github.com/o/r/pull/7",
        state: "OPEN",
        merged: false,
        mergedAt: null,
        closedAt: null,
        createdAt: "2026-11-16T00:00:00Z",
        author: { login: "me" },
        mergedBy: null,
        headRefName: "feat/x",
        baseRefName: "main",
        body: "Adds the button.",
        commits: { nodes: [] },
        reviews: { nodes: [] },
        comments: { nodes: comments },
        closingIssuesReferences: { nodes: [{ number: 5 }] },
        timelineItems: {
          nodes: [{ __typename: "LabeledEvent", actor: { login: "me" }, label: { name: "x" } }],
        },
      },
    },
  },
});

writeFileSync(
  join(fake, "issue.json"),
  JSON.stringify({
    data: {
      repository: {
        issue: {
          number: 5,
          title: "Export",
          url: "https://github.com/o/r/issues/5",
          state: "OPEN",
          author: { login: "me" },
          body: "",
          labels: { nodes: [] },
          userContentEdits: { nodes: [] },
          comments: { nodes: [] },
          parent: null,
        },
      },
    },
  }),
);

const runs = join(root, "work-reports");
put(join(runs, "2026-01-01-0001-aaaaaaa", "log.md"), "Implements #7\n");
put(join(runs, "2026-01-01-0002-bbbbbbb", "design.md"), "cites #7\n");
put(join(runs, "2026-01-01-0002-bbbbbbb", "plan.md"), "cites #7\n");
put(join(runs, "2026-01-01-0002-bbbbbbb", "log.md"), "Implements #9\n");
put(join(runs, "2026-01-01-0003-ccccccc", "review", "task-1-round-1-a.md"), "as in #7\n");
put(join(runs, "2026-01-01-0004-ddddddd", "log.md"), "課題#7を直した\n");
const worktreeLog = join(
  root,
  ".claude",
  "worktrees",
  "run-x",
  "work-reports",
  "2026-01-02-0001-eeeeeee",
  "log.md",
);
put(worktreeLog, "Implements #7\n");

const plain = {
  author: { login: "other" },
  body: "just a comment",
  createdAt: "2026-11-16T02:00:00Z",
};
const othersRecord = {
  author: { login: "other" },
  body: `${MARKER}\nx`,
  createdAt: "2026-11-16T03:00:00Z",
};
const mine = {
  author: { login: "me" },
  body: `${MARKER}\n## H\nbody`,
  createdAt: "2026-11-16T04:00:00Z",
};

test("gather writes the sessions, the reports and previous.md", () => {
  writeFileSync(
    join(fake, "pr.json"),
    JSON.stringify(graphqlPullRequest([plain, othersRecord, mine])),
  );
  const out = join(tmp, "gathered");
  const summary = parsed(prHumans(["gather", "7", "--out", out], { cwd: repo }));
  assert.equal(summary["previous"], true);
  assert.deepEqual(summary["issues"], [5]);
  assert.equal(summary["dir"], out);
  assert.equal(readFileSync(join(out, "previous.md"), "utf8"), "## H\nbody\n");

  const sessions = JSON.parse(
    readFileSync(join(out, "sessions.json"), "utf8"),
  ) as readonly Session[];
  const why = new Map(sessions.map((s) => [s.session, s.why]));
  assert.deepEqual(why.get("11111111-2222-3333-4444-555555555555"), [
    "created-pr",
    "on-branch",
    "names-pr",
  ]);
  for (const left of ["other", "onlyrun", "skillrun", "fifty"]) {
    assert.ok(!why.has(left), `${left} was taken`);
  }
  assert.deepEqual(why.get("afterrun"), ["names-pr"]);
  assert.deepEqual(why.get("otherpr"), ["names-pr"]);
  assert.deepEqual(why.get("otherskill"), ["names-pr"]);
  assert.deepEqual(why.get("twolinks"), ["created-pr"]);
  assert.deepEqual(why.get("plan"), ["names-issue 5"]);
  const creating = sessions.find((s) => s.session === "11111111-2222-3333-4444-555555555555");
  assert.ok(creating !== undefined);
  assert.deepEqual(creating.cwds, [root]);

  const reports = JSON.parse(readFileSync(join(out, "reports.json"), "utf8")) as readonly {
    readonly file: string;
  }[];
  assert.deepEqual(
    reports.map((r) => r.file),
    [join(runs, "2026-01-01-0001-aaaaaaa", "log.md"), worktreeLog],
  );

  const github = JSON.parse(readFileSync(join(out, "github.json"), "utf8")) as Record<
    string,
    unknown
  >;
  assert.deepEqual(
    (github["comments"] as readonly Record<string, unknown>[]).map((c) => c["body"]),
    ["just a comment"],
  );
  assert.deepEqual(github["events"], [{ __typename: "LabeledEvent", actor: "me", label: "x" }]);

  writeFileSync(join(fake, "pr.json"), JSON.stringify(graphqlPullRequest([plain, othersRecord])));
  const again = parsed(prHumans(["gather", "7", "--out", out], { cwd: repo }));
  assert.equal(again["previous"], false);
  assert.ok(!existsSync(join(out, "previous.md")), "previous.md kept for another account's record");
});

const view = (
  number: number,
  head: string,
  issues: PullRequestView["issues"],
): PullRequestView => ({
  number,
  title: "t",
  url: `https://github.com/o/r/pull/${number}`,
  state: "OPEN",
  merged: false,
  createdAt: "",
  mergedAt: null,
  closedAt: null,
  author: null,
  mergedBy: null,
  head,
  base: "main",
  body: "",
  commits: [],
  humanCommits: [],
  reviews: [],
  comments: [],
  events: [],
  issues,
});

const logFiles = [mainLog, afterrun, skillrun, otherskill, cmdbetween, twolinks].map((path) => ({
  path,
  raw: readFileSync(path, "utf8"),
}));

test("matchSession takes a pr-link of this repository only", () => {
  const eight = logFiles.flatMap(
    (file) => matchSession(file, view(8, "feat/y", []), "o/r", null) ?? [],
  );
  assert.deepEqual(
    eight.map((s) => [s.session, s.why]),
    [["twolinks", ["created-pr"]]],
  );
  const elsewhere = logFiles.flatMap(
    (file) => matchSession(file, view(7, "feat/x", []), "o/other", null) ?? [],
  );
  assert.ok(elsewhere.every((s) => !s.why.includes("created-pr")));
});

test("bySessionStart sorts by first, a missing one first", () => {
  const session = (first: string | null): Session => ({
    file: "f",
    session: String(first),
    why: [],
    entrypoint: null,
    cwd: null,
    branches: [],
    prLinks: [],
    first,
    last: null,
    cwds: [],
    turns: [],
  });
  assert.deepEqual(
    bySessionStart([session("b"), session(null), session("a")]).map((s) => s.first),
    [null, "a", "b"],
  );
});

const body = (d1: string, d2: string, extra = "", prose = "Pick one."): string =>
  `## Decisions\n\n${prose}\n\n### D1. First\n\n- [${d1}] Yes\n- [ ] No\n\n### D2. Second\n\n- [${d2}] Yes\n- [ ] No\n${extra}`;

test("checkboxEvents reads the ticks of an edit history", () => {
  const v1 = body(" ", " ");
  const v2 = body("x", " ");
  const v3 = body("x", "x", "- [x] Maybe\n", "Pick one, please.");
  const events = checkboxEvents([
    { editor: { login: "u" }, editedAt: "3", diff: v3 },
    { editor: { login: "u" }, editedAt: "2", diff: v2 },
    { editor: { login: "u" }, editedAt: "1", diff: v1 },
  ]);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    editor: "u",
    at: "2",
    onlyBoxes: true,
    changed: [{ box: "Yes", checked: true, under: "D1. First" }],
    addedChecked: [],
  });
  assert.equal(events[1]?.onlyBoxes, false);
  assert.deepEqual(events[1]?.changed, [{ box: "Yes", checked: true, under: "D2. Second" }]);
  assert.deepEqual(events[1]?.addedChecked, [{ box: "Maybe", checked: true, under: "D2. Second" }]);
  assert.deepEqual(checkboxEvents([{ diff: v1 }]), []);
});

test("checkboxEvents takes no issue reference for a heading", () => {
  const w1 = "### D1. First\n\n- [ ] Yes\n";
  const w2 = "### D1. First\n\n#5 same way as before\n- [x] Yes\n";
  const w3 = "### D1. First\n\n- [ ] Yes\n";
  const events = checkboxEvents([
    { diff: w3, editedAt: "3" },
    { diff: w2, editedAt: "2" },
    { diff: w1, editedAt: "1" },
  ]);
  assert.deepEqual(
    events.map((e) => e.changed),
    [
      [{ box: "Yes", checked: true, under: "D1. First" }],
      [{ box: "Yes", checked: false, under: "D1. First" }],
    ],
  );
});

test("checkboxEvents reads a Japanese body, with LF or CRLF", () => {
  const before = `### D1. 方式\n\n- [ ]${ideographicSpace}はい\n`;
  const ticked = `### D1. 方式\n\n- [x]${ideographicSpace}はい\n`;
  const want = [{ box: "はい", checked: true, under: "D1. 方式" }];
  const lf = checkboxEvents([{ diff: ticked }, { diff: before }]);
  assert.deepEqual(lf[0]?.changed, want);
  const crlf = checkboxEvents([
    { diff: ticked.replaceAll("\n", "\r\n") },
    { diff: before.replaceAll("\n", "\r\n") },
  ]);
  assert.deepEqual(crlf[0]?.changed, want);
});

test("lint refuses paths, session ids and mentions", () => {
  assert.deepEqual(
    lint(
      "## How people took part\n- approved the design [confirmed: commit a1b2c3d]\n- `@types/node` stays",
    ),
    [],
  );
  for (const [bad, want] of [
    ["see /Users/me/x", "local-path"],
    ["~/.claude/projects/x", "local-path"],
    ["C:\\Users\\me\\x", "local-path"],
    ["/var/folders/ab/T/x", "local-path"],
    ["/private/tmp/x", "local-path"],
    ["/private/var/x", "local-path"],
    ["/tmp/x", "local-path"],
    ["log a.jsonl", "session-id"],
    ["11111111-2222-3333-4444-555555555555", "session-id"],
    ["thanks @someone", "mention"],
  ] as const) {
    assert.ok(lint(bad).includes(want), `lint missed ${want} in ${bad}`);
  }
  assert.deepEqual(lint("mail me at a@b.c"), []);
  assert.deepEqual(lint("連絡先@someone"), []);
  assert.deepEqual(lint("記録.jsonlを読んだ"), []);
});

test("lint refuses the values knownValues collects", () => {
  const dir = join(tmp, "known");
  mkdirSync(dir);
  const known = knownValues({
    home: "/opt/homedir",
    dirs: [dir, realpathSync(dir)],
    sessions: [
      {
        session: "plan",
        cwd: "/work/r/src",
        cwds: ["/work/r/src", "/ab"],
        file: "/store/s/plan.jsonl",
      },
      { session: "abc", cwd: "/" },
    ],
    reports: [{ file: "/work/r/work-reports/a/log.md", size: 1 }],
  });
  for (const [text, want] of [
    ["in /work/r/src it", "local-path"],
    ["the plan session", "session-id"],
    ["see /work/r/work-reports/a here", "local-path"],
    ["at /opt/homedir/x", "local-path"],
    [`dir ${dir}/x`, "local-path"],
    [`dir ${realpathSync(dir)}`, "local-path"],
  ] as const) {
    assert.ok(lint(text, known).includes(want), `known value missed (${want}) in ${text}`);
  }
  assert.deepEqual(lint("the abc and /ab and a / b", known), []);
  assert.deepEqual(lint("replanning is not a session", known), []);
  assert.deepEqual(lint("clean text", known), []);
  assert.deepEqual(lint("セッションplanの記録", known), []);
});

test("linkedIssueNumbers reads a closing word after Japanese text as no link", () => {
  const pr = {
    number: 7,
    title: "t",
    body: "修正closes #5 と closes #6",
    closingIssuesReferences: { nodes: [] },
  } as unknown as GraphqlPullRequest;
  assert.deepEqual(linkedIssueNumbers(pr), [6]);
});

test("cap counts code points", () => {
  const smile = String.fromCodePoint(0x1f600);
  assert.equal(cap(smile.repeat(1600)), `${smile.repeat(1500)} …[100 more chars]`);
});

test("recordedBy, pickRecord and previousBody read the marker comment", () => {
  const me = { author: { login: "me" }, body: `${MARKER}\nx` };
  const other = { author: { login: "other" }, body: `${MARKER}\nx` };
  const note = { author: { login: "other" }, body: "just a comment" };
  assert.equal(recordedBy([note, me, other], "me"), "me");
  assert.equal(recordedBy([note, other], "me"), "other");
  assert.equal(recordedBy([note], "me"), null);

  const rme = { id: 1, user: { login: "me" }, body: `${MARKER}\nx` };
  const rot = { id: 2, user: { login: "other" }, body: `${MARKER}\nx` };
  const rpl = { id: 3, user: { login: "me" }, body: "no marker" };
  const onlyMine = pickRecord([rpl, rme], "me");
  assert.deepEqual(
    onlyMine.mine.map((c) => c.id),
    [1],
  );
  assert.deepEqual(onlyMine.others, []);
  const onlyOthers = pickRecord([rpl, rot], "me");
  assert.deepEqual(onlyOthers.mine, []);
  assert.deepEqual(
    onlyOthers.others.map((c) => c.id),
    [2],
  );
  assert.deepEqual(pickRecord([rpl], "me"), { mine: [], others: [] });

  const previous = previousBody(
    [note, other, { author: { login: "me" }, body: `${MARKER}\n## H\nbody` }],
    "me",
  );
  assert.equal(previous, "## H\nbody\n");
  assert.equal(previousBody([note, other], "me"), null);
});

const draft = (name: string, comment: string | null, sessions?: string): string => {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  if (comment !== null) {
    writeFileSync(join(dir, "comment.md"), comment);
  }
  if (sessions !== undefined) {
    writeFileSync(join(dir, "sessions.json"), sessions);
  }
  return dir;
};

const refused = (args: readonly string[], want: readonly string[], options = {}): void => {
  const out = parsed(prHumans(args, options), 3);
  assert.equal(out["status"], "stop");
  assert.equal(out["number"], 7);
  assert.deepEqual(out["problems"], want);
  assert.equal(ghCalls(), "", "the fake gh was called");
};

test("post refuses a local path, a known cwd and a missing or empty draft", () => {
  refused(["post", "7", draft("post1", "from /Users/me/x\n")], ["local-path"]);
  refused(
    [
      "post",
      "7",
      draft(
        "post3",
        "worked in /work/r/src\n",
        '[{"session":"s","cwd":"/work/r/src","cwds":["/work/r/src"]}]',
      ),
    ],
    ["local-path"],
  );
  const empty = draft("post4", null);
  refused(["post", "7", empty], ["no-draft"]);
  writeFileSync(join(empty, "comment.md"), "  \n");
  refused(["post", "7", empty], ["no-draft"]);
});

test("post refuses the directory it was given and the home directory", () => {
  const dir = draft("notes", `see ${join(tmp, "notes")}\n`);
  refused(["post", "7", "notes"], ["local-path"], { cwd: tmp });
  writeFileSync(join(dir, "comment.md"), `see ${realpathSync(dir)}\n`);
  refused(["post", "7", "notes"], ["local-path"], { cwd: tmp });
  refused(["post", "7", draft("homed", "at /opt/homedir/x\n")], ["local-path"], {
    env: { ...env, HOME: "/opt/homedir" },
  });
});

test("post creates the comment with the marker in front", () => {
  draft("notes", "review notes decided it\n");
  writeFileSync(join(fake, "comments.json"), "[[]]");
  const out = parsed(prHumans(["post", "7", "notes"], { cwd: tmp }));
  assert.deepEqual(out, {
    number: 7,
    action: "created",
    url: "https://github.com/o/r/pull/7#issuecomment-1",
  });
  assert.match(ghCalls(), /^api -X POST repos\/o\/r\/issues\/7\/comments --input -$/mu);
  const payload = JSON.parse(readFileSync(join(fake, "payload.json"), "utf8")) as Record<
    string,
    unknown
  >;
  assert.equal(payload["body"], `${MARKER}\nreview notes decided it`);
});

test("post updates this account's own comment", () => {
  writeFileSync(
    join(fake, "comments.json"),
    JSON.stringify([
      [
        { id: 10, user: { login: "other" }, body: "plain" },
        { id: 11, user: { login: "me" }, body: `${MARKER}\nold` },
      ],
    ]),
  );
  const out = parsed(prHumans(["post", "7", draft("update", "new words\n")]));
  assert.equal(out["action"], "updated");
  assert.match(ghCalls(), /^api -X PATCH repos\/o\/r\/issues\/comments\/11 --input -$/mu);
});

test("post stops when only another account recorded the pull request", () => {
  writeFileSync(
    join(fake, "comments.json"),
    JSON.stringify([[{ id: 12, user: { login: "other" }, body: `${MARKER}\nx` }]]),
  );
  const out = parsed(prHumans(["post", "7", draft("byother", "new words\n")]), 3);
  assert.deepEqual(out["problems"], ["recorded-by-other"]);
  assert.doesNotMatch(ghCalls(), /-X (?:PATCH|POST)/u);
});

test("a usage error exits 2 with the usage text", () => {
  for (const args of [
    [],
    ["bogus"],
    ["targets", "--bogus"],
    ["targets", "--project", "x"],
    ["gather", "7"],
    ["post", "7"],
  ]) {
    const ran = prHumans(args);
    assert.equal(ran.code, 2, `${args.join(" ")}: ${ran.stderr}`);
    assert.ok(ran.stderr.startsWith("pr-humans.sh: gather what"), ran.stderr);
    assert.equal(ghCalls(), "");
  }
});
