import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dirname, "..");

const tmp = mkdtempSync(join(tmpdir(), "retired-words-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

const anywhere: ReadonlySet<string> = new Set();

const RETIRED: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["design review", anywhere],
  ["Breaking changes:", anywhere],
  ["breaking changes are welcome", anywhere],
  ["breaking-changes.md", anywhere],
  ["minimal change", anywhere],
  ["the two review seats", anywhere],
  ["both seats", anywhere],
  ["both review seats", anywhere],
  ["the other seat", anywhere],
  ["those last three", anywhere],
  ["level 1", anywhere],
  ["level 2", anywhere],
  ["level 3", anywhere],
  ["levels 1", anywhere],
  ["panel.sh", anywhere],
  ["panel.py", anywhere],
  ["<the worktree line>", new Set(["plugins/annetaan/skills/level/SKILL.md"])],
  ["<the full design>", anywhere],
  ["<the full plan>", anywhere],
]);

const SCOPE = ["plugins/annetaan", "README.md", ".claude-plugin/marketplace.json"];
const GAP = "(?:[\\s>*`-]|<br\\s*/?>)+";
const GAP_JOIN = new RegExp(GAP, "g");

const escape = (word: string): string => word.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");

const check = (
  tree: string,
  retired: ReadonlyMap<string, ReadonlySet<string>>,
): readonly string[] => {
  const patterns = [...retired].map(([words, allowed]) => ({
    words,
    allowed,
    pattern: new RegExp(
      words
        .split(/[\s-]+/)
        .map(escape)
        .join(GAP),
      "gi",
    ),
  }));
  const listed = git(tree, "ls-files", "--cached", "--others", "--exclude-standard", "--", ...SCOPE)
    .split("\n")
    .filter(
      (p) =>
        (p.endsWith(".md") || p.endsWith(".json")) &&
        statSync(join(tree, p), { throwIfNoEntry: false })?.isFile() === true,
    );

  const findings: string[] = [];
  for (const p of listed.toSorted()) {
    const text = readFileSync(join(tree, p), "utf8");
    for (const { words, allowed, pattern } of patterns) {
      if (allowed.has(p)) {
        continue;
      }
      for (const m of text.matchAll(pattern)) {
        const line = text.slice(0, m.index).split("\n").length;
        findings.push(`${p}:${line}: "${m[0].replace(GAP_JOIN, " ")}" is retired (${words})`);
      }
    }
  }
  return findings;
};

test("the plugin's wording", () => {
  const findings = check(root, RETIRED);
  assert.deepEqual(findings, [], findings.join("\n"));
});

const good = join(tmp, "good");
const write = (file: string, lines: readonly string[]): void => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${lines.join("\n")}\n`);
};

const W = "plugins/annetaan/skills/workflow/README.md";
const P = "plugins/annetaan/README.md";

write(join(good, P), ["# Annetaan", "", "A plugin with two review seats at `high`."]);
write(join(good, W), [
  "# Workflow",
  "",
  "Design, implement, review.",
  "The design is read, then the review runs.",
]);
write(join(good, "plugins/annetaan/.claude-plugin/plugin.json"), [
  "{",
  '  "name": "annetaan",',
  '  "description": "Design and review skills"',
  "}",
]);
write(join(good, "README.md"), ["# Root", "", "Breaking changes need a decision."]);
write(join(good, ".claude-plugin/marketplace.json"), ["{", '  "plugins": []', "}"]);
mkdirSync(join(good, "tests"));
mkdirSync(join(good, ".claude"));
git(good, "init", "-q");
git(good, "add", "-A");

test("good", () => {
  const findings = check(good, RETIRED);
  assert.deepEqual(findings, [], findings.join("\n"));
});

const copyOf = (name: string): string => {
  const copy = join(tmp, name);
  cpSync(good, copy, { recursive: true });
  return copy;
};

const holds = (findings: readonly string[], want: string): void => {
  assert.ok(
    findings.some((f) => f.includes(want)),
    `no line ${want} in:\n${findings.join("\n")}`,
  );
};

const broken = (name: string, file: string, text: string, joined: string): void => {
  test(name, () => {
    const copy = copyOf(name);
    const path = join(copy, file);
    const n = readFileSync(path, "utf8").split("\n").length;
    appendFileSync(path, `${text}\n`);
    holds(check(copy, RETIRED), `${file}:${n}: "${joined}" is retired`);
  });
};

broken("wrapped", W, "That run has no design\nreview, no approval.", "design review");
broken("indented", P, "Those last\n  three are new for every task.", "Those last three");
broken("hyphen", P, "Read `design-review.md`.", "design review");
broken("br", P, "seats<br/>Design<br/>review", "Design review");
broken("quote", W, "> no design\n> review", "design review");
broken(
  "prompt",
  W,
  '      prompt: "Design:\\n<the full design>\\n\\nPlan:\\n<the full plan>")',
  "<the full design ",
);
broken("prompt-quote", W, "> <the worktree\n> line>", "<the worktree line ");
broken("ideographic", P, "design\u3000review", "design review");

test("json", () => {
  const copy = copyOf("json");
  write(join(copy, "plugins/annetaan/.claude-plugin/plugin.json"), [
    "{",
    '  "name": "annetaan",',
    '  "description": "Runs both seats on every task"',
    "}",
  ]);
  holds(
    check(copy, RETIRED),
    'plugins/annetaan/.claude-plugin/plugin.json:3: "both seats" is retired',
  );
});

test("untracked", () => {
  const copy = copyOf("untracked");
  write(join(copy, "plugins/annetaan/new.md"), ["No design", "review here."]);
  holds(check(copy, RETIRED), 'plugins/annetaan/new.md:1: "design review" is retired');
});

test("allowed", () => {
  const copy = copyOf("allowed");
  const allowed = new Map([["both seats", new Set([P, "plugins/annetaan/other.md"])]]);
  appendFileSync(join(copy, P), "Both\nseats run.\n");
  const first = check(copy, allowed);
  assert.deepEqual(first, [], first.join("\n"));
  appendFileSync(join(copy, W), "Both\nseats run.\n");
  const findings = check(copy, allowed);
  holds(findings, `${W}:5: "Both seats" is retired`);
  assert.ok(!findings.some((f) => f.includes(P)), findings.join("\n"));
});

test("outside", () => {
  const copy = copyOf("outside");
  for (const file of ["tests/x.md", ".claude/annetaan-level.md", "CLAUDE.md"]) {
    write(join(copy, file), ["Both seats, design", "review."]);
  }
  const findings = check(copy, RETIRED);
  assert.deepEqual(findings, [], findings.join("\n"));
});
