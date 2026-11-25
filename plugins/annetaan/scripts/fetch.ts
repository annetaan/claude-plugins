import { join } from "node:path";
import { git, run, type RunResult } from "./command.ts";
import { unlock, waitLock } from "./lock.ts";

export const withCloneLock = <T>(where: string, body: () => T): T => {
  const common = git(where, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  const dir = join(common, "annetaan-clone.lockdir");
  waitLock(dir);
  try {
    return body();
  } finally {
    unlock(dir);
  }
};

export const fetchFromOrigin = (where: string, refspecs: readonly string[]): RunResult =>
  withCloneLock(where, () => run(["git", "-C", where, "fetch", "--quiet", "origin", ...refspecs]));

export const fetchBranch = (where: string, branch: string): RunResult =>
  fetchFromOrigin(where, [`+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
