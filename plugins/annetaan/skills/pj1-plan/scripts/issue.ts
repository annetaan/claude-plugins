import { readFileSync, statSync, writeFileSync } from "node:fs";
import { run } from "../../../scripts/command.ts";
import {
  Failure,
  Stopped,
  UsageError,
  entry,
  statusLine,
  stop,
  type StatusObject,
} from "../../../scripts/status.ts";
import { splitLines } from "../../../scripts/pure/text.ts";
import { HANDOVER, markerProblem } from "./pure/comment-markers.ts";
import { lint, parentLint, parseBody } from "./pure/issue-body.ts";
import { readOrder, readProject } from "./project.ts";

const USAGE = `usage: issue.sh label <n> [--add <name>,...] [--remove <name>,...]
                                   add and remove labels on #<n> in one call, at least one of the two; make sure each added label exists
       issue.sh parent --title <t> --from <branch> [--blocked-by <Q>,<R>] [--roadmap <path> <heading>] --body <file>
                                   lint the parent body with its Base: and Roadmap: lines, file it labelled project, write those lines with its number
       issue.sh sub <P> --title <t> [--blocked-by <n>,<m>] [--blocking <k>] [--label <name>] --body <file>
                                   file a sub-issue of #<P> whose lint fails on nothing but decisions-open and stub, then check its edges for a cycle
       issue.sh relate <n> add|remove <m>
                                   add or remove "#<n> blocked by #<m>", and take an added edge back off when it made a cycle
       issue.sh order <P> --since <updatedAt>
                                   write the parent body from project.sh <P> --order-body
       issue.sh titles <P>         bring each open sub-issue's title to wantedTitle, and print the numbers retitled as changed
       issue.sh edit <n> --since <updatedAt> --body <file> [--title <t>]
                                   edit a body; a parent body has to pass the parent lint
       issue.sh comment <n> --body <file>
                                   post a marked comment
       issue.sh handover <P> [--since <updated_at>] --body <file>
                                   rewrite the parent's handover comment; without --since, post it only when there is none
       issue.sh close <n> --reason completed|not-planned --comment <file>
                                   post the marked comment and close #<n> in one write; on a closed issue, write nothing
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message":
moved, closed, no-marker, lint or cycle. Exit 1 means a usage error or an unexpected failure.
`;

export const LABELS = {
  ready: [
    "0E8A16",
    "Every decision is settled and the body is complete for its day. pj4-running can work on it.",
  ],
  blocker: ["B60205", "pj4-running stopped on this. Settle it before anything else."],
  project: ["5319E7", "The parent issue of a pj project. Its sub-issues are the project's tasks."],
  doing: ["1D76DB", "A pj project whose sub-issues are filed. It marks the parent issue."],
} as const satisfies Readonly<Record<string, readonly [string, string]>>;

export type LabelName = keyof typeof LABELS;

const isLabel = (name: string): name is LabelName => Object.hasOwn(LABELS, name);

type View = {
  readonly state: string;
  readonly updatedAt: string;
  readonly labels: readonly string[];
  readonly parent: { readonly number: number } | null;
  readonly body: string;
};

type RawView = Omit<View, "labels"> & { readonly labels: readonly { readonly name: string }[] };

const textOf = (path: string): string => readFileSync(path, "utf8");

