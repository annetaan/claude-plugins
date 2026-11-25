import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

type Version = readonly [number, number, number];

const THREE_INTEGERS = /^(\d+)\.(\d+)\.(\d+)$/;
const VERSION_FIELD = /("version"\s*:\s*")[^"]*(")/;

const parseVersion = (text: string): Version | null => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const version: unknown = (data as Readonly<Record<string, unknown>>)["version"];
  if (typeof version !== "string") {
    return null;
  }
  const parts = THREE_INTEGERS.exec(version);
  if (parts === null) {
    return null;
  }
  return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
};

const compareVersions = (a: Version, b: Version): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const withVersion = (text: string, next: string): string =>
  text.replace(VERSION_FIELD, (_, before: string, after: string) => `${before}${next}${after}`);

const root = join(import.meta.dirname, "..");
const PLUGIN = "plugins/annetaan";
const MANIFEST = `${PLUGIN}/.claude-plugin/plugin.json`;

const fail = (message: string): never => {
  process.stderr.write(`FAIL: ${message}\n`);
  process.exit(1);
};

const git = (args: readonly string[]): string | null => {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return result.status === 0 ? result.stdout : null;
};

const args = process.argv.slice(2);
if (!(args.length === 0 || (args.length === 1 && args[0] === "--bump"))) {
  fail("usage: bash tests/plugin-version.sh [--bump]");
}
const bump = args.length === 1;

const defaultBranch =
  git(["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"])?.trim() || "origin/main";
if (git(["rev-parse", "-q", "--verify", `${defaultBranch}^{commit}`]) === null) {
  fail(`${defaultBranch} does not name a commit`);
}
const base =
  git(["merge-base", "HEAD", defaultBranch])?.trim() ??
  fail(`HEAD has no merge base with ${defaultBranch}`);

const changed = git(["diff", "--name-only", base, "--", PLUGIN]);
const untracked = git(["ls-files", "--others", "--exclude-standard", "--", PLUGIN]);
if (changed === null || untracked === null) {
  process.exit(1);
}
if (changed === "" && untracked === "") {
  process.stdout.write(`ok: nothing under ${PLUGIN} differs from ${defaultBranch}\n`);
  process.exit(0);
}

const versionAt = (ref: string, where: string): Version =>
  parseVersion(git(["show", `${ref}:${MANIFEST}`]) ?? "") ??
  fail(`${MANIFEST} ${where} has no usable version`);
const baseVersion = versionAt(base, "at the merge base");
const defaultVersion = versionAt(defaultBranch, `on ${defaultBranch}`);

const manifestPath = join(root, MANIFEST);
const readManifest = (): string | null => {
  try {
    return readFileSync(manifestPath, "utf8");
  } catch {
    return null;
  }
};
const text = readManifest() ?? "";
const current = parseVersion(text) ?? fail(`${MANIFEST} in the working tree has no usable version`);
const currentText = (JSON.parse(text) as { readonly version: string }).version;

const floor = compareVersions(baseVersion, defaultVersion) >= 0 ? baseVersion : defaultVersion;
const floorText = floor.join(".");
if (compareVersions(current, floor) > 0) {
  process.stdout.write(`ok: ${MANIFEST} is ${currentText}, above ${floorText}\n`);
  process.exit(0);
}
if (!bump) {
  fail(
    `${MANIFEST} is ${currentText}, not above ${floorText}; run bash tests/plugin-version.sh --bump`,
  );
}
const next = `${floor[0]}.${floor[1] + 1}.0`;
writeFileSync(manifestPath, withVersion(text, next));
process.stdout.write(`bumped: ${MANIFEST} is ${next}\n`);
