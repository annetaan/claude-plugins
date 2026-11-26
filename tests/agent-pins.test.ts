import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

const root = join(import.meta.dirname, "..");
const plugin = join(root, "plugins/annetaan");
const readme = join(plugin, "README.md");
const level = join(plugin, "skills/workflow/scripts/level.sh");

const tmp = mkdtempSync(join(tmpdir(), "agent-pins-"));
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

const printed = (result: SpawnSyncReturns<string>): string => {
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return result.stdout;
};

const origin = join(tmp, "origin.git");
const clone = join(tmp, "clone");

git(tmp, "init", "-q", "--bare", "-b", "main", origin);
assert.equal(spawnSync("git", ["clone", "-q", origin, clone], { cwd: tmp, env }).status, 0);
git(clone, "checkout", "-q", "-b", "main");
writeFileSync(join(clone, "README.md"), "readme\n");
git(clone, "add", "README.md");
git(clone, "commit", "-q", "-m", "init");
git(clone, "push", "-q", "origin", "main");

type Agent = { readonly model: string; readonly effort: string };
type Shown = {
  readonly level: string;
  readonly source: string;
  readonly agents: Readonly<Record<string, Agent>>;
  readonly seats: readonly string[];
};

const show = (...args: readonly string[]): Shown =>
  JSON.parse(
    printed(spawnSync(level, ["show", clone, ...args], { env, encoding: "utf8" })),
  ) as Shown;

const byLevel = { standard: show("standard"), high: show("high") };
const none = show();
const levels = ["standard", "high"] as const;

const front = (file: string, key: string): string => {
  let dashes = 0;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line === "---") {
      dashes += 1;
    } else if (dashes === 1 && line.startsWith(`${key}: `)) {
      return line.slice(key.length + 2);
    }
  }
  return "";
};

const levelled = (name: string): boolean => levels.some((n) => name in byLevel[n].agents);

const frontmatterLevel = (name: string): string =>
  name in none.agents ? none.level : (levels.find((n) => name in byLevel[n].agents) ?? "");

const agentFile = (name: string): string => join(plugin, "agents", `${name}.md`);

const agentNames = readdirSync(join(plugin, "agents"))
  .filter((entry) => entry.endsWith(".md"))
  .toSorted()
  .map((entry) => entry.slice(0, -".md".length));

const atLevel = (n: string, name: string): string => {
  const agent = (byLevel as Readonly<Record<string, Shown>>)[n]?.agents[name];
  return agent === undefined ? "" : `${agent.model} ${agent.effort}`;
};

test("every agent has a model, an effort and a matching description, levelled ones with their level", () => {
  for (const name of agentNames) {
    const file = agentFile(name);
    const model = front(file, "model");
    const effort = front(file, "effort");
    assert.notEqual(model, "", `${name} has no model`);
    assert.notEqual(effort, "", `${name} has no effort`);
    const description = front(file, "description");
    if (levelled(name)) {
      const want = `(${frontmatterLevel(name)}: ${model} / effort ${effort}`;
      assert.ok(description.includes(want), `${name}: the description does not hold ${want}`);
    } else {
      const want = `(${model} / effort ${effort})`;
      assert.ok(description.includes(want), `${name}: the description does not hold ${want}`);
    }
  }
});

test("level.sh show without a file is standard from default", () => {
  assert.equal(none.level, "standard");
  assert.equal(none.source, "default");
  assert.deepEqual(none.agents, byLevel.standard.agents);
});

test("every agent level.sh names has a file, and its frontmatter is its value at the default level", () => {
  const names = new Set(levels.flatMap((n) => Object.keys(byLevel[n].agents)));
  for (const name of names) {
    const file = agentFile(name);
    assert.ok(existsSync(file), `level.sh names ${name}, which has no file under agents/`);
    const want = `${front(file, "model")} ${front(file, "effort")}`;
    const n = frontmatterLevel(name);
    assert.equal(
      atLevel(n, name),
      want,
      `${name}: level.sh show ${n} gives '${atLevel(n, name)}', the frontmatter says '${want}'`,
    );
  }
});

