import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const scripts = join(import.meta.dirname, "../plugins/annetaan/skills");
const cleanupSh = join(scripts, "cleanup/scripts/cleanup.sh");
const pjCleanupSh = join(scripts, "pj-cleanup/scripts/cleanup.sh");

const tmp = mkdtempSync(join(tmpdir(), "old-reports-"));
after(() => {
  spawnSync("chmod", ["-R", "u+rwx", tmp]);
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
mkdirSync(home);
mkdirSync(bin);
const issueJson = join(tmp, "issue.json");
writeFileSync(
  issueJson,
  `${JSON.stringify({
    data: {
      repository: {
        issue: {
          number: 1,
          url: "https://github.com/test/repo/issues/1",
          title: "P",
          state: "CLOSED",
          stateReason: "COMPLETED",
          updatedAt: "2000-01-01T00:00:00Z",
          body: "Base: `pj/1` from `main`\n\n## Goal\n\nx\n",
          labels: { nodes: [{ name: "project" }] },
          blockedBy: { nodes: [] },
          blocking: { nodes: [] },
          subIssues: { totalCount: 0, nodes: [] },
        },
      },
    },
  })}\n`,
);
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
if [ "$1 $2" = "repo view" ]; then
  echo test/repo
  exit 0
fi
if [ "$1 $2" = "pr list" ]; then
  echo '[]'
  exit 0
fi
if [ "$1 $2" = "api graphql" ]; then
  for arg in "$@"; do
    case "$arg" in
      query=*"updatedAt body"*) cat '${issueJson}'; exit 0 ;;
      query=*"ro: ref("*) echo '{"data":{"repository":{"ro":null,"mo":{"totalCount":1},"po":{"nodes":[]}}}}'; exit 0 ;;
    esac
  done
  echo "fake gh: unexpected query" >&2
  exit 1
fi
echo "fake gh: unexpected call: $*" >&2
exit 1
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

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

type Out = Readonly<Record<string, unknown>> & {
  readonly status: string;
  readonly reason?: string;
  readonly errors: readonly { readonly step: string }[];
  readonly oldReports: {
    readonly names: readonly string[];
    readonly keep: number;
    readonly path: string;
    readonly deleted?: readonly string[];
  };
  readonly worktree: { readonly action?: string; readonly moved?: readonly string[] };
};

