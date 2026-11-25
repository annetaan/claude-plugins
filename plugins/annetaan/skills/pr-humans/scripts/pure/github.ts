import { splitLines, wordBoundary } from "../../../../scripts/pure/text.ts";
import { cap } from "./cap.ts";
import { type GraphqlComment, MARKER } from "./record.ts";

type Nodes<T> = { readonly nodes: readonly T[] };
type Login = { readonly login: string } | null;

export type GraphqlEdit = {
  readonly editor?: Login;
  readonly editedAt?: string | null;
  readonly diff?: string | null;
};

export type GraphqlIssue = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly author: Login;
  readonly body: string | null;
  readonly labels: Nodes<{ readonly name: string }>;
  readonly userContentEdits: Nodes<GraphqlEdit>;
  readonly comments: Nodes<GraphqlComment & { readonly createdAt: string }>;
  readonly parent?: GraphqlIssue | null;
};

export type GraphqlPullRequest = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly merged: boolean;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly createdAt: string;
  readonly author: Login;
  readonly mergedBy: Login;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly body: string | null;
  readonly commits: Nodes<{
    readonly commit: {
      readonly oid: string;
      readonly messageHeadline: string;
      readonly message: string | null;
      readonly committedDate: string;
      readonly parents: { readonly totalCount: number };
      readonly authors: Nodes<{ readonly name: string }>;
    };
  }>;
  readonly reviews: Nodes<{
    readonly author: Login;
    readonly state: string;
    readonly body: string | null;
    readonly submittedAt: string | null;
    readonly comments: Nodes<{ readonly path: string; readonly body: string | null }>;
  }>;
  readonly comments: Nodes<GraphqlComment & { readonly createdAt: string }>;
  readonly closingIssuesReferences: Nodes<{ readonly number: number }>;
  readonly timelineItems: Nodes<Readonly<Record<string, unknown>>>;
};

export type Box = { readonly box: string; readonly checked: boolean; readonly under: string };

export type CheckboxEvent = {
  readonly editor: string | null;
  readonly at: string | null;
  readonly onlyBoxes: boolean;
  readonly changed: readonly Box[];
  readonly addedChecked: readonly Box[];
};

export type CommentView = {
  readonly author: string | null;
  readonly at: string;
  readonly body: string;
  readonly claude: boolean;
};

export type IssueView = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly author: string | null;
  readonly labels: readonly string[];
  readonly body: string;
  readonly edits: number;
  readonly checkboxEvents: readonly CheckboxEvent[];
  readonly comments: readonly CommentView[];
};

export type LinkedIssue = IssueView & { readonly parent: IssueView | null };

export type CommitView = {
  readonly oid: string;
  readonly headline: string;
  readonly at: string;
  readonly authors: readonly string[];
  readonly merge: boolean;
  readonly claude: boolean;
};

export type PullRequestView = {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: string;
  readonly merged: boolean;
  readonly createdAt: string;
  readonly mergedAt: string | null;
  readonly closedAt: string | null;
  readonly author: string | null;
  readonly mergedBy: string | null;
  readonly head: string;
  readonly base: string;
  readonly body: string;
  readonly commits: readonly CommitView[];
  readonly humanCommits: readonly CommitView[];
  readonly reviews: readonly {
    readonly author: string | null;
    readonly state: string;
    readonly at: string | null;
    readonly body: string;
    readonly claude: boolean;
    readonly comments: readonly { readonly path: string; readonly body: string }[];
  }[];
  readonly comments: readonly CommentView[];
  readonly events: readonly Readonly<Record<string, unknown>>[];
  readonly issues: readonly LinkedIssue[];
};

