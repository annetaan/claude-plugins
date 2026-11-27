import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import { environment, git, run, type RunOptions } from "../../../scripts/command.ts";
import { realPath, worktreeList } from "../../../scripts/clone.ts";
import { tryLock, unlock } from "../../../scripts/lock.ts";
import { stampOf } from "../../../scripts/pure/reports.ts";
import { DIGIT, splitLines } from "../../../scripts/pure/text.ts";
import {
  entry,
  Failure,
  statusLine,
  stop,
  Stopped,
  UsageError,
  type StatusObject,
} from "../../../scripts/status.ts";
import { stampedIn } from "../../../scripts/work-reports.ts";
import { includeIgnored } from "./include.ts";
import { AGENTS, LEVEL_SEATS, SEATS, parseRecordLine, recordLine } from "./pure/agent-table.ts";
import {
  DECISION_LABEL,
  DECISIONS,
  DECISIONS_RECORD,
  decisionBody,
  decisionEntries,
  filedIssue,
  filedNames,
  type FiledIssue,
} from "./pure/decisions-file.ts";
import { render } from "./pure/prompt-template.ts";
import {
  DISAGREE,
  draftText,
  droppedLine,
  fields,
  isScope,
  lintReasons,
  parseReview,
  printed,
  recordCounts,
  runArgs,
  scopeState,
  section,
  type Block,
  type ReviewDir,
  type RunArgs,
} from "./pure/review-file.ts";
import {
  evidenceWanted,
  judgementFault,
  parseJudgement,
  roundText,
  type JudgementFault,
} from "./pure/round-file.ts";

const USAGE = `usage: flow.sh run <WT> <seat> <probe dir>   snapshot the working tree of <WT>, put seat a or b at it, copy <probe dir>/tree over it,
                                              run <probe dir>/run.sh there and print its exit and its last 40 lines
       flow.sh close <WT>                    remove the seats; safe when there is none, and when <WT> is already gone
       flow.sh begin <WT> --level <level> --source <source> [--issue <n> --parent <P>]
                                              make the run's work directory under <WT>/work-reports/ with review/ and seats/,
                                              take HEAD as the start, and write the start, the level, its source, the issue
                                              and the parent to run.json
       flow.sh status <WT> [<scope>]         print the start, the work directory, the level, its source, the issue and the
                                              parent of the run whose run.json was written last; with a scope (task-<k>,
                                              integration or merge) also its next round, whether the cap is reached, the
                                              last verdict and the open findings
       flow.sh lint <file>                   check a seat file, a reply, an evidence file or a decisions.md against
                                              review-files.md and print ok, kind and reasons; it reads the file and the
                                              files beside it
       flow.sh verify <WT> <scope>           run again every command of the scope's next round, the open earlier findings
                                              and the findings of each seat the run's level runs, sort them by the
                                              probe's exit, and write drafts/<scope>-round-<r>.md in the run's work
                                              directory
       flow.sh round <WT> <scope> <judgement file>
                                              write review/<scope>-round-<r>.md of the scope's next round from
                                              drafts/<scope>-round-<r>.md and the judgement file, with its verdict, and
                                              print its path, the verdict, the open findings and whether the cap is reached
       flow.sh record <WT>                   write the pull request head, when the run comes from an issue, and the Level:
                                              line into log.md of the newest work directory, from its run.json
       flow.sh prompt <WT> <kind> [<scope>] [<seat>]
                                              write the prompt of one sub-agent call from prompts/<kind>.md to
                                              prompts/ of the run's work directory, and print its path, agent, model
                                              and effort; report, design and decisions take no scope, work, seat, again,
                                              respond, commit and detail take one, and seat also a seat, a or b
       flow.sh decisions <WT> <pr>           file one issue labelled decision per entry of decisions.md in the newest work
                                              directory, each pointing at pull request #<pr>, skip the entries decisions.json
                                              lists as filed, and print every issue filed for the file
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
<probe dir> has to be under <WT>/work-reports/. Exit 1 means a usage error or an unexpected failure.
`;

const SKILLS = dirname(dirname(import.meta.dirname));
const PROMPTS = join(SKILLS, "workflow", "prompts");
const TAIL = 40;

type RunRecord = {
  readonly start: string;
  readonly level: string;
  readonly source: string;
  readonly issue: number | null;
  readonly parent: number | null;
};

