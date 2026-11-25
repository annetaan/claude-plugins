import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pause } from "./clock.ts";

const GUARD_AGE_MS = 10_000;

const codeOf = (error: unknown): string | undefined =>
  error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

const holder = (dir: string): number | null => {
  try {
    return Number.parseInt(readFileSync(join(dir, "pid"), "utf8"), 10);
  } catch (error) {
    if (codeOf(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const alive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) === "EPERM";
  }
};

const dropStaleGuard = (guard: string): void => {
  try {
    if (Date.now() - statSync(guard).mtimeMs > GUARD_AGE_MS) {
      rmSync(guard, { recursive: true, force: true });
    }
  } catch (error) {
    if (codeOf(error) !== "ENOENT") {
      throw error;
    }
  }
};

const discard = (dir: string): void => {
  const gone = `${dir}.${process.pid}.gone`;
  renameSync(dir, gone);
  rmSync(gone, { recursive: true, force: true });
};

const reap = (dir: string, dead: number): void => {
  const guard = `${dir}.reap`;
  dropStaleGuard(guard);
  try {
    mkdirSync(guard);
  } catch (error) {
    if (codeOf(error) === "EEXIST") {
      return;
    }
    throw error;
  }
  try {
    if (holder(dir) === dead) {
      discard(dir);
    }
  } finally {
    rmSync(guard, { recursive: true, force: true });
  }
};

const held = (error: unknown): boolean => {
  const code = codeOf(error);
  return code === "ENOTEMPTY" || code === "EEXIST";
};

export const tryLock = (dir: string): boolean => {
  const tmp = `${dir}.${process.pid}.tmp`;
  for (;;) {
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp);
    writeFileSync(join(tmp, "pid"), `${process.pid}\n`);
    try {
      renameSync(tmp, dir);
      return true;
    } catch (error) {
      rmSync(tmp, { recursive: true, force: true });
      if (!held(error)) {
        throw error;
      }
    }
    const pid = holder(dir);
    if (pid !== null) {
      if (alive(pid)) {
        return false;
      }
      reap(dir, pid);
    }
  }
};

export const waitLock = (dir: string): void => {
  while (!tryLock(dir)) {
    pause(50);
  }
};

export const unlock = (dir: string): void => {
  if (holder(dir) === process.pid) {
    discard(dir);
  }
};
