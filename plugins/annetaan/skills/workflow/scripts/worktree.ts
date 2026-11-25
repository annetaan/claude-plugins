import { lstatSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  checkedOutIn,
  hasBranch,
  hasSubmodules,
  ignoreCheck,
  isAncestor,
  listed,
  mainWorktree,
  onOrigin,
  realPath,
  revParse,
  submoduleWork,
  worktreeList,
  type SubmoduleWork,
} from "../../../scripts/clone.ts";
import { git, run } from "../../../scripts/command.ts";
import { fetchBranch, fetchFromOrigin, withCloneLock } from "../../../scripts/fetch.ts";
import { losses, updateStep, type UpdateStep } from "../../../scripts/pure/cleanup-steps.ts";
import { atLeast, ghVersion } from "../../../scripts/pure/gh-version.ts";
import { oldReports, REPORTS_KEPT, stampOf } from "../../../scripts/pure/reports.ts";
import { splitLines } from "../../../scripts/pure/text.ts";
import { entry, Failure, statusLine, stop, UsageError } from "../../../scripts/status.ts";
import {
  deleteReports,
  incomingReports,
  moveReports,
  reportsIn,
  stampedIn,
  type ReportError,
} from "../../../scripts/work-reports.ts";
import { closeSeats } from "./flow.ts";
import { includeIgnored } from "./include.ts";

const USAGE = `usage: worktree.sh start                          check the clone, gh and the repository
       worktree.sh create <base>                  fetch origin/<base> and add a detached worktree wf-<stamp> on its tip,
                                                  copy into it the ignored files <MAIN>/.worktreeinclude lists, and print
                                                  copied, notIgnored and the unlisted ignored files
       worktree.sh ignore <name> [--add]          whether .claude/worktrees/ and work-reports/ are ignored; --add writes them to info/exclude
       worktree.sh sync <name> <base>             whether HEAD of the worktree <name> conflicts with origin/<base>; on a conflict, start the merge
       worktree.sh pr [<number>]                  the open pull request <number>, or the open pull requests of the user that conflict
       worktree.sh list                           the wf-* worktrees of this clone with the state of their pull request
       worktree.sh check <name>                   what cleanup would do for the worktree <name>
       worktree.sh cleanup <name> [--discard]     move the work reports out, remove the worktree, delete the branch, fast-forward the base.
                                                  --discard removes work that nothing else holds. It also deletes the old reports
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
`;

type Pr = {
  readonly number: number;
  readonly state: string;
  readonly url: string;
  readonly title: string;
  readonly base: string;
  readonly headSha: string;
};

type StepError = { readonly step: string; readonly message: string };

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const exists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

const located = (): string => {
  const main = mainWorktree();
  if (main === null) {
    return stop("not-a-repo", "not inside a git repository");
  }
  return main;
};

const wtRoot = (main: string): string => join(main, ".claude/worktrees");

const wfNames = (main: string): readonly string[] => {
  const root = realPath(wtRoot(main));
  return worktreeList(main)
    .slice(1)
    .map((e) => realPath(e.path))
    .filter((real) => dirname(real) === root && basename(real).startsWith("wf-"))
    .map((real) => basename(real))
    .toSorted(byName);
};

const resolveName = (main: string, name: string): string => {
  if (!/^wf-[A-Za-z0-9._-]+$/.test(name) || !wfNames(main).includes(name)) {
    stop("unknown", `${name} is no wf-* worktree of this clone`);
  }
  return join(wtRoot(main), name);
};

const pullRequest = (
  main: string,
  branch: string,
): { readonly pr: Pr | null; readonly err: string | null } => {
  const r = run(
    [
      "gh",
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--json",
      "number,state,url,title,baseRefName,headRefOid",
    ],
    { cwd: main },
  );
  if (r.code !== 0) {
    return { pr: null, err: r.stderr.trim() || r.stdout.trim() || `gh pr list exited ${r.code}` };
  }
  type Listed = {
    readonly number: number;
    readonly state: string;
    readonly url: string;
    readonly title: string;
    readonly baseRefName: string;
    readonly headRefOid: string;
  };
  let found: readonly Listed[];
  try {
    found = JSON.parse(r.stdout) as readonly Listed[];
  } catch {
    return { pr: null, err: "unreadable output from gh pr list" };
  }
  const p = found.toSorted(
    (a, b) => Number(b.state === "OPEN") - Number(a.state === "OPEN") || b.number - a.number,
  )[0];
  if (p === undefined) {
    return { pr: null, err: null };
  }
  return {
    pr: {
      number: p.number,
      state: p.state.toLowerCase(),
      url: p.url,
      title: p.title,
      base: p.baseRefName,
      headSha: p.headRefOid,
    },
    err: null,
  };
};

