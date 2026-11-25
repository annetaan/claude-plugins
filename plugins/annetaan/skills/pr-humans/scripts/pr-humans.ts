import {
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "../../../scripts/command.ts";
import { entry, Failure, UsageError, type Output } from "../../../scripts/status.ts";
import {
  bySessionStart,
  humanTurns,
  matchReports,
  matchSession,
  type Session,
} from "./pure/gather.ts";
import {
  type GraphqlIssue,
  type GraphqlPullRequest,
  issueView,
  type LinkedIssue,
  linkedIssueNumbers,
  pullRequestView,
  withoutParents,
} from "./pure/github.ts";
import { knownValues, lint } from "./pure/privacy.ts";
import {
  type GraphqlComment,
  MARKER,
  pickRecord,
  previousBody,
  type RestComment,
} from "./pure/record.ts";
import {
  chooseTargets,
  parseNumber,
  parseTargets,
  type PullRequestNode,
  type PullRequestRow,
  recordRow,
} from "./pure/targets.ts";

const USAGE = `pr-humans.sh: gather what the pr-humans skill needs, and post its comment.

Subcommands (each prints one JSON object on stdout; exit 2 is a usage error, 1 an unexpected failure):

  targets [N | A-B ...] [--project P] [--search Q] [--all] [--unrecorded]
      Resolve pull requests. Numbers and ranges name them directly. --project P takes the pull requests that close
      the sub-issues of parent issue P, and those from its base branch pj/P. --search Q passes Q to the GitHub
      search (for example "author:@me created:>=2026-10-01"). --all takes every pull request. --unrecorded keeps
      only those with no pr-humans comment, and alone it means --all --unrecorded.

  gather N --out DIR
      Write DIR/github.json (the pull request, its commits, reviews and comments, the issues it closes with their
      parents and the checkbox ticks in their edit history, each tick with the heading it sits under),
      DIR/sessions.json (the Claude Code sessions on this machine that touch it, with their working directories,
      the pull requests they linked in order, and what the human said and answered in each), DIR/reports.json (the
      log.md of each work report that names it) and, only when this account already recorded the pull request, DIR/previous.md
      (that comment without its marker line). Runs of pr-humans itself are left out of the sessions' turns. Prints
      a summary, with "previous": true or false.

  sessions-of FILE
      Print the human turns of one session log, as gather does. For tests and for a look by hand.

  post N DIR
      Create the pr-humans comment on pull request N with the body in DIR/comment.md, or rewrite this account's own
      when there is one. Refuses (exit 3, status stop, problems named) a body that holds a local path, a session id
      or an @mention, or any path or id that DIR/sessions.json, DIR/reports.json, DIR itself or $HOME holds
      (local-path, session-id, mention), and when only another account recorded the pull request
      (recorded-by-other), and a DIR with no comment.md or an empty one (no-draft). In each case nothing is written.

Each pull request that targets lists comes with "recordedBy": "me", "other" or null (who left the marker comment);
"recorded" stays and means recordedBy is "me". --unrecorded keeps those with recordedBy null.

Environment: PR_HUMANS_PROJECTS overrides ~/.claude/projects (tests).
`;

const ISSUE_FIELDS = `number title url state author{login} body
  labels(first:10){nodes{name}}
  userContentEdits(first:100){nodes{editor{login} editedAt diff}}
  comments(first:50){nodes{author{login} body createdAt}}`;

const ISSUE_QUERY = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){
          issue(number:$n){${ISSUE_FIELDS} parent{${ISSUE_FIELDS}}}}}`;

const PULL_REQUEST_QUERY = `query($owner:String!,$name:String!,$n:Int!){viewer{login} repository(owner:$owner,name:$name){
      pullRequest(number:$n){number title url state merged mergedAt closedAt createdAt
        author{login} mergedBy{login} headRefName baseRefName body
        commits(first:100){nodes{commit{oid messageHeadline message committedDate parents{totalCount}
          authors(first:5){nodes{name user{login}}}}}}
        reviews(first:50){nodes{author{login} state body submittedAt
          comments(first:50){nodes{path body}}}}
        comments(first:100){nodes{author{login} body createdAt}}
        closingIssuesReferences(first:10){nodes{number}}
        timelineItems(first:100,itemTypes:[CLOSED_EVENT,MERGED_EVENT,REOPENED_EVENT,READY_FOR_REVIEW_EVENT,
          REVIEW_REQUESTED_EVENT,LABELED_EVENT]){nodes{__typename
          ... on ClosedEvent{actor{login} createdAt} ... on MergedEvent{actor{login} createdAt}
          ... on ReopenedEvent{actor{login} createdAt} ... on ReadyForReviewEvent{actor{login} createdAt}
          ... on LabeledEvent{actor{login} createdAt label{name}}}}}}}`;

const PULL_REQUESTS_QUERY = `query($owner:String!,$name:String!,$after:String){viewer{login} repository(owner:$owner,name:$name){
      pullRequests(first:50,after:$after,orderBy:{field:CREATED_AT,direction:ASC}){
        pageInfo{hasNextPage endCursor}
        nodes{number title state url comments(last:100){nodes{author{login} body}}}}}}`;

const ONE_PULL_REQUEST_QUERY = `query($owner:String!,$name:String!,$n:Int!){viewer{login}
              repository(owner:$owner,name:$name){
              issueOrPullRequest(number:$n){__typename ... on PullRequest{
                number title state url comments(last:100){nodes{author{login} body}}}}}}`;

const PROJECT_QUERY = `query($owner:String!,$name:String!,$n:Int!){repository(owner:$owner,name:$name){
      issue(number:$n){subIssues(first:50){nodes{number
        closedByPullRequestsReferences(first:10,includeClosedPrs:true){nodes{number}}}}}}}`;

type Viewer = { readonly viewer?: { readonly login: string | null } | null };

const printed = (value: unknown): string => `${JSON.stringify(value, null, 1)}\n`;

const stopped = (number: number, problems: readonly string[]): Output => ({
  out: printed({ number, status: "stop", problems }),
  code: 3,
});

const gh = (args: readonly string[], input?: string): string => {
  const argv = ["gh", ...args];
  const result = run(argv, input === undefined ? {} : { input });
  if (result.code !== 0) {
    throw new Failure(
      `${argv.slice(0, input === undefined ? 3 : 4).join(" ")}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
};

