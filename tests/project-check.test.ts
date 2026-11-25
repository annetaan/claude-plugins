import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(import.meta.dirname, "../plugins/annetaan/skills/pj1-plan/scripts/project.sh");

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const realGit = (process.env["PATH"] ?? "")
  .split(delimiter)
  .map((dir) => join(dir, "git"))
  .find(isExecutable);
if (realGit === undefined) {
  throw new Error("no git on the PATH");
}

const tmp = mkdtempSync(join(tmpdir(), "project-check-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
const work = join(tmp, "work");
const origin = join(tmp, "origin.git");
const issuesJson = join(tmp, "issues.json");
const ghLog = join(tmp, "gh.log");
const gitLog = join(tmp, "git.log");
mkdirSync(home);
mkdirSync(bin);
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
echo "$1 $2" >> '${ghLog}'
if [ "$1 $2" = "pr list" ]; then
  echo '[]'
  exit 0
fi
if [ "$1 $2" = "api graphql" ]; then
  for arg in "$@"; do
    case "$arg" in
      query=*"updatedAt body"*) cat '${issuesJson}'; exit 0 ;;
      query=*"ro: ref("*) echo '{"data":{"repository":{"ro":{"compare":{"status":"IDENTICAL"}},"mo":{"totalCount":0},"po":{"nodes":[]}}}}'; exit 0 ;;
    esac
  done
  echo "fake gh: unexpected query" >&2
  exit 1
fi
echo "fake gh: unexpected call" >&2
exit 1
`,
  { mode: 0o755 },
);
writeFileSync(
  join(bin, "git"),
  `#!/usr/bin/env bash
echo "$*" >> '${gitLog}'
exec '${realGit}' "$@"
`,
  { mode: 0o755 },
);
const env = {
  ...process.env,
  PATH: `${bin}:${process.env["PATH"] ?? ""}`,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

const git = (cwd: string, ...args: readonly string[]): void => {
  const result = spawnSync(realGit, args, { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};

const initDate = {
  GIT_AUTHOR_DATE: "1999-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "1999-01-01T00:00:00Z",
};

git(tmp, "init", "-q", "-b", "main", "work");
git(tmp, "init", "-q", "--bare", "origin.git");
writeFileSync(join(work, "README.md"), "readme\n");
mkdirSync(join(work, "src"));
writeFileSync(
  join(work, "src/app.ts"),
  "export function foo() {}\nexport function oldName() {}\nexport function parseBody() {}\nexport const $el = 1\n",
);
writeFileSync(join(work, "src/index.ts"), "export * from './app';\nexport * from './old';\n");
writeFileSync(join(work, "roadmap.md"), "# Roadmap\n\n## Retry\n\nRetry a failed step.\n");
git(work, "add", "README.md", "roadmap.md", "src/app.ts", "src/index.ts");
assert.equal(
  spawnSync(realGit, ["commit", "-q", "-m", "init"], { cwd: work, env: { ...env, ...initDate } })
    .status,
  0,
);
writeFileSync(join(work, "src/app.ts"), "export function foo() {}\n");
git(work, "add", "src/app.ts");
git(work, "commit", "-q", "-m", "drop oldName and parseBody");
git(work, "remote", "add", "origin", "../origin.git");
git(work, "push", "-q", "origin", "main", "main:refs/heads/pj/1");
mkdirSync(join(work, "work-reports/run"), { recursive: true });

const setGraph = ({ extraEntry = "", two = false, roadmap = false } = {}): void => {
  const sub = {
    number: 2,
    url: "https://github.com/test/repo/issues/2",
    title: "Rename foo",
    state: "OPEN",
    stateReason: null,
    updatedAt: "2000-01-01T00:00:00Z",
    body:
      "## Goal\n\nRename foo.\n\n## Design\n\n- `src/app.ts` (changed): rename `foo`, as `README.md` describes.\n" +
      extraEntry +
      "\n## Acceptance criteria\n\n- `foo` is renamed.\n\n## Decisions\n\nNone.\n\n## Out of scope\n\nNothing.\n",
    labels: { nodes: [{ name: "ready" }] },
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
  };
  const subs = two
    ? [
        sub,
        {
          ...sub,
          number: 3,
          url: "https://github.com/test/repo/issues/3",
          title: "Rename foo again",
        },
      ]
    : [sub];
  const parent = {
    number: 1,
    url: "https://github.com/test/repo/issues/1",
    title: "Project",
    state: "OPEN",
    stateReason: null,
    updatedAt: "2000-01-01T00:00:00Z",
    body: `Base: \`pj/1\` from \`main\`\n${roadmap ? "Roadmap: `roadmap.md` Retry\n" : ""}\n## Goal\n\nx\n`,
    labels: { nodes: [] },
    blockedBy: { nodes: [] },
    blocking: { nodes: [] },
    subIssues: { totalCount: subs.length, nodes: subs },
  };
  writeFileSync(issuesJson, `${JSON.stringify({ data: { repository: { issue: parent } } })}\n`);
};

