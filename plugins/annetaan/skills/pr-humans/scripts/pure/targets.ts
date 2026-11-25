import { type GraphqlComment, recordedBy } from "./record.ts";

export type Targets = {
  readonly numbers: readonly number[];
  readonly project: number | null;
  readonly search: string | null;
  readonly all: boolean;
  readonly unrecorded: boolean;
};

export type PullRequestNode = {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly url: string;
  readonly comments: { readonly nodes: readonly GraphqlComment[] };
};

export type PullRequestRow = {
  readonly number: number;
  readonly title: string;
  readonly state: string;
  readonly url: string;
  readonly recordedBy: "me" | "other" | null;
  readonly recorded: boolean;
};

const NUMBER = /^#?([0-9]+)$/u;
const RANGE = /^#?([0-9]+)-#?([0-9]+)$/u;

const byNumber = (a: number, b: number): number => a - b;

export const parseNumber = (arg: string): number | null => {
  const match = NUMBER.exec(arg);
  return match === null ? null : Number(match[1]);
};

export const parseTargets = (argv: readonly string[]): Targets | { readonly usage: string } => {
  const numbers = new Set<number>();
  let project: number | null = null;
  let search: string | null = null;
  let all = false;
  let unrecorded = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    const range = RANGE.exec(arg);
    const single = parseNumber(arg);
    if (arg === "--project") {
      i += 1;
      const value = parseNumber(argv[i] ?? "");
      if (value === null || value === 0) {
        return { usage: "--project needs a number" };
      }
      project = value;
    } else if (arg === "--search") {
      i += 1;
      const value = argv[i] ?? "";
      if (value === "") {
        return { usage: "--search needs a query" };
      }
      search = value;
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--unrecorded") {
      unrecorded = true;
    } else if (single !== null) {
      numbers.add(single);
    } else if (range !== null) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      for (let n = Math.min(a, b); n <= Math.max(a, b); n += 1) {
        numbers.add(n);
      }
    } else {
      return { usage: `unknown argument: ${arg}` };
    }
  }
  if (numbers.size === 0 && project === null && search === null && !all) {
    if (!unrecorded) {
      return { usage: "name pull requests, --project, --search, --all or --unrecorded" };
    }
    all = true;
  }
  return { numbers: [...numbers].toSorted(byNumber), project, search, all, unrecorded };
};

export const recordRow = (node: PullRequestNode, me: string | null): PullRequestRow => {
  const by = recordedBy(node.comments.nodes, me);
  return {
    number: node.number,
    title: node.title,
    state: node.state,
    url: node.url,
    recordedBy: by,
    recorded: by === "me",
  };
};

export const chooseTargets = (
  numbers: readonly number[],
  info: ReadonlyMap<number, PullRequestRow>,
  all: boolean,
  unrecorded: boolean,
): { readonly prs: readonly PullRequestRow[]; readonly notPullRequests: readonly number[] } => {
  const chosen = all
    ? [...info.values()]
    : numbers.flatMap((n) => {
        const row = info.get(n);
        return row === undefined ? [] : [row];
      });
  const prs = chosen.toSorted((a, b) => byNumber(a.number, b.number));
  return {
    prs: unrecorded ? prs.filter((row) => row.recordedBy === null) : prs,
    notPullRequests: numbers.filter((n) => !info.has(n)).toSorted(byNumber),
  };
};
