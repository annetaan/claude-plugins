import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const scripts = join(import.meta.dirname, "../plugins/annetaan/skills/workflow/scripts");
const worktreeSh = join(scripts, "worktree.sh");
const includeSh = join(scripts, "include.sh");
const skills = join(import.meta.dirname, "../plugins/annetaan/skills");

const tmp = mkdtempSync(join(tmpdir(), "include-"));
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

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

const captured = (text: string): string => text.replace(/\n+$/, "");

type Ran = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

const bash = (cwd: string, script: string, ...args: readonly string[]): Ran => {
  const result = spawnSync("bash", [script, ...args], { cwd, env, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

type Out = Readonly<Record<string, unknown>> & {
  readonly status: string;
  readonly worktree: string;
  readonly name: string;
  readonly reason: string;
  readonly copied: readonly string[];
  readonly notIgnored: readonly string[];
  readonly unlisted: readonly string[];
  readonly added: readonly string[];
  readonly paths: readonly string[];
};

const printed = (result: Ran): Out => {
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout) as Out;
};

const mode = (path: string): number => statSync(path).mode & 0o777;

const text = (path: string): string => captured(readFileSync(path, "utf8"));

let main = "";

const setup = (): void => {
  rmSync(join(tmp, "origin.git"), { recursive: true, force: true });
  rmSync(join(tmp, "work"), { recursive: true, force: true });
  git(tmp, "init", "-q", "--bare", "-b", "main", join(tmp, "origin.git"));
  git(tmp, "init", "-q", "-b", "main", join(tmp, "work"));
  main = realpathSync(join(tmp, "work"));
  writeFileSync(
    join(main, ".gitignore"),
    [
      ".claude/worktrees/",
      "work-reports/",
      ".env*",
      "*.local.toml",
      ".DS_Store",
      "node_modules/",
      ".worktreeinclude",
      "",
    ].join("\n"),
  );
  mkdirSync(join(main, "apps/web"), { recursive: true });
  writeFileSync(join(main, "README.md"), "readme\n");
  writeFileSync(join(main, "apps/web/index.js"), "web\n");
  git(main, "add", ".gitignore", "README.md", "apps/web/index.js");
  git(main, "commit", "-q", "-m", "init");
  git(main, "remote", "add", "origin", join(tmp, "origin.git"));
  git(main, "push", "-q", "origin", "main");
};

const create = (): Out => {
  const out = printed(bash(main, worktreeSh, "create", "main"));
  assert.equal(out.status, "ready", JSON.stringify(out));
  return out;
};

let out: Out;
let wt = "";

test("create copies the listed ignored files, at the root and nested, keeping their mode", () => {
  setup();
  writeFileSync(join(main, ".env.local"), "root\n");
  chmodSync(join(main, ".env.local"), 0o600);
  writeFileSync(join(main, "apps/web/.env.local"), "nested\n");
  chmodSync(join(main, "apps/web/.env.local"), 0o640);
  writeFileSync(join(main, ".DS_Store"), "mac\n");
  writeFileSync(join(main, "mise.local.toml"), "mise\n");
  writeFileSync(join(main, ".env.test"), "test\n");
  writeFileSync(join(main, "a[1]*.local.toml"), "weird\n");
  mkdirSync(join(main, "node_modules/p"), { recursive: true });
  writeFileSync(join(main, "node_modules/p/index.js"), "dep\n");
  writeFileSync(join(main, "extra.secret"), "s\n");
  appendFileSync(join(main, ".gitignore"), "extra.secret\n");
  writeFileSync(
    join(main, ".worktreeinclude"),
    "/.env.local\n/apps/web/.env.local\n!/.DS_Store\n/extra.secret\n",
  );
  out = create();
  wt = out.worktree;
  assert.deepEqual(out.copied, [".env.local", "apps/web/.env.local"]);
  assert.equal(text(join(wt, ".env.local")), "root");
  assert.equal(text(join(wt, "apps/web/.env.local")), "nested");
  assert.equal(mode(join(wt, ".env.local")), 0o600);
  assert.equal(mode(join(wt, "apps/web/.env.local")), 0o640);
});

test("a !/ line is neither copied nor unlisted", () => {
  assert.ok(!existsSync(join(wt, ".DS_Store")), ".DS_Store copied");
  assert.ok(!out.copied.includes(".DS_Store") && !out.unlisted.includes(".DS_Store"));
});

test("an ignored file no line names is unlisted and not copied; ignored directories appear in neither list", () => {
  assert.deepEqual(out.unlisted, [".env.test", "a[1]*.local.toml", "mise.local.toml"]);
  assert.ok(!existsSync(join(wt, "mise.local.toml")) && !existsSync(join(wt, ".env.test")));
  assert.ok(!existsSync(join(wt, "node_modules")), "node_modules copied");
  const listed = [...out.copied, ...out.notIgnored, ...out.unlisted].filter(
    (p) => p.startsWith("node_modules") || p.startsWith(".claude/") || p.startsWith("work-reports"),
  );
  assert.deepEqual(listed, []);
});

test("a listed file the worktree does not ignore is in notIgnored, not copied, and the worktree's status stays empty", () => {
  assert.deepEqual(out.notIgnored, ["extra.secret"]);
  assert.ok(!existsSync(join(wt, "extra.secret")), "extra.secret copied");
  assert.equal(git(wt, "status", "--porcelain"), "");
});

test("a file already present in the worktree is not overwritten", () => {
  writeFileSync(join(wt, ".env.local"), "mine\n");
  writeFileSync(join(main, "other.local.toml"), "other\n");
  const again = printed(bash(main, includeSh, "remember", wt, "--copy", "other.local.toml"));
  assert.equal(again.status, "ok", JSON.stringify(again));
  assert.equal(text(join(wt, ".env.local")), "mine");
  assert.deepEqual(again.copied, ["other.local.toml"]);
});

test(".worktreeinclude itself is never unlisted", () => {
  assert.ok(!out.unlisted.includes(".worktreeinclude"));
});

test("remember --copy appends /<path>, copies it and drops it from unlisted; --never appends !/<path>", () => {
  const before = text(join(main, ".worktreeinclude"));
  const r = printed(
    bash(
      main,
      includeSh,
      "remember",
      wt,
      "--copy",
      "mise.local.toml",
      "--copy",
      "a[1]*.local.toml",
      "--never",
      ".env.test",
    ),
  );
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.deepEqual(r.added, ["/mise.local.toml", "/a\\[1]\\*.local.toml", "!/.env.test"]);
  assert.equal(
    text(join(main, ".worktreeinclude")),
    `${before}\n/mise.local.toml\n/a\\[1]\\*.local.toml\n!/.env.test`,
  );
  assert.equal(text(join(wt, "mise.local.toml")), "mise");
  assert.equal(text(join(wt, "a[1]*.local.toml")), "weird");
  assert.ok(!existsSync(join(wt, ".env.test")), ".env.test copied");
  assert.deepEqual(r.copied, ["a[1]*.local.toml", "mise.local.toml"]);
  assert.deepEqual(r.unlisted, []);
});

let second: Out;

test("a second create after remember prints no unlisted file and copies the remembered one", () => {
  second = create();
  assert.deepEqual(second.unlisted, []);
  assert.equal(text(join(second.worktree, "mise.local.toml")), "mise");
});

test("cleanup removes a worktree holding copied files without --discard", () => {
  const c = printed(bash(main, worktreeSh, "cleanup", second.name));
  assert.equal(c.status, "done", JSON.stringify(c));
  assert.ok(!existsSync(second.worktree), `${second.worktree} still there`);
});

test("remember with a path not in unlisted stops with not-unlisted and leaves the list unchanged", () => {
  const before = text(join(main, ".worktreeinclude"));
  const r = printed(
    bash(main, includeSh, "remember", wt, "--copy", ".env.local", "--never", "nope"),
  );
  assert.equal(r.status, "stop");
  assert.equal(r.reason, "not-unlisted");
  assert.deepEqual(r.paths, [".env.local", "nope"]);
  assert.equal(text(join(main, ".worktreeinclude")), before);
});

test("remember stops with unknown on MAIN and on a path that is no worktree, and refuses a wrong argument shape", () => {
  assert.equal(printed(bash(main, includeSh, "remember", main, "--copy", "x")).reason, "unknown");
  assert.equal(
    printed(bash(main, includeSh, "remember", join(tmp, "nowhere"), "--copy", "x")).reason,
    "unknown",
  );
  for (const args of [
    ["remember", wt],
    ["remember", wt, "--copy"],
    ["remember", wt, "--keep", "x"],
    ["forget", wt, "--copy", "x"],
  ]) {
    assert.notEqual(bash(main, includeSh, ...args).code, 0, `usage accepted: ${args.join(" ")}`);
  }
});

test("remember creates the list when absent and adds the missing newline first", () => {
  setup();
  writeFileSync(join(main, "mise.local.toml"), "mise\n");
  writeFileSync(join(main, ".env.test"), "test\n");
  const o = create();
  assert.deepEqual(o.copied, []);
  assert.deepEqual(o.notIgnored, []);
  assert.deepEqual(o.unlisted, [".env.test", "mise.local.toml"]);
  const r = printed(bash(main, includeSh, "remember", o.worktree, "--copy", "mise.local.toml"));
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(text(join(main, ".worktreeinclude")), "/mise.local.toml");
  writeFileSync(join(main, ".worktreeinclude"), "/mise.local.toml");
  printed(bash(main, includeSh, "remember", o.worktree, "--never", ".env.test"));
  assert.equal(text(join(main, ".worktreeinclude")), "/mise.local.toml\n!/.env.test");
});

test("a file whose name holds a carriage return is unlisted under its real name, remembered and copied", () => {
  setup();
  appendFileSync(join(main, ".git/info/exclude"), "Icon?\n");
  writeFileSync(join(main, "Icon\r"), "icon");
  const o = create();
  assert.deepEqual(o.unlisted, ["Icon\r"]);
  const r = printed(bash(main, includeSh, "remember", o.worktree, "--copy", "Icon\r"));
  assert.deepEqual([r.added, r.copied, r.unlisted], [["/Icon[\r]"], ["Icon\r"], []]);
  assert.equal(readFileSync(join(o.worktree, "Icon\r"), "utf8"), "icon");
  const s = create();
  assert.deepEqual([s.copied, s.unlisted], [["Icon\r"], []]);
});

test("every skill that runs step 3 of The worktree names the .worktreeinclude exception in its rules", () => {
  const matched: string[] = [];
  for (const skill of readdirSync(skills)) {
    const file = join(skills, skill, "SKILL.md");
    if (!existsSync(file)) {
      continue;
    }
    const body = readFileSync(file, "utf8");
    if (!/Run steps 3 (to|and) [0-9] of \*\*The worktree\*\*/.test(body)) {
      continue;
    }
    matched.push(skill);
    const bare = body
      .split("\n")
      .filter(
        (line) =>
          (line.includes("never in `<MAIN>`") || line.includes("Write nothing before")) &&
          !line.includes("worktreeinclude"),
      );
    assert.deepEqual(
      bare,
      [],
      `${file} keeps a run out of <MAIN> without the .worktreeinclude exception`,
    );
  }
  assert.deepEqual(matched.toSorted(), ["level", "pj-roadmap"]);
});
