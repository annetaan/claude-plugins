import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { git, run } from "../../../scripts/command.ts";
import { pause } from "../../../scripts/clock.ts";
import {
  checkedOutIn,
  ensureIgnored,
  hasBranch,
  isAncestor,
  listed,
  realPath,
  revParse,
  submoduleWork,
} from "../../../scripts/clone.ts";
import { fetchBranch } from "../../../scripts/fetch.ts";
import { losses } from "../../../scripts/pure/cleanup-steps.ts";
import { requiredGh } from "../../../scripts/pure/gh-version.ts";
import { DIGIT, splitLines } from "../../../scripts/pure/text.ts";
import { projectWorktree } from "../../../scripts/pure/worktree-list.ts";
import {
  entry,
  Failure,
  statusLine,
  stop,
  UsageError,
  type StatusObject,
} from "../../../scripts/status.ts";
import { moveReports } from "../../../scripts/work-reports.ts";
import { includeIgnored } from "../../workflow/scripts/include.ts";
import {
  addWorktree,
  located,
  mergeIn,
  removeWorktree,
  WORKTREES,
  type StepError,
} from "../../workflow/scripts/worktrees.ts";
import {
  closeIssue,
  editLabels,
  fileSub,
  postComment,
  syncTitles,
} from "../../pj1-plan/scripts/issue.ts";
import { readProject, startableAfter } from "../../pj1-plan/scripts/project.ts";
import { markerProblem } from "../../pj1-plan/scripts/pure/comment-markers.ts";
import type { Project } from "../../pj1-plan/scripts/pure/project-view.ts";
import {
  checkList,
  due,
  mergeRules,
  settleDeadline,
  verdict,
  type Check,
  type JsonObject,
  type MergeRules,
  type Verdict,
} from "./pure/run-steps.ts";
import { ceilingSeconds, jobTimeouts, type JobTimeout } from "./pure/workflow-timeouts.ts";
import { triggers } from "./pure/workflow-triggers.ts";

const USAGE = `usage: run.sh start <P>                       check the clone, gh and the repository, read the project, create its base branch when due, fetch it, read the merge rules, add the ignore paths; on the way to run, assign you to the parent, and stop when someone else is assigned
       run.sh close <P> <n> --comment <file>  comment on and close #<n> as completed, when it is due. For a parent it also lists the projects that can be split now (startable)
       run.sh worktree <P> <k> <branch>       make the worktree pj-<P>-<k>-<stamp> on the tip of origin/<base> and create <branch> there; a local <branch> holding commits origin/<base> lacks stops with left, one checked out stops with checked-out, any other is deleted and made again
       run.sh end <P> <name> --since <sha>    move the work reports of the worktree <name> into <MAIN>/work-reports/; remove it and delete its branch when nothing changed since <sha>, otherwise detach its HEAD, delete its branch and keep it for the cleanup
       run.sh merge <P> <k> <m> --comment <file> [--wait <seconds>] [--ceiling <seconds>]
                                              wait for every check on #<m>, merge it into the base branch, close #<k>, remove the run's worktree when it holds no work, delete the head branch; --wait is how long to wait for a first check to register when one is expected; --ceiling is how long to wait for every check to finish, by default the job timeouts of the workflows that run on the pull request plus 30 minutes; a check still pending then stops with checks-timeout. When CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS is set above 0, the whole merge ends 5 minutes before it
       run.sh sync <P> [--push <name>]        make the worktree pj-<P>-sync-<stamp> on the tip of origin/<base>, merge origin/<from> there and push it; --push <name> pushes a merge committed in that worktree after a conflict
       run.sh pr <P> --body <file>            open the pull request from the base branch into <from>, once every sub-issue is closed and the base contains <from>
       run.sh stop <P> <k> <blocking|decision|detail|round-cap> --comment <file> [--stub <file> --title <t>]
                                              make the writes of issue.sh that the stop asks of GitHub, the comment on #<k> last: blocking files the stub under <P>, labelled blocker and blocking #<k>; decision takes ready off #<k> and syncs the titles; detail puts blocker on #<k> and takes ready off; round-cap only comments. --stub and --title go with blocking alone
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
`;

type Context = {
  readonly p: number;
  readonly args: readonly string[];
};

const project = (p: number, extra: Readonly<Record<string, unknown>> = {}): Project => {
  try {
    return readProject(p, process.cwd());
  } catch (error) {
    if (error instanceof Failure) {
      return stop("project", `project: ${error.message}`, extra);
    }
    throw error;
  }
};