const gh = (args: readonly string[], input?: string): string => {
  const result = run(["gh", ...args], input === undefined ? {} : { input });
  if (result.code !== 0) {
    throw new Failure(`gh ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
};

const view = (n: number): View => {
  const raw = JSON.parse(
    gh(["issue", "view", String(n), "--json", "state,updatedAt,labels,parent,body"]),
  ) as RawView;
  return { ...raw, labels: raw.labels.map((label) => label.name) };
};

const refuseClosed = (v: View, n: number): void => {
  if (v.state === "CLOSED") {
    stop("closed", `#${n} is closed`);
  }
};

const ensureLabel = (name: LabelName): void => {
  const [color, description] = LABELS[name];
  const result = run([
    "gh",
    "label",
    "create",
    name,
    "--color",
    color,
    "--description",
    description,
  ]);
  if (result.code !== 0 && !result.stderr.includes("already exists")) {
    throw new Failure(`cannot create the label ${name}: ${result.stderr.trim()}`);
  }
};

type Cycle =
  | { readonly kind: "ok" }
  | { readonly kind: "cycle" | "failed"; readonly message: string };

const cycleCheck = (p: number): Cycle => {
  try {
    const result = readOrder(p, process.cwd());
    return result.kind === "cycle"
      ? { kind: "cycle", message: `project: ${result.message}` }
      : { kind: "ok" };
  } catch (error) {
    if (error instanceof Failure) {
      return { kind: "failed", message: `project: ${error.message}` };
    }
    throw error;
  }
};

const moved = (
  message: string,
  key: string,
  value: string | null,
  file: string | null,
  text: string | null,
): never => {
  if (file !== null && text !== null) {
    const github = `${file}.github`;
    writeFileSync(github, text);
    return stop("moved", message, { [key]: value, github });
  }
  return stop("moved", message, { [key]: value });
};

const filed = (out: string): { readonly number: number; readonly url: string } => {
  const url = splitLines(out.trim()).at(-1) ?? "";
  return { number: Number.parseInt(url.replace(/\/+$/, "").split("/").at(-1) ?? "", 10), url };
};

const joined = (ns: readonly number[]): string => ns.join(",");

const settled = (write: () => StatusObject): StatusObject => {
  try {
    return write();
  } catch (error) {
    if (error instanceof Stopped) {
      return error.fields;
    }
    throw error;
  }
};

const labelWrite = (
  n: number,
  add: readonly LabelName[],
  remove: readonly LabelName[],
): StatusObject => {
  refuseClosed(view(n), n);
  const edit: string[] = [];
  if (add.length > 0) {
    for (const name of add) {
      ensureLabel(name);
    }
    edit.push("--add-label", add.join(","));
  }
  if (remove.length > 0) {
    edit.push("--remove-label", remove.join(","));
  }
  gh(["issue", "edit", String(n), ...edit]);
  return { status: "ok" };
};

export const editLabels = (
  n: number,
  add: readonly LabelName[],
  remove: readonly LabelName[],
): StatusObject => settled(() => labelWrite(n, add, remove));

type ParentArgs = {
  readonly title: string;
  readonly from: string;
  readonly blockedBy: readonly number[];
  readonly roadmap: readonly [string, string] | null;
  readonly body: string;
};

const parentWrite = (a: ParentArgs): StatusObject => {
  const text = textOf(a.body);
  const body = (n: number): string => {
    const head = [`Base: \`pj/${n}\` from \`${a.from}\``];
    if (a.roadmap !== null) {
      head.push(`Roadmap: \`${a.roadmap[0]}\` ${a.roadmap[1]}`);
    }
    return `${head.join("\n")}\n\n${text}`;
  };
  const result = parentLint(parseBody(body(0)));
  if (!result.ok) {
    stop("lint", "the parent body fails the parent lint", { reasons: result.reasons });
  }
  ensureLabel("project");
  const create = [
    "issue",
    "create",
    "--label",
    "project",
    "--title",
    a.title,
    "--body-file",
    a.body,
  ];
  if (a.blockedBy.length > 0) {
    create.push("--blocked-by", joined(a.blockedBy));
  }
  const { number, url } = filed(gh(create));
  const edited = run(["gh", "issue", "edit", String(number), "--body-file", "-"], {
    input: body(number),
  });
  if (edited.code !== 0) {
    throw new Failure(
      `filed #${number} ${url} but could not write its Base: line: ${edited.stderr.trim()}`,
    );
  }
  return { status: "ok", number, url };
};

export type SubArgs = {
  readonly title: string;
  readonly body: string;
  readonly blockedBy: readonly number[];
  readonly blocking: number | null;
  readonly label: LabelName | null;
};

const subWrite = (p: number, a: SubArgs): StatusObject => {
  const result = lint(parseBody(textOf(a.body)));
  if (result.reasons.some((reason) => reason !== "decisions-open" && reason !== "stub")) {
    stop("lint", "the body fails the lint", { reasons: result.reasons });
  }
  refuseClosed(view(p), p);
  if (a.label !== null) {
    ensureLabel(a.label);
  }
  const create = [
    "issue",
    "create",
    "--parent",
    String(p),
    "--title",
    a.title,
    "--body-file",
    a.body,
  ];
  const undo: string[] = [];
  if (a.blockedBy.length > 0) {
    create.push("--blocked-by", joined(a.blockedBy));
    undo.push("--remove-blocked-by", joined(a.blockedBy));
  }
  if (a.blocking !== null) {
    create.push("--blocking", String(a.blocking));
    undo.push("--remove-blocking", String(a.blocking));
  }
  if (a.label !== null) {
    create.push("--label", a.label);
  }
  const { number, url } = filed(gh(create));
  if (undo.length > 0) {
    const check = cycleCheck(p);
    if (check.kind !== "ok") {
      gh(["issue", "edit", String(number), ...undo]);
      if (check.kind === "cycle") {
        stop(
          "cycle",
          `#${number} made a cycle, so its edges are taken back off: ${check.message}`,
          {
            number,
            url,
          },
        );
      }
      throw new Failure(
        `filed #${number} ${url}, took its edges back off, and project.sh ${p} --order failed: ${check.message}`,
      );
    }
  }
  return { status: "ok", number, url };
};

export const fileSub = (p: number, sub: SubArgs): StatusObject => settled(() => subWrite(p, sub));

const relateWrite = (n: number, action: "add" | "remove", m: number): StatusObject => {
  const v = view(n);
  let x: number;
  if (v.labels.includes("project")) {
    x = n;
  } else if (v.parent !== null) {
    x = v.parent.number;
  } else {
    throw new Failure(`#${n} is neither a parent nor a sub-issue`);
  }
  refuseClosed(v, n);
  gh(["issue", "edit", String(n), `--${action}-blocked-by`, String(m)]);
  if (action === "add") {
    const check = cycleCheck(x);
    if (check.kind !== "ok") {
      gh(["issue", "edit", String(n), "--remove-blocked-by", String(m)]);
      if (check.kind === "cycle") {
        stop(
          "cycle",
          `#${n} blocked by #${m} made a cycle, so it is taken back off: ${check.message}`,
        );
      }
      throw new Failure(
        `took #${n} blocked by #${m} back off, because project.sh ${x} --order failed: ${check.message}`,
      );
    }
  }
  return { status: "ok" };
};

const orderWrite = (p: number, since: string): StatusObject => {
  refuseClosed(view(p), p);
  let body: string;
  try {
    const result = readOrder(p, process.cwd());
    if (result.kind === "cycle") {
      return stop("cycle", `project: ${result.message}`);
    }
    body = result.body;
  } catch (error) {
    if (error instanceof Failure) {
      throw new Failure(`project.sh ${p} --order-body failed: project: ${error.message}`);
    }
    throw error;
  }
  const now = view(p).updatedAt;
  if (now !== since) {
    moved(`#${p} changed on GitHub since ${since}`, "updatedAt", now, null, null);
  }
  gh(["issue", "edit", String(p), "--body-file", "-"], body);
  return { status: "ok" };
};

const titlesWrite = (p: number): StatusObject => {
  let issues;
  try {
    issues = readProject(p, process.cwd()).issues;
  } catch (error) {
    if (error instanceof Failure) {
      throw new Failure(`project.sh ${p} failed: project: ${error.message}`);
    }
    throw error;
  }
  const changed: number[] = [];
  for (const issue of issues) {
    if (issue.state === "OPEN" && issue.wantedTitle !== issue.title) {
      gh(["issue", "edit", String(issue.number), "--title", issue.wantedTitle]);
      changed.push(issue.number);
    }
  }
  return { status: "ok", changed };
};

export const syncTitles = (p: number): StatusObject => settled(() => titlesWrite(p));

const editWrite = (n: number, since: string, body: string, title: string | null): StatusObject => {
  const before = view(n);
  if (before.labels.includes("project")) {
    const result = parentLint(parseBody(textOf(body)));
    if (!result.ok) {
      stop("lint", "the parent body fails the parent lint", { reasons: result.reasons });
    }
  }
  refuseClosed(before, n);
  const now = view(n);
  if (now.updatedAt !== since) {
    moved(`#${n} changed on GitHub since ${since}`, "updatedAt", now.updatedAt, body, now.body);
  }
  gh([
    "issue",
    "edit",
    String(n),
    "--body-file",
    body,
    ...(title === null ? [] : ["--title", title]),
  ]);
  return { status: "ok" };
};

const requireMarker = (path: string): void => {
  const problem = markerProblem(path, textOf(path));
  if (problem !== null) {
    stop("no-marker", problem);
  }
};

const commentWrite = (n: number, body: string): StatusObject => {
  requireMarker(body);
  refuseClosed(view(n), n);
  gh(["issue", "comment", String(n), "--body-file", body]);
  return { status: "ok" };
};

export const postComment = (n: number, body: string): StatusObject =>
  settled(() => commentWrite(n, body));

type Handover = { readonly id: number; readonly updated_at: string; readonly body: string };

const handoverWrite = (p: number, since: string | null, body: string): StatusObject => {
  if (!textOf(body).startsWith(HANDOVER)) {
    stop("no-marker", `${body} does not start with ${HANDOVER}`);
  }
  refuseClosed(view(p), p);
  const out = gh([
    "api",
    `repos/{owner}/{repo}/issues/${p}/comments`,
    "--paginate",
    "--jq",
    `.[] | select(.body | startswith("${HANDOVER}")) | {id, updated_at, body}`,
  ]);
  const first = splitLines(out).find((line) => line.trim() !== "");
  const found = first === undefined ? null : (JSON.parse(first) as Handover);
  if (since === null) {
    if (found !== null) {
      moved(
        `#${p} already has a handover comment`,
        "updated_at",
        found.updated_at,
        body,
        found.body,
      );
    }
    gh(["issue", "comment", String(p), "--body-file", body]);
  } else {
    if (found === null) {
      return moved(`the handover comment of #${p} is gone`, "updated_at", null, body, null);
    }
    if (found.updated_at !== since) {
      moved(
        `the handover comment of #${p} changed since ${since}`,
        "updated_at",
        found.updated_at,
        body,
        found.body,
      );
    }
    gh([
      "api",
      "-X",
      "PATCH",
      `repos/{owner}/{repo}/issues/comments/${found.id}`,
      "-F",
      `body=@${body}`,
    ]);
  }
  return { status: "ok" };
};

const closeWrite = (
  n: number,
  reason: "completed" | "not-planned",
  comment: string,
): StatusObject => {
  requireMarker(comment);
  if (view(n).state === "CLOSED") {
    return { status: "ok" };
  }
  gh([
    "issue",
    "close",
    String(n),
    "--reason",
    reason === "not-planned" ? "not planned" : reason,
    "--comment",
    textOf(comment),
  ]);
  return { status: "ok" };
};

export const closeIssue = (
  n: number,
  reason: "completed" | "not-planned",
  comment: string,
): StatusObject => settled(() => closeWrite(n, reason, comment));

type Parsed = {
  readonly positionals: Readonly<Record<string, string>>;
  readonly options: Readonly<Record<string, readonly string[]>>;
};

const parse = (
  args: readonly string[],
  positionals: readonly string[],
  options: Readonly<Record<string, number>>,
): Parsed => {
  const given: string[] = [];
  const found: Record<string, readonly string[]> = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i] ?? "";
    if (arg.startsWith("-") && arg !== "-") {
      const count = options[arg];
      if (count === undefined) {
        throw new UsageError(`unrecognized arguments: ${arg}`);
      }
      const values = args.slice(i + 1, i + 1 + count);
      if (values.length < count || values.some((value) => value.startsWith("--"))) {
        throw new UsageError(
          `argument ${arg}: expected ${count === 1 ? "one argument" : `${count} arguments`}`,
        );
      }
      found[arg] = values;
      i += 1 + count;
    } else {
      given.push(arg);
      i += 1;
    }
  }
  if (given.length > positionals.length) {
    throw new UsageError(`unrecognized arguments: ${given.slice(positionals.length).join(" ")}`);
  }
  if (given.length < positionals.length) {
    throw new UsageError(
      `the following arguments are required: ${positionals.slice(given.length).join(", ")}`,
    );
  }
  return {
    positionals: Object.fromEntries(positionals.map((name, k) => [name, given[k] ?? ""])),
    options: found,
  };
};

