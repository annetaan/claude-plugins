import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const plugin = join(import.meta.dirname, "../plugins/annetaan");
const scripts = join(plugin, "skills/workflow/scripts");

const KEPT: readonly (readonly [string, string])[] = [
  ["skills/workflow/scripts/level.ts", '"git fetch failed"'],
];

const LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const GIT_FETCH = /\bgit\b.*\bfetch\b/s;
const SH_LINE = /\bgit\b.*\bfetch\b|\bfetch\b.*\bgit\b|["']fetch["']/;

const filesIn = (dir: string): readonly string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(".ts") || name.endsWith(".sh"))
        .map((name) => join(dir, name))
    : [];

const sources = (): readonly string[] => {
  const dirs = [join(plugin, "scripts"), join(plugin, "scripts/pure")];
  for (const skill of readdirSync(join(plugin, "skills"))) {
    dirs.push(
      join(plugin, "skills", skill, "scripts"),
      join(plugin, "skills", skill, "scripts/pure"),
    );
  }
  return dirs.flatMap(filesIn).toSorted();
};

const lineAt = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const tsHits = (text: string): readonly (readonly [number, string])[] =>
  [...text.matchAll(LITERAL)].flatMap((found) => {
    const body = found[0].slice(1, -1);
    if (body !== "fetch" && !GIT_FETCH.test(body)) {
      return [];
    }
    const n = lineAt(text, found.index);
    return [[n, text.split("\n")[n - 1] ?? ""] as const];
  });

const shHits = (text: string): readonly (readonly [number, string])[] => {
  const hits: (readonly [number, string])[] = [];
  let n = 1;
  for (const line of text.split(/(?<!\\)\n/)) {
    const joined = line.split("\\\n").join(" ");
    if (SH_LINE.test(joined)) {
      hits.push([n, joined]);
    }
    n += line.split("\n").length;
  }
  return hits;
};

test("no script but scripts/fetch.ts runs git fetch", () => {
  const hits = sources().flatMap((path) => {
    const rel = relative(plugin, path);
    if (rel === "scripts/fetch.ts") {
      return [];
    }
    const text = readFileSync(path, "utf8");
    return (path.endsWith(".ts") ? tsHits(text) : shHits(text))
      .filter(([, line]) => !KEPT.some(([file, kept]) => rel === file && line.includes(kept)))
      .map(([n, line]) => `${rel}:${n}: ${line.trim()}`);
  });
  assert.deepEqual(hits, [], `git fetch outside scripts/fetch.ts:\n${hits.join("\n")}`);
});

const tmp = mkdtempSync(join(tmpdir(), "clone-fetch-"));
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

type Ran = { readonly code: number | null; readonly stdout: string; readonly stderr: string };

const runAsync = (cwd: string, args: readonly string[]) =>
  new Promise<Ran>((resolve, reject) => {
    const child = spawn("bash", args, { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });

const RUNS = 6;

test(`${RUNS} creates and ${RUNS} level shows from linked worktrees, all at once, fetch without a ref lock failure`, async () => {
  const origin = join(tmp, "origin.git");
  git(tmp, "init", "-q", "--bare", "-b", "main", origin);
  git(tmp, "init", "-q", "-b", "main", join(tmp, "work"));
  const main = realpathSync(join(tmp, "work"));
  writeFileSync(join(main, ".gitignore"), ".claude/worktrees/\n");
  git(main, "add", ".gitignore");
  git(main, "commit", "-q", "-m", "init");
  git(main, "remote", "add", "origin", origin);
  git(main, "push", "-q", "origin", "main");
  for (let i = 1; i <= RUNS; i += 1) {
    git(main, "worktree", "add", "-q", "--detach", join(tmp, `linked-${i}`));
  }
  git(tmp, "clone", "-q", origin, join(tmp, "other"));
  git(join(tmp, "other"), "commit", "-q", "--allow-empty", "-m", "more");
  git(join(tmp, "other"), "push", "-q", "origin", "main");
  const tip = git(join(tmp, "other"), "rev-parse", "HEAD").trim();

  const runs = await Promise.all(
    Array.from({ length: RUNS }, (_, i) => [
      runAsync(main, [join(scripts, "worktree.sh"), "create", "main", "--kind", "run"]),
      runAsync(main, [join(scripts, "level.sh"), "show", join(tmp, `linked-${i + 1}`)]),
    ]).flat(),
  );
  const bad = runs.flatMap((run, i) => {
    const what = `${i % 2 === 0 ? "create" : "show"} ${Math.floor(i / 2) + 1}`;
    try {
      const d = JSON.parse(run.stdout) as Readonly<Record<string, unknown>>;
      const good =
        i % 2 === 0
          ? d["status"] === "ready" && d["head"] === tip
          : d["warning"] === null && d["ref"] === "origin/main";
      return good ? [] : [`${what}: ${run.stdout}${run.stderr}`];
    } catch {
      return [`${what}: ${run.stdout}${run.stderr}`];
    }
  });
  assert.deepEqual(bad, [], `parallel creates and shows in one clone:\n${bad.join("\n")}`);
});
