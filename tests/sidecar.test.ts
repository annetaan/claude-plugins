import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const sidecarSh = join(
  import.meta.dirname,
  "../plugins/annetaan/skills/doc-meta/scripts/sidecar.sh",
);

const tmp = mkdtempSync(join(tmpdir(), "sidecar-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

let spaces = 0;
const space = (): string => {
  spaces += 1;
  const dir = join(tmp, `case-${spaces}`);
  mkdirSync(dir);
  return dir;
};

type Ran = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly json: Readonly<Record<string, unknown>>;
};

const sidecar = (dir: string, ...args: readonly string[]): Ran => {
  const result = spawnSync("bash", [sidecarSh, ...args], { cwd: dir, encoding: "utf8" });
  const json: Readonly<Record<string, unknown>> =
    result.status === 0 && result.stdout !== "" ? JSON.parse(result.stdout) : {};
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, json };
};

const write = (dir: string, name: string, lines: readonly string[]): string => {
  writeFileSync(join(dir, name), `${lines.join("\n")}\n`);
  return name;
};

const blocks = (...entries: readonly (readonly string[] | "---")[]): readonly string[] => {
  let n = 0;
  return entries.flatMap((entry) => {
    if (entry === "---") {
      return ["---", ""];
    }
    n += 1;
    const [mark, ...quoted] = entry;
    return [`### ${n}${mark === "verbatim" ? " verbatim" : ""}`, ...quoted, ""];
  });
};

const ok = (ran: Ran): Readonly<Record<string, unknown>> => {
  assert.equal(ran.code, 0, ran.stderr);
  assert.equal(ran.json["status"], "ok", ran.stdout);
  return ran.json;
};

type Fill = {
  readonly weight?: string;
  readonly role?: string;
  readonly aid?: string;
  readonly flag?: string;
  readonly review?: string;
};

const fill = (text: string, id: string, how: Fill = {}): string => {
  const pending = new RegExp(`### ${id} \\(pending\\)\\n((?:>[^\\n]*\\n)+)\\nflag:\\n`, "u");
  assert.match(text, pending, `${id} is pending`);
  return text.replace(pending, (_, quoted: string) =>
    [
      `### ${id} ${how.weight ?? "★★☆"} ${how.role ?? "claim"}\n`,
      quoted,
      how.aid === undefined ? "" : `ja: ${how.aid}\n`,
      `\nflag:${how.flag === undefined ? "" : ` ${how.flag}`}\n`,
      how.review === undefined ? "" : `review: ${how.review}\n`,
    ].join(""),
  );
};

const sidecarFile = (dir: string, name = "doc"): string => join(dir, `${name}.doc-meta.md`);

const readSidecar = (dir: string): string => readFileSync(sidecarFile(dir), "utf8");

const editSidecar = (dir: string, edit: (text: string) => string): void => {
  writeFileSync(sidecarFile(dir), edit(readSidecar(dir)));
};