const check = (cwd: string, ...numbers: readonly string[]) =>
  spawnSync("bash", [script, "-R", "test/repo", "1", "--check", ...numbers], {
    cwd,
    env,
    encoding: "utf8",
  });

const json = (result: ReturnType<typeof check>) => {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};

type Failure = { path: string; symbol?: string; why: string };

const triples = (d: { premises: { failures: readonly Failure[] } }) =>
  d.premises.failures.map((f) => [f.path, f.symbol ?? null, f.why]);

const failures = (entry: string, cwd = work) => {
  setGraph({ extraEntry: entry });
  return triples(json(check(cwd, "2")));
};

const lintAndFailures = (entry: string) => {
  setGraph({ extraEntry: entry });
  const d = json(check(work, "2"));
  return [d.lint.reasons, triples(d)];
};

test("check from a subdirectory matches check from the root", () => {
  setGraph();
  const outs = [work, join(work, "src"), join(work, "work-reports/run")].map((cwd) => {
    const result = check(cwd, "2");
    assert.equal(result.status, 0, `${cwd}: ${result.stderr}`);
    return result.stdout;
  });
  assert.equal(outs[1], outs[0]);
  assert.equal(outs[2], outs[0]);
  const d = JSON.parse(outs[0] ?? "");
  assert.equal(d.lint.ok, true);
  assert.equal(d.premises.mode, "full");
  assert.deepEqual(d.premises.failures, []);
  assert.ok(!("history" in d));
  assert.equal(d.ok, true);
});

test("check outside a work tree is refused", () => {
  setGraph();
  for (const dir of [origin, join(work, ".git")]) {
    const result = check(dir, "2");
    assert.notEqual(result.status, 0, dir);
    assert.ok(result.stderr.includes("inside a work tree of a clone"), `${dir}: ${result.stderr}`);
  }
});

test("--check looks up no name in a document entry", () => {
  assert.deepEqual(failures("- `README.md` (changed): says `Temporal` is used\n"), []);
  const got = failures("- `src/app.ts` (changed): uses `Temporal`\n");
  assert.ok(
    got.some(([path, symbol]) => path === "src/app.ts" && symbol === "Temporal"),
    JSON.stringify(got),
  );
});

test("--check fails a document entry whose path does not exist", () => {
  assert.deepEqual(failures("- `docs/none.md` (changed): says `Temporal` is used\n"), [
    ["docs/none.md", null, "changed, but does not exist"],
  ]);
});

test("--check reads a name the file never held as symbol never in the file", () => {
  assert.deepEqual(failures("- `src/app.ts` (changed): uses `Temporal`\n"), [
    ["src/app.ts", "Temporal", "symbol never in the file"],
  ]);
});

test("--check reads a name the file once held as symbol not found", () => {
  assert.deepEqual(failures("- `src/app.ts` (changed): uses `oldName`\n"), [
    ["src/app.ts", "oldName", "symbol not found"],
  ]);
});

test("--check reads a held name with a $ as symbol not found", () => {
  assert.deepEqual(failures("- `src/app.ts` (changed): uses `$el`\n"), [
    ["src/app.ts", "$el", "symbol not found"],
  ]);
});