const ghJson = <T>(args: readonly string[]): T => JSON.parse(gh(args) || "null") as T;

const graphql = <T>(
  query: string,
  variables: Readonly<Record<string, string | number>>,
  tolerate: boolean,
): T | null => {
  const argv = ["gh", "api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    argv.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
  }
  const result = run(argv);
  let parsed: {
    readonly data?: T | null;
    readonly errors?: readonly { readonly type?: string }[] | null;
  };
  try {
    parsed = JSON.parse(result.stdout || "{}") as typeof parsed;
  } catch {
    throw new Failure(`gh api graphql: ${result.stderr.trim()}`);
  }
  const errors = (parsed.errors ?? []).filter((error) => !tolerate || error.type !== "NOT_FOUND");
  const data = parsed.data ?? null;
  if (errors.length > 0 || (result.code !== 0 && data === null)) {
    throw new Failure(errors.length > 0 ? JSON.stringify(errors) : result.stderr.trim());
  }
  return data;
};

const repo = (): readonly [string, string] => {
  const full = ghJson<{ readonly nameWithOwner: string }>([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
  ]).nameWithOwner;
  const slash = full.indexOf("/");
  return [full.slice(0, slash), full.slice(slash + 1)];
};

const prNumbers = (args: readonly string[]): readonly number[] =>
  (ghJson<readonly { readonly number: number }[] | null>([...args, "--json", "number"]) ?? []).map(
    (pr) => pr.number,
  );