const typed = <T>(name: string, value: string, convert: (s: string) => T): T => {
  try {
    return convert(value);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new UsageError(`argument ${name}: ${error.message}`);
    }
    throw error;
  }
};

const positiveNumber = (s: string): number => {
  if (!/^[0-9]+$/.test(s) || Number.parseInt(s, 10) <= 0) {
    throw new TypeError(`not a positive number: ${s}`);
  }
  return Number.parseInt(s, 10);
};

const numberList = (s: string): readonly number[] => s.split(",").map(positiveNumber);

const labelName = (s: string): LabelName => {
  if (!isLabel(s)) {
    throw new TypeError(`not a pj label: ${s}`);
  }
  return s;
};

const labelList = (s: string): readonly LabelName[] => s.split(",").map(labelName);

const existingFile = (s: string): string => {
  let file = false;
  try {
    file = statSync(s).isFile();
  } catch {
    file = false;
  }
  if (!file) {
    throw new TypeError(`no such file: ${s}`);
  }
  return s;
};

const choice =
  <T extends string>(choices: readonly T[]) =>
  (s: string): T => {
    const found = choices.find((c) => c === s);
    if (found === undefined) {
      throw new TypeError(
        `invalid choice: '${s}' (choose from ${choices.map((c) => `'${c}'`).join(", ")})`,
      );
    }
    return found;
  };

