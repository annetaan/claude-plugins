import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/pj4-running/scripts/run.sh");
const projectSh = join(
  import.meta.dirname,
  "../plugins/annetaan/skills/pj1-plan/scripts/project.sh",
);

const tmp = mkdtempSync(join(tmpdir(), "run-issues-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
const fake = join(tmp, "fake");
const work = join(tmp, "work");
const graph = join(tmp, "graph.json");
mkdirSync(home);
mkdirSync(bin);

writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
printf '%s\\n' "$(printf '%s' "$*" | tr '\\n' ' ')" >> '${fake}/gh.log'
case "$1 $2" in
  "repo view")
    for arg in "$@"; do [ "$arg" = --jq ] && { echo o/r; exit 0; }; done
    echo '{"nameWithOwner":"o/r"}' ;;
  "pr list") echo '[{"number":3,"state":"MERGED","isDraft":false,"url":"https://github.com/o/r/pull/3","body":"Implements #2"}]' ;;
  "api graphql")
    for arg in "$@"; do
      case "$arg" in
        query=*"updatedAt body"*) cat '${graph}'; exit 0 ;;
        query=*"ro: ref("*) echo '{"data":{"repository":{"ro":{"compare":{"status":"IDENTICAL"}},"mo":{"totalCount":0},"po":{"nodes":[]}}}}'; exit 0 ;;
      esac
    done
    echo "unexpected gh $*" >&2; exit 1 ;;
  "issue view")
    state=OPEN
    [ -e '${fake}'/closed-"$3" ] && state=CLOSED
    echo '{"state":"'"$state"'","updatedAt":"2000-01-01T00:00:00Z","labels":[],"parent":{"number":1},"body":""}' ;;
  "issue create"|"issue edit"|"issue comment"|"issue close"|"label create")
    if [ -e '${fake}'/fail-"$1"-"$2" ]; then echo boom >&2; exit 1; fi
    [ "$1 $2" = "issue create" ] && echo https://github.com/o/r/issues/9
    exit 0 ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`,
  { mode: 0o755 },
);

const env = {
  ...process.env,
  PATH: `${bin}:${process.env["PATH"] ?? ""}`,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
};

const gitInit = spawnSync("git", ["init", "-q", work], { env, encoding: "utf8" });
assert.equal(gitInit.status, 0, gitInit.stderr);

const STUB_BODY = "## Goal\n\nx\n\n## Design\n\nTo be drawn.\n";

type Node = {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly stateReason: string | null;
  readonly blockedBy: readonly number[];
};

const node = (n: Node) => ({
  number: n.number,
  url: `https://github.com/o/r/issues/${n.number}`,
  title: n.title,
  state: n.state,
  stateReason: n.stateReason,
  updatedAt: "2000-01-01T00:00:00Z",
  body: STUB_BODY,
  labels: { nodes: [] },
  blockedBy: {
    nodes: n.blockedBy.map((b) => ({ number: b, state: "OPEN", parent: { number: 1 } })),
  },
  blocking: { nodes: [] },
});

const setGraph = (nodes: readonly Node[]): void => {
  const parent = {
    number: 1,
    url: "https://github.com/o/r/issues/1",
    title: "Project",
    state: "OPEN",
    stateReason: null,
    updatedAt: "2000-01-01T00:00:00Z",
    body: "Base: `pj/1` from `main`\n\n## Goal\n\nx\n",
    labels: { nodes: [{ name: "project" }] },
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    subIssues: { totalCount: nodes.length, nodes: nodes.map(node) },
  };
  writeFileSync(graph, `${JSON.stringify({ data: { repository: { issue: parent } } })}\n`);
};

const openTask: Node = {
  number: 2,
  title: "Task (1/1)",
  state: "OPEN",
  stateReason: null,
  blockedBy: [],
};

const setup = (nodes: readonly Node[] = [openTask]): void => {
  rmSync(fake, { recursive: true, force: true });
  mkdirSync(fake);
  setGraph(nodes);
};

const comment = join(tmp, "comment.md");
const stubFile = join(tmp, "stub.md");
const badStub = join(tmp, "bad-stub.md");
const unmarked = join(tmp, "unmarked.md");
writeFileSync(comment, "**[pj4-running]** stopped\n");
writeFileSync(stubFile, STUB_BODY);
writeFileSync(badStub, "## Goal\n");
writeFileSync(unmarked, "stopped\n");