test("--check reads a name inside a longer name as symbol never in the file", () => {
  assert.deepEqual(failures("- `src/app.ts` (changed): uses `parse`\n"), [
    ["src/app.ts", "parse", "symbol never in the file"],
  ]);
});

test("--check needs no symbol on a code file that holds no name", () => {
  assert.deepEqual(lintAndFailures("- `src/index.ts` (changed): re-exports the new module too\n"), [
    [],
    [],
  ]);
});

test("--check fails no-symbols on a code file that holds a name", () => {
  assert.deepEqual(lintAndFailures("- `src/app.ts` (changed): exports one more function\n"), [
    ["no-symbols"],
    [],
  ]);
});

test("a format-only fix clears a name a re-export file never held", () => {
  assert.deepEqual(lintAndFailures("- `src/index.ts` (changed): re-exports `UserId`\n"), [
    [],
    [["src/index.ts", "UserId", "symbol never in the file"]],
  ]);
  assert.deepEqual(lintAndFailures("- `src/index.ts` (changed): re-exports UserId\n"), [[], []]);
});

test("--check in a shallow clone reads every missing name as symbol not found", () => {
  const shallow = join(tmp, "shallow");
  git(tmp, "clone", "-q", "--depth", "1", "-b", "main", `file://${origin}`, shallow);
  for (const name of ["Temporal", "oldName"]) {
    assert.deepEqual(failures(`- \`src/app.ts\` (changed): uses \`${name}\`\n`, shallow), [
      ["src/app.ts", name, "symbol not found"],
    ]);
  }
});

test("--check with several numbers prints one line each, in the order given", () => {
  setGraph({ two: true });
  const result = check(work, "3", "2");
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 2, result.stdout);
  assert.deepEqual(
    lines.map((line) => JSON.parse(line).number),
    [3, 2],
  );
  const alone = check(work, "2");
  assert.equal(alone.status, 0, alone.stderr);
  assert.equal(lines[1], alone.stdout.trimEnd());
});

test("--check with several numbers reads GitHub and fetches once", () => {
  setGraph({ two: true });
  const counts = (...numbers: readonly string[]) => {
    rmSync(ghLog, { force: true });
    rmSync(gitLog, { force: true });
    const result = check(work, ...numbers);
    assert.equal(result.status, 0, result.stderr);
    const gh: Record<string, number> = {};
    for (const line of readFileSync(ghLog, "utf8").split("\n").filter(Boolean)) {
      gh[line] = (gh[line] ?? 0) + 1;
    }
    const fetches = readFileSync(gitLog, "utf8")
      .split("\n")
      .filter((line) => /^(-C [^ ]+ )?fetch /.test(line)).length;
    return { gh, fetches };
  };
  const one = counts("2");
  assert.ok("api graphql" in one.gh, JSON.stringify(one));
  assert.ok(one.fetches >= 1, JSON.stringify(one));
  assert.deepEqual(counts("2", "3"), one);
});

test("--check dies before printing when one number is no sub-issue", () => {
  setGraph({ two: true });
  const result = check(work, "2", "99");
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes("#99 is not a sub-issue of #1"), result.stderr);
});

const roadmapEntry = "- `roadmap.md` (changed): deletes the Retry entry.\n";

test("--check fails every roadmap task when several list the file", () => {
  setGraph({ extraEntry: roadmapEntry, two: true, roadmap: true });
  const result = check(work, "2", "3");
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    lines.map((d) => d.number),
    [2, 3],
  );
  for (const d of lines) {
    assert.deepEqual(d.roadmap["several-tasks"], [2, 3]);
    assert.equal(d.ok, false);
    assert.deepEqual(d.premises.failures, []);
  }
});

test("--check passes the one roadmap task", () => {
  setGraph({ extraEntry: roadmapEntry, roadmap: true });
  const d = json(check(work, "2"));
  assert.deepEqual(d.roadmap["several-tasks"], []);
  assert.equal(d.ok, true);
});
