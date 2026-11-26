import { join } from "node:path";
import {
  ensureIgnored,
  isAncestor,
  onOrigin,
  revParse,
  worktreeList,
} from "../../../scripts/clone.ts";
import { git, run } from "../../../scripts/command.ts";
import { fetchBranch } from "../../../scripts/fetch.ts";
import { requiredGh } from "../../../scripts/pure/gh-version.ts";
import { splitLines } from "../../../scripts/pure/text.ts";
import { entry, Failure, statusLine, stop, UsageError } from "../../../scripts/status.ts";
import { includeIgnored } from "./include.ts";
import { newestProposal, type OpenPull, proposalBranch } from "./pure/proposal.ts";
import {
  addWorktree,
  listedNames,
  located,
  mergeIn,
  removeWorktree,
  WORKTREES,
} from "./worktrees.ts";

const USAGE = `usage: worktree.sh start                          check the clone, gh and the repository
       worktree.sh create <base> --kind run|propose
                                                  fetch origin/<base> and add a detached worktree run-<stamp> or propose-<stamp> on its tip,
                                                  add .claude/worktrees/ and work-reports/ to info/exclude when it lacks them,
                                                  copy into it the ignored files <MAIN>/.worktreeinclude lists, and print
                                                  ignored, copied, notIgnored and the unlisted ignored files
       worktree.sh sync <name> <base>             whether HEAD of the run-* worktree <name> conflicts with origin/<base>; on a conflict, start the merge
       worktree.sh pr [<number>]                  the open pull request <number>, or the open pull requests of the user that conflict
       worktree.sh proposal <prefix> <base>       the newest open pull request into <base> from a branch <prefix>/*, or null
       worktree.sh propose <name> <base> --prefix <prefix> --path <path> --subject <subject> --title <title> --body <file>
                                                  in the propose-* worktree <name>, commit <path> alone on <prefix>/<stamp>,
                                                  push it and open a pull request into <base>
Every subcommand prints one JSON object with "status" and exits 0. "stop" carries "reason" and "message".
Exit 1 means a usage error or an unexpected failure.
`;

type Kind = "run" | "propose";

const resolveName = (main: string, name: string, kind: Kind): string => {
  if (
    !new RegExp(`^${kind}-[A-Za-z0-9._-]+$`, "u").test(name) ||
    !listedNames(main, `${kind}-`).includes(name)
  ) {
    stop("unknown", `${name} is no ${kind}-* worktree of this clone`);
  }
  return join(main, WORKTREES, name);
};

const start = (): string => {
  const main = located();
  if (run(["git", "-C", main, "remote", "get-url", "origin"]).code !== 0) {
    stop("no-origin", "the clone has no remote named origin", { main });
  }
  const ghRun = run(["gh", "--version"]);
  if (ghRun.code === 127) {
    stop("gh", "gh is not installed", { main });
  }
  const gh = requiredGh(ghRun.stdout);
  if (gh.kind === "old") {
    return stop("gh", gh.message, { main });
  }
  const out = { main, gh: gh.version };
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
  });
};

const create = (base: string, kind: Kind): string => {
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
  const { name, path: wt } = addWorktree(main, kind, `refs/remotes/origin/${base}`);
  const kept = ensureIgnored(main, wt);
  if (kept.status === "stop") {
    removeWorktree(main, wt, false);
    return stop(kept.reason, kept.message, {
      notIgnored: kept.notIgnored,
      ignored: kept.ignored,
      base,
    });
  }
  return statusLine({
    status: "ready",
    main,
    worktree: wt,
    name,
    base,
    head: revParse(wt, "HEAD"),
    ignored: kept.ignored,
    ...includeIgnored(wt),
  });
};

const sync = (name: string, base: string): string => {
  const main = located();
  const wt = resolveName(main, name, "run");
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
  const merged = mergeIn(wt, `origin/${base}`, null);
  if (merged.kind === "merged") {
    throw new Failure(
      `git merge origin/${base} did not stop on the conflicts merge-tree found: it committed ${merged.sha}`,
    );
  }
  return statusLine({ status: "conflict", start: head, files: merged.files, behind, ...out });
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

const openPulls = (main: string, base: string): readonly OpenPull[] => {
  const r = run(
    [
      "gh",
      "pr",
      "list",
      "--state",
      "open",
      "--base",
      base,
      "--limit",
      "100",
      "--json",
      "number,url,headRefName",
    ],
    { cwd: main },
  );
  if (r.code !== 0) {
    throw new Failure(`cannot list the open pull requests into ${base}: ${r.stderr.trim()}`);
  }
  try {
    return JSON.parse(r.stdout) as readonly OpenPull[];
  } catch {
    throw new Failure(`gh pr list printed what is not JSON: ${r.stdout.trim()}`);
  }
};

const proposal = (prefix: string, base: string): string =>
  statusLine({ status: "ok", pr: newestProposal(prefix, openPulls(located(), base)) });

const PROPOSE_FLAGS = ["--prefix", "--path", "--subject", "--title", "--body"] as const;

type ProposeFlags = { readonly [K in (typeof PROPOSE_FLAGS)[number]]: string };

const proposeFlags = (rest: readonly string[]): ProposeFlags => {
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i] ?? "";
    const value = rest[i + 1];
    if (
      value === undefined ||
      !(PROPOSE_FLAGS as readonly string[]).includes(flag) ||
      flags.has(flag)
    ) {
      throw new UsageError("");
    }
    flags.set(flag, value);
  }
  const value = (flag: (typeof PROPOSE_FLAGS)[number]): string => {
    const v = flags.get(flag);
    if (v === undefined) {
      throw new UsageError(`missing ${flag}`);
    }
    return v;
  };
  return {
    "--prefix": value("--prefix"),
    "--path": value("--path"),
    "--subject": value("--subject"),
    "--title": value("--title"),
    "--body": value("--body"),
  };
};