const projectPullRequests = (owner: string, name: string, parent: number): readonly number[] => {
  type Data = {
    readonly repository?: {
      readonly issue?: {
        readonly subIssues: {
          readonly nodes: readonly {
            readonly closedByPullRequestsReferences: {
              readonly nodes: readonly { readonly number: number }[];
            };
          }[];
        };
      } | null;
    } | null;
  };
  const issue = graphql<Data>(PROJECT_QUERY, { owner, name, n: parent }, true)?.repository?.issue;
  if (issue === null || issue === undefined) {
    throw new Failure(`#${parent} is not an issue`);
  }
  return [
    ...issue.subIssues.nodes.flatMap((sub) =>
      sub.closedByPullRequestsReferences.nodes.map((pr) => pr.number),
    ),
    ...["--base", "--head"].flatMap((flag) =>
      prNumbers(["pr", "list", "--state", "all", "--limit", "200", flag, `pj/${parent}`]),
    ),
  ];
};

const recordedByNumber = (
  owner: string,
  name: string,
  numbers: readonly number[],
): ReadonlyMap<number, PullRequestRow> => {
  type Data = Viewer & {
    readonly repository?: {
      readonly issueOrPullRequest?: (PullRequestNode & { readonly __typename: string }) | null;
    } | null;
  };
  let me: string | null = null;
  const nodes: PullRequestNode[] = [];
  for (const n of numbers) {
    const data = graphql<Data>(ONE_PULL_REQUEST_QUERY, { owner, name, n }, true);
    me = data?.viewer?.login || me;
    const node = data?.repository?.issueOrPullRequest;
    if (node?.__typename === "PullRequest") {
      nodes.push(node);
    }
  }
  return new Map(nodes.map((node) => [node.number, recordRow(node, me)]));
};

const recordedAll = (owner: string, name: string): ReadonlyMap<number, PullRequestRow> => {
  type Data = Viewer & {
    readonly repository: {
      readonly pullRequests: {
        readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
        readonly nodes: readonly PullRequestNode[];
      };
    };
  };
  let me: string | null = null;
  const nodes: PullRequestNode[] = [];
  let after: string | null = null;
  for (;;) {
    const variables: Readonly<Record<string, string>> =
      after === null || after === "" ? { owner, name } : { owner, name, after };
    const data: Data | null = graphql<Data>(PULL_REQUESTS_QUERY, variables, false);
    if (data === null) {
      throw new Failure("gh api graphql: no data");
    }
    me = data.viewer?.login || me;
    const page = data.repository.pullRequests;
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) {
      break;
    }
    after = page.pageInfo.endCursor;
  }
  return new Map(nodes.map((node) => [node.number, recordRow(node, me)]));
};

const targets = (argv: readonly string[]): Output => {
  const parsed = parseTargets(argv);
  if ("usage" in parsed) {
    throw new UsageError(parsed.usage);
  }
  const [owner, name] = repo();
  const numbers = new Set(parsed.numbers);
  if (parsed.project !== null) {
    for (const n of projectPullRequests(owner, name, parsed.project)) {
      numbers.add(n);
    }
  }
  if (parsed.search !== null) {
    const found = prNumbers([
      "pr",
      "list",
      "--state",
      "all",
      "--limit",
      "1000",
      "--search",
      parsed.search,
    ]);
    for (const n of found) {
      numbers.add(n);
    }
  }
  const sorted = [...numbers].toSorted((a, b) => a - b);
  const info = parsed.all ? recordedAll(owner, name) : recordedByNumber(owner, name, sorted);
  const chosen = chooseTargets(sorted, info, parsed.all, parsed.unrecorded);
  return printed({
    repo: `${owner}/${name}`,
    prs: chosen.prs,
    notPullRequests: chosen.notPullRequests,
  });
};

const readText = (path: string): string => readFileSync(path, "utf8").replace(/\r\n?/gu, "\n");

