import { test, after } from "node:test";
import assert from "node:assert/strict";
import { accessSync, constants, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";

const launcher = join(import.meta.dirname, "../plugins/annetaan/scripts/ts.sh");
const stop = "annetaan: needs Bun, or Node.js 24 or later";

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const bash = (process.env["PATH"] ?? "")
  .split(delimiter)
  .map((dir) => join(dir, "bash"))
  .find(isExecutable);
if (bash === undefined) {
  throw new Error("no bash on the PATH");
}

const tmp = mkdtempSync(join(tmpdir(), "ts-sh-"));
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const echo = '#!/bin/sh\necho "${0##*/}" "$@"\n';

const fakeBin = (name: string, fakes: Readonly<Record<string, string>>): string => {
  const bin = join(tmp, name);
  mkdirSync(bin);
  for (const [fake, body] of Object.entries(fakes)) {
    writeFileSync(join(bin, fake), body, { mode: 0o755 });
  }
  return bin;
};

const fakeNode = (answer: string): string =>
  `#!/bin/sh\nif [ "$1" = -p ]; then echo ${answer}; exit 0; fi\necho "\${0##*/}" "$@"\n`;

const launch = (args: readonly string[], env: NodeJS.ProcessEnv) =>
  spawnSync(bash, [launcher, ...args], { cwd: tmp, env, encoding: "utf8" });

test("runs a file with its arguments and exits with its code", () => {
  writeFileSync(
    join(tmp, "a.ts"),
    'const words: string = process.argv.slice(2).join(" ");\nconsole.log(words);\nprocess.exit(3);\n',
  );
  const result = launch(["a.ts", "x", "y"], process.env);
  assert.equal(result.stdout, "x y\n");
  assert.equal(result.status, 3);
});

test("prefers bun when both are on the PATH", () => {
  const env = { PATH: fakeBin("both", { bun: echo, node: fakeNode("24 strip") }) };
  const file = launch(["a.ts", "x"], env);
  assert.equal(file.stdout, "bun a.ts x\n");
  assert.equal(file.status, 0);
  const tests = launch(["--test", "a.test.ts"], env);
  assert.equal(tests.stdout, "bun test --timeout 600000 a.test.ts\n");
  assert.equal(tests.status, 0);
});

test("uses node when it strips types", () => {
  const env = { PATH: fakeBin("node", { node: fakeNode("24 strip") }) };
  const file = launch(["a.ts", "x"], env);
  assert.equal(file.stdout, "node a.ts x\n");
  assert.equal(file.status, 0);
  const tests = launch(["--test", "a.test.ts"], env);
  assert.equal(tests.stdout, "node --test a.test.ts\n");
  assert.equal(tests.status, 0);
});

const assertStops = (env: NodeJS.ProcessEnv): void => {
  const result = launch(["a.ts"], env);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.startsWith(stop), result.stderr);
};

test("stops on a node that cannot run TypeScript", () => {
  assertStops({ PATH: fakeBin("old-node", { node: fakeNode("24 undefined") }) });
});

test("stops on a node below 24 that strips types", () => {
  assertStops({ PATH: fakeBin("node-23", { node: fakeNode("23 strip") }) });
});

test("stops when neither runtime is on the PATH", () => {
  assertStops({ PATH: fakeBin("empty", {}) });
});