const exists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const normPath = (path: string): string => {
  const normal = normalize(path);
  return normal.length > 1 && normal.endsWith("/") ? normal.slice(0, -1) : normal;
};

const seatPath = (wt: string, seat: string): string =>
  join(dirname(wt), `review-${basename(wt)}-${seat}`);

const lockPath = (wt: string, where: string, seat: string): string => {
  const common = git(where, ["rev-parse", "--git-common-dir"]).trim();
  return join(
    isAbsolute(common) ? common : join(where, common),
    `panel-${basename(wt)}-${seat}.lockdir`,
  );
};

const nearestCloneDir = (wt: string): string | null => {
  let where = wt;
  while (!isDirectory(where)) {
    const parent = dirname(where);
    if (parent === where) {
      return null;
    }
    where = parent;
  }
  return run(["git", "-C", where, "rev-parse", "--git-dir"]).code === 0 ? where : null;
};

const worktreesByPath = (where: string): ReadonlyMap<string, boolean> =>
  new Map(worktreeList(where).map((entry) => [realPath(entry.path), entry.prunable]));

const requireLiveWt = (wt: string): void => {
  const where = nearestCloneDir(wt);
  if (where === null || where !== wt || worktreesByPath(wt).get(realPath(wt)) !== false) {
    stop("unknown", `${wt} is no worktree of a clone`);
  }
};

const snapshot = (wt: string): string => {
  const head = git(wt, ["rev-parse", "HEAD"]).trim();
  const holder = mkdtempSync(
    join(git(wt, ["rev-parse", "--absolute-git-dir"]).trim(), "panel-index-"),
  );
  const indexEnv: RunOptions = { env: environment({ GIT_INDEX_FILE: join(holder, "index") }) };
  let tree: string;
  try {
    git(wt, ["read-tree", "HEAD"], indexEnv);
    const added = run(["git", "-C", wt, "add", "-A"], indexEnv);
    if (added.code !== 0) {
      stop("snapshot", `cannot snapshot ${wt}: ${added.stderr.trim()}`);
    }
    tree = git(wt, ["write-tree"], indexEnv).trim();
  } finally {
    rmSync(holder, { recursive: true, force: true });
  }
  const ident = environment({
    GIT_AUTHOR_NAME: "panel",
    GIT_AUTHOR_EMAIL: "panel@localhost",
    GIT_COMMITTER_NAME: "panel",
    GIT_COMMITTER_EMAIL: "panel@localhost",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  });
  return git(wt, ["commit-tree", tree, "-p", head, "-m", "review snapshot"], { env: ident }).trim();
};

const prepare = (wt: string, seat: string, snap: string): string => {
  const path = seatPath(wt, seat);
  let known = worktreesByPath(wt).get(realPath(path));
  if (known === true) {
    git(wt, ["worktree", "prune"]);
    known = undefined;
  }
  if (known === false) {
    git(path, ["checkout", "--quiet", "--force", "--detach", snap]);
    git(path, ["clean", "-fd", "--quiet"]);
  } else if (exists(path)) {
    throw new Failure(`${path} exists and is no worktree of this clone`);
  } else {
    git(wt, ["worktree", "add", "--quiet", "--detach", path, snap]);
    includeIgnored(path);
  }
  return path;
};

const SEAT_NAMES: readonly string[] = SEATS;

const runProbe = (wt: string, seat: string, given: string): StatusObject => {
  const probe = realPath(given);
  if (!SEAT_NAMES.includes(seat)) {
    throw new Failure(`no such seat: ${seat}`);
  }
  try {
    requireLiveWt(wt);
    const reports = `${realPath(join(wt, "work-reports"))}/`;
    if (!probe.startsWith(reports)) {
      stop("outside", `${probe} is not under ${reports}`);
    }
    const script = join(probe, "run.sh");
    if (!isFile(script)) {
      stop("no-script", `${probe} has no run.sh`);
    }
    const lock = lockPath(wt, wt, seat);
    if (!tryLock(lock)) {
      stop("busy", `seat ${seat} is held by another run`);
    }
    try {
      const snap = snapshot(wt);
      const path = prepare(wt, seat, snap);
      const overlay = join(probe, "tree");
      if (isDirectory(overlay)) {
        cpSync(overlay, path, { recursive: true, force: true, verbatimSymlinks: true });
      }
      const result = run(["bash", "-c", 'exec bash "$1" 2>&1', "probe", script], { cwd: path });
      const lines = splitLines(result.stdout);
      return {
        status: "ran",
        seat,
        snapshot: snap,
        exit: result.code,
        lines: lines.length,
        output: lines.slice(-TAIL).join("\n"),
      };
    } finally {
      unlock(lock);
    }
  } catch (error) {
    if (error instanceof Stopped) {
      return error.fields;
    }
    throw error;
  }
};

