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
import { join, posix } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dirname, "..");

const tmp = mkdtempSync(join(tmpdir(), "references-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const git = (cwd: string, ...args: readonly string[]): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

const PLUGIN = "plugins/annetaan";
const SKILLS = `${PLUGIN}/skills`;
const NAME = "[A-Za-z_][A-Za-z0-9_]*";
const PATH = "[A-Za-z0-9._/-]";
const W = "\\p{L}\\p{N}_";
const FENCE = /^\s*(```|~~~)/;
const SPAN = /(`+)(.+?)\1/g;
const RUN_FILE_BODY = `(?<![/.<$${W}-])(?:(?:design|plan|notes|adaptations|checks|merge)\\.md|detail/task-\\S*?\\.md)(?![${W}-])`;
const RUN_FILE = new RegExp(RUN_FILE_BODY, "gu");
const RUN_SKILLS: ReadonlySet<string> = new Set(["workflow", "pj4-running"]);
const RUN_FILE_WHOLE = new RegExp(`^(?:${RUN_FILE_BODY})$`, "u");
const SKILL_FILE = new RegExp(`^${SKILLS}/[^/]+/SKILL\\.md$`);
const DECLARES = new RegExp(`\`\\$(${NAME})\` below means \`\\$\\{CLAUDE_SKILL_DIR\\}\``);
const OWN = new RegExp(`^${SKILLS}/([^/]+)/`);
const SHORT_TARGET = new RegExp(`^\\$(${NAME})/(.*)$`);
const SKILLS_PATH = new RegExp(`<skills>/(${PATH}+)`, "g");
const PATH_ONLY = new RegExp(`^${PATH}+$`);
const SLUG_DROP = new RegExp(`[^${W}\\- ]`, "gu");

type Line = { readonly i: number; readonly line: string; readonly fenced: boolean };
type Ref = { readonly at: number; readonly section: string; readonly file: string };

const group = (match: RegExpMatchArray, k: number): string => {
  const found = match[k];
  assert.ok(found !== undefined, `no group ${k} in ${match[0]}`);
  return found;
};

const normpath = (p: string): string => {
  const normal = posix.normalize(p);
  return normal.length > 1 && normal.endsWith("/") ? normal.slice(0, -1) : normal;
};

const splitLines = (text: string): readonly Line[] => {
  const out: Line[] = [];
  let fence: string | null = null;
  for (const [index, line] of text.split("\n").entries()) {
    const match = FENCE.exec(line);
    if (fence !== null) {
      out.push({ i: index + 1, line, fenced: true });
      if (match !== null && group(match, 1) === fence) {
        fence = null;
      }
    } else if (match !== null) {
      fence = group(match, 1);
      out.push({ i: index + 1, line, fenced: true });
    } else {
      out.push({ i: index + 1, line, fenced: false });
    }
  }
  return out;
};

const norm = (s: string): string => s.replaceAll("`", "").replace(/\s+/g, " ").trim();

const slug = (heading: string): string =>
  heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll("`", "")
    .toLowerCase()
    .replace(SLUG_DROP, "")
    .replaceAll(" ", "-");

const check = (tree: string): readonly string[] => {
  const listed = git(tree, "ls-files", "--cached", "--others", "--exclude-standard", "--", PLUGIN)
    .split("\n")
    .filter(
      (p) => p !== "" && statSync(join(tree, p), { throwIfNoEntry: false })?.isFile() === true,
    );
  const files = new Set(listed);
  const present = new Set(listed);
  for (const p of listed) {
    for (let d = posix.dirname(p); d !== "."; d = posix.dirname(d)) {
      present.add(d);
    }
  }

  const exists = (rel: string): boolean => present.has(normpath(rel));
  const read = (rel: string): string => readFileSync(join(tree, rel), "utf8");

  const skills = new Set(
    listed.filter((p) => SKILL_FILE.test(p)).map((p) => p.split("/")[3] ?? ""),
  );
  const declares = new Map<string, string>();
  for (const s of skills) {
    const match = DECLARES.exec(read(`${SKILLS}/${s}/SKILL.md`));
    if (match !== null) {
      declares.set(s, group(match, 1));
    }
  }

  const skillOf = (p: string): string | null => {
    const match = OWN.exec(p);
    return match !== null && skills.has(group(match, 1)) ? group(match, 1) : null;
  };

  const headingsOf = new Map<string, readonly string[]>();
  const headings = (rel: string): readonly string[] => {
    const known = headingsOf.get(rel);
    if (known !== undefined) {
      return known;
    }
    const found = splitLines(read(rel)).flatMap(({ line, fenced }) => {
      const match = fenced ? null : /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
      return match === null ? [] : [group(match, 1)];
    });
    headingsOf.set(rel, found);
    return found;
  };

  const slugs = (rel: string): ReadonlySet<string> => {
    const seen = new Map<string, number>();
    const out = new Set<string>();
    for (const h of headings(rel)) {
      const s = slug(h);
      const n = (seen.get(s) ?? -1) + 1;
      seen.set(s, n);
      out.add(n === 0 ? s : `${s}-${n}`);
    }
    return out;
  };

  const resolve = (
    p: string,
    target: string,
    roots: ReadonlyMap<string, string>,
  ): string | null => {
    const own = skillOf(p);
    const short = SHORT_TARGET.exec(target);
    if (short !== null) {
      const root = roots.get(group(short, 1));
      return root === undefined ? null : normpath(posix.join(SKILLS, root, group(short, 2)));
    }
    if (target.startsWith("<skills>/")) {
      return normpath(posix.join(SKILLS, target.slice("<skills>/".length)));
    }
    if (target.includes("/") && skills.has(target.split("/")[0] ?? "")) {
      return normpath(posix.join(SKILLS, target));
    }
    const nearby = normpath(posix.join(posix.dirname(p), target));
    const inSkill = own === null ? [] : [normpath(posix.join(SKILLS, own, target))];
    return [nearby, ...inSkill].find((c) => exists(c)) ?? nearby;
  };

  const othersHolding = (name: string, own: string): readonly string[] =>
    [
      ...new Set(
        listed.flatMap((q) => {
          const s = q.endsWith(`/${name}`) ? skillOf(q) : null;
          return s === null || s === own ? [] : [s];
        }),
      ),
    ].toSorted();

  const findings: string[] = [];

  for (const p of listed.filter((q) => q.endsWith(".md")).toSorted()) {
    const own = skillOf(p);
    const name = own === null ? undefined : declares.get(own);
    const lines = splitLines(read(p));
    const firstH2 =
      lines.find(({ line, fenced }) => !fenced && line.startsWith("## "))?.i ?? lines.length + 1;
    const opening = lines
      .filter(({ i }) => i < firstH2)
      .map(({ line }) => line)
      .join("\n");
    const namesIt =
      name !== undefined && (p === `${SKILLS}/${own}/SKILL.md` || opening.includes(`\`$${name}\``));
    const roots = new Map<string, string>(
      [...declares].flatMap(([s, n]): (readonly [string, string])[] =>
        s === own || (own !== null && opening.includes(`\`$${n}\``)) ? [[n, s]] : [],
      ),
    );

    const find = (i: number, msg: string): void => {
      findings.push(`${p}:${i}: ${msg}`);
    };

    for (const { i, line, fenced } of lines) {
      for (const [n, root] of roots) {
        for (const m of line.matchAll(new RegExp(`\\$${n}/(${PATH}*)`, "g"))) {
          const target = group(m, 1).replace(/\.+$/, "");
          if (!exists(posix.join(SKILLS, root, target))) {
            find(i, `$${n}/${target} does not exist`);
          }
          if (n === name && !namesIt) {
            find(i, `uses $${n}/ but its opening lines do not name \`$${n}\``);
          }
        }
      }
      for (const m of line.matchAll(SKILLS_PATH)) {
        const target = group(m, 1).replace(/\.+$/, "");
        if (!exists(posix.join(SKILLS, target))) {
          find(i, `<skills>/${target} does not exist`);
        }
      }
      if (fenced) {
        continue;
      }
      if (own !== null && RUN_SKILLS.has(own)) {
        for (const m of line.matchAll(RUN_FILE)) {
          find(i, `${m[0]} is a file of the run: write it <WORKDIR>/${m[0]}`);
        }
      }

      for (const m of line.replace(/\[[^\]]*\]\(/g, "](").matchAll(SPAN)) {
        const s = group(m, 2).trim();
        if (!PATH_ONLY.test(s)) {
          continue;
        }
        if (s.includes("/") && skills.has(s.split("/")[0] ?? "")) {
          if (!exists(posix.join(SKILLS, s))) {
            find(i, `${s} does not exist`);
          }
        } else if (own !== null && RUN_SKILLS.has(own) && RUN_FILE_WHOLE.test(s)) {
          continue;
        } else if (own !== null && s.endsWith(".md")) {
          const rel = resolve(p, s, roots);
          assert.ok(rel !== null, `${p}:${i}: ${s} resolves to nothing`);
          const others = exists(rel) ? [] : othersHolding(s, own);
          if (others.length > 0) {
            find(i, `${s} is a file of ${others.join(", ")}: write it with the skill's name`);
          }
        }
      }

      const blanked = line.replace(SPAN, (span) => " ".repeat(span.length));
      for (const m of blanked.matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = group(m, 1);
        if (/^[a-z]+:/.test(target)) {
          continue;
        }
        const hash = target.indexOf("#");
        const path = hash < 0 ? target : target.slice(0, hash);
        const anchor = hash < 0 ? "" : target.slice(hash + 1);
        const rel = path === "" ? p : normpath(posix.join(posix.dirname(p), path));
        if (!exists(rel)) {
          find(i, `link to ${target}: no such file`);
        } else if (anchor !== "" && (!rel.endsWith(".md") || !slugs(rel).has(anchor))) {
          find(i, `link to ${target}: no such anchor`);
        }
      }
    }

    const paragraphs: (readonly Line[])[] = [];
    let run: Line[] = [];
    for (const entry of [...lines, { i: 0, line: "", fenced: true }]) {
      if (entry.fenced || entry.line.trim() === "") {
        if (run.length > 0) {
          paragraphs.push(run);
        }
        run = [];
      } else {
        run.push(entry);
      }
    }
    for (const paragraph of paragraphs) {
      const text = paragraph.map(({ line }) => line).join("\n");
      let offset = 0;
      const starts = paragraph.map(({ line }) => {
        const start = offset;
        offset += line.length + 1;
        return start;
      });
      const refs: Ref[] = [];
      const taken = new Set<number>();
      for (const m of text.matchAll(/\*\*([^*]+)\*\*\s+in\s+`([^`\n]+\.md)`/g)) {
        refs.push({ at: m.index, section: group(m, 1), file: group(m, 2) });
        taken.add(m.index);
      }
      for (const m of text.matchAll(/`([^`\n]+\.md)`,\s+\*\*([^*]+)\*\*/g)) {
        const section = group(m, 2);
        const at = m.index + m[0].length - "**".length - section.length - "**".length;
        if (!taken.has(at)) {
          refs.push({ at, section, file: group(m, 1) });
        }
      }
      for (const { at, section, file } of refs) {
        const rel = resolve(p, file, roots);
        if (rel === null) {
          continue;
        }
        const k = starts.findLastIndex((start) => start <= at);
        const entry = paragraph[k];
        assert.ok(entry !== undefined, `${p}: no line holds offset ${at}`);
        if (!files.has(rel)) {
          find(entry.i, `${file}: no such file, for **${norm(section)}**`);
        } else if (!headings(rel).some((h) => norm(h) === norm(section))) {
          find(entry.i, `${file} has no section **${norm(section)}**`);
        }
      }
    }
  }

  return findings;
};

test("the plugin's references", () => {
  const findings = check(root);
  assert.deepEqual(findings, [], findings.join("\n"));
});

const good = join(tmp, "good");
const S = join(good, "plugins/annetaan/skills");
const write = (file: string, lines: readonly string[]): void => {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${lines.join("\n")}\n`);
};

write(join(S, "one/SKILL.md"), [
  "---",
  "name: one",
  "---",
  "# One",
  "",
  "## Paths: `$ONE`",
  "",
  "**`$ONE` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.",
  "",
  "Read `$ONE/notes.md` and `two/guide.md`, then `<skills>/two/guide.md`. Write `$TMP/out.md`.",
  "Keep the user's `story.md`. Follow **A** in phase 1, in `notes.md`, **Steps** in `two/guide.md`.",
  "See [the `run` step](notes.md#the-run-step) and [`guide.md`](../two/guide.md). Then **The `run`",
  "step** in `notes.md`, and `two/guide.md`,",
  "**Steps**.",
  "[手順](notes.md#café-の手順)",
  "Roles are under $ONE/roles/.",
]);
write(join(S, "one/notes.md"), ["# Notes", "", "## A", "", "## The `run` step", "## Café の手順"]);
write(join(S, "one/roles/guide.md"), ["# Guide"]);
write(join(S, "two/SKILL.md"), [
  "---",
  "name: two",
  "---",
  "# Two",
  "",
  "## Paths: `$TWO`",
  "",
  "**`$TWO` below means `${CLAUDE_SKILL_DIR}`**, the absolute path of this skill's directory.",
  "",
  "The other skill writes `$ONE/missing.md`, a shell path here.",
]);
write(join(S, "two/guide.md"), ["# Guide", "", "## Steps"]);
write(join(S, "two/borrowed.md"), [
  "# Borrowed",
  "",
  "> `$ONE` in this file is `<skills>/one`.",
  "",
  "## Steps",
  "",
  "Read `$ONE/notes.md`, then **A** in `$ONE/notes.md`.",
]);
write(join(S, "pj4-running/SKILL.md"), ["---", "name: pj4-running", "---", "# Running"]);
write(join(S, "workflow/SKILL.md"), [
  "---",
  "name: workflow",
  "---",
  "# Workflow",
  "",
  "Write `<WORKDIR>/design.md`, then <WORKDIR>/detail/task-<k>.md, `task-<k>-evidence.md` and `log.md`.",
  "",
  "Read `roles/design.md`.",
  "",
  "```",
  "plan.md",
  "```",
  "Keep the user's 旧design.md.",
]);
write(join(S, "workflow/prompts/design.md"), ["Design: <WORKDIR>/design.md"]);
write(join(S, "workflow/roles/design.md"), ["# The design session"]);
write(join(good, ".gitignore"), ["*.doc-meta.md"]);
write(join(S, "one/notes.doc-meta.md"), ["See `missing.md`, **Nope** in `gone.md`."]);
git(good, "init", "-q");

test("good", () => {
  const findings = check(good);
  assert.deepEqual(findings, [], findings.join("\n"));
});

const broken = (name: string, file: string, line: string, expect: string): void => {
  test(name, () => {
    const copy = join(tmp, name);
    cpSync(good, copy, { recursive: true });
    const path = join(copy, "plugins/annetaan/skills", file);
    const n = readFileSync(path, "utf8").split("\n").length;
    appendFileSync(path, `${line}\n`);
    const findings = check(copy);
    const want = `plugins/annetaan/skills/${file}:${n}: ${expect}`;
    assert.ok(
      findings.some((f) => f.includes(want)),
      `no line ${want} in:\n${findings.join("\n")}`,
    );
  });
};

broken(
  "bare",
  "one/SKILL.md",
  "Read `guide.md`.",
  "guide.md is a file of two: write it with the skill's name",
);
broken(
  "run-file",
  "workflow/SKILL.md",
  "Keep `notes.md`.",
  "notes.md is a file of the run: write it <WORKDIR>/notes.md",
);
broken(
  "run-detail",
  "workflow/SKILL.md",
  "Read detail/task-<k>.md.",
  "detail/task-<k>.md is a file of the run: write it <WORKDIR>/detail/task-<k>.md",
);
broken(
  "run-prompt",
  "workflow/prompts/design.md",
  "Design: design.md",
  "design.md is a file of the run: write it <WORKDIR>/design.md",
);
broken(
  "run-role",
  "workflow/roles/design.md",
  "Read `plan.md`.",
  "plan.md is a file of the run: write it <WORKDIR>/plan.md",
);
broken("qualified", "one/SKILL.md", "Read `two/none.md`.", "two/none.md does not exist");
broken(
  "run-file-running",
  "pj4-running/SKILL.md",
  "Keep `notes.md`.",
  "notes.md is a file of the run: write it <WORKDIR>/notes.md",
);
broken("borrowed", "two/borrowed.md", "Read `$ONE/none.md`.", "$ONE/none.md does not exist");
broken(
  "borrowed-section",
  "two/borrowed.md",
  "Follow **Nope** in `$ONE/notes.md`.",
  "$ONE/notes.md has no section **Nope**",
);
broken("short", "one/SKILL.md", "Read `$ONE/none.md`.", "$ONE/none.md does not exist");
broken(
  "opening",
  "one/notes.md",
  "Read `$ONE/notes.md`.",
  "uses $ONE/ but its opening lines do not name `$ONE`",
);
broken(
  "skills",
  "one/SKILL.md",
  "Read `<skills>/two/none.md`.",
  "<skills>/two/none.md does not exist",
);
broken(
  "section",
  "one/SKILL.md",
  "Follow **Nope** in `two/guide.md`.",
  "two/guide.md has no section **Nope**",
);
broken(
  "wrapped",
  "one/SKILL.md",
  "Follow **No such** in\n`two/guide.md`.",
  "two/guide.md has no section **No such**",
);
broken("link", "one/SKILL.md", "See [it](none.md).", "link to none.md: no such file");
broken(
  "anchor",
  "one/SKILL.md",
  "See [it](notes.md#nope).",
  "link to notes.md#nope: no such anchor",
);

test("deleted", () => {
  const copy = join(tmp, "deleted");
  cpSync(good, copy, { recursive: true });
  git(copy, "add", "-A");
  rmSync(join(copy, "plugins/annetaan/skills/two/guide.md"));
  const findings = check(copy);
  const want = "plugins/annetaan/skills/one/SKILL.md:10: two/guide.md does not exist";
  assert.ok(
    findings.some((f) => f.includes(want)),
    `no line ${want} in:\n${findings.join("\n")}`,
  );
});