const block = (text: string, id: string): string => {
  const start = text.indexOf(`### ${id} `);
  assert.notEqual(start, -1, `no block ${id}`);
  const rest = text.slice(start + 1);
  const end = rest.search(/\n(### |---\n)/u);
  return end === -1 ? text.slice(start) : text.slice(start, start + 1 + end);
};

test("a flag survives exactly when its block is unchanged", () => {
  const dir = space();
  write(dir, "doc.md", [
    "# Guide",
    "",
    "The tool reads files. It writes reports. It never deletes anything.",
    "",
    "This paragraph is wrapped",
    "over two lines. 日本語の文です。",
    "",
    "It ends here.",
  ]);
  write(
    dir,
    "blocks.md",
    blocks(
      ["", "> # Guide"],
      "---",
      ["", "> The tool reads files."],
      ["", "> It writes reports."],
      ["", "> It never deletes anything."],
      "---",
      ["", "> This paragraph is wrapped", "> over two lines."],
      ["", "> 日本語の文です。"],
      "---",
      ["", "> It ends here."],
    ),
  );
  const first = ok(sidecar(dir, "sync", "doc.md", "blocks.md"));
  assert.deepEqual(first["new"], ["b001", "b002", "b003", "b004", "b005", "b006", "b007"]);
  editSidecar(dir, (text) =>
    ["b001", "b002", "b003", "b004", "b005", "b006", "b007"].reduce(
      (filled, id) =>
        fill(filled, id, {
          aid: `訳 ${id}`,
          flag: `[question] about ${id}`,
          review: `answer for ${id}`,
        }),
      text,
    ),
  );
  const flagged = readSidecar(dir);
  write(dir, "doc.md", [
    "# Guide",
    "",
    "The tool reads files. It writes short reports.",
    "",
    "This paragraph is　wrapped over",
    "two lines.　日本語の文です。",
    "",
    "It ends here. Then it stops.",
  ]);
  write(
    dir,
    "blocks.md",
    blocks(
      ["", "> # Guide"],
      "---",
      ["", "> The tool reads files."],
      ["", "> It writes short reports."],
      "---",
      ["", "> This paragraph is　wrapped over", "> two lines."],
      ["", "> 日本語の文です。"],
      "---",
      ["", "> It ends here."],
      ["", "> Then it stops."],
    ),
  );
  const second = ok(sidecar(dir, "sync", "doc.md", "blocks.md"));
  assert.deepEqual(second["unchanged"], ["b001", "b002", "b005", "b006", "b007"]);
  assert.deepEqual(second["changed"], ["b003"]);
  assert.deepEqual(second["new"], ["b008"]);
  assert.deepEqual(second["deleted"], ["b004"]);
  assert.deepEqual(second["flagsDropped"], ["b003", "b004"]);
  const text = readSidecar(dir);
  for (const id of ["b001", "b002", "b005", "b006", "b007"]) {
    assert.equal(block(text, id), block(flagged, id), `${id} is kept whole`);
    assert.match(
      block(text, id),
      new RegExp(
        `ja: 訳 ${id}\\n\\nflag: \\[question\\] about ${id}\\nreview: answer for ${id}`,
        "u",
      ),
    );
  }
  assert.equal(block(text, "b003"), "### b003 (pending)\n> It writes short reports.\n\nflag:\n");
  assert.doesNotMatch(text, /b004/u);
  assert.match(text, /\n- max id: b008\n/u);
});

const threeSentences = (dir: string): void => {
  write(dir, "doc.md", ["Alpha one. Bravo two. Charlie three."]);
  write(
    dir,
    "blocks.md",
    blocks(["", "> Alpha one."], ["", "> Bravo two."], ["", "> Charlie three."]),
  );
  ok(sidecar(dir, "sync", "doc.md", "blocks.md"));
};

test("a deleted id is never handed out again", () => {
  const dir = space();
  threeSentences(dir);
  write(dir, "doc.md", ["Delta four. Alpha one. Bravo two."]);
  write(
    dir,
    "blocks.md",
    blocks(["", "> Delta four."], ["", "> Alpha one."], ["", "> Bravo two."]),
  );
  const result = ok(sidecar(dir, "sync", "doc.md", "blocks.md"));
  assert.deepEqual(result["deleted"], ["b003"]);
  assert.deepEqual(result["new"], ["b004"]);
  assert.equal(result["maxIdRebuilt"], false);
  assert.match(readSidecar(dir), /\n- max id: b004\n/u);
});

test("a missing max id is rebuilt from the blocks", () => {
  const dir = space();
  threeSentences(dir);
  editSidecar(dir, (text) => text.replace("- max id: b003\n", ""));
  write(dir, "doc.md", ["Alpha one. Bravo two. Charlie three. Delta four. Echo five."]);
  write(
    dir,
    "blocks.md",
    blocks(
      ["", "> Alpha one."],
      ["", "> Bravo two."],
      ["", "> Charlie three."],
      ["", "> Delta four."],
      ["", "> Echo five."],
    ),
  );
  const result = ok(sidecar(dir, "sync", "doc.md", "blocks.md"));
  assert.equal(result["maxIdRebuilt"], true);
  assert.deepEqual(result["new"], ["b004", "b005"]);
  assert.match(readSidecar(dir), /\n- max id: b005\n/u);
});

test("a verbatim block compares whitespace exactly", () => {
  const dir = space();
  const fence = (indent: string): readonly string[] => ["```sh", `${indent}echo hi`, "```"];
  write(dir, "doc.md", ["Run this script now.", "", ...fence("  ")]);
  write(
    dir,
    "blocks.md",
    blocks(["", "> Run this script now."], ["verbatim", ...fence("  ").map((line) => `> ${line}`)]),
  );
  ok(sidecar(dir, "sync", "doc.md", "blocks.md"));
  write(dir, "doc.md", ["Run this", "script   now.", "", ...fence("    ")]);
  write(
    dir,
    "blocks.md",
    blocks(
      ["", "> Run this", "> script   now."],
      ["verbatim", ...fence("    ").map((line) => `> ${line}`)],
    ),
  );
  const result = ok(sidecar(dir, "sync", "doc.md", "blocks.md"));
  assert.deepEqual(result["unchanged"], ["b001"]);
  assert.deepEqual(result["changed"], ["b002"]);
});

test("only a newline ends a line of the blocks file and the sidecar", () => {
  const dir = space();
  const fence = ["```c", "int a;\f", "int\u2028b;", "```"];
  write(dir, "doc.md", ["Build it.", "", ...fence]);
  write(
    dir,
    "blocks.md",
    blocks(["", "> Build it."], ["verbatim", ...fence.map((line) => `> ${line}`)]),
  );
  assert.deepEqual(ok(sidecar(dir, "sync", "doc.md", "blocks.md"))["new"], ["b001", "b002"]);
  editSidecar(dir, (text) => fill(text, "b002", { flag: "[keep] as is" }));
  const kept = readSidecar(dir);
  const again = ok(sidecar(dir, "sync", "doc.md", "blocks.md"));
  assert.deepEqual(again["unchanged"], ["b001", "b002"]);
  assert.equal(readSidecar(dir), kept);
  assert.ok(kept.includes("> int a;\f\n> int\u2028b;\n"), kept);
  write(dir, "bad.md", ["### 1", "> Build\fit.", "nonsense"]);
  const ran = sidecar(dir, "sync", "doc.md", "bad.md");
  assert.equal(ran.json["reason"], "blocks", ran.stdout);
  assert.equal(ran.json["line"], 3, ran.stdout);
});

test("sync stops and writes nothing", () => {
  const dir = space();
  threeSentences(dir);
  const before = readSidecar(dir);
  const stops = (ran: Ran, reason: string, extra: Readonly<Record<string, unknown>> = {}): void => {
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(ran.json["status"], "stop", ran.stdout);
    assert.equal(ran.json["reason"], reason, ran.stdout);
    for (const [key, value] of Object.entries(extra)) {
      assert.equal(ran.json[key], value, ran.stdout);
    }
    assert.equal(readSidecar(dir), before);
  };
  stops(sidecar(dir, "sync", "doc.doc-meta.md", "blocks.md"), "is-sidecar");
  stops(sidecar(dir, "sync", "missing.md", "blocks.md"), "no-document");
  assert.equal(existsSync(sidecarFile(dir, "missing")), false);
  write(dir, "bad.md", ["### 1", "> Alpha one.", "### 3", "> Bravo two."]);
  stops(sidecar(dir, "sync", "doc.md", "bad.md"), "blocks", { line: 3 });
  write(dir, "empty.md", [""]);
  stops(sidecar(dir, "sync", "doc.md", "empty.md"), "blocks", { line: 1 });
  write(dir, "lost.md", blocks(["", "> Alpha one."], ["", "> Zulu."]));
  stops(sidecar(dir, "sync", "doc.md", "lost.md"), "not-in-document", { block: 2 });
  const headingLine = (text: string, id: string): number =>
    text.split("\n").findIndex((line) => line.startsWith(`### ${id} `)) + 1;
  for (const broken of [
    before.replace("### b002 (pending)", "### two (pending)"),
    before.replace("### b002 (pending)", "### b001 (pending)"),
  ]) {
    writeFileSync(sidecarFile(dir), broken);
    const ran = sidecar(dir, "sync", "doc.md", "blocks.md");
    assert.equal(ran.json["reason"], "sidecar", ran.stdout);
    assert.equal(ran.json["line"], headingLine(before, "b002"), ran.stdout);
    assert.equal(readSidecar(dir), broken);
  }
});

const completed = (dir: string): string => {
  threeSentences(dir);
  editSidecar(dir, (text) =>
    ["b001", "b002", "b003"]
      .reduce((filled, id) => fill(filled, id), text)
      .replace("- weights:\n", "- weights: ★☆☆ 0, ★★☆ 3, ★★★ 0\n"),
  );
  return readSidecar(dir);
};

test("verify reports each code", () => {
  const dir = space();
  const good = completed(dir);
  assert.deepEqual(ok(sidecar(dir, "verify", "doc.md")), { status: "ok", ok: true, reasons: [] });
  const reasons = (text: string): unknown => {
    writeFileSync(sidecarFile(dir), text);
    const result = ok(sidecar(dir, "verify", "doc.md"));
    assert.equal(result["ok"], false);
    return result["reasons"];
  };
  const b1 = block(good, "b001");
  const b2 = block(good, "b002");
  const cases: readonly (readonly [string, string, string | null])[] = [
    [
      good.replace("### b002 ★★☆ claim", "### b002 (pending)").replace("★★☆ 3", "★★☆ 2"),
      "pending",
      "b002",
    ],
    [good.replace("> Bravo two.", "> Bravo twice."), "not-in-document", "b002"],
    [good.replace(`${b1}\n${b2}`, `${b2}\n${b1}`), "order", "b001"],
    [good.replace("### b003 ★★☆", "### b002 ★★☆"), "duplicate-id", "b002"],
    [good.replace("- max id: b003", "- max id: b002"), "max-id", "b003"],
    [good.replace("- max id: b003\n", ""), "max-id", null],
    [good.replace("- blocks: 3", "- blocks: 4"), "count", null],
    [good.replace("★★☆ 3", "★★☆ 2"), "weights", null],
    [good.replace("> Bravo two.\n\nflag:\n", "> Bravo two.\n"), "no-flag", "b002"],
    [good.replace("### b002 ★★☆ claim", "### b002 ★★☆ opinion"), "heading", "b002"],
    [good.replace("### b002 ★★☆ claim", "### two ★★☆ claim"), "heading", null],
  ];
  for (const [text, code, id] of cases) {
    assert.deepEqual(reasons(text), [{ code, block: id }], code);
  }
});

test("a three-line record verifies by its first two lines", () => {
  const dir = space();
  const body = Array.from({ length: 11 }, (_, index) => `    x${index} = ${index}`);
  const doc = (first: string): readonly string[] => [
    "Some code follows.",
    "",
    "```python",
    first,
    ...body,
    "```",
  ];
  write(dir, "doc.md", doc("def f():"));
  write(
    dir,
    "blocks.md",
    blocks(["", "> Some code follows."], ["", "> ```python", "> def f():", "> ... 11 more lines"]),
  );
  ok(sidecar(dir, "sync", "doc.md", "blocks.md"));
  const pending = ok(sidecar(dir, "verify", "doc.md"))["reasons"];
  assert.deepEqual(
    (pending as readonly { readonly code: string }[]).filter((reason) => reason.code !== "pending"),
    [{ code: "weights", block: null }],
  );
  editSidecar(dir, (text) =>
    fill(fill(text, "b001"), "b002", { weight: "★★★", role: "verbatim" })
      .replace("... 11 more lines", "... 99 more lines")
      .replace("- weights:\n", "- weights: ★☆☆ 0, ★★☆ 1, ★★★ 1\n"),
  );
  assert.deepEqual(ok(sidecar(dir, "verify", "doc.md")), { status: "ok", ok: true, reasons: [] });
  write(dir, "doc.md", doc("def g():"));
  assert.deepEqual(ok(sidecar(dir, "verify", "doc.md"))["reasons"], [
    { code: "not-in-document", block: "b002" },
  ]);
});

test("quotes checks each bullet", () => {
  const dir = space();
  write(dir, "doc.md", ["This paragraph is wrapped", "over two lines. Bravo two."]);
  write(
    dir,
    "blocks.md",
    blocks(["", "> This paragraph is wrapped", "> over two lines."], ["", "> Bravo two."]),
  );
  ok(sidecar(dir, "sync", "doc.md", "blocks.md"));
  write(dir, "bullets.md", [
    '- b001 ("paragraph is wrapped over two") repeats b002 ("Bravo").',
    '- b009 ("Bravo") is gone.',
    "- b002 carries no quote.",
    '- b002 ("Charlie") is not in it.',
    "- The document never says who it is for.",
  ]);
  assert.deepEqual(ok(sidecar(dir, "quotes", "doc.md", "bullets.md"))["bullets"], [
    { index: 1, ok: true, code: null },
    { index: 2, ok: false, code: "no-block" },
    { index: 3, ok: false, code: "no-quote" },
    { index: 4, ok: false, code: "no-quote" },
    { index: 5, ok: true, code: null },
  ]);
});

test("verify and quotes stop", () => {
  const dir = space();
  write(dir, "doc.md", ["Alpha one."]);
  write(dir, "doc.doc-meta.md", ["# not checked"]);
  write(dir, "lone.md", ["No sidecar here."]);
  write(dir, "bullets.md", ["- (none)"]);
  for (const command of [["verify"], ["quotes"]] as const) {
    const tail = command[0] === "quotes" ? ["bullets.md"] : [];
    for (const [document, reason] of [
      ["doc.doc-meta.md", "is-sidecar"],
      ["missing.md", "no-document"],
      ["lone.md", "no-sidecar"],
    ] as const) {
      const ran = sidecar(dir, command[0], document, ...tail);
      assert.equal(ran.code, 0, ran.stderr);
      assert.equal(ran.json["status"], "stop", ran.stdout);
      assert.equal(ran.json["reason"], reason, `${command[0]} ${document}`);
    }
  }
});

test("a usage error exits 1", () => {
  const dir = space();
  write(dir, "doc.md", ["Alpha one."]);
  for (const args of [
    ["check", "doc.md"],
    ["sync", "doc.md", "missing-blocks.md"],
  ]) {
    const ran = spawnSync("bash", [sidecarSh, ...args], { cwd: dir, encoding: "utf8" });
    assert.equal(ran.status, 1, args.join(" "));
    assert.equal(ran.stdout, "");
    assert.match(ran.stderr, /^sidecar\.sh: match, number and verify/u);
  }
  assert.equal(existsSync(sidecarFile(dir)), false);
});