export const closeSeats = (wt: string): readonly string[] => {
  const where = nearestCloneDir(wt);
  if (where === null) {
    return [];
  }
  const removed: string[] = [];
  for (const seat of SEATS) {
    const path = seatPath(wt, seat);
    const known = worktreesByPath(where).get(realPath(path));
    if (known === undefined) {
      continue;
    }
    if (known) {
      git(where, ["worktree", "prune"]);
    } else {
      git(where, ["worktree", "remove", "--force", path]);
    }
    removed.push(path);
    rmSync(lockPath(wt, where, seat), { recursive: true, force: true });
  }
  return removed;
};

const begin = (wt: string, options: Readonly<Record<string, string>>): StatusObject => {
  requireLiveWt(wt);
  const ignored = run(["git", "-C", wt, "check-ignore", "-q", "work-reports/"]);
  if (ignored.code === 1) {
    stop("not-ignored", `work-reports/ is not ignored in ${wt}`);
  }
  if (ignored.code !== 0) {
    throw new Failure(`git check-ignore failed: ${ignored.stderr.trim()}`);
  }
  const start = git(wt, ["rev-parse", "HEAD"]).trim();
  const stamp = `${stampOf(new Date())}-${start.slice(0, 7)}`;
  let name = stamp;
  for (let n = 2; exists(join(wt, "work-reports", name)); n += 1) {
    name = `${stamp}-${n}`;
  }
  const workdir = join(wt, "work-reports", name);
  for (const sub of ["review", "seats"]) {
    mkdirSync(join(workdir, sub), { recursive: true });
  }
  const issue = options["--issue"];
  const parent = options["--parent"];
  const record: RunRecord = {
    start,
    level: options["--level"] ?? "",
    source: options["--source"] ?? "",
    issue: issue === undefined ? null : Number(issue),
    parent: parent === undefined ? null : Number(parent),
  };
  writeFileSync(join(workdir, "run.json"), `${JSON.stringify(record)}\n`);
  return { status: "ok", start, workdir, level: record.level, source: record.source };
};

const currentRun = (wt: string): { readonly workdir: string; readonly record: RunRecord } => {
  const root = join(wt, "work-reports");
  const runs = stampedIn(root).flatMap((name) => {
    const file = join(root, name, "run.json");
    return isFile(file) ? [{ time: statSync(file, { bigint: true }).mtimeNs, name }] : [];
  });
  const newest = runs.reduce<{ readonly time: bigint; readonly name: string } | null>(
    (best, one) =>
      best === null || one.time > best.time || (one.time === best.time && one.name > best.name)
        ? one
        : best,
    null,
  );
  if (newest === null) {
    stop("no-run", `no work directory under ${root} holds a run.json`);
  }
  const workdir = join(root, newest?.name ?? "");
  return {
    workdir,
    record: JSON.parse(readFileSync(join(workdir, "run.json"), "utf8")) as RunRecord,
  };
};

const mdFiles = (dir: string, prefix: string): readonly (readonly [string, string])[] =>
  isDirectory(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(".md") && isFile(join(dir, name)))
        .map((name) => [`${prefix}/${name}`, readFileSync(join(dir, name), "utf8")] as const)
    : [];

const workdirReview = (workdir: string): ReviewDir =>
  Object.fromEntries([
    ...mdFiles(join(workdir, "review"), "review"),
    ...mdFiles(join(workdir, "drafts"), "drafts"),
  ]);

const requireScope = (scope: string): void => {
  if (!isScope(scope)) {
    throw new Failure(`no such scope: ${scope}`);
  }
};