const projectOrNull = (p: number): Project | null => {
  try {
    return readProject(p, process.cwd());
  } catch (error) {
    if (error instanceof Failure) {
      return null;
    }
    throw error;
  }
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const field = (value: unknown, key: string): unknown => (isObject(value) ? value[key] : undefined);

const repoView = (): JsonObject => {
  const result = run([
    "gh",
    "repo",
    "view",
    "--json",
    "nameWithOwner,hasIssuesEnabled,defaultBranchRef,viewerPermission,squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed",
  ]);
  if (result.code !== 0) {
    throw new Failure(`cannot read the repository: ${result.stderr.trim()}`);
  }
  const view = parseJson(result.stdout);
  if (!isObject(view)) {
    throw new Failure("cannot read the repository: unreadable output from gh repo view");
  }
  return view;
};

const nameWithOwner = (view: JsonObject): string => String(view["nameWithOwner"]);

const apiJson = (args: readonly string[]): unknown => {
  const result = run(["gh", "api", ...args]);
  return result.code === 0 ? (parseJson(result.stdout) ?? null) : null;
};

const CLASSIC_QUERY =
  "query($owner: String!, $name: String!, $q: String!) { repository(owner: $owner, name: $name) { " +
  "ref(qualifiedName: $q) { branchProtectionRule { requiredApprovingReviewCount " +
  "requiresCodeOwnerReviews requiresStatusChecks } } } }";

const rules = (repo: string, base: string, view: JsonObject, main: string): MergeRules => {
  const owner = repo.slice(0, repo.indexOf("/"));
  const name = repo.slice(repo.indexOf("/") + 1);
  const ruleset = apiJson([`repos/${repo}/rules/branches/${base}`]);
  const branch = apiJson([`repos/${repo}/branches/${base}`]);
  const q = apiJson([
    "graphql",
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-f",
    `q=refs/heads/${base}`,
    "-f",
    `query=${CLASSIC_QUERY}`,
  ]);
  const classic = isObject(q)
    ? field(field(field(q["data"], "repository"), "ref"), "branchProtectionRule")
    : undefined;
  const owners = run([
    "git",
    "-C",
    main,
    "ls-tree",
    "--name-only",
    `origin/${base}`,
    "--",
    "CODEOWNERS",
    ".github/CODEOWNERS",
    "docs/CODEOWNERS",
  ]);
  return mergeRules({
    ruleset: Array.isArray(ruleset) ? ruleset : null,
    protected: isObject(branch) ? branch["protected"] : undefined,
    classic: isObject(classic) ? classic : null,
    codeowners: owners.code === 0 && owners.stdout.trim() !== "",
    view,
  });
};

const pullRequestWorkflows = (
  main: string,
  ref: string,
  base: string,
): readonly (readonly JobTimeout[])[] | null => {
  const listing = run([
    "git",
    "-C",
    main,
    "ls-tree",
    "--name-only",
    ref,
    "--",
    ".github/workflows/",
  ]);
  if (listing.code !== 0) {
    return null;
  }
  const workflows: (readonly JobTimeout[])[] = [];
  for (const path of splitLines(listing.stdout)) {
    if (!path.endsWith(".yml") && !path.endsWith(".yaml")) {
      continue;
    }
    const shown = run(["git", "-C", main, "show", `${ref}:${path}`]);
    if (shown.code !== 0) {
      return null;
    }
    if (triggers(shown.stdout, base)) {
      workflows.push(jobTimeouts(shown.stdout));
    }
  }
  return workflows;
};

const issueWrite = (write: () => StatusObject): StatusObject => {
  try {
    return write();
  } catch (error) {
    if (error instanceof Failure) {
      return { status: "stop", reason: "issue-failed", message: `issue: ${error.message}` };
    }
    throw error;
  }
};

const requireMarker = (path: string): void => {
  const problem = markerProblem(path, readFileSync(path, "utf8"));
  if (problem !== null) {
    stop("no-marker", problem);
  }
};

const closeFailure = (n: number, commentFile: string): string | null => {
  const out = issueWrite(() => closeIssue(n, "completed", commentFile));
  return out.status === "stop" ? String(out["message"]) : null;
};

const NO_CHECKS = "no checks reported on the";

type Registered = { readonly n: number | null; readonly error: string | null };

type CheckRows = { readonly rows: readonly unknown[] | null; readonly error: string | null };

const readChecks = (m: number, fields: string): CheckRows => {
  const result = run(["gh", "pr", "checks", String(m), "--json", fields]);
  const found = parseJson(result.stdout);
  if (Array.isArray(found)) {
    return { rows: found, error: null };
  }
  if ((result.stdout + result.stderr).includes(NO_CHECKS)) {
    return { rows: [], error: null };
  }
  if (result.code === 0) {
    return { rows: null, error: "unreadable output from gh pr checks" };
  }
  return {
    rows: null,
    error: result.stderr.trim() || result.stdout.trim() || `gh pr checks exited ${result.code}`,
  };
};

const registered = (m: number): Registered => {
  const { rows, error } = readChecks(m, "name");
  return { n: rows === null ? null : rows.length, error };
};

type Settled =
  | { readonly kind: "unreadable"; readonly error: string }
  | { readonly kind: Verdict; readonly checks: readonly Check[] };

const checksOn = (m: number): Settled => {
  const { rows, error } = readChecks(m, "name,bucket,link");
  const checks = checkList(rows);
  if (checks === null) {
    return { kind: "unreadable", error: error ?? "unreadable output from gh pr checks" };
  }
  return { kind: verdict(checks), checks };
};

const claim = (
  p: number,
  repo: string,
  out: Readonly<Record<string, unknown>>,
): { readonly login: string; readonly added: boolean } => {
  const assignees = (me: string | null = null): readonly string[] => {
    const r = apiJson([`repos/${repo}/issues/${p}`]);
    if (r === null) {
      stop("assign-failed", `cannot read the assignees of #${p}`, {
        step: "read",
        ...(me === null ? {} : { assignee: { login: me, added: true } }),
        ...out,
      });
    }
    const list = field(r, "assignees");
    return Array.isArray(list) ? list.map((a) => String(field(a, "login"))) : [];
  };
  const others = (me: string, logins: readonly string[], added = false): void => {
    const found = logins.filter((l) => l.toLowerCase() !== me.toLowerCase());
    if (found.length > 0) {
      stop("assigned", `#${p} is assigned to ${found.join(", ")}`, {
        login: me,
        assignees: found,
        self: added || found.length < logins.length,
        ...out,
      });
    }
  };
  const login = field(apiJson(["user"]), "login");
  if (typeof login !== "string" || login === "") {
    return stop("assign-failed", "cannot read the user's login from GitHub", {
      step: "login",
      ...out,
    });
  }
  const logins = assignees();
  others(login, logins);
  if (logins.length > 0) {
    return { login, added: false };
  }
  const r = run(["gh", "issue", "edit", String(p), "--add-assignee", login]);
  if (r.code !== 0) {
    stop("assign-failed", `cannot assign ${login} to #${p}: ${r.stderr.trim()}`, {
      step: "add",
      ...out,
    });
  }
  others(login, assignees(login), true);
  return { login, added: true };
};

const start = (ctx: Context): string => {
  const main = located();
  let out: Record<string, unknown> = { main };
  if (run(["git", "-C", main, "remote", "get-url", "origin"]).code !== 0) {
    stop("no-origin", "the clone has no remote named origin", out);
  }
  const ghRun = run(["gh", "--version"]);
  if (ghRun.code === 127) {
    stop("gh", "gh is not installed", out);
  }
  const gh = requiredGh(ghRun.stdout);
  if (gh.kind === "old") {
    return stop("gh", gh.message, out);
  }
  out = { ...out, gh: gh.version };
  const auth = run(["gh", "auth", "status"]);
  if (auth.code !== 0) {
    stop("gh-auth", `gh is not logged in: ${splitLines(auth.stderr.trim()).at(-1) ?? ""}`, out);
  }
  const view = repoView();
  const repo = nameWithOwner(view);
  const defaultBranch = field(view["defaultBranchRef"], "name");
  out = { ...out, repo, defaultBranch: defaultBranch ?? null };
  if (view["hasIssuesEnabled"] !== true) {
    stop("issues-off", `issues are turned off in ${repo}`, out);
  }
  const permission = view["viewerPermission"];
  if (permission !== "WRITE" && permission !== "MAINTAIN" && permission !== "ADMIN") {
    stop(
      "permission",
      `the permission on ${repo} is ${typeof permission === "string" ? permission : "None"}, and WRITE, MAINTAIN or ADMIN is required`,
      out,
    );
  }
  if (
    !["squashMergeAllowed", "mergeCommitAllowed", "rebaseMergeAllowed"].some(
      (f) => view[f] === true,
    )
  ) {
    stop("no-merge-method", `${repo} allows no merge method`, out);
  }

  const proj = project(ctx.p, out);
  const parent = proj.parent;
  const base = parent.base;
  const summary = {
    number: parent.number,
    title: parent.title,
    base: parent.base,
    from: parent.from,
    baseExists: parent.baseExists,
    merged: parent.merged,
  };
  out = { ...out, project: summary };
  const issues = proj.issues;
  if (issues.length > 0 && issues.every((i) => i.state === "CLOSED")) {
    const close =
      parent.merged && parent.state === "OPEN"
        ? [{ number: ctx.p, title: parent.title, base, self: true }]
        : [];
    const keptDone = ensureIgnored(main, null);
    if (keptDone.status === "stop") {
      return stop(keptDone.reason, keptDone.message, {
        notIgnored: keptDone.notIgnored,
        ignored: keptDone.ignored,
        close,
        ...out,
      });
    }
    return statusLine({ status: "done", close, ignored: keptDone.ignored, ...out });
  }
  out = {
    ...out,
    close: parent.waitsOn
      .filter((d) => d.state === "OPEN" && d.merged)
      .map((d) => ({ number: d.number, title: d.title, base: d.base, self: false })),
  };
  if (issues.length === 0) {
    return statusLine({ status: "empty", ...out });
  }

  out = { ...out, created: null };
  if (!parent.baseExists) {
    if (issues.some((i) => i.pr !== null && i.pr.state === "MERGED")) {
      stop("base-gone", `${base} is gone from origin, and a pull request into it has merged`, out);
    }
    const waits = parent.waitsOn
      .filter((d) => !d.merged)
      .map((d) => ({ number: d.number, title: d.title, state: d.state, base: d.base }));
    if (waits.length > 0) {
      stop("waits", `#${ctx.p} waits on ${waits.map((d) => `#${d.number}`).join(", ")}`, {
        waits,
        ...out,
      });
    }
    const ref = apiJson([`repos/${repo}/git/ref/heads/${parent.from}`]);
    const sha = field(field(ref, "object"), "sha");
    if (typeof sha !== "string" || sha === "") {
      stop("create-failed", `cannot read the tip of ${parent.from}`, out);
    }
    const made = run([
      "gh",
      "api",
      `repos/${repo}/git/refs`,
      "-f",
      `ref=refs/heads/${base}`,
      "-f",
      `sha=${String(sha)}`,
    ]);
    if (made.code !== 0) {
      stop("create-failed", `cannot create ${base}: ${made.stderr.trim()}`, out);
    }
    out = { ...out, created: { sha }, project: { ...summary, baseExists: true } };
  }

  if (fetchBranch(main, base).code !== 0) {
    stop("fetch-failed", `cannot fetch ${base} from origin`, out);
  }

  const found = rules(repo, base, view, main);
  if (found.blockedBy.length > 0) {
    stop("self-merge", `${base} needs a review that pj4-running cannot give itself`, {
      blockedBy: found.blockedBy,
      ...out,
    });
  }
  if (found.mergeMethod === null) {
    stop("no-merge-method", `the rules on ${base} leave no merge method that ${repo} allows`, out);
  }
  const keptRun = ensureIgnored(main, null);
  if (keptRun.status === "stop") {
    return stop(keptRun.reason, keptRun.message, {
      notIgnored: keptRun.notIgnored,
      ignored: keptRun.ignored,
      ...out,
    });
  }
  const assignee = claim(ctx.p, repo, out);
  return statusLine({
    status: "run",
    rules: { selfMerge: found.selfMerge, mergeMethod: found.mergeMethod },
    ignored: keptRun.ignored,
    assignee,
    ...out,
  });
};

