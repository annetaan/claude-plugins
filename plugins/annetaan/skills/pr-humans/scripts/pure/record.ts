import { escapeRegExp } from "../../../../scripts/pure/text.ts";

export const MARKER = "<!-- annetaan:pr-humans -->";

const MARKER_LINE = new RegExp(`^[ \\t]*${escapeRegExp(MARKER)}[ \\t]*\\r?\\n?`, "mu");

type Login = { readonly login: string } | null;

export type GraphqlComment = { readonly author: Login; readonly body: string | null };

export type RestComment = {
  readonly id: number;
  readonly user: Login;
  readonly body: string | null;
};

const marked = <T extends { readonly body: string | null }>(comments: readonly T[]): readonly T[] =>
  comments.filter((comment) => (comment.body ?? "").includes(MARKER));

const loginOf = (who: Login): string | null => (who === null ? null : who.login);

export const recordedBy = (
  comments: readonly GraphqlComment[],
  me: string | null,
): "me" | "other" | null => {
  const records = marked(comments);
  if (records.some((comment) => loginOf(comment.author) === me)) {
    return "me";
  }
  return records.length > 0 ? "other" : null;
};

export const previousBody = (
  comments: readonly GraphqlComment[],
  me: string | null,
): string | null => {
  const last = marked(comments)
    .filter((comment) => loginOf(comment.author) === me)
    .at(-1);
  return last === undefined ? null : `${(last.body ?? "").replace(MARKER_LINE, "").trim()}\n`;
};

export const pickRecord = (
  comments: readonly RestComment[],
  me: string,
): { readonly mine: readonly RestComment[]; readonly others: readonly RestComment[] } => {
  const records = marked(comments);
  return {
    mine: records.filter((comment) => loginOf(comment.user) === me),
    others: records.filter((comment) => loginOf(comment.user) !== me),
  };
};
