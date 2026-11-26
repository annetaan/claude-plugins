import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const skills = join(import.meta.dirname, "../plugins/annetaan/skills");
const script = join(skills, "workflow/scripts/worktree.sh");
const cleanupSh = join(skills, "cleanup/scripts/cleanup.sh");

const tmp = mkdtempSync(join(tmpdir(), "worktree-propose-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
const answers = join(tmp, "gh");
const ghLog = join(answers, "log");
mkdirSync(home);
mkdirSync(bin);
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
echo "$*" >> "${ghLog}"
case "$1 $2" in
  "pr list")
    if [ -f "${answers}/list.json" ]; then cat "${answers}/list.json"; else echo '[]'; fi
    exit 0 ;;
  "pr create")
    code=0
    if [ -f "${answers}/create-code" ]; then code=$(cat "${answers}/create-code"); fi
    if [ "$code" = 0 ]; then
      echo "Creating pull request"
      cat "${answers}/create-url"
    else
      echo "pull request create failed" >&2
    fi
    exit "$code" ;;
  "pr view")
    if [ -f "${answers}/view.json" ]; then cat "${answers}/view.json"; exit 0; fi
    echo "no pull requests found" >&2
    exit 1 ;;
esac
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

type Ran = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

const ran = (cwd: string, ...args: readonly string[]): Ran => {
  const result = spawnSync("bash", [script, ...args], { cwd, env, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

type Out = Readonly<Record<string, unknown>> & {
  readonly status: string;
  readonly reason?: string;
  readonly message?: string;
  readonly branch?: string;
  readonly number?: number;
  readonly url?: string;
  readonly pr?: { readonly number: number; readonly url: string } | null;
};

const printed = (cwd: string, ...args: readonly string[]): Out => {
  const result = ran(cwd, ...args);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout) as Out;
};

type Clone = { readonly root: string; readonly main: string; readonly origin: string };

const setup = (dir: string): Clone => {
  rmSync(answers, { recursive: true, force: true });
  mkdirSync(answers);
  writeFileSync(ghLog, "");
  const root = join(tmp, dir);
  mkdirSync(root);
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "init", "-q", "-b", "main", "work");
  const main = realpathSync(join(root, "work"));
  writeFileSync(join(main, ".gitignore"), ".claude/\n");
  writeFileSync(join(main, "ROADMAP.md"), "# Roadmap\n");
  git(main, "add", ".gitignore", "ROADMAP.md");
  git(main, "commit", "-q", "-m", "init");
  git(main, "remote", "add", "origin", origin);
  git(main, "push", "-q", "origin", "main");
  return { root, main, origin };
};

type Created = { readonly name: string; readonly worktree: string };

const create = (main: string, kind: "run" | "propose"): Created => {
  const out = printed(main, "create", "main", "--kind", kind);
  assert.equal(out.status, "ready", JSON.stringify(out));
  return out as unknown as Created;
};

const stampOf = (name: string): string => name.slice("propose-".length);

const pullUrl = (n: number): string => `https://github.com/test/repo/pull/${n}`;

const bodyFile = (root: string): string => {
  const path = join(root, "pr.md");
  writeFileSync(path, "the body\n");
  return path;
};

const proposeArgs = (
  name: string,
  path: string,
  body: string,
  prefix = "level",
): readonly string[] => [
  "propose",
  name,
  "main",
  "--prefix",
  prefix,
  "--path",
  path,
  "--subject",
  "Set the level",
  "--title",
  "Set the level (title)",
  "--body",
  body,
];

const ghCalls = (): readonly string[] =>
  readFileSync(ghLog, "utf8")
    .split("\n")
    .filter((l) => l !== "");

type Cleanup = {
  readonly status: string;
  readonly loses: readonly string[];
  readonly branches: readonly { readonly name: string; readonly remote: string }[];
};

const cleanup = (main: string, ...args: readonly string[]): Cleanup => {
  rmSync(join(answers, "list.json"), { force: true });
  const result = spawnSync("bash", [cleanupSh, ...args], { cwd: main, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Cleanup;
};

const branchesOf = (out: Cleanup): readonly (readonly string[])[] =>
  out.branches.map((b) => [b.name, b.remote]);

const remoteBranches = (origin: string, pattern: string): string =>
  git(origin, "for-each-ref", "--format=%(refname:short)", `refs/heads/${pattern}`).trim();

test("proposal finds the newest open pull request from <prefix>/*", () => {
  const { main } = setup("proposal");
  writeFileSync(
    join(answers, "list.json"),
    JSON.stringify([
      { number: 3, url: pullUrl(3), headRefName: "level/a" },
      { number: 5, url: pullUrl(5), headRefName: "level/b" },
      { number: 9, url: pullUrl(9), headRefName: "level-2026-01-01-0000" },
      { number: 7, url: pullUrl(7), headRefName: "pj-roadmap/c" },
    ]),
  );
  assert.deepEqual(printed(main, "proposal", "level", "main"), {
    status: "ok",
    pr: { number: 5, url: pullUrl(5) },
  });
  assert.deepEqual(printed(main, "proposal", "pj-roadmap", "main"), {
    status: "ok",
    pr: { number: 7, url: pullUrl(7) },
  });
  assert.deepEqual(ghCalls(), [
    "pr list --state open --base main --limit 100 --json number,url,headRefName",
    "pr list --state open --base main --limit 100 --json number,url,headRefName",
  ]);
});

test("proposal prints a null pr when none matches", () => {
  const { main } = setup("proposal-none");
  writeFileSync(
    join(answers, "list.json"),
    JSON.stringify([{ number: 2, url: pullUrl(2), headRefName: "feat/x" }]),
  );
  assert.deepEqual(printed(main, "proposal", "level", "main"), { status: "ok", pr: null });
});

test("proposal exits 1 when gh prints no JSON", () => {
  const { main } = setup("proposal-broken");
  writeFileSync(join(answers, "list.json"), "not json");
  const result = ran(main, "proposal", "level", "main");
  assert.equal(result.code, 1);
  assert.match(result.stderr, /gh pr list printed what is not JSON/);
});

test("propose opens a pull request from <prefix>/<stamp>", () => {
  const { root, main, origin } = setup("opened");
  const wt = create(main, "propose");
  writeFileSync(join(wt.worktree, "ROADMAP.md"), "# Roadmap\n\n## One\n");
  writeFileSync(join(wt.worktree, "other.txt"), "other\n");
  git(wt.worktree, "add", "other.txt");
  writeFileSync(join(answers, "create-url"), `${pullUrl(42)}\n`);
  const body = bodyFile(root);
  const branch = `level/${stampOf(wt.name)}`;
  assert.deepEqual(printed(main, ...proposeArgs(wt.name, "ROADMAP.md", body)), {
    status: "opened",
    branch,
    number: 42,
    url: pullUrl(42),
  });
  assert.equal(git(origin, "rev-list", "--count", `main..${branch}`).trim(), "1");
  assert.equal(
    git(origin, "log", "--format=%s", "--name-only", `main..${branch}`).trim(),
    "Set the level\n\nROADMAP.md",
  );
  assert.deepEqual(ghCalls().at(-1)?.split(" "), [
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    branch,
    "--title",
    "Set",
    "the",
    "level",
    "(title)",
    "--body-file",
    body,
  ]);
  assert.equal(git(wt.worktree, "status", "--porcelain"), "A  other.txt\n");
});

test("propose commits an ignored new file", () => {
  const { root, main, origin } = setup("ignored");
  const wt = create(main, "propose");
  const path = ".claude/annetaan-level.md";
  mkdirSync(join(wt.worktree, ".claude"), { recursive: true });
  writeFileSync(join(wt.worktree, path), "---\nlevel: high\n---\n");
  writeFileSync(join(answers, "create-url"), `${pullUrl(8)}\n`);
  const out = printed(main, ...proposeArgs(wt.name, path, bodyFile(root)));
  assert.equal(out.status, "opened", JSON.stringify(out));
  const branch = `level/${stampOf(wt.name)}`;
  assert.equal(git(origin, "show", `${branch}:${path}`), "---\nlevel: high\n---\n");
  assert.equal(git(origin, "diff", "--name-only", `main..${branch}`).trim(), path);
});

test("propose stops unchanged when the file equals origin", () => {
  const { root, main } = setup("unchanged");
  const wt = create(main, "propose");
  const out = printed(main, ...proposeArgs(wt.name, "ROADMAP.md", bodyFile(root)));
  assert.equal(out.status, "stop", JSON.stringify(out));
  assert.equal(out.reason, "unchanged");
  assert.equal(git(wt.worktree, "branch", "--list", "level/*"), "");
  assert.equal(git(wt.worktree, "status", "--porcelain"), "");
  assert.deepEqual(ghCalls(), []);
  assert.equal(cleanup(main, "run", wt.name).status, "done");
});

test("propose stops exists when a proposal is open", () => {
  const { root, main, origin } = setup("exists");
  const wt = create(main, "propose");
  writeFileSync(join(wt.worktree, "ROADMAP.md"), "# Roadmap\n\nchanged\n");
  writeFileSync(
    join(answers, "list.json"),
    JSON.stringify([{ number: 12, url: pullUrl(12), headRefName: "level/x" }]),
  );
  const out = printed(main, ...proposeArgs(wt.name, "ROADMAP.md", bodyFile(root)));
  const branch = `level/${stampOf(wt.name)}`;
  assert.equal(out.status, "stop", JSON.stringify(out));
  assert.equal(out.reason, "exists");
  assert.equal(out.number, 12);
  assert.equal(out.url, pullUrl(12));
  assert.equal(out.branch, branch);
  assert.equal(remoteBranches(origin, "level/*"), "");
  assert.equal(git(wt.worktree, "branch", "--show-current").trim(), branch);
  const check = cleanup(main, "check", wt.name);
  assert.deepEqual(check.loses, ["commits"]);
  assert.deepEqual(branchesOf(check), [[branch, "absent"]]);
});

test("propose stops push-failed when origin rejects the push", () => {
  const { root, main, origin } = setup("push-failed");
  const wt = create(main, "propose");
  writeFileSync(join(wt.worktree, "ROADMAP.md"), "# Roadmap\n\npushed\n");
  writeFileSync(join(origin, "hooks", "pre-receive"), "#!/bin/sh\necho rejected >&2\nexit 1\n", {
    mode: 0o755,
  });
  const out = printed(main, ...proposeArgs(wt.name, "ROADMAP.md", bodyFile(root)));
  assert.equal(out.status, "stop", JSON.stringify(out));
  assert.equal(out.reason, "push-failed");
  assert.equal(out.branch, `level/${stampOf(wt.name)}`);
  assert.match(out.message ?? "", /rejected/);
  assert.equal(remoteBranches(origin, "level/*"), "");
  assert.ok(!ghCalls().some((c) => c.startsWith("pr create")));
  const check = cleanup(main, "check", wt.name);
  assert.deepEqual(check.loses, ["commits"]);
  assert.deepEqual(branchesOf(check), [[`level/${stampOf(wt.name)}`, "absent"]]);
});

test("propose stops create-failed when no pull request exists after a failed create", () => {
  const { root, main, origin } = setup("create-failed");
  const wt = create(main, "propose");
  writeFileSync(join(wt.worktree, "ROADMAP.md"), "# Roadmap\n\nfailed\n");
  writeFileSync(join(answers, "create-code"), "1");
  const branch = `level/${stampOf(wt.name)}`;
  const out = printed(main, ...proposeArgs(wt.name, "ROADMAP.md", bodyFile(root)));
  assert.deepEqual(out, {
    status: "stop",
    reason: "create-failed",
    message: "pull request create failed",
    branch,
  });
  assert.equal(remoteBranches(origin, "level/*"), branch);
  assert.equal(ghCalls().at(-1), `pr view ${branch} --json number,url`);
  assert.deepEqual(branchesOf(cleanup(main, "check", wt.name)), [[branch, "present"]]);
});

test("propose carries on with the pull request gh pr view finds", () => {
  const { root, main } = setup("create-view");
  const wt = create(main, "propose");
  writeFileSync(join(wt.worktree, "ROADMAP.md"), "# Roadmap\n\nviewed\n");
  writeFileSync(join(answers, "create-code"), "1");
  writeFileSync(join(answers, "view.json"), JSON.stringify({ number: 31, url: pullUrl(31) }));
  const out = printed(main, ...proposeArgs(wt.name, "ROADMAP.md", bodyFile(root), "pj-roadmap"));
  assert.deepEqual(out, {
    status: "opened",
    branch: `pj-roadmap/${stampOf(wt.name)}`,
    number: 31,
    url: pullUrl(31),
  });
});

test("propose exits 1 for a name that is no propose worktree", () => {
  const { root, main } = setup("not-propose");
  const run = create(main, "run");
  writeFileSync(join(run.worktree, "ROADMAP.md"), "# Roadmap\n\nrun\n");
  const body = bodyFile(root);
  for (const name of [run.name, "propose-nope"]) {
    const result = ran(main, ...proposeArgs(name, "ROADMAP.md", body));
    assert.equal(result.code, 1, result.stdout);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, new RegExp(`${name} is no propose-\\* worktree of this clone`));
  }
  assert.equal(git(run.worktree, "status", "--porcelain"), " M ROADMAP.md\n");
});

test("propose exits 1 on a repeated, missing or unknown flag", () => {
  const { root, main } = setup("usage");
  const wt = create(main, "propose");
  const args = proposeArgs(wt.name, "ROADMAP.md", bodyFile(root));
  for (const bad of [
    [...args, "--path", "x"],
    args.slice(0, -2),
    [...args, "--draft", "yes"],
    [...args, "--path"],
  ]) {
    const result = ran(main, ...bad);
    assert.equal(result.code, 1, bad.join(" "));
    assert.match(result.stderr, /usage: worktree\.sh/);
  }
});