const headContains = (main: string, tip: string, pr: Pr): boolean => {
  const head = pr.headSha;
  if (run(["git", "-C", main, "cat-file", "-e", `${head}^{commit}`]).code !== 0) {
    if (fetchFromOrigin(main, [`refs/pull/${pr.number}/head`]).code !== 0) {
      stop("fetch-failed", `cannot fetch the head of pull request #${pr.number} from origin`);
    }
  }
  return isAncestor(main, tip, head);
};

const start = (): string => {
  const main = mainWorktree();
  if (main === null) {
    return stop("not-a-repo", "not inside a git repository");
  }
  if (run(["git", "-C", main, "remote", "get-url", "origin"]).code !== 0) {
    stop("no-origin", "the clone has no remote named origin", { main });
  }
  const ghRun = run(["gh", "--version"]);
  if (ghRun.code === 127) {
    stop("gh", "gh is not installed", { main });
  }
  const v = ghVersion(ghRun.stdout);
  const out = {
    main,
    gh: v === null ? null : v.join("."),
    attach: v !== null && atLeast(v, [2, 99, 0]),
  };
  const auth = run(["gh", "auth", "status"]);
  if (auth.code !== 0) {
    stop("gh-auth", `gh is not logged in: ${splitLines(auth.stderr.trim()).at(-1) ?? ""}`, out);
  }
  const view = run(["gh", "repo", "view", "--json", "nameWithOwner,defaultBranchRef"], {
    cwd: main,
  });
  if (view.code !== 0) {
    stop("repo", `cannot read the repository on GitHub: ${view.stderr.trim()}`, out);
  }
  const repo = JSON.parse(view.stdout) as {
    readonly defaultBranchRef?: { readonly name?: string } | null;
  };
  return statusLine({
    status: "ok",
    main,
    mainBranch: worktreeList(main)[0]?.branch ?? null,
    defaultBranch: repo.defaultBranchRef?.name ?? null,
    gh: out.gh,
    attach: out.attach,
  });
};

const create = (base: string): string => {
  const main = located();
  if (run(["git", "check-ref-format", "--branch", base]).code !== 0) {
    throw new Failure(`not a valid branch name: ${base}`);
  }
  if (fetchBranch(main, base).code !== 0) {
    if (onOrigin(main, base) === false) {
      stop("base-missing", `origin has no branch ${base}`, { base });
    }
    stop("fetch-failed", `cannot fetch ${base} from origin`, { base });
  }
  const stamp = `wf-${stampOf(new Date())}`;
  const { name, wt } = withCloneLock(main, () => {
    let found = stamp;
    for (let n = 2; exists(join(wtRoot(main), found)) || wfNames(main).includes(found); n += 1) {
      found = `${stamp}-${n}`;
    }
    const path = join(wtRoot(main), found);
    git(main, ["worktree", "add", "--quiet", "--detach", path, `refs/remotes/origin/${base}`]);
    return { name: found, wt: path };
  });
  return statusLine({
    status: "ready",
    main,
    worktree: wt,
    name,
    base,
    head: revParse(wt, "HEAD"),
    ...includeIgnored(wt),
  });
};

const ignore = (name: string, add: boolean): string => {
  const main = located();
  return statusLine(ignoreCheck(main, resolveName(main, name), add));
};

const listRuns = (): string => {
  const main = located();
  const trees = new Map(worktreeList(main).map((e) => [realPath(e.path), e.branch]));
  const runs = wfNames(main).map((name) => {
    const path = join(wtRoot(main), name);
    const branch = trees.get(realPath(path)) ?? null;
    if (branch === null) {
      return { name, path, branch, state: "no-pr", pr: null };
    }
    const { pr, err } = pullRequest(main, branch);
    if (err !== null) {
      return { name, path, branch, state: "error", pr: null, error: err };
    }
    return pr === null
      ? { name, path, branch, state: "no-pr", pr: null }
      : { name, path, branch, state: pr.state, pr };
  });
  return statusLine({ status: "ok", main, worktrees: runs });
};