const listed = (dir: string): readonly string[] => {
  try {
    return readdirSync(dir)
      .filter((name) => !name.startsWith("."))
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
};

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const sessionLogs = (base: string): readonly string[] =>
  listed(base)
    .flatMap((dir) => listed(dir).filter((path) => path.endsWith(".jsonl")))
    .toSorted();

const reportLogs = (root: string): readonly string[] =>
  [
    ...listed(join(root, "work-reports")).toSorted(),
    ...listed(join(root, ".claude", "worktrees"))
      .flatMap((worktree) => listed(join(worktree, "work-reports")))
      .toSorted(),
  ].flatMap((dir) => {
    const log = join(dir, "log.md");
    return isFile(log) ? [log] : [];
  });

const readable = (
  paths: readonly string[],
): readonly { readonly file: string; readonly text: string }[] =>
  paths.flatMap((file) => {
    try {
      return [{ file, text: readText(file) }];
    } catch {
      return [];
    }
  });

const cloneRoot = (): string | null => {
  const top = run(["git", "rev-parse", "--show-toplevel"]);
  const root = top.code === 0 ? top.stdout.trim() : "";
  if (root === "") {
    return null;
  }
  const common = run([
    "git",
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]).stdout.trim();
  return common.endsWith("/.git") ? common.slice(0, -5) : root;
};

const linkedIssues = (
  owner: string,
  name: string,
  pr: GraphqlPullRequest,
): readonly LinkedIssue[] => {
  type Data = { readonly repository?: { readonly issue?: GraphqlIssue | null } | null };
  return withoutParents(
    linkedIssueNumbers(pr).flatMap((n) => {
      const issue = graphql<Data>(ISSUE_QUERY, { owner, name, n }, true)?.repository?.issue;
      if (issue === null || issue === undefined) {
        return [];
      }
      const parent = issue.parent ?? null;
      return [{ ...issueView(issue), parent: parent === null ? null : issueView(parent) }];
    }),
  );
};

const gather = (argv: readonly string[]): Output => {
  const n = argv.length === 3 && argv[1] === "--out" ? parseNumber(argv[0] ?? "") : null;
  const out = argv[2];
  if (n === null || out === undefined) {
    throw new UsageError("usage: gather N --out DIR");
  }
  const [owner, name] = repo();
  const root = cloneRoot();
  type Data = Viewer & {
    readonly repository: {
      readonly pullRequest:
        | (GraphqlPullRequest & {
            readonly comments: { readonly nodes: readonly GraphqlComment[] };
          })
        | null;
    };
  };
  const data = graphql<Data>(PULL_REQUEST_QUERY, { owner, name, n }, false);
  const pr = data?.repository.pullRequest ?? null;
  if (pr === null) {
    throw new Failure(`#${n} is not a pull request`);
  }
  const me = data?.viewer?.login ?? null;
  const view = pullRequestView(pr, linkedIssues(owner, name, pr));
  const base = process.env["PR_HUMANS_PROJECTS"] || join(homedir(), ".claude", "projects");
  const found: Session[] = [];
  for (const path of sessionLogs(base)) {
    let raw: string;
    try {
      raw = readText(path);
    } catch {
      continue;
    }
    const session = matchSession({ path, raw }, view, `${owner}/${name}`, root);
    if (session !== null) {
      found.push(session);
    }
  }
  const sessions = bySessionStart(found);
  const reports = root === null ? [] : matchReports(readable(reportLogs(root)), view);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "github.json"), JSON.stringify(view, null, 1));
  writeFileSync(join(out, "sessions.json"), JSON.stringify(sessions, null, 1));
  writeFileSync(join(out, "reports.json"), JSON.stringify(reports, null, 1));
  const previous = previousBody(pr.comments.nodes, me);
  const previousPath = join(out, "previous.md");
  if (previous === null) {
    rmSync(previousPath, { force: true });
  } else {
    writeFileSync(previousPath, previous);
  }
  return printed({
    number: n,
    title: view.title,
    state: view.state,
    url: view.url,
    dir: out,
    previous: previous !== null,
    issues: view.issues.map((issue) => issue.number),
    parents: [
      ...new Set(
        view.issues.flatMap((issue) => (issue.parent === null ? [] : [issue.parent.number])),
      ),
    ].toSorted((a, b) => a - b),
    humanCommits: view.humanCommits.length,
    sessions: sessions.length,
    humanTurns: sessions.reduce((sum, session) => sum + session.turns.length, 0),
    reports: reports.length,
  });
};