const close = (ctx: Context): string => {
  const n = Number(ctx.args[0]);
  const commentFile = ctx.args[2] ?? "";
  requireMarker(commentFile);
  const proj = project(ctx.p);
  const state = due(proj, n);
  const isParent = n === ctx.p || proj.parent.waitsOn.some((d) => d.number === n);
  const startable = (): ReturnType<typeof startableAfter> => {
    const source = !isParent ? null : n === ctx.p ? proj : projectOrNull(n);
    return source === null ? [] : startableAfter(source, process.cwd());
  };
  if (state === "unknown") {
    stop(
      "unknown-issue",
      `#${n} is neither #${ctx.p}, a project it waits on, nor one of its sub-issues`,
      { number: n },
    );
  }
  if (state === "not-due") {
    stop("not-due", `#${n} is not due to close`, { number: n });
  }
  if (state === "already") {
    return statusLine({
      status: "closed",
      number: n,
      already: true,
      startable: startable(),
    });
  }
  const failed = closeFailure(n, commentFile);
  if (failed !== null) {
    throw new Failure(`cannot close #${n}: ${failed}`);
  }
  return statusLine({
    status: "closed",
    number: n,
    already: false,
    startable: startable(),
  });
};

const STATUS = ["status", "--porcelain", "--untracked-files=normal"] as const;