const status = (wt: string, scope: string | undefined): StatusObject => {
  if (scope !== undefined) {
    requireScope(scope);
  }
  const { workdir, record } = currentRun(wt);
  const state = scope === undefined ? {} : scopeState(workdirReview(workdir), scope);
  return {
    status: "ok",
    start: record.start,
    workdir,
    level: record.level,
    source: record.source,
    issue: record.issue,
    parent: record.parent,
    ...state,
  };
};

const lint = (path: string): StatusObject => {
  if (!isFile(path)) {
    stop("no-file", `${path} is no file`);
  }
  const found =
    basename(path) === DECISIONS
      ? { kind: "decisions", reasons: decisionEntries(readFileSync(path, "utf8")).reasons }
      : lintReasons(
          Object.fromEntries(mdFiles(dirname(path), "review")),
          `review/${basename(path)}`,
        );
  return { status: "ok", ok: found.reasons.length === 0, kind: found.kind, reasons: found.reasons };
};

const commandOf = (block: Block): { readonly command: string; readonly args: RunArgs | null } => {
  const got = fields(block, ["Command"])["Command"] ?? [];
  const text = got[0] ?? "";
  const quoted = got.length === 1 && text.length > 1 && text.startsWith("`") && text.endsWith("`");
  return quoted
    ? { command: text.slice(1, -1), args: runArgs(text.slice(1, -1)) }
    : { command: text, args: null };
};

const rerun = (args: RunArgs): StatusObject => runProbe(normPath(args.wt), args.seat, args.probe);

const TITLE_NUMBER = new RegExp(`^### (?:${DIGIT}+\\. )?`, "u");

const verify = (wt: string, scope: string): StatusObject => {
  requireScope(scope);
  const { workdir, record } = currentRun(wt);
  const dir = workdirReview(workdir);
  const state = scopeState(dir, scope);
  const r = state.round;
  const earlier: Record<string, unknown>[] = [];
  const added: Record<string, unknown>[] = [];
  const dropped: Record<string, unknown>[] = [];
  const dropouts: string[] = [];
  const earlierLines: string[] = [];
  const newBlocks: string[] = [];
  const droppedLines: string[] = [];
  for (const finding of state.open) {
    const id = finding.id;
    const [j = 0, n = 0] = id.slice(1).split(".").map(Number);
    const raiser = parseReview(dir, `review/${scope}-round-${j}.md`);
    const { command, args } = commandOf(section(raiser, "New findings").blocks[n - 1] ?? []);
    if (args === null) {
      throw new Failure(`${id} could not be run again: its Command is not one flow.sh run line`);
    }
    const result = rerun(args);
    if (result.status === "stop") {
      throw new Failure(`${id} could not be run again: ${String(result["message"])}`);
    }
    const exit = Number(result["exit"]);
    const output = String(result["output"]);
    const word = exit === 0 ? "resolved" : finding.stood > 0 ? "stands again" : "stands";
    earlierLines.push(
      `- ${id} ${word}: ran: \`${command}\`; saw: ${printed({ exit, output })}${finding.reply === "disagree" ? DISAGREE : ""}`,
    );
    earlier.push({ id, command, exit, output, state: word, reply: finding.reply });
  }
  for (const seat of LEVEL_SEATS[record.level] ?? []) {
    const key = `review/${scope}-round-${r}-${seat}.md`;
    if (dir[key] === undefined) {
      dropouts.push(seat);
      droppedLines.push(`- ${seat}: no seat file`);
      continue;
    }
    const gone = new Map<string, number[]>();
    section(parseReview(dir, key), "Findings").blocks.forEach((block, i) => {
      const number = i + 1;
      const title = (block[0] ?? "").replace(TITLE_NUMBER, "");
      const { command, args } = commandOf(block);
      let why: string | null;
      let result: StatusObject | null = null;
      if (args === null) {
        why = "command";
      } else {
        result = rerun(args);
        why =
          result.status === "stop"
            ? String(result["reason"])
            : Number(result["exit"]) === 0
              ? "exit-0"
              : null;
      }
      if (why !== null || result === null) {
        const reason = why ?? "command";
        gone.set(reason, [...(gone.get(reason) ?? []), number]);
        dropped.push({ seat, number, title, command, why: reason });
        return;
      }
      const id = `R${r}.${added.length + 1}`;
      const exit = Number(result["exit"]);
      const output = String(result["output"]);
      added.push({ id, seat, number, title, command, exit, output });
      newBlocks.push(
        `### ${id} ${title}\n\nFound by: ${seat}\nCommand: \`${command}\`\nPrinted: ${printed({ exit, output })}`,
      );
    });
    const lines = [...gone].map(([why, numbers]) => droppedLine(seat, why, numbers));
    droppedLines.push(...(lines.length > 0 ? lines : [`- ${seat}: none`]));
  }
  const draft = join(workdir, "drafts", `${scope}-round-${r}.md`);
  mkdirSync(dirname(draft), { recursive: true });
  writeFileSync(draft, draftText(scope, r, earlierLines, newBlocks, droppedLines));
  return { status: "ok", scope, round: r, draft, dropouts, earlier, new: added, dropped };
};