const sessionsOf = (argv: readonly string[]): Output => {
  const [file] = argv;
  if (argv.length !== 1 || file === undefined) {
    throw new UsageError("usage: sessions-of FILE");
  }
  let log: string;
  try {
    log = readText(file);
  } catch (error) {
    throw new Failure(
      `cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const { talk: _talk, cwds: _cwds, ...shown } = humanTurns(log);
  return printed(shown);
};

const parsedFile = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const post = (argv: readonly string[]): Output => {
  const n = argv.length === 2 ? parseNumber(argv[0] ?? "") : null;
  const dir = argv[1];
  if (n === null || dir === undefined) {
    throw new UsageError("usage: post N DIR");
  }
  let isDirectory: boolean;
  try {
    isDirectory = statSync(dir).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    throw new UsageError(`usage: post N DIR (not a directory: ${dir})`);
  }
  let body: string;
  try {
    body = readText(join(dir, "comment.md")).trim();
  } catch {
    body = "";
  }
  if (body === "") {
    return stopped(n, ["no-draft"]);
  }
  const known = knownValues({
    home: homedir(),
    dirs: [resolve(dir), realpathSync(dir)],
    sessions: parsedFile(join(dir, "sessions.json")),
    reports: parsedFile(join(dir, "reports.json")),
  });
  const problems = lint(body, known);
  if (problems.length > 0) {
    return stopped(n, problems);
  }
  const marked = body.includes(MARKER) ? body : `${MARKER}\n${body}`;
  const [owner, name] = repo();
  const me = ghJson<{ readonly login: string }>(["api", "user"]).login;
  const pages = ghJson<readonly RestComment[] | readonly (readonly RestComment[])[] | null>([
    "api",
    "--paginate",
    "--slurp",
    `repos/${owner}/${name}/issues/${n}/comments?per_page=100`,
  ]);
  const comments: readonly RestComment[] =
    pages !== null && Array.isArray(pages[0])
      ? (pages as readonly (readonly RestComment[])[]).flat()
      : ((pages ?? []) as readonly RestComment[]);
  const { mine, others } = pickRecord(comments, me);
  const last = mine.at(-1);
  if (last === undefined && others.length > 0) {
    return stopped(n, ["recorded-by-other"]);
  }
  const payload = JSON.stringify({ body: marked });
  const written = JSON.parse(
    last === undefined
      ? gh(
          ["api", "-X", "POST", `repos/${owner}/${name}/issues/${n}/comments`, "--input", "-"],
          payload,
        )
      : gh(
          [
            "api",
            "-X",
            "PATCH",
            `repos/${owner}/${name}/issues/comments/${last.id}`,
            "--input",
            "-",
          ],
          payload,
        ),
  ) as { readonly html_url?: string | null };
  return printed({
    number: n,
    action: last === undefined ? "created" : "updated",
    url: written.html_url ?? null,
  });
};

const main = (argv: readonly string[]): Output => {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
      throw new UsageError("");
    case "targets":
      return targets(rest);
    case "gather":
      return gather(rest);
    case "sessions-of":
      return sessionsOf(rest);
    case "post":
      return post(rest);
    default:
      throw new UsageError(`unknown subcommand: ${command}`);
  }
};

entry(import.meta.url, "pr-humans", USAGE, main, { usage: 2, failure: 1 });