const printed = (cwd: string, script: string, ...args: readonly string[]): Out => {
  const result = spawnSync("bash", [script, ...args], { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Out;
};

const exists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const OLDEST = "2026-01-01-0000-r000";
const SECOND = "2026-01-01-0100-r001";
const NEWEST = "2026-01-05-0400-r100";
const NEW_IN = "2099-12-31-2359-incoming";
const OLD_IN = "2000-01-01-0000-incoming";

const two = (n: number): string => String(n).padStart(2, "0");

const seedReports = (reports: string): void => {
  mkdirSync(reports, { recursive: true });
  for (let i = 0; i < 101; i += 1) {
    const at = new Date(Date.UTC(2026, 0, 1, i));
    const stamp = `${at.getUTCFullYear()}-${two(at.getUTCMonth() + 1)}-${two(at.getUTCDate())}-${two(at.getUTCHours())}${two(at.getUTCMinutes())}`;
    mkdirSync(join(reports, `${stamp}-r${String(i).padStart(3, "0")}`));
  }
  writeFileSync(join(reports, OLDEST, "log.md"), "x\n");
  mkdirSync(join(reports, "notes"));
  writeFileSync(join(reports, ".DS_Store"), "");
  writeFileSync(join(reports, "2099-01-01-0000-file"), "");
  const elsewhere = join(tmp, "elsewhere");
  mkdirSync(elsewhere, { recursive: true });
  symlinkSync(elsewhere, join(reports, "2000-01-01-0000-link"));
  const old = new Date(2026, 0, 1);
  utimesSync(join(reports, NEWEST), old, old);
};

const incoming = (wt: string): void => {
  for (const name of [NEW_IN, OLD_IN, OLDEST]) {
    mkdirSync(join(wt, "work-reports", name), { recursive: true });
  }
};

type Clone = { readonly main: string; readonly wt: string; readonly reports: string };

const clone = (dir: string, name: string, withOrigin: boolean): Clone => {
  rmSync(join(tmp, dir), { recursive: true, force: true });
  mkdirSync(join(tmp, dir));
  git(join(tmp, dir), "init", "-q", "-b", "main", "work");
  const main = realpathSync(join(tmp, dir, "work"));
  writeFileSync(join(main, ".gitignore"), "work-reports/\n.claude/worktrees/\n");
  writeFileSync(join(main, "README.md"), "readme\n");
  git(main, "add", ".gitignore", "README.md");
  git(main, "commit", "-q", "-m", "init");
  if (withOrigin) {
    git(join(tmp, dir), "init", "-q", "--bare", "origin.git");
    git(main, "remote", "add", "origin", join(tmp, dir, "origin.git"));
    git(main, "push", "-q", "origin", "main");
  }
  git(main, "worktree", "add", "-q", "--detach", `.claude/worktrees/${name}`, "HEAD");
  const reports = join(main, "work-reports");
  seedReports(reports);
  return { main, wt: join(main, ".claude/worktrees", name), reports };
};

const setup = (): Clone => clone("work-run", "run-test", true);
const setupPj = (): Clone => clone("pj", "pj-1", true);

const count = (reports: string): number => readdirSync(reports).length;

test("check lists the reports beyond the 100 newest by stamp and deletes nothing", () => {
  const { main, reports } = setup();
  const out = printed(main, cleanupSh, "check", "run-test");
  assert.deepEqual(out.oldReports.names, [OLDEST]);
  assert.equal(out.oldReports.keep, 100);
  assert.equal(out.oldReports.path, reports);
  assert.equal("deleted" in out.oldReports, false);
  assert.equal(count(reports), 105);
});

test("cleanup deletes what check listed, an incoming report past the cut included, under the name a collision gives it", () => {
  const { main, wt, reports } = setup();
  incoming(wt);
  const listed = printed(main, cleanupSh, "check", "run-test").oldReports.names;
  assert.deepEqual(listed, [OLD_IN, OLDEST, `${OLDEST}-2`, SECOND]);
  const out = printed(main, cleanupSh, "run", "run-test");
  assert.equal(out.status, "done");
  assert.deepEqual(out.oldReports.deleted, listed);
  assert.deepEqual(out.errors, []);
  for (const gone of [OLD_IN, OLDEST, `${OLDEST}-2`, SECOND]) {
    assert.equal(exists(join(reports, gone)), false, gone);
  }
  for (const kept of [NEW_IN, NEWEST, "notes", ".DS_Store", "2099-01-01-0000-file"]) {
    assert.equal(exists(join(reports, kept)), true, kept);
  }
  assert.equal(exists(join(reports, "2000-01-01-0000-link")), true);
  assert.equal(statSync(join(tmp, "elsewhere")).isDirectory(), true);
  const left = readdirSync(reports).filter(
    (name) => (name.startsWith("2") && name.includes("-r")) || name.endsWith("-incoming"),
  );
  assert.equal(left.length, 100);
});

test("mtime does not decide", () => {
  const { main, reports } = setup();
  assert.deepEqual(printed(main, cleanupSh, "check", "run-test").oldReports.names, [OLDEST]);
  printed(main, cleanupSh, "run", "run-test");
  assert.equal(exists(join(reports, NEWEST)), true);
  assert.equal(exists(join(reports, OLDEST)), false);
});

test("cleanup.sh run on a run worktree refused for discard deletes nothing", () => {
  const { main, wt, reports } = setup();
  writeFileSync(join(wt, "untracked.txt"), "dirty\n");
  const out = printed(main, cleanupSh, "run", "run-test");
  assert.equal(out.status, "stop");
  assert.equal(out.reason, "discard");
  assert.equal(count(reports), 105);
});

test("cleanup.sh run records a report it cannot delete in errors and deletes the others", () => {
  const { main, reports } = setup();
  const locked = join(reports, "2000-01-02-0000-locked");
  mkdirSync(locked);
  writeFileSync(join(locked, "f"), "x\n");
  chmodSync(locked, 0o555);
  const out = printed(main, cleanupSh, "run", "run-test");
  assert.equal(out.status, "done");
  assert.deepEqual(
    out.errors.map((error) => error.step),
    ["old-reports"],
  );
  assert.deepEqual(out.oldReports.deleted, [OLDEST]);
  assert.equal(exists(join(reports, OLDEST)), false);
  assert.equal(exists(locked), true);
  chmodSync(locked, 0o755);
});

test("pj-cleanup check lists what run deletes", () => {
  const { main, wt, reports } = setupPj();
  incoming(wt);
  const checked = printed(main, pjCleanupSh, "check", "1");
  assert.equal(checked.status, "ok");
  const listed = checked.oldReports.names;
  assert.deepEqual(listed, [OLD_IN, OLDEST, `${OLDEST}-2`, SECOND]);
  assert.equal(checked.oldReports.keep, 100);
  assert.equal(checked.oldReports.path, reports);
  assert.equal("deleted" in checked.oldReports, false);
  assert.equal(count(reports), 105);
  const out = printed(main, pjCleanupSh, "run", "1");
  assert.equal(out.status, "done");
  assert.equal(out.worktree.action, "removed");
  assert.deepEqual(out.oldReports.deleted, listed);
  assert.deepEqual(out.errors, []);
  assert.equal(exists(join(reports, OLD_IN)), false);
  assert.equal(exists(join(reports, `${OLDEST}-2`)), false);
  assert.deepEqual(out.worktree.moved, [
    join(reports, OLD_IN),
    join(reports, `${OLDEST}-2`),
    join(reports, NEW_IN),
  ]);
  for (const kept of [NEW_IN, "notes", ".DS_Store", "2000-01-01-0000-link"]) {
    assert.equal(exists(join(reports, kept)), true, kept);
  }
});

test("cleanup.sh run refused for discard deletes nothing", () => {
  const { main, wt, reports } = setupPj();
  writeFileSync(join(wt, "untracked.txt"), "dirty\n");
  const out = printed(main, pjCleanupSh, "run", "1");
  assert.equal(out.status, "stop");
  assert.equal(out.reason, "discard");
  assert.equal(count(reports), 105);
});
