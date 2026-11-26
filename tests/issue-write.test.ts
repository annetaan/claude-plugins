import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  MARKERS,
  markerProblem,
} from "../plugins/annetaan/skills/pj1-plan/scripts/pure/comment-markers.ts";
import { LABELS } from "../plugins/annetaan/skills/pj1-plan/scripts/issue.ts";

const scripts = join(import.meta.dirname, "../plugins/annetaan/skills/pj1-plan/scripts");
const script = join(scripts, "issue.sh");

const tmp = mkdtempSync(join(tmpdir(), "issue-write-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const bin = join(tmp, "bin");
const fake = join(tmp, "fake");
mkdirSync(bin);
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
FAKE='${fake}'
case "$1 $2" in
  "api graphql")
    for arg in "$@"; do
      case "$arg" in
        query=*"updatedAt body"*)
          for n in "$@"; do case "$n" in n=*) echo "graphql $n" >> "$FAKE/project.log" ;; esac; done
          if [ -e "$FAKE/graphql-fail" ]; then echo "graphql failed" >&2; exit 1; fi
          if [ -e "$FAKE/bump" ]; then
            sed -i.bak 's/2026-01-01T00:00:00Z/2026-02-02T00:00:00Z/' "$FAKE/view-1"
          fi
          cat "$FAKE/graphql"; exit 0 ;;
        query=*"ro: ref("*)
          echo '{"data":{"repository":{"ro":{"compare":{"status":"IDENTICAL"}},"mo":{"totalCount":0},"po":{"nodes":[]}}}}'; exit 0 ;;
      esac
    done
    echo "unexpected query" >&2; exit 1 ;;
  "repo view") echo o/r; exit 0 ;;
  "pr list") echo '[]'; exit 0 ;;
esac
echo "$*" >> "$FAKE/gh.log"
case "$1 $2" in
  "issue view") cat "$FAKE/view-$3" ;;
  "label create")
    if grep -qxF -- "$3" "$FAKE/labels"; then
      echo "label with name \\"$3\\" already exists; use \\\`--force\\\` to update its color and description" >&2
      exit 1
    fi ;;
  "issue create") echo "https://github.com/o/r/issues/$(cat "$FAKE/next")" ;;
  "issue edit")
    case " $* " in *" --body-file - "*) cat > "$FAKE/body-$3" ;; esac ;;
  "issue comment"|"issue close") ;;
  "api -X") ;;
  "api repos/{owner}/{repo}/issues/"*) cat "$FAKE/comments" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`,
  { mode: 0o755 },
);

const env = { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` };

type Ran = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