const count = (where: string, range: string): number =>
  Number.parseInt(git(where, ["rev-list", "--count", range]).trim(), 10);

const worktree = (ctx: Context): string => {
  const k = Number(ctx.args[0]);
  const b = ctx.args[1] ?? "";
  const main = located();
  const base = project(ctx.p).parent.base;
  if (run(["git", "check-ref-format", "--branch", b]).code !== 0) {
    throw new Failure(`not a valid branch name: ${b}`);
  }
  if (fetchBranch(main, base).code !== 0) {
    stop("fetch-failed", `cannot fetch ${base} from origin`, { branch: b });
  }
  if (hasBranch(main, b)) {
    const holder = checkedOutIn(main, b);
    const ahead = count(main, `origin/${base}..${b}`);
    if (ahead > 0) {
      stop("left", `${b} holds ${ahead} commit(s) that origin/${base} does not have`, {
        worktree: holder,
        commits: ahead,
        branch: b,
      });
    }
    if (holder !== null) {
      stop("checked-out", `${b} is checked out in ${holder}`, { worktree: holder, branch: b });
    }
    git(main, ["branch", "-D", b]);
  }
  const { name, path } = addWorktree(main, `pj-${ctx.p}-${k}`, `refs/remotes/origin/${base}`);
  git(path, ["switch", "--quiet", "--no-track", "-c", b, `origin/${base}`]);
  return statusLine({
    status: "ready",
    worktree: path,
    name,
    branch: b,
    start: revParse(path, "HEAD"),
    ...includeIgnored(path),
  });
};

const removal = (
  main: string,
  path: string,
): { readonly moved: readonly string[]; readonly errors: readonly StepError[] } => {
  try {
    const removed = removeWorktree(main, path, false);
    return { moved: removed.moved, errors: removed.errors };
  } catch (error) {
    if (error instanceof Failure) {
      return { moved: [], errors: [{ step: "worktree", message: error.message }] };
    }
    throw error;
  }
};

const deleteBranch = (main: string, b: string | null): readonly StepError[] => {
  if (b === null) {
    return [];
  }
  const deleted = run(["git", "-C", main, "branch", "-D", b]);
  return deleted.code === 0 ? [] : [{ step: "branch", message: deleted.stderr.trim() }];
};