type Tree = {
  path: string;
  state: string;
  changes?: readonly string[];
  reports?: readonly string[];
  submodules?: readonly SubmoduleWork[];
  hasSubmodules?: boolean;
  seats?: readonly string[];
  moved?: readonly string[];
  action?: string;
};

type Branch = {
  name: string;
  local: string;
  remote: string;
  why?: string;
  worktree?: string;
};

type Update = UpdateStep | { readonly action: "updated" | "not-updated" };

type Plan = {
  main: string;
  name: string;
  state: string;
  pr: Pr | null;
  base: string | null;
  worktree: Tree;
  branch: Branch | null;
  loses: readonly string[];
  update: Update;
  oldReports: {
    path: string;
    keep: number;
    names: readonly string[];
    deleted?: readonly string[];
  };
};

const plan = (name: string): Plan => {
  const main = located();
  const wt = resolveName(main, name);
  const prunable = listed(main, wt);
  const trees = worktreeList(main);
  const branch = trees.find((e) => realPath(e.path) === realPath(wt))?.branch ?? null;

  let pr: Pr | null = null;
  if (branch !== null) {
    const found = pullRequest(main, branch);
    if (found.err !== null) {
      stop("gh", `cannot read the pull requests of ${branch}: ${found.err}`);
    }
    pr = found.pr;
  }
  const state = pr === null ? "no-pr" : pr.state;
  if (pr !== null && state === "open") {
    stop("open", `the pull request #${pr.number} of ${branch ?? ""} is still open`, { pr });
  }
  const base = pr === null ? null : pr.base;

  let tree: Tree;
  if (prunable === true) {
    tree = { path: wt, state: "prunable" };
  } else {
    const changes = splitLines(git(wt, ["status", "--porcelain"]));
    tree = {
      path: wt,
      state: changes.length > 0 ? "dirty" : "clean",
      changes: changes.slice(0, 20),
      reports: reportsIn(wt),
      submodules: submoduleWork(wt),
      hasSubmodules: hasSubmodules(wt),
    };
  }

  let br: Branch | null = null;
  let commitFacts = null;
  if (branch !== null) {
    const remote = onOrigin(main, branch);
    if (remote === null) {
      stop("fetch-failed", "cannot read the branches on origin");
    }
    const local: Branch = {
      name: branch,
      local: "delete",
      remote: remote === true ? "present" : "absent",
    };
    const holder = trees.find(
      (e) => e.branch === branch && realPath(e.path) !== realPath(wt),
    )?.path;
    const tip = hasBranch(main, branch) ? revParse(main, `refs/heads/${branch}`) : null;
    if (holder !== undefined) {
      Object.assign(local, { local: "keep", why: "checked-out", worktree: holder });
    } else if (state === "merged" && tip !== null && pr !== null && !headContains(main, tip, pr)) {
      Object.assign(local, { local: "keep", why: "unpushed" });
    }
    br = local;
    let heldOnOrigin = false;
    if (state === "no-pr" && tip !== null) {
      const held = run([
        "git",
        "-C",
        main,
        "for-each-ref",
        "--format=%(refname)",
        "--contains",
        tip,
        "refs/remotes/origin",
      ]).stdout.split(/\s+/);
      heldOnOrigin = held.some((h) => h !== "" && h !== `refs/remotes/origin/${branch}`);
    }
    commitFacts = { state, tip, heldOnOrigin };
  }
  const loses = losses({
    dirty: tree.state === "dirty",
    submodules: (tree.submodules ?? []).length > 0,
    branch: commitFacts,
  });

  let update: Update = { action: "none" };
  if (state === "merged" && base !== null) {
    if (fetchBranch(main, base).code !== 0) {
      stop("fetch-failed", `cannot fetch ${base} from origin`);
    }
    const target = revParse(main, `refs/remotes/origin/${base}`);
    const holderPath = checkedOutIn(main, base);
    const holder = holderPath !== null && realPath(holderPath) === realPath(wt) ? null : holderPath;
    const tip = hasBranch(main, base) ? revParse(main, `refs/heads/${base}`) : null;
    update = updateStep({
      tip,
      target,
      tipIsAncestor: tip !== null && tip !== target && isAncestor(main, tip, target),
      holder,
    });
  }

  return {
    main,
    name,
    state,
    pr,
    base,
    worktree: tree,
    branch: br,
    loses,
    update,
    oldReports: {
      path: join(main, "work-reports"),
      keep: REPORTS_KEPT,
      names: oldReports(stampedIn(join(main, "work-reports")), incomingReports(main, wt)),
    },
  };
};

