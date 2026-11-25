import { WORD, squeeze, wordBoundary } from "../../../../scripts/pure/text.ts";
import { type RoadmapLine, isDocument, symbols } from "./issue-body.ts";
import { type Graph, type IssueRecord, transitiveBlockers } from "./project-view.ts";

const WORD_RE = new RegExp(`[A-Za-z_$][${WORD}$]*`, "gu");
const FROM_PATH_RE = new RegExp(`${wordBoundary("before")}from\\s*(?:'[^'\\n]*'|"[^"\\n]*")`, "gu");

export const holdsName = (text: string): boolean =>
  (text.replace(FROM_PATH_RE, " ").match(WORD_RE) ?? []).some((word) => word !== "export");

export const rootFiles = (tree: string): ReadonlySet<string> =>
  new Set(
    tree.split("\0").flatMap((record) => {
      const tab = record.indexOf("\t");
      if (tab === -1) {
        return [];
      }
      const name = record.slice(tab + 1);
      return name !== "" && squeeze(record.slice(0, tab)).split(" ")[1] === "blob" ? [name] : [];
    }),
  );

export const symbolKey = (path: string, symbol: string): string => `${path}\n${symbol}`;

export type PremiseFacts = {
  readonly baseExists: boolean;
  readonly waitsOnMerged: boolean;
  readonly historyUnknown: boolean;
  readonly paths: ReadonlySet<string>;
  readonly exists: ReadonlySet<string>;
  readonly found: ReadonlySet<string>;
  readonly inHistory: ReadonlySet<string>;
  readonly roadmap: RoadmapLine | null;
  readonly roadmapHeadings: readonly string[];
};

export type PremiseFailure =
  | { readonly path: string; readonly why: string }
  | { readonly path: string; readonly symbol: string; readonly why: string };

export type Premises = {
  readonly mode: "none" | "early" | "full";
  readonly excusers: readonly number[];
  readonly failures: readonly PremiseFailure[];
};

const tokensOf = (body: string | null): ReadonlySet<string> =>
  new Set((body ?? "").match(WORD_RE) ?? []);

export const premises = (issue: IssueRecord, graph: Graph, facts: PremiseFacts): Premises => {
  const walked = transitiveBlockers(issue, graph.byNumber);
  const openRecord = (m: number): IssueRecord | undefined => {
    const record = graph.byNumber.get(m);
    return record?.state === "OPEN" ? record : undefined;
  };
  if (
    !(facts.baseExists || facts.waitsOnMerged) ||
    issue.blockedBy.some((b) => !graph.byNumber.has(b.number) && b.state === "OPEN") ||
    [...walked].some((m) => openRecord(m)?.stub === true)
  ) {
    return { mode: "none", excusers: [], failures: [] };
  }
  const excusers = [...walked].filter((m) => openRecord(m) !== undefined).toSorted((a, b) => a - b);
  const lists = (kinds: readonly string[], path: string): readonly number[] =>
    excusers.filter((m) =>
      (graph.byNumber.get(m)?.files ?? []).some((g) => g.path === path && kinds.includes(g.kind)),
    );
  const tokens = new Map(excusers.map((m) => [m, tokensOf(graph.byNumber.get(m)?.body ?? null)]));
  const failures: PremiseFailure[] = [];
  for (const f of issue.files) {
    const exists = facts.exists.has(f.path);
    let why: string | null = null;
    if (f.kind === "added") {
      if (lists(["added"], f.path).length > 0) {
        why = "added, but an open blocker adds it too";
      } else if (exists && lists(["deleted"], f.path).length === 0) {
        why = "added, but already exists";
      }
    } else if (lists(["deleted"], f.path).length > 0) {
      why = `${f.kind}, but an open blocker deletes it`;
    } else if (!exists && lists(["added"], f.path).length === 0) {
      why = `${f.kind}, but does not exist`;
    }
    if (why !== null) {
      failures.push({ path: f.path, why });
      continue;
    }
    if (f.kind !== "changed") {
      continue;
    }
    const namers = lists(["added", "changed"], f.path);
    for (const symbol of isDocument(f.path) ? [] : symbols(f, facts.paths)) {
      const key = symbolKey(f.path, symbol);
      const found = exists && facts.found.has(key);
      if (!found && !namers.some((m) => tokens.get(m)?.has(symbol) === true)) {
        const held = facts.historyUnknown || (exists && facts.inHistory.has(key));
        failures.push({
          path: f.path,
          symbol,
          why: held ? "symbol not found" : "symbol never in the file",
        });
      }
    }
    if (
      facts.roadmap !== null &&
      f.path === facts.roadmap.path &&
      !facts.roadmapHeadings.includes(facts.roadmap.entry)
    ) {
      failures.push({ path: f.path, why: "roadmap entry not found" });
    }
  }
  return { mode: excusers.length > 0 ? "early" : "full", excusers, failures };
};