const end = (ctx: Context): string => {
  const name = ctx.args[0] ?? "";
  const given = ctx.args[2] ?? "";
  const main = located();
  const named = projectWorktree(name);
  if (named === null || named.p !== ctx.p) {
    throw new Failure(`${name} is no worktree name of project #${ctx.p}`);
  }
  const path = join(main, WORKTREES, name);
  if (listed(main, path) !== false) {
    throw new Failure(`${path} is no live worktree of this clone`);
  }
  if (
    run(["git", "-C", path, "merge-base", "--is-ancestor", `${given}^{commit}`, "HEAD"]).code !== 0
  ) {
    throw new Failure(`${given} is no commit, or no ancestor of HEAD in ${path}`);
  }
  const since = revParse(path, `${given}^{commit}`);
  const moved = moveReports(main, path);
  const commits = count(path, `${since}..HEAD`);
  const changes = splitLines(git(path, STATUS));
  const symbolic = run(["git", "-C", path, "symbolic-ref", "--quiet", "--short", "HEAD"]);
  const held = symbolic.code === 0 ? symbolic.stdout.trim() : null;
  if (commits === 0 && changes.length === 0) {
    const removed = removal(main, path);
    return statusLine({
      status: "removed",
      name,
      moved: [...moved, ...removed.moved],
      errors: [...removed.errors, ...deleteBranch(main, held)],
    });
  }
  const detached = run(["git", "-C", path, "update-ref", "--no-deref", "HEAD", "HEAD"]);
  return statusLine({
    status: "kept",
    name,
    worktree: path,
    moved,
    head: revParse(path, "HEAD"),
    commits,
    changes: changes.slice(0, 20),
    errors: [
      ...(detached.code === 0 ? [] : [{ step: "detach", message: detached.stderr.trim() }]),
      ...deleteBranch(main, held),
    ],
  });
};

const isRunWorktree = (main: string, holder: string, p: number, k: number): boolean => {
  const named = projectWorktree(basename(holder));
  return (
    named !== null &&
    named.p === p &&
    named.k === k &&
    dirname(realPath(holder)) === realPath(join(main, WORKTREES))
  );
};

const leaveRun = (
  main: string,
  holder: string,
): {
  readonly worktree: { readonly name: string; readonly moved: readonly string[] } | null;
  readonly errors: readonly StepError[];
} => {
  try {
    const lost = losses({
      dirty: splitLines(git(holder, ["status", "--porcelain"])).length > 0,
      submodules: submoduleWork(holder).length > 0,
      branch: null,
      detached: false,
    });
    if (lost.length > 0) {
      return {
        worktree: null,
        errors: [{ step: "worktree", message: `${holder} holds ${lost.join(", ")}, so it stays` }],
      };
    }
    const removed = removeWorktree(main, holder, false);
    return {
      worktree: { name: basename(holder), moved: removed.moved },
      errors: removed.errors.map((e) => ({ step: "worktree", message: e.message })),
    };
  } catch (error) {
    if (error instanceof Failure) {
      return { worktree: null, errors: [{ step: "worktree", message: error.message }] };
    }
    throw error;
  }
};

const waitForChecks = (m: number, wait: number): Registered => {
  const deadline = performance.now() + wait * 1000;
  for (;;) {
    const found = registered(m);
    const left = deadline - performance.now();
    if ((found.n !== null && found.n > 0) || left <= 0) {
      return found;
    }
    pause(Math.min(10_000, left));
  }
};

const settle = (m: number, deadline: number): Settled => {
  for (;;) {
    const found = checksOn(m);
    const left = deadline - performance.now();
    if (found.kind !== "pending" || left <= 0) {
      return found;
    }
    pause(Math.min(10_000, left));
  }
};

const MERGE_FLAGS: readonly string[] = ["--wait", "--ceiling"];

const mergeFlags = (rest: readonly string[]): Readonly<Record<string, string>> => {
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i] ?? "";
    const value = rest[i + 1];
    if (value === undefined || !MERGE_FLAGS.includes(flag) || flag in flags) {
      throw new UsageError("");
    }
    flags[flag] = value;
  }
  return flags;
};

const checkNames = (checks: readonly Check[], buckets: readonly string[]): string =>
  checks
    .filter((c) => buckets.includes(c.bucket))
    .map((c) => `${c.name} ${c.link}`.trim())
    .join(", ");