test("README rows match the frontmatter", () => {
  const lines = readFileSync(readme, "utf8").split("\n");
  for (const name of agentNames) {
    const rows = lines.filter((line) => line.includes(`| \`annetaan:${name}\` |`));
    assert.equal(rows.length, 1, `${name} has not exactly one row in the README table`);
    const cells = (rows[0] ?? "").split("|");
    const said = [cells[2], cells[3]].map((cell) => (cell ?? "").replaceAll(" ", "")).join(" ");
    const file = agentFile(name);
    const want = `${front(file, "model")} ${front(file, "effort")}`;
    assert.equal(
      said,
      want,
      `${name}: the README row says '${said}', the frontmatter says '${want}'`,
    );
  }
  const table = lines.filter((line) => line.startsWith("| `annetaan:")).length;
  assert.equal(
    table,
    agentNames.length,
    `the README table has ${table} rows for ${agentNames.length} agents`,
  );
});

test("the README level table matches level.sh show standard and high", () => {
  type Pair = readonly [string, string] | null;
  const cell = " (?:([\\p{L}\\p{N}_]+) / ([\\p{L}\\p{N}_]+)|-) \\|";
  const row = new RegExp(`^\\| \`([a-z-]+)\` \\|${cell}${cell}$`, "u");
  const pair = (model: string | undefined, effort: string | undefined): Pair =>
    model === undefined || effort === undefined ? null : [model, effort];
  const rows: Record<string, readonly [Pair, Pair]> = {};
  for (const line of readFileSync(readme, "utf8").split("\n")) {
    const match = row.exec(line);
    if (match !== null) {
      const name = match[1] ?? "";
      assert.ok(!(name in rows), `two README level rows for ${name}`);
      rows[name] = [pair(match[2], match[3]), pair(match[4], match[5])];
    }
  }
  const want: Record<string, readonly [Pair, Pair]> = {};
  for (const name of new Set(levels.flatMap((n) => Object.keys(byLevel[n].agents)))) {
    const [standard, high] = levels.map((n) => byLevel[n].agents[name]);
    want[name] = [pair(standard?.model, standard?.effort), pair(high?.model, high?.effort)];
  }
  assert.deepEqual(rows, want);
});

test("one review seat at standard, and two on different models at high", () => {
  const { standard, high } = byLevel;
  assert.ok("workflow-reviewer-a" in standard.agents, "standard has no workflow-reviewer-a");
  assert.ok(!("workflow-reviewer-b" in standard.agents), "standard has workflow-reviewer-b");
  assert.deepEqual(standard.seats, ["a"]);
  const a = high.agents["workflow-reviewer-a"];
  const b = high.agents["workflow-reviewer-b"];
  assert.ok(a !== undefined, "high has no workflow-reviewer-a");
  assert.ok(b !== undefined, "high has no workflow-reviewer-b");
  assert.notEqual(a.model, b.model);
  assert.deepEqual(high.seats, ["a", "b"]);
});

test("no skill states a pin", () => {
  const pin =
    /(opus|sonnet|fable|haiku) \/ (low|medium|high|xhigh|max)|pinned to (Fable|fable|opus|sonnet|haiku) at/;
  const files = (dir: string): readonly string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return files(path);
      }
      return entry.isFile() ? [path] : [];
    });
  const hits = files(join(plugin, "skills")).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((text, index) => (pin.test(text) ? [`${file}:${index + 1}: ${text}`] : [])),
  );
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("every agent blocks the Artifact tools", () => {
  const artifact = ["Artifact", "ArtifactComments", "ArtifactData"];
  const misses: string[] = [];
  for (const name of agentNames) {
    const file = agentFile(name);
    const allowed = front(file, "tools");
    if (allowed !== "") {
      const names = allowed.split(", ");
      misses.push(
        ...artifact.filter((tool) => names.includes(tool)).map((tool) => `${name} allows ${tool}`),
      );
    } else {
      const blocked = front(file, "disallowedTools").split(", ");
      misses.push(
        ...artifact
          .filter((tool) => !blocked.includes(tool))
          .map((tool) => `${name} does not block ${tool}`),
      );
    }
  }
  assert.deepEqual(misses, [], misses.join("\n"));
});
