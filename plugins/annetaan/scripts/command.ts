import { spawnSync } from "node:child_process";
import { constants } from "node:os";
import { Failure } from "./status.ts";

export type RunOptions = {
  readonly cwd?: string;
  readonly input?: string;
  readonly env?: Readonly<Record<string, string>>;
};

export type RunResult = { readonly code: number; readonly stdout: string; readonly stderr: string };

const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

const decoded = (bytes: Buffer | null): string => (bytes === null ? "" : decoder.decode(bytes));

const signalCode = (signal: NodeJS.Signals): number => 128 + (constants.signals[signal] ?? 0);

export const environment = (
  extra: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> => ({
  ...Object.fromEntries(
    Object.entries(process.env).flatMap(([key, value]) =>
      value === undefined ? [] : [[key, value]],
    ),
  ),
  ...extra,
});

export const run = (argv: readonly string[], options: RunOptions = {}): RunResult => {
  const [command, ...args] = argv;
  if (command === undefined) {
    return { code: 127, stdout: "", stderr: "no command given" };
  }
  const result = spawnSync(command, args, {
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
    input: options.input ?? "",
    maxBuffer: Infinity,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.error !== undefined && result.status === null && result.signal === null) {
    return { code: 127, stdout: decoded(result.stdout), stderr: result.error.message };
  }
  const code = result.signal === null ? (result.status ?? 0) : signalCode(result.signal);
  return { code, stdout: decoded(result.stdout), stderr: decoded(result.stderr) };
};

export const git = (where: string, args: readonly string[], options: RunOptions = {}): string => {
  const result = run(["git", "-C", where, ...args], options);
  if (result.code !== 0) {
    throw new Failure(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
};