const merge = (ctx: Context): string => {
  const start = performance.now();
  const k = Number(ctx.args[0]);
  const m = Number(ctx.args[1]);
  const comment = ctx.args[3] ?? "";
  const flags = mergeFlags(ctx.args.slice(4));
  const wait = Number(flags["--wait"] ?? 300);
  const given = flags["--ceiling"];
  requireMarker(comment);
  const proj = project(ctx.p);
  const issue = proj.issues.find((i) => i.number === k);
  if (issue === undefined) {
    throw new Failure(`#${k} is not a sub-issue of #${ctx.p}`);
  }
  const pr = issue.pr;
  if (pr === null || pr.number !== m) {
    stop("not-the-pr", `#${m} is not the pull request project.sh reports for #${k}`, {
      pr: pr?.number ?? null,
    });
  }
  const main = located();
  const base = proj.parent.base;
  const view = repoView();
  const found = rules(nameWithOwner(view), base, view, main);
  const read = run([
    "gh",
    "pr",
    "view",
    String(m),
    "--json",
    "reviewDecision,mergeStateStatus,isDraft,headRefName,state",
  ]);
  if (read.code !== 0) {
    throw new Failure(`cannot read #${m}: ${read.stderr.trim()}`);
  }
  const pv = parseJson(read.stdout);
  const b = String(field(pv, "headRefName"));

  const mergedEarlier = pr?.state === "MERGED";
  if (!mergedEarlier) {
    const decision = field(pv, "reviewDecision");
    if (decision === "REVIEW_REQUIRED" || decision === "CHANGES_REQUESTED") {
      stop("review", `#${m} has review decision ${decision}`, { pr: m });
    }
    if (field(pv, "mergeStateStatus") === "DIRTY") {
      stop("conflict", `#${m} conflicts with ${base}`, { pr: m });
    }
    const method = found.mergeMethod;
    if (method === null) {
      return stop(
        "no-merge-method",
        `the rules on ${base} leave no merge method that ${nameWithOwner(view)} allows`,
        { pr: m },
      );
    }
    if (fetchBranch(main, b).code !== 0) {
      stop("checks-unreadable", `cannot fetch ${b} from origin to read its workflows`, { pr: m });
    }
    const workflows = pullRequestWorkflows(main, `origin/${b}`, base);
    if (workflows === null) {
      return stop("checks-unreadable", `cannot read the workflows on origin/${b}`, { pr: m });
    }
    if (found.requiredChecks !== "no" || workflows.length > 0) {
      const checks = waitForChecks(m, wait);
      if (checks.n === null) {
        stop("checks-unreadable", `cannot read the checks on #${m}: ${checks.error ?? ""}`, {
          pr: m,
        });
      }
      if (checks.n === 0 && found.requiredChecks === "yes") {
        stop(
          "no-checks",
          `${base} requires a check, and none registered on #${m} within ${wait} seconds`,
          { pr: m },
        );
      }
    }
    const settleStart = performance.now();
    const settled = settle(
      m,
      settleDeadline({
        start,
        settleStart,
        ceilingSeconds: given === undefined ? ceilingSeconds(workflows) : Number(given),
        driverMs: process.env["CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS"],
      }),
    );
    if (settled.kind === "unreadable") {
      stop("checks-unreadable", `cannot read the checks on #${m}: ${settled.error}`, { pr: m });
    } else if (settled.kind === "fail") {
      stop(
        "checks-failed",
        `checks failed on #${m}: ${checkNames(settled.checks, ["fail", "cancel"])}`,
        { pr: m },
      );
    } else if (settled.kind === "pending") {
      stop(
        "checks-timeout",
        `checks on #${m} still pending after ${Math.round((performance.now() - settleStart) / 60_000)} minutes: ${checkNames(settled.checks, ["pending"])}`,
        { pr: m },
      );
    }
    if (field(pv, "isDraft") === true) {
      const ready = run(["gh", "pr", "ready", String(m)]);
      if (ready.code !== 0) {
        stop("merge-failed", `cannot mark #${m} ready: ${ready.stderr.trim()}`, { pr: m });
      }
    }
    const merged = run(["gh", "pr", "merge", String(m), `--${method}`]);
    if (merged.code !== 0) {
      stop("merge-failed", `cannot merge #${m}: ${merged.stderr.trim()}`, { pr: m });
    }
  }

  const errors: StepError[] = [];
  let closed: string;
  if (issue.state === "CLOSED") {
    closed = "already-closed";
  } else {
    const failed = closeFailure(k, comment);
    if (failed === null) {
      closed = "closed";
    } else {
      errors.push({ step: "close", message: failed });
      closed = "open";
    }
  }

  const holder = checkedOutIn(main, b);
  const left =
    holder !== null && isRunWorktree(main, holder, ctx.p, k) ? leaveRun(main, holder) : null;
  errors.push(...(left?.errors ?? []));
  let local = "absent";
  if (left !== null && left.worktree === null) {
    local = "kept";
  } else if (hasBranch(main, b)) {
    const deleted = run(["git", "-C", main, "branch", "-D", b]);
    if (deleted.code === 0) {
      local = "deleted";
    } else {
      local = "kept";
      errors.push({ step: "delete-local", message: deleted.stderr.trim() });
    }
  }
  const pushed = run(["git", "-C", main, "push", "--quiet", "origin", "--delete", b]);
  let remote: string;
  if (pushed.code === 0) {
    remote = "deleted";
  } else if (pushed.stderr.includes("remote ref does not exist")) {
    remote = "absent";
  } else {
    remote = "kept";
    errors.push({ step: "delete-remote", message: pushed.stderr.trim() });
  }
  return statusLine({
    status: "merged",
    pr: m,
    branch: { name: b, local, remote },
    method: mergedEarlier ? null : found.mergeMethod,
    mergedEarlier,
    issue: closed,
    worktree: left?.worktree ?? null,
    errors,
  });
};

type Write = { readonly step: string; readonly write: () => StatusObject };

