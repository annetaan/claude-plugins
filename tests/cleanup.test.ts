import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const skills = join(import.meta.dirname, "../plugins/annetaan/skills");
const worktreeSh = join(skills, "workflow/scripts/worktree.sh");
const cleanupSh = join(skills, "cleanup/scripts/cleanup.sh");

const tmp = mkdtempSync(join(tmpdir(), "cleanup-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const home = join(tmp, "home");
const bin = join(tmp, "bin");
const prs = join(tmp, "prs");
mkdirSync(home);
mkdirSync(bin);
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash
if [ "$1 $2" = "pr list" ]; then
  head=""
  while [ $# -gt 0 ]; do
    if [ "$1" = "--head" ]; then head="$2"; fi
    shift
  done
  file="${prs}/\${head//\\//_}.json"
  if [ -f "$file" ]; then cat "$file"; else echo '[]'; fi
  exit 0
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

const gitResult = (cwd: string, ...args: readonly string[]) =>
  spawnSync("git", args, { cwd, env, encoding: "utf8" });

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = gitResult(cwd, ...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

type Pr = { readonly number: number; readonly title: string; readonly url: string };

type Out = Readonly<Record<string, unknown>> & {
  readonly status: string;
  readonly reason?: string;
  readonly loses: readonly string[];
  readonly errors: readonly unknown[];
  readonly worktrees: readonly { readonly action?: string; readonly path?: string }[];
  readonly branches: readonly Readonly<Record<string, unknown>>[];
  readonly update: { readonly action: string };
  readonly targets: readonly {
    readonly kind: string;
    readonly name: string;
    readonly worktrees: readonly string[];
    readonly branch: string | null;
    readonly pr: Pr | null;
    readonly state: string;
  }[];
};

const printed = (cwd: string, ...args: readonly string[]): Out => {
  const result = spawnSync("bash", [cleanupSh, ...args], { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Out;
};

type Clone = { readonly main: string; readonly other: string };

const setup = (dir: string): Clone => {
  rmSync(prs, { recursive: true, force: true });
  mkdirSync(prs);
  const root = join(tmp, dir);
  mkdirSync(root);
  git(root, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(root, "init", "-q", "-b", "main", "work");
  const main = realpathSync(join(root, "work"));
  writeFileSync(join(main, "README.md"), "readme\n");
  git(main, "add", "README.md");
  git(main, "commit", "-q", "-m", "init");
  git(main, "remote", "add", "origin", join(root, "origin.git"));
  git(main, "push", "-q", "origin", "main");
  git(root, "clone", "-q", join(root, "origin.git"), "other");
  return { main, other: join(root, "other") };
};

type Created = { readonly name: string; readonly worktree: string };

const create = (main: string, kind: "run" | "propose"): Created => {
  const result = spawnSync("bash", [worktreeSh, "create", "main", "--kind", kind], {
    cwd: main,
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const d = JSON.parse(result.stdout) as Created & { readonly status: string };
  assert.equal(d.status, "ready", result.stdout);
  return d;
};

const commitOn = (wt: string, branch: string | null, file: string): string => {
  if (branch !== null) {
    git(wt, "switch", "-q", "-c", branch);
  }
  writeFileSync(join(wt, file), `${file}\n`);
  git(wt, "add", file);
  git(wt, "commit", "-q", "-m", file);
  return git(wt, "rev-parse", "HEAD").trim();
};

const pullRequest = (branch: string, number: number, state: string, head: string): void => {
  writeFileSync(
    join(prs, `${branch.replaceAll("/", "_")}.json`),
    JSON.stringify([
      {
        number,
        state,
        url: `https://github.com/test/repo/pull/${number}`,
        title: `PR ${number}`,
        baseRefName: "main",
        headRefOid: head,
      },
    ]),
  );
};

test("run removes a fresh run worktree with nothing to lose", () => {
  const { main } = setup("fresh");
  const wt = create(main, "run");
  const out = printed(main, "run", wt.name);
  assert.equal(out.status, "done", JSON.stringify(out));
  assert.equal(out.worktrees[0]?.action, "removed");
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.branches, []);
  assert.equal(existsSync(wt.worktree), false);
});

test("run after a merged pull request deletes the branch and fast-forwards the base", () => {
  const { main, other } = setup("merged");
  const wt = create(main, "run");
  const tip = commitOn(wt.worktree, "feat/m", "m.txt");
  git(wt.worktree, "push", "-q", "origin", "feat/m");
  git(other, "fetch", "-q", "origin");
  git(other, "merge", "-q", "--no-ff", "-m", "Merge feat/m", "origin/feat/m");
  git(other, "push", "-q", "origin", "main");
  pullRequest("feat/m", 1, "MERGED", tip);
  const out = printed(main, "run", wt.name);
  assert.equal(out.status, "done", JSON.stringify(out));
  assert.deepEqual(out.branches, [
    { name: "feat/m", local: "deleted", why: null, remote: "deleted" },
  ]);
  assert.equal(out.update.action, "updated");
  assert.deepEqual(out.errors, []);
  assert.equal(
    git(main, "rev-parse", "refs/heads/main").trim(),
    git(main, "rev-parse", "refs/remotes/origin/main").trim(),
  );
  assert.equal(git(main, "ls-remote", "origin", "refs/heads/feat/m"), "");
  assert.notEqual(gitResult(main, "rev-parse", "--verify", "-q", "refs/heads/feat/m").status, 0);
});

test("run after a merged pull request keeps a branch on origin whose local tip the pull request lacks", () => {
  const { main, other } = setup("merged-late");
  const wt = create(main, "run");
  const tip = commitOn(wt.worktree, "feat/m", "m.txt");
  git(wt.worktree, "push", "-q", "origin", "feat/m");
  git(other, "fetch", "-q", "origin");
  git(other, "merge", "-q", "--no-ff", "-m", "Merge feat/m", "origin/feat/m");
  git(other, "push", "-q", "origin", "main");
  pullRequest("feat/m", 1, "MERGED", tip);
  const late = commitOn(wt.worktree, null, "late.txt");
  git(wt.worktree, "push", "-q", "origin", "feat/m");
  const checked = printed(main, "check", wt.name);
  assert.deepEqual(checked.branches, [
    { name: "feat/m", local: "keep", why: "unpushed", remote: "present" },
  ]);
  const out = printed(main, "run", wt.name);
  assert.equal(out.status, "done", JSON.stringify(out));
  assert.deepEqual(out.branches, [
    { name: "feat/m", local: "kept", why: "unpushed", remote: "kept" },
  ]);
  assert.deepEqual(out.errors, []);
  assert.equal(
    git(main, "ls-remote", "origin", "refs/heads/feat/m"),
    `${late}\trefs/heads/feat/m\n`,
  );
  assert.equal(
    gitResult(main, "rev-parse", "--verify", "-q", "refs/remotes/origin/feat/m").status,
    0,
  );
  assert.equal(out.update.action, "updated");
  assert.equal(git(main, "log", "--format=%s", "origin/main..feat/m"), "late.txt\n");
  assert.deepEqual(printed(main, "list").targets, []);
});

test("a closed pull request's branch is a loss", () => {
  const { main } = setup("closed");
  const wt = create(main, "run");
  const tip = commitOn(wt.worktree, "feat/c", "c.txt");
  git(wt.worktree, "push", "-q", "origin", "feat/c");
  pullRequest("feat/c", 2, "CLOSED", tip);
  const checked = printed(main, "check", wt.name);
  assert.equal(checked.status, "ok", JSON.stringify(checked));
  assert.deepEqual(checked.loses, ["commits"]);
  const out = printed(main, "run", wt.name);
  assert.equal(out.status, "stop");
  assert.equal(out.reason, "discard");
  assert.ok(existsSync(wt.worktree));
  assert.equal(git(main, "rev-parse", "refs/heads/feat/c").trim(), tip);
});

test("a detached HEAD on no origin ref is a loss until it is pushed", () => {
  const { main } = setup("detached");
  const wt = create(main, "run");
  commitOn(wt.worktree, null, "d.txt");
  assert.deepEqual(printed(main, "check", wt.name).loses, ["commits"]);
  git(wt.worktree, "push", "-q", "origin", "HEAD:refs/heads/feat");
  assert.deepEqual(printed(main, "check", wt.name).loses, []);
});

test("an open pull request stops check and run", () => {
  const { main } = setup("open");
  const wt = create(main, "run");
  const tip = commitOn(wt.worktree, "feat/o", "o.txt");
  pullRequest("feat/o", 3, "OPEN", tip);
  for (const sub of ["check", "run"]) {
    const out = printed(main, sub, wt.name);
    assert.equal(out.status, "stop", JSON.stringify(out));
    assert.equal(out.reason, "open");
  }
  assert.ok(existsSync(wt.worktree));
});

test("list gives run and propose targets with their pull requests", () => {
  const { main } = setup("list");
  const run = create(main, "run");
  pullRequest("feat/l", 4, "MERGED", commitOn(run.worktree, "feat/l", "l.txt"));
  const proposal = create(main, "propose");
  const level = `level/${proposal.name.slice("propose-".length)}`;
  pullRequest(level, 5, "OPEN", commitOn(proposal.worktree, level, "level.md"));
  const fresh = create(main, "run");
  const out = printed(main, "list");
  assert.equal(out.status, "ok", JSON.stringify(out));
  const byName = new Map(out.targets.map((t) => [t.name, t]));
  assert.equal(out.targets.length, 3);
  assert.deepEqual(byName.get(run.name), {
    kind: "run",
    name: run.name,
    worktrees: [run.name],
    branch: "feat/l",
    pr: { number: 4, title: "PR 4", url: "https://github.com/test/repo/pull/4" },
    state: "merged",
  });
  const listedProposal = byName.get(proposal.name);
  assert.equal(listedProposal?.kind, "propose");
  assert.equal(listedProposal.branch, level);
  assert.equal(listedProposal.state, "open");
  assert.equal(listedProposal.pr?.number, 5);
  assert.deepEqual(byName.get(fresh.name), {
    kind: "run",
    name: fresh.name,
    worktrees: [fresh.name],
    branch: null,
    pr: null,
    state: "no-pr",
  });
});

test("check stops with unknown on a name that is no run or propose worktree", () => {
  const { main } = setup("unknown");
  for (const name of ["pj-1", "review-run-x-a"]) {
    git(main, "worktree", "add", "-q", "--detach", `.claude/worktrees/${name}`, "HEAD");
  }
  for (const name of ["pj-1", "review-run-x-a", "run-nope"]) {
    const out = printed(main, "check", name);
    assert.equal(out.status, "stop", `${name}: ${JSON.stringify(out)}`);
    assert.equal(out.reason, "unknown", name);
  }
});