const COMMENTED = `issue comment 2 --body-file ${comment}`;
const FILED = `issue create --parent 1 --title Stub --body-file ${stubFile} --blocking 2 --label blocker`;

type Out = Readonly<Record<string, unknown>> & { readonly status: string };

const runSh = (...args: readonly string[]) =>
  spawnSync("bash", [script, ...args], { cwd: work, env, encoding: "utf8" });

const printed = (result: ReturnType<typeof runSh>): Out => {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

const calls = (): readonly string[] => {
  const log = join(fake, "gh.log");
  return existsSync(log) ? readFileSync(log, "utf8").split("\n").slice(0, -1) : [];
};

const WRITE = /^(issue (create|edit|comment|close)|label create) /u;

const writes = (): readonly string[] =>
  calls()
    .filter((line) => WRITE.test(line))
    .map((line) => (line.startsWith("label create ") ? (line.split(" --color")[0] ?? line) : line));

const blocking = (file: string, stub = stubFile): Out =>
  printed(
    runSh("stop", "1", "2", "blocking", "--comment", file, "--stub", stub, "--title", "Stub"),
  );

const stopWith = (why: string, file = comment): Out =>
  printed(runSh("stop", "1", "2", why, "--comment", file));

test("stop blocking files the stub, then comments", () => {
  setup();
  const out = blocking(comment);
  assert.equal(out.status, "stopped");
  assert.equal(out["number"], 2);
  assert.deepEqual(out["stub"], { number: 9, url: "https://github.com/o/r/issues/9" });
  assert.deepEqual(writes(), ["label create blocker", FILED, COMMENTED]);
});

test("stop decision takes ready off, syncs the titles and comments", () => {
  setup();
  const out = stopWith("decision");
  assert.equal(out.status, "stopped");
  assert.ok(!("stub" in out));
  assert.deepEqual(writes(), [
    "issue edit 2 --remove-label ready",
    "issue edit 2 --title Task",
    COMMENTED,
  ]);
});

test("stop detail adds blocker, takes ready off and comments", () => {
  setup();
  assert.equal(stopWith("detail").status, "stopped");
  assert.deepEqual(writes(), [
    "label create blocker",
    "issue edit 2 --add-label blocker --remove-label ready",
    COMMENTED,
  ]);
});

test("stop round-cap only comments", () => {
  setup();
  assert.equal(stopWith("round-cap").status, "stopped");
  assert.deepEqual(writes(), [COMMENTED]);
});

test("close and stop refuse an unmarked comment before any write", () => {
  setup();
  for (const args of [
    ["close", "1", "2", "--comment", unmarked],
    ["stop", "1", "2", "decision", "--comment", unmarked],
    ["stop", "1", "2", "detail", "--comment", unmarked],
    ["stop", "1", "2", "round-cap", "--comment", unmarked],
    ["stop", "1", "2", "blocking", "--comment", unmarked, "--stub", stubFile, "--title", "Stub"],
  ]) {
    const out = printed(runSh(...args));
    assert.deepEqual([out.status, out["reason"]], ["stop", "no-marker"], args.join(" "));
    assert.ok(!("step" in out), args.join(" "));
  }
  assert.deepEqual(calls(), []);
});

test("close takes the marker of every skill", () => {
  const marked = join(tmp, "marked.md");
  for (const marker of ["**[pj3-doctor]**", "**[pj4-running]**", "**[pj-cleanup]**"]) {
    setup();
    writeFileSync(marked, `${marker} closed\n`);
    const out = printed(runSh("close", "1", "2", "--comment", marked));
    assert.equal(out.status, "closed", marker);
    assert.deepEqual(writes(), [`issue close 2 --reason completed --comment ${marker} closed `]);
  }
  setup([{ ...openTask, state: "CLOSED", stateReason: "COMPLETED" }]);
  const cleanup = join(tmp, "cleanup.md");
  writeFileSync(cleanup, "**[pj-cleanup]** merged\n");
  const out = printed(runSh("close", "1", "1", "--comment", cleanup));
  assert.equal(out.status, "closed");
  assert.deepEqual(writes(), [
    "issue close 1 --reason completed --comment **[pj-cleanup]** merged ",
  ]);
});

test("stop passes on a refusal of issue.sh and names the step", () => {
  setup();
  writeFileSync(join(fake, "closed-2"), "");
  const atComment = blocking(comment);
  assert.deepEqual(
    [atComment.status, atComment["reason"], atComment["message"], atComment["step"]],
    ["stop", "closed", "#2 is closed", "comment"],
  );
  assert.deepEqual(atComment["stub"], { number: 9, url: "https://github.com/o/r/issues/9" });

  setup([
    { ...openTask, blockedBy: [9] },
    { number: 9, title: "Stub", state: "OPEN", stateReason: null, blockedBy: [2] },
  ]);
  const cycle = blocking(comment);
  assert.deepEqual([cycle["reason"], cycle["step"]], ["cycle", "sub"]);
  assert.deepEqual(cycle["stub"], { number: 9, url: "https://github.com/o/r/issues/9" });
  assert.ok(!("number" in cycle));
  assert.deepEqual(writes(), ["label create blocker", FILED, "issue edit 9 --remove-blocking 2"]);

  setup();
  const lint = blocking(comment, badStub);
  const expected = printed(
    spawnSync("bash", [projectSh, "--lint", badStub], { cwd: work, env, encoding: "utf8" }),
  );
  assert.equal(lint["reason"], "lint");
  assert.deepEqual(lint["reasons"], expected["reasons"]);
  assert.ok(!("stub" in lint));
  assert.deepEqual(writes(), []);

  setup();
  writeFileSync(join(fake, "closed-2"), "");
  const atLabel = stopWith("decision");
  assert.deepEqual([atLabel["reason"], atLabel["step"]], ["closed", "label"]);
  assert.deepEqual(writes(), []);
});

test("stop turns a failure of issue.sh into issue-failed at its step", () => {
  setup();
  writeFileSync(join(fake, "fail-issue-edit"), "");
  const atLabel = stopWith("detail");
  assert.deepEqual(
    [atLabel.status, atLabel["reason"], atLabel["step"]],
    ["stop", "issue-failed", "label"],
  );
  assert.equal(
    atLabel["message"],
    "issue: gh issue edit 2 --add-label blocker --remove-label ready failed: boom",
  );
  assert.ok(!writes().includes(COMMENTED));

  setup();
  writeFileSync(join(fake, "fail-issue-comment"), "");
  const atComment = blocking(comment);
  assert.deepEqual([atComment["reason"], atComment["step"]], ["issue-failed", "comment"]);
  assert.deepEqual(atComment["stub"], { number: 9, url: "https://github.com/o/r/issues/9" });

  setup();
  writeFileSync(join(fake, "fail-issue-create"), "");
  const atSub = blocking(comment);
  assert.deepEqual([atSub["reason"], atSub["step"]], ["issue-failed", "sub"]);
  assert.ok(!("stub" in atSub));
  assert.ok(!writes().includes(COMMENTED));
});

test("stop refuses an issue outside the project", () => {
  setup();
  const out = printed(runSh("stop", "1", "5", "round-cap", "--comment", comment));
  assert.deepEqual([out.status, out["reason"], out["number"]], ["stop", "unknown-issue", 5]);
  assert.deepEqual(writes(), []);
});

test("stop usage errors", () => {
  setup();
  for (const args of [
    ["stop", "1", "2", "later", "--comment", comment],
    ["stop", "1", "2", "blocking", "--comment", comment],
    ["stop", "1", "2", "blocking", "--comment", comment, "--title", "Stub", "--stub", stubFile],
    ["stop", "1", "2", "detail", "--comment", comment, "--stub", stubFile, "--title", "Stub"],
    ["stop", "1", "x", "detail", "--comment", comment],
    ["stop", "1", "2", "detail", "--body", comment],
    [
      "stop",
      "1",
      "2",
      "blocking",
      "--comment",
      comment,
      "--stub",
      join(tmp, "none.md"),
      "--title",
      "Stub",
    ],
  ]) {
    assert.notEqual(runSh(...args).status, 0, args.join(" "));
  }
  assert.deepEqual(calls(), []);
});