const stopIssue = (ctx: Context): string => {
  const k = Number(ctx.args[0]);
  const why = ctx.args[1] ?? "";
  const comment = ctx.args[3] ?? "";
  requireMarker(comment);
  const proj = project(ctx.p);
  if (!proj.issues.some((i) => i.number === k)) {
    stop("unknown-issue", `#${k} is not a sub-issue of #${ctx.p}`, { number: k });
  }
  const writes: readonly Write[] = [
    ...(why === "blocking"
      ? [
          {
            step: "sub",
            write: () =>
              fileSub(ctx.p, {
                title: ctx.args[7] ?? "",
                body: ctx.args[5] ?? "",
                blockedBy: [],
                blocking: k,
                label: "blocker",
              }),
          },
        ]
      : why === "decision"
        ? [
            { step: "label", write: () => editLabels(k, [], ["ready"]) },
            { step: "titles", write: () => syncTitles(ctx.p) },
          ]
        : why === "detail"
          ? [{ step: "label", write: () => editLabels(k, ["blocker"], ["ready"]) }]
          : []),
    { step: "comment", write: () => postComment(k, comment) },
  ];
  let found: Readonly<Record<string, unknown>> = {};
  for (const { step, write } of writes) {
    const out = issueWrite(write);
    if (step === "sub" && "number" in out) {
      found = { ...found, stub: { number: out["number"], url: out["url"] } };
    }
    if (out.status === "stop") {
      stop(String(out["reason"]), String(out["message"]), {
        step,
        ...found,
        ...("reasons" in out ? { reasons: out["reasons"] } : {}),
      });
    }
  }
  return statusLine({ status: "stopped", number: k, ...found });
};

const syncWorktree = (main: string, p: number, name: string): string => {
  const named = projectWorktree(name);
  const path = join(main, WORKTREES, name);
  if (named === null || named.p !== p || named.k !== null || listed(main, path) !== false) {
    throw new Failure(`${name} is no sync worktree of project #${p} in this clone`);
  }
  return path;
};