const CLAUDE_TRAILER = new RegExp(`^Co-Authored-By:\\s*Claude${wordBoundary("after")}`, "imu");
const CLAUDE_FOOTER = /Generated with \[?Claude Code/iu;
const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.*\S)\s*$/u;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/u;
const HEADING_MARKS = /^\s*#+\s*/u;
const BOX_MARK = /^(\s*[-*]\s+)\[[ xX]\]/gmu;
const LINK = new RegExp(
  `${wordBoundary("before")}(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|implements?|part of|refs?)\\s*:?\\s+#([0-9]+)`,
  "giu",
);
const TITLE_REFERENCE = /\(#([0-9]+)\)/gu;

const loginOf = (who: Login | undefined): string | null =>
  who === null || who === undefined ? null : who.login;

const claudeWrote = (body: string | null): boolean => CLAUDE_FOOTER.test(body ?? "");

type Boxes = ReadonlyMap<string, Box>;

const boxesOf = (body: string): Boxes => {
  const boxes = new Map<string, Box>();
  let heading = "";
  for (const line of splitLines(body)) {
    if (HEADING.test(line)) {
      heading = line.replace(HEADING_MARKS, "").trim();
      continue;
    }
    const match = CHECKBOX.exec(line);
    if (match !== null) {
      const box = match[2] ?? "";
      boxes.set(JSON.stringify([heading, box]), { box, checked: match[1] !== " ", under: heading });
    }
  }
  return boxes;
};

const withoutBoxes = (text: string): string => text.replace(BOX_MARK, "$1[]");

export const checkboxEvents = (edits: readonly GraphqlEdit[]): readonly CheckboxEvent[] => {
  const revisions = edits.toReversed();
  return revisions.slice(1).flatMap((current, i) => {
    const previous = revisions[i];
    const a = previous?.diff ?? "";
    const b = current.diff ?? "";
    const before = boxesOf(a);
    const after = [...boxesOf(b)];
    const changed = after.flatMap(([key, box]: readonly [string, Box]) => {
      const old = before.get(key);
      return old !== undefined && old.checked !== box.checked ? [box] : [];
    });
    const addedChecked = after.flatMap(([key, box]: readonly [string, Box]) =>
      !before.has(key) && box.checked ? [box] : [],
    );
    if (changed.length === 0 && addedChecked.length === 0) {
      return [];
    }
    return [
      {
        editor: loginOf(current.editor),
        at: current.editedAt ?? null,
        onlyBoxes: withoutBoxes(a) === withoutBoxes(b),
        changed,
        addedChecked,
      },
    ];
  });
};

const commentView = (comment: GraphqlComment & { readonly createdAt: string }): CommentView => ({
  author: loginOf(comment.author),
  at: comment.createdAt,
  body: cap(comment.body),
  claude: claudeWrote(comment.body),
});

export const issueView = (issue: GraphqlIssue): IssueView => {
  const edits = issue.userContentEdits.nodes;
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    state: issue.state,
    author: loginOf(issue.author),
    labels: issue.labels.nodes.map((label) => label.name),
    body: cap(issue.body, 30000),
    edits: edits.length,
    checkboxEvents: checkboxEvents(edits),
    comments: issue.comments.nodes.map(commentView),
  };
};

export const linkedIssueNumbers = (pr: GraphqlPullRequest): readonly number[] => {
  const numbers = new Set(pr.closingIssuesReferences.nodes.map((issue) => issue.number));
  for (const match of (pr.body ?? "").matchAll(LINK)) {
    numbers.add(Number(match[1]));
  }
  for (const match of pr.title.matchAll(TITLE_REFERENCE)) {
    numbers.add(Number(match[1]));
  }
  numbers.delete(pr.number);
  return [...numbers].toSorted((a, b) => a - b);
};

export const withoutParents = (issues: readonly LinkedIssue[]): readonly LinkedIssue[] => {
  const parents = new Set(
    issues.flatMap((issue) => (issue.parent === null ? [] : [issue.parent.number])),
  );
  return issues.filter((issue) => !parents.has(issue.number));
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const flattened = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }
  if ("login" in value) {
    return value["login"];
  }
  return "name" in value ? value["name"] : null;
};

export const pullRequestView = (
  pr: GraphqlPullRequest,
  issues: readonly LinkedIssue[],
): PullRequestView => {
  const commits: readonly CommitView[] = pr.commits.nodes.map(({ commit }) => ({
    oid: commit.oid.slice(0, 7),
    headline: commit.messageHeadline,
    at: commit.committedDate,
    authors: commit.authors.nodes.map((author) => author.name),
    merge: commit.parents.totalCount > 1,
    claude: CLAUDE_TRAILER.test(commit.message ?? ""),
  }));
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    merged: pr.merged,
    createdAt: pr.createdAt,
    mergedAt: pr.mergedAt,
    closedAt: pr.closedAt,
    author: loginOf(pr.author),
    mergedBy: loginOf(pr.mergedBy),
    head: pr.headRefName,
    base: pr.baseRefName,
    body: cap(pr.body, 30000),
    commits,
    humanCommits: commits.filter((commit) => !commit.claude && !commit.merge),
    reviews: pr.reviews.nodes.map((review) => ({
      author: loginOf(review.author),
      state: review.state,
      at: review.submittedAt,
      body: cap(review.body),
      claude: claudeWrote(review.body),
      comments: review.comments.nodes.map((comment) => ({
        path: comment.path,
        body: cap(comment.body, 600),
      })),
    })),
    comments: pr.comments.nodes
      .filter((comment) => !(comment.body ?? "").includes(MARKER))
      .map(commentView),
    events: pr.timelineItems.nodes.map((event) =>
      Object.fromEntries(
        Object.entries(event).map(([key, value]: readonly [string, unknown]) => [
          key,
          flattened(value),
        ]),
      ),
    ),
    issues,
  };
};