const check = (name: string): string => statusLine({ status: "ok", ...plan(name) });

const seatsOf = (
  path: string,
): { readonly seats: readonly string[]; readonly error: StepError | null } => {
  try {
    return { seats: closeSeats(path), error: null };
  } catch (error) {
    if (error instanceof Failure) {
      return { seats: [], error: { step: "seats", message: `flow: ${error.message}` } };
    }
    throw error;
  }
};

const cleanup = (name: string, discard: boolean): string => {
  const out = plan(name);
  const { main } = out;
  if (out.loses.length > 0 && !discard) {
    stop("discard", `${name} holds work that nothing else holds: ${out.loses.join(", ")}`, out);
  }
  const tree = out.worktree;
  const errors: (StepError | ReportError)[] = [];
  const br = out.branch;

  const seats = seatsOf(tree.path);
  tree.seats = seats.seats;
  if (seats.error !== null) {
    errors.push(seats.error);
  }

  if (tree.state === "prunable") {
    git(main, ["worktree", "prune"]);
    tree.action = "pruned";
  } else {
    tree.moved = moveReports(main, tree.path);
    const force =
      (discard && tree.state === "dirty") || tree.hasSubmodules === true ? ["--force"] : [];
    git(main, ["worktree", "remove", ...force, tree.path]);
    tree.action = "removed";
  }

  if (br !== null) {
    if (br.local === "delete") {
      const r = run(["git", "-C", main, "branch", "-D", br.name]);
      if (r.code === 0) {
        br.local = "deleted";
      } else {
        br.local = "keep";
        errors.push({ step: "local-branch", message: r.stderr.trim() });
      }
    }
    if (br.remote === "present") {
      const r = run(["git", "-C", main, "push", "--quiet", "origin", "--delete", br.name]);
      if (r.code === 0 || r.stderr.includes("remote ref does not exist")) {
        br.remote = r.code === 0 ? "deleted" : "absent";
      } else {
        errors.push({ step: "remote-branch", message: r.stderr.trim() });
      }
    }
    run(["git", "-C", main, "update-ref", "-d", `refs/remotes/origin/${br.name}`]);
  }

  const update = out.update;
  if (update.action === "fast-forward" && out.base !== null) {
    const r =
      update.worktree === null
        ? run(["git", "-C", main, "update-ref", `refs/heads/${out.base}`, update.to, update.from])
        : run([
            "git",
            "-C",
            update.worktree,
            "merge",
            "--ff-only",
            "--quiet",
            `origin/${out.base}`,
          ]);
    if (r.code === 0) {
      out.update = { ...update, action: "updated" };
    } else {
      out.update = { ...update, action: "not-updated" };
      errors.push({ step: "update", message: (r.stderr || r.stdout).trim() });
    }
  }

  out.oldReports.names = oldReports(stampedIn(join(main, "work-reports")));
  const deleted = deleteReports(main, out.oldReports.names);
  out.oldReports.deleted = deleted.deleted;
  errors.push(...deleted.errors);
  return statusLine({ status: "done", errors, ...out });
};