const sync = (ctx: Context): string => {
  const main = located();
  const proj = project(ctx.p);
  const { parent, issues } = proj;
  const base = parent.base;
  const frm = parent.from;
  const out = { base, from: frm };
  if (parent.merged) {
    stop("merged", `#${ctx.p} is merged into ${frm}`, out);
  }
  if (issues.length === 0 || issues.some((i) => i.state === "OPEN")) {
    stop("not-due", `#${ctx.p} has open sub-issues, or none at all`, out);
  }
  if (!parent.baseExists) {
    stop("base-gone", `${base} is gone from origin`, out);
  }
  if (fetchBranch(main, base).code !== 0 || fetchBranch(main, frm).code !== 0) {
    stop("fetch-failed", `cannot fetch ${base} and ${frm} from origin`, out);
  }
  const tip = revParse(main, `origin/${base}`);
  const given = ctx.args[1];
  let path: string;
  let made: Readonly<Record<string, unknown>>;
  if (given !== undefined) {
    path = syncWorktree(main, ctx.p, given);
    made = { worktree: path, name: given };
    if (
      run(["git", "-C", path, "rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).code === 0 ||
      git(path, ["status", "--porcelain"]).trim() !== ""
    ) {
      stop("unfinished", `${path} still holds an unfinished merge or uncommitted changes`, out);
    }
    const parents = git(path, ["rev-list", "--parents", "-n", "1", "HEAD"])
      .trim()
      .split(/\s+/u)
      .slice(1);
    if (
      parents.length !== 2 ||
      parents[0] !== tip ||
      !isAncestor(path, parents[1] ?? "", `origin/${frm}`)
    ) {
      stop(
        "not-the-merge",
        `HEAD is not a merge of origin/${frm} on the tip of origin/${base}`,
        out,
      );
    }
  } else {
    const added = addWorktree(main, `pj-${ctx.p}-sync`, `refs/remotes/origin/${base}`);
    path = added.path;
    made = { worktree: path, name: added.name, ...includeIgnored(path) };
    if (isAncestor(main, `origin/${frm}`, `origin/${base}`)) {
      return statusLine({ status: "current", sha: tip, ...out, ...made });
    }
    const merged = mergeIn(path, `refs/remotes/origin/${frm}`, `Merge ${frm} into ${base}`);
    if (merged.kind === "conflict") {
      return statusLine({ status: "conflict", start: tip, files: merged.files, ...out, ...made });
    }
  }
  const sha = revParse(path, "HEAD");
  const pushed = run(["git", "-C", path, "push", "--quiet", "origin", `HEAD:refs/heads/${base}`]);
  if (pushed.code !== 0) {
    stop("push-rejected", `cannot push the merge to ${base}: ${pushed.stderr.trim()}`, {
      sha,
      start: tip,
      worktree: path,
      name: made["name"],
      ...out,
    });
  }
  fetchBranch(main, base);
  return statusLine({ status: "merged", sha, ...out, ...made });
};

const PULL_NUMBER = new RegExp(`/pull/(${DIGIT}+)$`, "u");

const projectPr = (ctx: Context): string => {
  const body = ctx.args[1] ?? "";
  const main = located();
  const proj = project(ctx.p);
  const { parent, issues } = proj;
  const base = parent.base;
  const frm = parent.from;
  const out = { base, from: frm };
  if (parent.merged) {
    stop("merged", `#${ctx.p} is merged into ${frm}`, out);
  }
  if (issues.length === 0 || issues.some((i) => i.state === "OPEN")) {
    stop("not-due", `#${ctx.p} has open sub-issues, or none at all`, out);
  }
  if (!parent.baseExists) {
    stop("base-gone", `${base} is gone from origin`, out);
  }
  if (fetchBranch(main, base).code !== 0 || fetchBranch(main, frm).code !== 0) {
    stop("fetch-failed", `cannot fetch ${base} and ${frm} from origin`, out);
  }
  if (!isAncestor(main, `origin/${frm}`, `origin/${base}`)) {
    stop("behind", `${base} does not contain origin/${frm}. run.sh sync ${ctx.p} first`, out);
  }
  const listed_ = run([
    "gh",
    "pr",
    "list",
    "--head",
    base,
    "--base",
    frm,
    "--state",
    "open",
    "--json",
    "number,url",
  ]);
  if (listed_.code !== 0) {
    throw new Failure(`cannot list the pull requests from ${base}: ${listed_.stderr.trim()}`);
  }
  const prs = parseJson(listed_.stdout);
  const found = (Array.isArray(prs) ? prs : [])
    .map((pr) => ({ number: Number(field(pr, "number")), url: field(pr, "url") }))
    .toSorted((a, b) => a.number - b.number);
  const first = found[0];
  if (first !== undefined) {
    return statusLine({ status: "exists", pr: first.number, url: first.url, ...out });
  }
  const created = run([
    "gh",
    "pr",
    "create",
    "--base",
    frm,
    "--head",
    base,
    "--title",
    parent.title,
    "--body-file",
    body,
  ]);
  if (created.code !== 0) {
    stop(
      "create-failed",
      `cannot open the pull request from ${base} into ${frm}: ${created.stderr.trim()}`,
      out,
    );
  }
  const url = splitLines(created.stdout.trim()).at(-1) ?? "";
  const m = PULL_NUMBER.exec(url);
  return statusLine({ status: "opened", pr: m === null ? null : Number(m[1]), url, ...out });
};

const isNumber = (text: string | undefined): boolean =>
  text !== undefined && /^[0-9]+$/u.test(text);

const number = (what: string, text: string | undefined): void => {
  if (!isNumber(text)) {
    throw new Failure(`${what} must be a number: ${text ?? ""}`);
  }
};

const existing = (path: string | undefined): void => {
  if (path === undefined || !isFile(path)) {
    throw new Failure(`no such file: ${path ?? ""}`);
  }
};

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const usage = (ok: boolean): void => {
  if (!ok) {
    throw new UsageError("");
  }
};

const checkedMergeFlags = (rest: readonly string[]): void => {
  const flags = mergeFlags(rest);
  if (flags["--wait"] !== undefined) {
    number("the wait in seconds", flags["--wait"]);
  }
  if (flags["--ceiling"] !== undefined) {
    number("the ceiling in seconds", flags["--ceiling"]);
  }
};

const checked = (argv: readonly string[]): void => {
  const n = argv.length;
  usage(n >= 2);
  number("the project", argv[1]);
  switch (argv[0]) {
    case "start":
      usage(n === 2);
      return;
    case "worktree":
      usage(n === 4);
      number("the issue", argv[2]);
      return;
    case "end":
      usage(n === 5 && argv[3] === "--since");
      return;
    case "close":
      usage(n === 5 && argv[3] === "--comment");
      number("the issue", argv[2]);
      existing(argv[4]);
      return;
    case "merge":
      usage((n === 6 || n === 8 || n === 10) && argv[4] === "--comment");
      number("the issue", argv[2]);
      number("the pull request", argv[3]);
      existing(argv[5]);
      checkedMergeFlags(argv.slice(6));
      return;
    case "sync":
      usage(n === 2 || (n === 4 && argv[2] === "--push"));
      return;
    case "pr":
      usage(n === 4 && argv[2] === "--body");
      existing(argv[3]);
      return;
    case "stop":
      usage((n === 6 || n === 10) && argv[4] === "--comment");
      number("the issue", argv[2]);
      existing(argv[5]);
      if (argv[3] === "blocking") {
        usage(n === 10 && argv[6] === "--stub" && argv[8] === "--title");
        existing(argv[7]);
      } else {
        usage(
          (argv[3] === "decision" || argv[3] === "detail" || argv[3] === "round-cap") && n === 6,
        );
      }
      return;
    default:
      usage(false);
  }
};

const SUBCOMMANDS: Readonly<Record<string, (ctx: Context) => string>> = {
  start,
  close,
  worktree,
  end,
  merge,
  sync,
  pr: projectPr,
  stop: stopIssue,
};

const main = (argv: readonly string[]): string => {
  checked(argv);
  const sub = SUBCOMMANDS[argv[0] ?? ""];
  if (sub === undefined) {
    throw new UsageError("");
  }
  return sub({ p: Number(argv[1]), args: argv.slice(2) });
};

entry(import.meta.url, "run", USAGE, main);