class Args {
  readonly parsed: Parsed;

  constructor(parsed: Parsed) {
    this.parsed = parsed;
  }

  at<T>(name: string, convert: (s: string) => T): T {
    return typed(name, this.parsed.positionals[name] ?? "", convert);
  }

  optional<T>(name: string, convert: (s: string) => T): T | null {
    const values = this.parsed.options[name];
    return values === undefined ? null : typed(name, values[0] ?? "", convert);
  }

  required<T>(name: string, convert: (s: string) => T): T {
    const value = this.optional(name, convert);
    if (value === null) {
      throw new UsageError(`the following arguments are required: ${name}`);
    }
    return value;
  }

  pair(name: string): readonly [string, string] | null {
    const values = this.parsed.options[name];
    return values === undefined ? null : [values[0] ?? "", values[1] ?? ""];
  }
}

const text = (s: string): string => s;

const COMMANDS = [
  "label",
  "parent",
  "sub",
  "relate",
  "order",
  "titles",
  "edit",
  "comment",
  "handover",
  "close",
] as const;

const subcommand = (name: string, rest: readonly string[]): StatusObject => {
  const args = (positionals: readonly string[], options: Readonly<Record<string, number>>): Args =>
    new Args(parse(rest, positionals, options));
  switch (name) {
    case "label": {
      const a = args(["n"], { "--add": 1, "--remove": 1 });
      const n = a.at("n", positiveNumber);
      const add = a.optional("--add", labelList) ?? [];
      const remove = a.optional("--remove", labelList) ?? [];
      if (add.length === 0 && remove.length === 0) {
        throw new UsageError("label takes --add, --remove or both");
      }
      return labelWrite(n, add, remove);
    }
    case "parent": {
      const a = args([], {
        "--title": 1,
        "--from": 1,
        "--blocked-by": 1,
        "--roadmap": 2,
        "--body": 1,
      });
      return parentWrite({
        title: a.required("--title", text),
        from: a.required("--from", text),
        blockedBy: a.optional("--blocked-by", numberList) ?? [],
        roadmap: a.pair("--roadmap"),
        body: a.required("--body", existingFile),
      });
    }
    case "sub": {
      const a = args(["p"], {
        "--title": 1,
        "--blocked-by": 1,
        "--blocking": 1,
        "--label": 1,
        "--body": 1,
      });
      const p = a.at("p", positiveNumber);
      return subWrite(p, {
        title: a.required("--title", text),
        blockedBy: a.optional("--blocked-by", numberList) ?? [],
        blocking: a.optional("--blocking", positiveNumber),
        label: a.optional("--label", labelName),
        body: a.required("--body", existingFile),
      });
    }
    case "relate": {
      const a = args(["n", "action", "m"], {});
      return relateWrite(
        a.at("n", positiveNumber),
        a.at("action", choice(["add", "remove"] as const)),
        a.at("m", positiveNumber),
      );
    }
    case "order": {
      const a = args(["p"], { "--since": 1 });
      return orderWrite(a.at("p", positiveNumber), a.required("--since", text));
    }
    case "titles": {
      const a = args(["p"], {});
      return titlesWrite(a.at("p", positiveNumber));
    }
    case "edit": {
      const a = args(["n"], { "--since": 1, "--body": 1, "--title": 1 });
      const n = a.at("n", positiveNumber);
      return editWrite(
        n,
        a.required("--since", text),
        a.required("--body", existingFile),
        a.optional("--title", text),
      );
    }
    case "comment": {
      const a = args(["n"], { "--body": 1 });
      return commentWrite(a.at("n", positiveNumber), a.required("--body", existingFile));
    }
    case "handover": {
      const a = args(["p"], { "--since": 1, "--body": 1 });
      return handoverWrite(
        a.at("p", positiveNumber),
        a.optional("--since", text),
        a.required("--body", existingFile),
      );
    }
    case "close": {
      const a = args(["n"], { "--reason": 1, "--comment": 1 });
      return closeWrite(
        a.at("n", positiveNumber),
        a.required("--reason", choice(["completed", "not-planned"] as const)),
        a.required("--comment", existingFile),
      );
    }
    default:
      throw new UsageError(
        `argument command: invalid choice: '${name}' (choose from ${COMMANDS.map((c) => `'${c}'`).join(", ")})`,
      );
  }
};

const main = (argv: readonly string[]): string => {
  const [name, ...rest] = argv;
  if (name === undefined) {
    throw new UsageError("the following arguments are required: command");
  }
  return statusLine(subcommand(name, rest));
};

entry(import.meta.url, "issue", USAGE, main);