const judgementStop = (path: string, { line, why, id }: JudgementFault): StatusObject =>
  stop("judgement", `${path} line ${line}: ${why}${id === null ? "" : ` ${id}`}`, { line, why });

const round = (wt: string, scope: string, judgementPath: string): StatusObject => {
  requireScope(scope);
  const { workdir } = currentRun(wt);
  if (!isFile(judgementPath)) {
    throw new Failure(`no such file: ${judgementPath}`);
  }
  const dir = workdirReview(workdir);
  const r = scopeState(dir, scope).round;
  const key = `drafts/${scope}-round-${r}.md`;
  if (dir[key] === undefined) {
    return stop("no-draft", `no draft of round ${r} in ${join(workdir, key)}; run verify first`);
  }
  const draft = parseReview(dir, key);
  const judgement = parseJudgement(readFileSync(judgementPath, "utf8"));
  if ("why" in judgement) {
    return judgementStop(judgementPath, judgement);
  }
  const fault = judgementFault(judgement, draft);
  if (fault !== null) {
    return judgementStop(judgementPath, fault);
  }
  let verdict: "approve" | "changes-requested" = "changes-requested";
  if (judgement.keep.length === 0 && !judgement.earlier.some((entry) => entry.word === "stands")) {
    const wanted = evidenceWanted(dir, scope, r);
    if (wanted !== null) {
      const file = join(workdir, wanted);
      return stop("no-evidence", `approve needs ${file}`, { file });
    }
    verdict = "approve";
  }
  const path = join(workdir, "review", `${scope}-round-${r}.md`);
  writeFileSync(path, roundText(scope, r, draft, judgement, verdict));
  const after = scopeState(workdirReview(workdir), scope);
  return {
    status: "ok",
    round: path,
    verdict,
    open: after.open.map((finding) => finding.id),
    cap: after.cap,
  };
};

const agentOf = (kind: string, seat: string | undefined): string | null => {
  switch (kind) {
    case "work":
    case "report":
      return "workflow-worker";
    case "design":
      return "workflow-design";
    case "seat":
      return `workflow-reviewer-${seat ?? ""}`;
    case "decisions":
      return "workflow-reviewer-a";
    default:
      return null;
  }
};

