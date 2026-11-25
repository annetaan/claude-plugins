import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/pj1-plan/scripts/project.sh");

const tmp = mkdtempSync(join(tmpdir(), "project-design-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const bin = join(tmp, "bin");
const log = join(tmp, "gh.log");
const issues = join(tmp, "issues.json");
mkdirSync(bin);
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
echo "$1 $2" >> '${log}'
if [ "$1 $2" = "pr list" ]; then
  echo '[]'
  exit 0
fi
if [ "$1 $2" = "api graphql" ]; then
  cat '${issues}'
  exit 0
fi
echo "fake gh: unexpected call" >&2
exit 1
`,
  { mode: 0o755 },
);
const env = { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` };

const body = (design: string, criteria: string, decisions = "None."): string =>
  `## Goal\n\nA goal.\n\n## Design\n\n${design}\n\n## Acceptance criteria\n\n${criteria}\n\n## Decisions\n\n${decisions}\n\n## Out of scope\n\n- Nothing.\n`;

const sub = (
  n: number,
  title: string,
  text: string,
  state = "OPEN",
  reason: string | null = null,
  blocked: readonly number[] = [],
) => ({
  number: n,
  url: `https://example.com/${n}`,
  title,
  state,
  stateReason: reason,
  updatedAt: "2000-01-01T00:00:00Z",
  body: text,
  labels: { nodes: [] },
  blockedBy: { nodes: blocked.map((b) => ({ number: b, state: "OPEN", parent: { number: 1 } })) },
  blocking: { nodes: [] },
});

const project = (n: number, design: string) => ({
  number: n,
  url: `https://example.com/${n}`,
  title: `Project ${n}`,
  state: "CLOSED",
  stateReason: "COMPLETED",
  body: `Base: \`pj/${n}\` from \`main\`\n\n## Goal\n\ng\n\n## Design\n\n${design}\n\n## Decisions\n\nNone.\n`,
});

const target = [
  "## Goal",
  "",
  "The target goal.",
  "",
  "## Design",
  "",
  "- `a.txt` (changed): `x`.",
  "",
  "## Acceptance criteria",
  "",
  "- `check-a` passes.",
  "",
  "## Decisions",
  "",
  "### D1. First",
  "",
  "Only you know: the first.",
  "",
  "- [ ] Option one (recommended)",
  "  under one",
  "- [x] Option two",
  "  under two",
  "",
  "  more two",
  "- [ ] Option three",
  "",
  "Decided: two, because.",
  "",
  "### D2. Second",
  "",
  "Only you know: the second.",
  "",
  "```",
  "### D9. fenced",
  "- [x] fenced option",
  "```",
  "",
  "- [x] Only option (recommended)",
  "- [ ] Other",
  "",
  "## Out of scope",
  "",
  "- Nothing.",
  "",
]
  .join("\n")
  .replaceAll("\n", "\r\n");

const openDecision = body(
  "- `a.txt` (changed): `x`.",
  "- `t` passes.",
  "### D1. Open\n\nOnly you know: x.\n\n- [ ] A (recommended)\n- [ ] B",
);
const contradictory = body(
  "- `a.txt` (changed): `x`.",
  "- `t` passes.",
  "### D1. Both\n\nOnly you know: x.\n\n- [x] A (recommended)\n- [x] B",
);

const parent = {
  number: 1,
  url: "https://example.com/1",
  title: "Parent",
  state: "OPEN",
  stateReason: null,
  updatedAt: "2000-01-01T00:00:00Z",
  body:
    "Base: `pj/1` from `main`\n\n## Order\n\n1. #3\n\n## Goal\n\nParent goal.\n\n## Design\n\nParent design.\n\n" +
    "```\n## not a heading\n```\n\n### Model decisions\n\n- A model decision.\n\n## Decisions\n\nNone.\n\n" +
    "## Out of scope\n\n- None.\n",
  labels: { nodes: [] },
  blockedBy: { nodes: [project(30, "Design thirty."), project(20, "Design twenty.")] },
  blocking: { nodes: [] },
  subIssues: {
    totalCount: 7,
    nodes: [
      sub(
        2,
        "Breaker",
        body(
          "- `a.txt` (changed): `x`.\n\n### Left broken\n\n- `check-a`: why.\n- `check-b`: why.",
          "- `t` passes.",
        ),
        "CLOSED",
        "COMPLETED",
      ),
      sub(3, "Target (1/2)", target, "OPEN", null, [2]),
      sub(
        4,
        "Closer of b",
        body("- `a.txt` (changed): `x`.", "- `check-b` passes."),
        "OPEN",
        null,
        [2],
      ),
      sub(
        5,
        "Open breaker",
        body("- `a.txt` (changed): `x`.\n\n### Left broken\n\n- `check-c`: why.", "- `t` passes."),
      ),
      sub(
        6,
        "Closer of all",
        body("- `a.txt` (changed): `x`.", "- `check-a`, `check-b` and `check-c` pass."),
        "OPEN",
        null,
        [2, 5],
      ),
      sub(7, "Open decision", openDecision),
      sub(8, "Contradictory", contradictory),
    ],
  },
};
writeFileSync(issues, JSON.stringify({ data: { repository: { issue: parent } } }));

const want = `# Issue #3: Target

## Goal

The target goal.

## Design

- \`a.txt\` (changed): \`x\`.

## Acceptance criteria

- \`check-a\` passes.

## Decisions

### D1. First

- [x] Option two
  under two

  more two

Decided: two, because.

### D2. Second

- [x] Only option (recommended)

## Out of scope

- Nothing.

# Parent #1: Parent

## Design

Parent design.

\`\`\`
## not a heading
\`\`\`

### Model decisions

- A model decision.

# Waited-on project #20: Project 20

## Design

Design twenty.

# Waited-on project #30: Project 30

## Design

Design thirty.

# Left broken on the base branch

- \`check-b\` (left by #2)
`;

const design = (...args: readonly string[]) =>
  spawnSync("bash", [script, "-R", "test/repo", "1", "--design", ...args], {
    cwd: tmp,
    env,
    encoding: "utf8",
  });

const printed = (result: ReturnType<typeof design>): string => {
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

const leftBroken = (out: string): string => {
  const from = out.search(/^# Left broken on the base branch$/m);
  assert.notEqual(from, -1, out);
  return out.slice(from);
};

test("the target's approved design, with decisions cut, the parents' designs and the open breakage", () => {
  writeFileSync(log, "");
  assert.equal(printed(design("3")), want);
});

test("--design reads the one query and lists no pull request", () => {
  assert.equal(readFileSync(log, "utf8"), "api graphql\n");
});

test("the closer of every check reads None., and an open breaker's check never appears", () => {
  const closer = printed(design("6"));
  assert.ok(closer.endsWith("# Left broken on the base branch\n\nNone.\n"), closer);
  for (const n of ["3", "6"]) {
    assert.ok(!leftBroken(printed(design(n))).includes("check-c"), n);
  }
});

const refused = (line: string, ...args: readonly string[]): void => {
  const result = design(...args);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.split("\n").includes(line), result.stderr);
};

test("an open decision, a contradictory decision and a number that is no sub-issue are refused", () => {
  refused("project: #7 has decisions not settled: 1 open, 0 contradictory", "7");
  refused("project: #8 has decisions not settled: 0 open, 1 contradictory", "8");
  refused("project: #9 is not a sub-issue of #1", "9");
});

test("--design with no number or with x is refused", () => {
  const none = design();
  assert.notEqual(none.status, 0);
  assert.ok(
    none.stderr.split("\n").includes("project: --design takes one issue number"),
    none.stderr,
  );
  refused("project: --design takes one issue number", "x");
});