const opened = (branch: string, number: number, url: string): string =>
  statusLine({ status: "opened", branch, number, url });

const viewedPull = (
  wt: string,
  branch: string,
): { readonly number: number; readonly url: string } | null => {
  const view = run(["gh", "pr", "view", branch, "--json", "number,url"], { cwd: wt });
  if (view.code !== 0) {
    return null;
  }
  try {
    return JSON.parse(view.stdout) as { readonly number: number; readonly url: string };
  } catch {
    return null;
  }
};

const propose = (name: string, base: string, flags: ProposeFlags): string => {
  const main = located();
  const prefix = flags["--prefix"];
  const path = flags["--path"];
  const branch = proposalBranch(prefix, name);
  if (branch === null || !listedNames(main, "propose-").includes(name)) {
    throw new Failure(`${name} is no propose-* worktree of this clone`);
  }
  const wt = join(main, WORKTREES, name);
  git(wt, ["add", "-f", "--", path]);
  const same = run([
    "git",
    "-C",
    wt,
    "diff",
    "--cached",
    "--quiet",
    `refs/remotes/origin/${base}`,
    "--",
    path,
  ]);
  if (same.code === 0) {
    git(wt, ["reset", "--quiet", "--", path]);
    return stop("unchanged", `${path} is the same as on origin/${base}`);
  }
  if (same.code !== 1) {
    throw new Failure(`git diff --cached failed: ${same.stderr.trim()}`);
  }
  git(wt, ["checkout", "--quiet", "-b", branch]);
  git(wt, ["commit", "--quiet", "-m", flags["--subject"], "--", path]);
  const open = newestProposal(prefix, openPulls(main, base));
  if (open !== null) {
    return stop("exists", `pull request #${open.number} from a ${prefix}/* branch is open`, {
      number: open.number,
      url: open.url,
      branch,
    });
  }
  const push = run(["git", "-C", wt, "push", "--quiet", "-u", "origin", branch]);
  if (push.code !== 0) {
    return stop("push-failed", push.stderr.trim(), { branch });
  }
  const create = run(
    [
      "gh",
      "pr",
      "create",
      "--base",
      base,
      "--head",
      branch,
      "--title",
      flags["--title"],
      "--body-file",
      flags["--body"],
    ],
    { cwd: wt },
  );
  if (create.code === 0) {
    const url = splitLines(create.stdout.trim()).at(-1) ?? "";
    const number = /\/pull\/(\d+)/.exec(url)?.[1];
    if (number === undefined) {
      throw new Failure(`gh pr create printed no pull request URL: ${create.stdout.trim()}`);
    }
    return opened(branch, Number(number), url);
  }
  const found = viewedPull(wt, branch);
  return found === null
    ? stop("create-failed", create.stderr.trim(), { branch })
    : opened(branch, found.number, found.url);
};

const main = (args: readonly string[]): string => {
  const [sub, first, second, third] = args;
  const count = args.length;
  if (sub === "start" && count === 1) {
    return start();
  }
  if (
    sub === "create" &&
    count === 4 &&
    first !== undefined &&
    second === "--kind" &&
    (third === "run" || third === "propose")
  ) {
    return create(first, third);
  }
  if (sub === "sync" && count === 3 && first !== undefined && second !== undefined) {
    return sync(first, second);
  }
  if (sub === "pr" && count <= 2) {
    return pr(first);
  }
  if (sub === "proposal" && count === 3 && first !== undefined && second !== undefined) {
    return proposal(first, second);
  }
  if (sub === "propose" && first !== undefined && second !== undefined) {
    return propose(first, second, proposeFlags(args.slice(3)));
  }
  throw new UsageError("");
};

entry(import.meta.url, "worktree", USAGE, main);