const issue = (...args: readonly string[]): Ran => {
  const result = spawnSync("bash", [script, ...args], { cwd: tmp, env, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

const printed = (result: Ran): Record<string, unknown> => {
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout) as Record<string, unknown>;
};

const read = (path: string): string => readFileSync(path, "utf8");

const lines = (path: string): readonly string[] =>
  read(path)
    .split("\n")
    .filter((l) => l !== "");

const ghLog = (): readonly string[] => lines(join(fake, "gh.log"));

const projectLog = (): readonly string[] => lines(join(fake, "project.log"));

const writes = (): readonly string[] => ghLog().filter((l) => !l.startsWith("issue view "));

const logged = (line: string): boolean => ghLog().includes(line);

const clearLog = (): void => {
  writeFileSync(join(fake, "gh.log"), "");
};

const view = (n: number, state: string, label: string, parent: number | null): void => {
  writeFileSync(
    join(fake, `view-${n}`),
    `${JSON.stringify({
      state,
      updatedAt: "2026-01-01T00:00:00Z",
      labels: label === "" ? [] : [{ name: label }],
      parent: parent === null ? null : { number: parent },
      body: `GitHub body of #${n}`,
    })}\n`,
  );
};

const openDecision = `### D1. Does the admin screen show the retry count?

Only you know: whether the people who run the admin screen need the count.

- [ ] Show it (recommended)
  Adds a column to \`src/admin.ts\`.
- [ ] Hide it
  Leaves \`src/admin.ts\` as it is.
`;

const subBody = (criteria: string, decisions: string): string => `## Goal

Sign-out stops emptying what the page fetched once.

## Design

- \`src/session.ts\` (changed): \`signOut\` clears only the entries the session owns

## Acceptance criteria

- ${criteria}

## Decisions

${decisions}
## Out of scope

The admin screen.
`;

const goodCriteria = "sign out, then sign in again: `npm test -- signin` prints `3 passed`";

type Node = {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly body: string;
  readonly blockedBy: readonly number[];
};

const projectJson = (parentBody: string, nodes: readonly Node[]): string =>
  JSON.stringify({
    data: {
      repository: {
        issue: {
          number: 1,
          url: "https://github.com/o/r/issues/1",
          title: "Project",
          state: "OPEN",
          stateReason: null,
          updatedAt: "2026-01-01T00:00:00Z",
          body: parentBody,
          labels: { nodes: [{ name: "project" }] },
          blockedBy: { nodes: [] },
          blocking: { nodes: [] },
          subIssues: {
            totalCount: nodes.length,
            nodes: nodes.map((node) => ({
              number: node.number,
              url: `https://github.com/o/r/issues/${node.number}`,
              title: node.title,
              state: node.state,
              stateReason: node.state === "CLOSED" ? "COMPLETED" : null,
              updatedAt: "2026-01-01T00:00:00Z",
              body: node.body,
              labels: { nodes: [] },
              blockedBy: {
                nodes: node.blockedBy.map((m) => ({
                  number: m,
                  state: "OPEN",
                  parent: { number: 1 },
                })),
              },
              blocking: {
                nodes: nodes
                  .filter((other) => other.blockedBy.includes(node.number))
                  .map((other) => ({ number: other.number })),
              },
            })),
          },
        },
      },
    },
  });

const parentBody = "Base: `pj/1` from `main`\n\n## Order\n\n1. #3\n\n## Goal\n\nG.\n";

const acyclic = projectJson(parentBody, [
  {
    number: 2,
    title: "A",
    state: "OPEN",
    body: subBody(goodCriteria, openDecision),
    blockedBy: [],
  },
  { number: 3, title: "B", state: "OPEN", body: subBody(goodCriteria, "None.\n"), blockedBy: [] },
  {
    number: 5,
    title: "C",
    state: "CLOSED",
    body: subBody(goodCriteria, openDecision),
    blockedBy: [],
  },
]);

const cyclic = projectJson(parentBody, [
  { number: 2, title: "Two", state: "OPEN", body: "", blockedBy: [3] },
  { number: 3, title: "Three", state: "OPEN", body: "", blockedBy: [2] },
]);

const setup = (): void => {
  rmSync(fake, { recursive: true, force: true });
  for (const name of readdirSync(tmp)) {
    if (name.endsWith(".github")) {
      rmSync(join(tmp, name));
    }
  }
  mkdirSync(fake);
  for (const name of ["gh.log", "project.log", "labels", "comments"]) {
    writeFileSync(join(fake, name), "");
  }
  writeFileSync(join(fake, "next"), "7\n");
  writeFileSync(join(fake, "graphql"), acyclic);
  view(1, "OPEN", "project", null);
  view(2, "OPEN", "", 1);
  view(3, "OPEN", "", 1);
  view(5, "CLOSED", "", 1);
  view(6, "CLOSED", "project", null);
  view(9, "OPEN", "", null);
};

const file = (name: string, text: string): string => {
  const path = join(tmp, name);
  writeFileSync(path, text);
  return path;
};

const bodyMd = file("body.md", "## Goal\n\nRetry failed jobs.\n");
const parentMd = file(
  "parent.md",
  "## Goal\n\nRetry failed jobs.\n\n## Design\n\nA retry loop.\n\n## Decisions\n\nNone.\n\n## Out of scope\n\nNothing.\n",
);
const passMd = file("pass.md", subBody(goodCriteria, "None.\n"));
const openMd = file("open.md", subBody(goodCriteria, openDecision));
const badMd = file("bad.md", subBody("sign out, then sign in again", openDecision));
const stubMd = file(
  "stub.md",
  "## Goal\n\nFound while working on #2.\n\n## Design\n\nTo be drawn.\n\n## Acceptance criteria\n\nTo be drawn.\n\n## Decisions\n\nTo be drawn.\n\n## Out of scope\n\nTo be drawn.\n",
);
const nodesignMd = file(
  "nodesign.md",
  "## Goal\n\nG.\n\n## Decisions\n\nNone.\n\n## Out of scope\n\nNothing.\n",
);
const markedMd = file("marked.md", "**[pj3-doctor]** Resolved by the rewrite of #2.\n");
const plainMd = file("plain.md", "No marker here.\n");
const handoverMd = file(
  "handover.md",
  "**[pj4-running]** Handover notes\n- bash tests/run.sh runs the tests\n",
);

test("comment-markers.ts and issue.ts import MARKERS, markerProblem and LABELS, run no command, keep every label description within 100 characters, and match the Labels table", () => {
  setup();
  assert.deepEqual(MARKERS, ["**[pj3-doctor]**", "**[pj4-running]**", "**[cleanup]**"]);
  assert.equal(markerProblem(markedMd, read(markedMd)), null);
  assert.equal(markerProblem(plainMd, read(plainMd)), `${plainMd} does not start with a marker`);
  const long = Object.entries(LABELS).filter(([, [, text]]) => text.length > 100);
  assert.deepEqual(long, []);
  const doc = read(join(scripts, "../between-skills.md"));
  const section = doc.split("## Labels\n")[1]?.split("\n## ")[0] ?? "";
  const rows = Object.fromEntries(
    [...section.matchAll(/^\| `([^`]+)` \| (.+) \|$/gm)].map((m) => [m[1], m[2]]),
  );
  const want = Object.fromEntries(Object.entries(LABELS).map(([name, [, text]]) => [name, text]));
  assert.deepEqual(rows, want);
  assert.deepEqual(ghLog(), []);
  assert.deepEqual(projectLog(), []);
});

test("label adds and removes in one call and reuses an existing label", () => {
  setup();
  writeFileSync(join(fake, "labels"), "ready\n");
  assert.equal(
    printed(issue("label", "2", "--add", "ready,blocker", "--remove", "doing"))["status"],
    "ok",
  );
  assert.ok(
    logged(
      "label create ready --color 0E8A16 --description Every decision is settled and the body is complete for its day. pj4-running can work on it.",
    ),
  );
  assert.ok(
    logged(
      "label create blocker --color B60205 --description pj4-running stopped on this. Settle it before anything else.",
    ),
  );
  assert.ok(!ghLog().some((l) => l.startsWith("label create doing")));
  assert.ok(!ghLog().some((l) => l.includes("--force")));
  assert.equal(writes().at(-1), "issue edit 2 --add-label ready,blocker --remove-label doing");
  assert.equal(ghLog().filter((l) => l.startsWith("issue edit")).length, 1);
});

test("parent files the project and writes Base and Roadmap above the body", () => {
  setup();
  const out = printed(
    issue(
      "parent",
      "--title",
      "Retry",
      "--from",
      "main",
      "--blocked-by",
      "3,4",
      "--roadmap",
      "docs/roadmap.md",
      "Retry settings",
      "--body",
      parentMd,
    ),
  );
  assert.equal(out["status"], "ok", JSON.stringify(out));
  assert.equal(out["number"], 7);
  assert.equal(out["url"], "https://github.com/o/r/issues/7");
  assert.deepEqual(
    writes().map((l) => l.split(" ").slice(0, 3).join(" ")),
    ["label create project", "issue create --label", "issue edit 7"],
  );
  assert.ok(
    logged(`issue create --label project --title Retry --body-file ${parentMd} --blocked-by 3,4`),
  );
  assert.ok(logged("issue edit 7 --body-file -"));
  assert.equal(
    read(join(fake, "body-7")),
    `Base: \`pj/7\` from \`main\`\nRoadmap: \`docs/roadmap.md\` Retry settings\n\n${read(parentMd)}`,
  );
});

test("a parent body that fails the parent lint stops lint", () => {
  setup();
  const out = printed(issue("parent", "--title", "Retry", "--from", "main", "--body", nodesignMd));
  assert.equal(out["reason"], "lint");
  assert.deepEqual(out["reasons"], ["sections"]);
  const edited = printed(
    issue("edit", "1", "--since", "2026-01-01T00:00:00Z", "--body", nodesignMd),
  );
  assert.equal(edited["reason"], "lint");
  assert.deepEqual(writes(), []);
  const sub = printed(
    issue("edit", "2", "--since", "2026-01-01T00:00:00Z", "--body", bodyMd, "--title", "Add retry"),
  );
  assert.equal(sub["status"], "ok");
  assert.ok(logged(`issue edit 2 --body-file ${bodyMd} --title Add retry`));
});

test("sub files a sub-issue and refuses a failing lint", () => {
  setup();
  writeFileSync(join(fake, "next"), "8\n");
  const out = printed(
    issue(
      "sub",
      "1",
      "--title",
      "Add retry",
      "--blocked-by",
      "2,3",
      "--blocking",
      "4",
      "--label",
      "blocker",
      "--body",
      passMd,
    ),
  );
  assert.equal(out["status"], "ok", JSON.stringify(out));
  assert.deepEqual([out["number"], out["url"]], [8, "https://github.com/o/r/issues/8"]);
  assert.ok(
    logged(
      "label create blocker --color B60205 --description pj4-running stopped on this. Settle it before anything else.",
    ),
  );
  assert.ok(
    logged(
      `issue create --parent 1 --title Add retry --body-file ${passMd} --blocked-by 2,3 --blocking 4 --label blocker`,
    ),
  );
  assert.deepEqual(projectLog(), ["graphql n=1"]);
  assert.equal(printed(issue("sub", "1", "--title", "Open", "--body", openMd))["status"], "ok");
  assert.equal(printed(issue("sub", "1", "--title", "Stub", "--body", stubMd))["status"], "ok");
  clearLog();
  const bad = printed(issue("sub", "1", "--title", "Bad", "--body", badMd));
  assert.equal(bad["reason"], "lint");
  assert.deepEqual(bad["reasons"], ["criteria", "decisions-open"]);
  assert.deepEqual(ghLog(), []);
});

test("a cycle takes the edge back off and stops cycle", () => {
  setup();
  writeFileSync(join(fake, "next"), "8\n");
  writeFileSync(join(fake, "graphql"), cyclic);
  const out = printed(
    issue(
      "sub",
      "1",
      "--title",
      "Add retry",
      "--blocked-by",
      "2",
      "--blocking",
      "4",
      "--body",
      passMd,
    ),
  );
  assert.equal(out["reason"], "cycle", JSON.stringify(out));
  assert.deepEqual([out["number"], out["url"]], [8, "https://github.com/o/r/issues/8"]);
  assert.equal(writes().at(-1), "issue edit 8 --remove-blocked-by 2 --remove-blocking 4");
  clearLog();
  const related = printed(issue("relate", "2", "add", "3"));
  assert.equal(related["reason"], "cycle");
  assert.match(
    String(related["message"]),
    /project: .*have a cycle: #2 blocked by #3 blocked by #2/,
  );
  assert.deepEqual(writes(), [
    "issue edit 2 --add-blocked-by 3",
    "issue edit 2 --remove-blocked-by 3",
  ]);
  writeFileSync(join(fake, "project.log"), "");
  assert.equal(printed(issue("relate", "1", "add", "6"))["reason"], "cycle");
  assert.deepEqual(projectLog(), ["graphql n=1"]);
  writeFileSync(join(fake, "graphql-fail"), "");
  clearLog();
  const failed = issue("relate", "2", "add", "3");
  assert.equal(failed.code, 1);
  assert.match(
    failed.stderr,
    /^issue: took #2 blocked by #3 back off, because project.sh 1 --order failed: project: cannot read issue #1 in o\/r/m,
  );
  assert.ok(logged("issue edit 2 --remove-blocked-by 3"));
  writeFileSync(join(fake, "project.log"), "");
  assert.equal(printed(issue("relate", "2", "remove", "3"))["status"], "ok");
  assert.deepEqual(projectLog(), []);
  assert.equal(issue("relate", "9", "add", "3").code, 1);
});

test("moved saves GitHub's text beside the file", () => {
  setup();
  writeFileSync(join(fake, "bump"), "");
  const order = printed(issue("order", "1", "--since", "2026-01-01T00:00:00Z"));
  assert.equal(order["reason"], "moved");
  assert.equal(order["updatedAt"], "2026-02-02T00:00:00Z");
  assert.ok(!("github" in order));
  const editMd = join(tmp, "edit.md");
  copyFileSync(bodyMd, editMd);
  const edited = printed(issue("edit", "2", "--since", "2025-12-31T00:00:00Z", "--body", editMd));
  assert.equal(edited["reason"], "moved");
  assert.deepEqual(
    [edited["updatedAt"], edited["github"]],
    ["2026-01-01T00:00:00Z", `${editMd}.github`],
  );
  assert.equal(read(`${editMd}.github`), "GitHub body of #2");
  writeFileSync(
    join(fake, "comments"),
    '{"id":11,"updated_at":"2026-01-03T00:00:00Z","body":"**[pj4-running]** Handover notes\\n- a human line"}\n',
  );
  const notesMd = join(tmp, "notes.md");
  copyFileSync(handoverMd, notesMd);
  const handed = printed(
    issue("handover", "1", "--since", "2026-01-02T00:00:00Z", "--body", notesMd),
  );
  assert.equal(handed["reason"], "moved");
  assert.deepEqual(
    [handed["updated_at"], handed["github"]],
    ["2026-01-03T00:00:00Z", `${notesMd}.github`],
  );
  assert.equal(read(`${notesMd}.github`), "**[pj4-running]** Handover notes\n- a human line");
  assert.deepEqual(
    writes().filter((l) => !l.startsWith("api repos/")),
    [],
  );
  rmSync(join(fake, "bump"));
  view(1, "OPEN", "project", null);
  assert.equal(printed(issue("order", "1", "--since", "2026-01-01T00:00:00Z"))["status"], "ok");
  assert.equal(
    read(join(fake, "body-1")),
    "Base: `pj/1` from `main`\n\n## Order\n\n1. #5\n2. #3\n3. #2\n\n## Goal\n\nG.\n",
  );
});

test("handover posts once and rewrites under since", () => {
  setup();
  assert.equal(printed(issue("handover", "1", "--body", handoverMd))["status"], "ok");
  assert.ok(logged(`issue comment 1 --body-file ${handoverMd}`));
  assert.ok(
    logged(
      'api repos/{owner}/{repo}/issues/1/comments --paginate --jq .[] | select(.body | startswith("**[pj4-running]** Handover notes")) | {id, updated_at, body}',
    ),
  );
  const gone = printed(
    issue("handover", "1", "--since", "2026-01-03T00:00:00Z", "--body", handoverMd),
  );
  assert.deepEqual([gone["reason"], gone["updated_at"], "github" in gone], ["moved", null, false]);
  writeFileSync(
    join(fake, "comments"),
    '{"id":11,"updated_at":"2026-01-03T00:00:00Z","body":"**[pj4-running]** Handover notes"}\n',
  );
  clearLog();
  assert.equal(printed(issue("handover", "1", "--body", handoverMd))["reason"], "moved");
  assert.deepEqual(
    writes().filter((l) => !l.startsWith("api repos/")),
    [],
  );
  assert.equal(
    printed(issue("handover", "1", "--since", "2026-01-03T00:00:00Z", "--body", handoverMd))[
      "status"
    ],
    "ok",
  );
  assert.equal(
    writes().at(-1),
    `api -X PATCH repos/{owner}/{repo}/issues/comments/11 -F body=@${handoverMd}`,
  );
});

test("a file with no marker stops no-marker", () => {
  setup();
  const out = printed(issue("comment", "2", "--body", plainMd));
  assert.deepEqual(
    [out["reason"], out["message"]],
    ["no-marker", `${plainMd} does not start with a marker`],
  );
  assert.equal(
    printed(issue("close", "2", "--reason", "completed", "--comment", plainMd))["reason"],
    "no-marker",
  );
  assert.equal(printed(issue("handover", "1", "--body", markedMd))["reason"], "no-marker");
  assert.deepEqual(ghLog(), []);
});

test("a closed issue stops closed", () => {
  setup();
  const calls: readonly (readonly string[])[] = [
    ["label", "5", "--add", "ready"],
    ["comment", "5", "--body", markedMd],
    ["edit", "5", "--since", "2026-01-01T00:00:00Z", "--body", bodyMd],
    ["relate", "5", "add", "2"],
    ["sub", "6", "--title", "T", "--body", passMd],
    ["order", "6", "--since", "2026-01-01T00:00:00Z"],
    ["handover", "6", "--body", handoverMd],
  ];
  for (const call of calls) {
    assert.equal(printed(issue(...call))["reason"], "closed", call.join(" "));
  }
  assert.deepEqual(writes(), []);
  printed(issue("titles", "1"));
  assert.ok(!ghLog().some((l) => l.startsWith("issue edit 5")));
});

test("close posts the marker comment and closes in one call", () => {
  setup();
  assert.equal(
    printed(issue("close", "2", "--reason", "not-planned", "--comment", markedMd))["status"],
    "ok",
  );
  assert.deepEqual(writes(), [
    "issue close 2 --reason not planned --comment **[pj3-doctor]** Resolved by the rewrite of #2.",
  ]);
  clearLog();
  assert.equal(
    printed(issue("close", "5", "--reason", "completed", "--comment", markedMd))["status"],
    "ok",
  );
  assert.deepEqual(writes(), []);
});

test("titles retitles only open sub-issues that differ", () => {
  setup();
  const out = printed(issue("titles", "1"));
  assert.deepEqual([out["status"], out["changed"]], ["ok", [2]]);
  assert.deepEqual(ghLog(), ["issue edit 2 --title A (0/1)"]);
  writeFileSync(join(fake, "graphql-fail"), "");
  const failed = issue("titles", "7");
  assert.equal(failed.code, 1);
  assert.match(
    failed.stderr,
    /^issue: project.sh 7 failed: project: cannot read issue #7 in o\/r/m,
  );
});

test("usage errors exit 1 and refusals exit 0", () => {
  setup();
  const usageError = (...args: readonly string[]): void => {
    const result = issue(...args);
    assert.equal(result.code, 1, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    const err = result.stderr.split("\n").filter((l) => l !== "");
    assert.match(err[0] ?? "", /^usage: issue.sh label /, args.join(" "));
    assert.match(err.at(-1) ?? "", /^issue: /, args.join(" "));
  };
  usageError();
  usageError("frob", "2");
  usageError("label", "2");
  usageError("label", "0", "--add", "ready");
  usageError("label", "2", "--add", "wip");
  usageError("label", "2", "--add", "ready", "-h");
  usageError("comment", "2", "--body", join(tmp, "missing.md"));
  usageError("close", "2", "--reason", "duplicate", "--comment", markedMd);
  usageError("relate", "2", "link", "3");
  usageError("sub", "1", "--title", "T", "--blocked-by", "2,x", "--body", passMd);
  usageError(
    "parent",
    "--title",
    "T",
    "--from",
    "main",
    "--roadmap",
    "docs/roadmap.md",
    "--body",
    bodyMd,
  );
  assert.deepEqual(ghLog(), []);
  const refused = issue("comment", "2", "--body", plainMd);
  assert.equal(refused.code, 0);
  assert.equal((JSON.parse(refused.stdout) as Record<string, unknown>)["status"], "stop");
});