const prompt = (
  wt: string,
  kind: string,
  scope: string | undefined,
  seat: string | undefined,
): StatusObject => {
  if (scope !== undefined) {
    requireScope(scope);
  }
  const { workdir, record } = currentRun(wt);
  const k = scope !== undefined && scope.startsWith("task-") ? Number(scope.slice(5)) : null;
  if (kind === "detail" && (k === null || k < 2)) {
    throw new Failure(`detail needs task-<k> with k of 2 or more: ${scope ?? "None"}`);
  }
  if (kind === "design" && record.issue === null) {
    throw new Failure("design needs a run begun with --issue");
  }
  const state = scope === undefined ? null : scopeState(workdirReview(workdir), scope);
  if (
    state !== null &&
    state.round === 1 &&
    (kind === "again" || kind === "respond" || (kind === "work" && scope === "integration"))
  ) {
    throw new Failure(`${kind} ${scope ?? ""} has no round file to name before round 1`);
  }
  const agent = agentOf(kind, seat);
  const levels = agent === null ? undefined : AGENTS[agent];
  if (agent !== null && levels?.[record.level] === undefined) {
    throw new Failure(`level ${record.level} runs no ${agent}`);
  }
  const [model, effort] = agent === null ? [null, null] : (levels?.[record.level] ?? [null, null]);
  const entries = worktreeList(wt);
  const branch = entries.find((one) => realPath(one.path) === realPath(wt))?.branch ?? null;
  const progress = git(wt, ["log", "--oneline", `${record.start}..HEAD`]).trim();
  const values: (readonly [string, string])[] = [
    ["skills", SKILLS],
    ["WT", wt],
    ["MAIN", entries[0]?.path ?? ""],
    ["branch", branch ?? "none"],
    ["WORKDIR", workdir],
    ["START", record.start],
    ["head", git(wt, ["rev-parse", "HEAD"]).trim()],
    ["progress", progress === "" ? "none" : progress],
  ];
  if (scope !== undefined && state !== null) {
    values.push(
      ["scope", scope],
      ["round", String(state.round)],
      ["last", String(state.round - 1)],
    );
  }
  if (k !== null) {
    values.push(["k", String(k)], ["prev", String(k - 1)]);
  }
  if (seat !== undefined) {
    values.push(["seat", seat]);
  }
  const holds: string[] = [];
  if (record.issue !== null) {
    values.push(["n", String(record.issue)], ["P", String(record.parent)]);
    holds.push("issue");
  }
  if (scope !== undefined && state !== null) {
    holds.push(k !== null ? "task" : scope, state.round === 1 ? "first" : "restart");
  }
  const names = [
    kind,
    ...(kind === "work" && scope === "integration" ? ["respond"] : []),
    "worktree-line",
  ];
  const parts = names.map((name) =>
    readFileSync(join(PROMPTS, `${name}.md`), "utf8").replace(/\n+$/u, ""),
  );
  const path = join(
    workdir,
    "prompts",
    `${[kind, ...[scope, seat].filter((w): w is string => w !== undefined && w !== "")].join("-")}.md`,
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${render(parts.join("\n\n"), values, holds)}\n`);
  return { status: "ok", path, agent, model, effort };
};

const HEAD_LINE = new RegExp(`^(?:Implements|Part of) #${DIGIT}+\\s*$`, "u");

const record = (wt: string): StatusObject => {
  const { workdir, record: runRecord } = currentRun(wt);
  const log = join(workdir, "log.md");
  const review = join(workdir, "review");
  if (!isFile(log)) {
    stop("no-log", `no log.md in ${workdir}`);
  }
  if (!isDirectory(review)) {
    stop("no-review", `no review/ in ${workdir}`);
  }
  const counts = recordCounts(workdirReview(workdir));
  const line = recordLine({
    level: runRecord.level,
    source: runRecord.source,
    tasks: counts.tasks,
    taskRounds: counts.taskRounds,
    integrationRounds: counts.integrationRounds,
    findings: counts.findings,
  });
  let lines = readFileSync(log, "utf8")
    .split("\n")
    .filter((one) => parseRecordLine(one.replace(/\r$/u, "")) === null);
  if (runRecord.issue !== null) {
    let first = 0;
    while (
      first < lines.length &&
      ((lines[first] ?? "").trim() === "" ||
        HEAD_LINE.test((lines[first] ?? "").replace(/\r$/u, "")))
    ) {
      first += 1;
    }
    lines = [
      `Implements #${runRecord.issue}`,
      `Part of #${runRecord.parent}`,
      "",
      ...lines.slice(first),
    ];
  }
  writeFileSync(log, `${lines.join("\n").replace(/[\r\n]+$/u, "")}\n\n${line}\n`);
  return { status: "ok", line };
};

const decisions = (wt: string, pr: number): StatusObject => {
  const { workdir } = currentRun(wt);
  const path = join(workdir, DECISIONS);
  const kept = join(workdir, DECISIONS_RECORD);
  if (!isFile(path)) {
    stop("no-decisions", `no ${DECISIONS} in ${workdir}`);
  }
  const { reasons, entries } = decisionEntries(readFileSync(path, "utf8"));
  if (reasons.length > 0) {
    stop("malformed", `${path} fails the lint: ${reasons.join(", ")}`);
  }
  let filed: readonly FiledIssue[] = isFile(kept)
    ? (JSON.parse(readFileSync(kept, "utf8")) as readonly FiledIssue[])
    : [];
  const done = new Set(filed.map((issue) => issue.title));
  const todo = entries.filter((one) => !done.has(one.title));
  if (todo.length > 0) {
    const created = run(
      [
        "gh",
        "label",
        "create",
        DECISION_LABEL.name,
        "--color",
        DECISION_LABEL.color,
        "--description",
        DECISION_LABEL.description,
      ],
      { cwd: wt },
    );
    if (created.code !== 0 && !created.stderr.includes("already exists")) {
      stop(
        "gh",
        `cannot create the label ${DECISION_LABEL.name}: ${created.stderr.trim()}; filed before: ${filedNames(filed)}`,
      );
    }
  }
  for (const one of todo) {
    const result = run(
      [
        "gh",
        "issue",
        "create",
        "--title",
        one.title,
        "--label",
        DECISION_LABEL.name,
        "--body-file",
        "-",
      ],
      { cwd: wt, input: decisionBody(one, pr) },
    );
    if (result.code !== 0) {
      stop(
        "gh",
        `cannot file ${one.title}: ${result.stderr.trim()}; filed before: ${filedNames(filed)}`,
      );
    }
    filed = [...filed, filedIssue(one, result.stdout)];
    writeFileSync(kept, `${JSON.stringify(filed)}\n`);
  }
  return { status: "ok", filed };
};

const NUMBER = /^[0-9]+$/u;
const PR_NUMBER = /^[1-9][0-9]*$/u;

const checked = (args: readonly string[]): void => {
  const [sub, , third, , fifth, , seventh, eighth, ninth, tenth] = args;
  const count = args.length;
  const ok = ((): boolean => {
    switch (sub) {
      case "run":
        return count === 4;
      case "close":
      case "lint":
      case "record":
        return count === 2;
      case "begin":
        return (
          (count === 6 || count === 10) &&
          third === "--level" &&
          (args[3] === "standard" || args[3] === "high") &&
          fifth === "--source" &&
          (args[5] === "file" || args[5] === "override" || args[5] === "default") &&
          (count === 6 ||
            (seventh === "--issue" &&
              ninth === "--parent" &&
              NUMBER.test(eighth ?? "") &&
              NUMBER.test(tenth ?? "")))
        );
      case "status":
        return count === 2 || count === 3;
      case "verify":
        return count === 3;
      case "round":
        return count === 4;
      case "prompt":
        switch (third) {
          case "report":
          case "design":
          case "decisions":
            return count === 3;
          case "work":
          case "again":
          case "respond":
          case "commit":
          case "detail":
            return count === 4;
          case "seat":
            return count === 5 && (fifth === "a" || fifth === "b");
          default:
            return false;
        }
      case "decisions":
        return count === 3 && PR_NUMBER.test(third ?? "");
      default:
        return false;
    }
  })();
  if (!ok) {
    throw new UsageError("");
  }
  const path = args[1] ?? "";
  if (!path.startsWith("/")) {
    throw new Failure(`<WT> and <file> must be absolute paths: ${path}`);
  }
  const judgement = args[3] ?? "";
  if (sub === "round" && !judgement.startsWith("/")) {
    throw new Failure(`<judgement file> must be an absolute path: ${judgement}`);
  }
};

const pairs = (options: readonly string[]): Readonly<Record<string, string>> =>
  Object.fromEntries(
    options.flatMap((option, i) => (i % 2 === 0 ? [[option, options[i + 1] ?? ""]] : [])),
  );

const dispatch = (args: readonly string[]): StatusObject => {
  const [sub = "", given = "", third, fourth, fifth] = args;
  const path = normPath(given);
  switch (sub) {
    case "run":
      return runProbe(path, third ?? "", fourth ?? "");
    case "close":
      return { status: "closed", removed: closeSeats(path) };
    case "begin":
      return begin(path, pairs(args.slice(2)));
    case "status":
      return status(path, third);
    case "lint":
      return lint(path);
    case "verify":
      return verify(path, third ?? "");
    case "round":
      return round(path, third ?? "", fourth ?? "");
    case "record":
      return record(path);
    case "prompt":
      return prompt(path, third ?? "", fourth, fifth);
    default:
      return decisions(path, Number(third));
  }
};

const main = (args: readonly string[]): string => {
  checked(args);
  return statusLine(dispatch(args));
};

entry(import.meta.url, "flow", USAGE, main);