const sync = (name: string, base: string): string => {
  const main = located();
  const wt = resolveName(main, name);
  const out = { base };
  if (run(["git", "-C", wt, "rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).code === 0) {
    stop("unfinished", `${wt} holds an unfinished merge`, out);
  }
  if (git(wt, ["status", "--porcelain"]).trim() !== "") {
    stop("dirty", `${wt} has uncommitted changes`, out);
  }
  if (fetchBranch(main, base).code !== 0) {
    stop("fetch-failed", `cannot fetch ${base} from origin`, out);
  }
  const head = revParse(wt, "HEAD");
  const incoming = `refs/remotes/origin/${base}`;
  if (isAncestor(wt, incoming, "HEAD")) {
    return statusLine({ status: "current", sha: head, ...out });
  }
  const tree = run([
    "git",
    "-C",
    wt,
    "merge-tree",
    "--write-tree",
    "--name-only",
    "HEAD",
    incoming,
  ]);
  if (tree.code !== 0 && tree.code !== 1) {
    throw new Failure(`git merge-tree failed: ${tree.stderr.trim()}`);
  }
  const behind = Number.parseInt(git(wt, ["rev-list", "--count", `HEAD..${incoming}`]).trim(), 10);
  if (tree.code === 0) {
    return statusLine({ status: "clean", sha: head, behind, ...out });
  }
  const merged = run(["git", "-C", wt, "merge", "--no-ff", `origin/${base}`]);
  const files = splitLines(git(wt, ["diff", "--name-only", "--diff-filter=U"]));
  if (merged.code === 0 || files.length === 0) {
    run(["git", "-C", wt, "merge", "--abort"]);
    throw new Failure(
      `git merge origin/${base} did not stop on the conflicts merge-tree found: ${(merged.stderr || merged.stdout).trim()}`,
    );
  }
  return statusLine({ status: "conflict", start: head, files, behind, ...out });
};

const prInfo = (main: string, number: number): Readonly<Record<string, unknown>> => {
  const r = run(
    [
      "gh",
      "pr",
      "view",
      String(number),
      "--json",
      "number,state,url,title,headRefName,baseRefName,isCrossRepository",
    ],
    { cwd: main },
  );
  if (r.code !== 0) {
    stop("unknown", `cannot read pull request #${number}: ${r.stderr.trim()}`);
  }
  const p = JSON.parse(r.stdout) as {
    readonly number: number;
    readonly state: string;
    readonly url: string;
    readonly title: string;
    readonly headRefName: string;
    readonly baseRefName: string;
    readonly isCrossRepository: boolean;
  };
  const info = {
    number: p.number,
    url: p.url,
    title: p.title,
    head: p.headRefName,
    base: p.baseRefName,
    project: null as number | null,
  };
  if (p.state !== "OPEN") {
    stop("not-open", `pull request #${p.number} is ${p.state.toLowerCase()}`, { pr: info });
  }
  if (p.isCrossRepository) {
    stop(
      "fork",
      `pull request #${p.number} comes from a fork, and its branch cannot be pushed from here`,
      { pr: info },
    );
  }
  const project = /^pj\/(\d+)$/.exec(p.headRefName)?.[1];
  if (project !== undefined) {
    const labels = run(["gh", "issue", "view", project, "--json", "labels"], { cwd: main });
    if (
      labels.code === 0 &&
      (
        JSON.parse(labels.stdout) as { readonly labels: readonly { readonly name: string }[] }
      ).labels.some((l) => l.name === "project")
    ) {
      info.project = Number(project);
    }
  }
  return info;
};

const pr = (number: string | undefined): string => {
  const main = located();
  if (number !== undefined) {
    if (!/^\d+$/.test(number)) {
      throw new Failure(`not a pull request number: ${number}`);
    }
    return statusLine({ status: "ok", pr: prInfo(main, Number(number)) });
  }
  const r = run(
    [
      "gh",
      "pr",
      "list",
      "--author",
      "@me",
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,url,headRefName,baseRefName,mergeable",
    ],
    { cwd: main },
  );
  if (r.code !== 0) {
    stop("gh", `cannot list the open pull requests: ${r.stderr.trim()}`);
  }
  const listedPrs = JSON.parse(r.stdout) as readonly {
    readonly number: number;
    readonly title: string;
    readonly url: string;
    readonly headRefName: string;
    readonly baseRefName: string;
    readonly mergeable: string;
  }[];
  const candidates = listedPrs
    .filter((p) => p.mergeable === "CONFLICTING")
    .map((p) => ({
      number: p.number,
      title: p.title,
      url: p.url,
      head: p.headRefName,
      base: p.baseRefName,
    }))
    .toSorted((a, b) => a.number - b.number);
  return statusLine({ status: "pick", candidates });
};

const main = (args: readonly string[]): string => {
  const [sub, first, second, ...rest] = args;
  const count = args.length;
  if ((sub === "start" || sub === "list") && count === 1) {
    return sub === "start" ? start() : listRuns();
  }
  if (sub === "create" && count === 2 && first !== undefined) {
    return create(first);
  }
  if (sub === "check" && count === 2 && first !== undefined) {
    return check(first);
  }
  if (
    sub === "ignore" &&
    first !== undefined &&
    (count === 2 || (count === 3 && second === "--add"))
  ) {
    return ignore(first, count === 3);
  }
  if (sub === "sync" && count === 3 && first !== undefined && second !== undefined) {
    return sync(first, second);
  }
  if (sub === "pr" && count <= 2) {
    return pr(first);
  }
  if (
    sub === "cleanup" &&
    first !== undefined &&
    rest.length === 0 &&
    (count === 2 || (count === 3 && second === "--discard"))
  ) {
    return cleanup(first, count === 3);
  }
  throw new UsageError("");
};

entry(import.meta.url, "worktree", USAGE, main);
