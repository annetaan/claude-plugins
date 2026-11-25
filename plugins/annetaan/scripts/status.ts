import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type StatusObject = Readonly<Record<string, unknown>> & { readonly status: string };

export const statusLine = (fields: StatusObject): string => `${JSON.stringify(fields)}\n`;

export class Failure extends Error {}

export class Stopped extends Error {
  readonly fields: StatusObject;

  constructor(fields: StatusObject) {
    super(typeof fields["message"] === "string" ? fields["message"] : fields.status);
    this.fields = fields;
  }
}

export const stop = (
  reason: string,
  message: string,
  extra: Readonly<Record<string, unknown>> = {},
): never => {
  throw new Stopped({ status: "stop", reason, message, ...extra });
};

export class UsageError extends Error {}

export type Output = string | { readonly out: string; readonly code: number };

export type ExitCodes = { readonly usage: number; readonly failure: number };

const started = (url: string): boolean => {
  const argv1 = process.argv[1];
  if (argv1 === undefined) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(url)) === realpathSync(argv1);
  } catch {
    return false;
  }
};

export const entry = (
  url: string,
  name: string,
  usage: string,
  main: (args: readonly string[]) => Output,
  codes: ExitCodes = { usage: 1, failure: 1 },
): void => {
  if (!started(url)) {
    return;
  }
  try {
    const output = main(process.argv.slice(2));
    if (typeof output === "string") {
      process.stdout.write(output);
      process.exitCode = 0;
    } else {
      process.stdout.write(output.out);
      process.exitCode = output.code;
    }
  } catch (error) {
    if (error instanceof Stopped) {
      process.stdout.write(statusLine(error.fields));
      process.exitCode = 0;
    } else if (error instanceof UsageError) {
      process.stderr.write(usage.endsWith("\n") ? usage : `${usage}\n`);
      if (error.message !== "") {
        process.stderr.write(`${name}: ${error.message}\n`);
      }
      process.exitCode = codes.usage;
    } else if (error instanceof Failure) {
      process.stderr.write(`${name}: ${error.message}\n`);
      process.exitCode = codes.failure;
    } else {
      throw error;
    }
  }
};
