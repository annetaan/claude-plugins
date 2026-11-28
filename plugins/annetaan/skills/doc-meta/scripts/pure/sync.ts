import { squeeze } from "../../../../scripts/pure/text.ts";
import { locate } from "./locate.ts";
import {
  FIELDS,
  fenceRecord,
  formatId,
  headerLine,
  ID,
  type NewBlock,
  parseBlocksFile,
  parseId,
  parseSidecar,
  quotedLines,
  quoteText,
  type SidecarBlock,
} from "./sidecar-text.ts";

export type SyncResult =
  | {
      readonly kind: "ok";
      readonly text: string;
      readonly unchanged: readonly string[];
      readonly changed: readonly string[];
      readonly new: readonly string[];
      readonly deleted: readonly string[];
      readonly flagsDropped: readonly string[];
      readonly maxIdRebuilt: boolean;
    }
  | { readonly kind: "stop"; readonly reason: "blocks"; readonly line: number }
  | { readonly kind: "stop"; readonly reason: "sidecar"; readonly line: number }
  | { readonly kind: "stop"; readonly reason: "not-in-document"; readonly block: number };

type Outcome =
  | { readonly kind: "unchanged" | "changed"; readonly old: number }
  | { readonly kind: "new" };

const isBlock = (item: NewBlock | "---"): item is NewBlock => item !== "---";

const sameText = (block: NewBlock, old: SidecarBlock): boolean => {
  const mine = quoteText(block.quoted);
  const theirs = quoteText(quotedLines(old));
  return block.verbatim ? mine === theirs : squeeze(mine) === squeeze(theirs);
};

const flagged = (old: SidecarBlock): boolean =>
  old.lines.some((line) => line.startsWith("flag:") && line.slice("flag:".length).trim() !== "");

const brokenOldBlock = (blocks: readonly SidecarBlock[]): number | null => {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.id === null || seen.has(block.id)) {
      return block.line;
    }
    seen.add(block.id);
  }
  return null;
};

const match = (blocks: readonly NewBlock[], olds: readonly SidecarBlock[]): readonly Outcome[] => {
  const anchors: (readonly [number, number])[] = [];
  let after = -1;
  blocks.forEach((block, index) => {
    const found = olds.findIndex((old, at) => at > after && sameText(block, old));
    if (found !== -1) {
      anchors.push([index, found]);
      after = found;
    }
  });
  const outcomes: Outcome[] = blocks.map(() => ({ kind: "new" }));
  const bounds = [[-1, -1] as const, ...anchors, [blocks.length, olds.length] as const];
  bounds.slice(1).forEach(([newEnd, oldEnd], index) => {
    const [newStart, oldStart] = bounds[index] ?? [-1, -1];
    if (newEnd < blocks.length) {
      outcomes[newEnd] = { kind: "unchanged", old: oldEnd };
    }
    const pairs = Math.min(newEnd - newStart - 1, oldEnd - oldStart - 1);
    for (let k = 0; k < pairs; k += 1) {
      outcomes[newStart + 1 + k] = { kind: "changed", old: oldStart + 1 + k };
    }
  });
  return outcomes;
};

const readMaxId = (document: readonly string[]): number | null => {
  const pattern = new RegExp(`^- max id: (${ID})$`, "u");
  const word = document.map((line) => pattern.exec(line)?.[1]).find((id) => id !== undefined);
  return word === undefined ? null : parseId(word);
};

const documentLines = (
  old: readonly string[],
  blocks: number,
  maxId: string,
): readonly string[] => {
  const at = FIELDS.map((field) =>
    old.findIndex((line) => line === `- ${field}:` || line.startsWith(`- ${field}: `)),
  );
  const fields = FIELDS.map((field, index) => {
    if (field === "blocks") {
      return `- blocks: ${blocks}`;
    }
    if (field === "max id") {
      return `- max id: ${maxId}`;
    }
    return old[at[index] ?? -1] ?? `- ${field}:`;
  });
  const others = old.filter((line, index) => line.trim() !== "" && !at.includes(index));
  return [...fields, ...others];
};

export const syncSidecar = (input: {
  readonly document: string;
  readonly blocks: string;
  readonly sidecar: string | null;
  readonly formatPath: string;
}): SyncResult => {
  const items = parseBlocksFile(input.blocks);
  if ("line" in items) {
    return { kind: "stop", reason: "blocks", line: items.line };
  }
  const blocks = items.filter(isBlock);
  const placements = locate(
    input.document,
    blocks.map((block) => ({
      text: quoteText(block.quoted),
      verbatim: block.verbatim,
      record: fenceRecord(block.quoted),
    })),
  );
  const lost = placements.findIndex((placement) => placement !== "found");
  if (lost !== -1) {
    return { kind: "stop", reason: "not-in-document", block: blocks[lost]?.n ?? lost + 1 };
  }
  const old = input.sidecar === null ? { document: [], blocks: [] } : parseSidecar(input.sidecar);
  const broken = brokenOldBlock(old.blocks);
  if (broken !== null) {
    return { kind: "stop", reason: "sidecar", line: broken };
  }
  const idOf = (index: number): string => old.blocks[index]?.id ?? "";
  const largestOld = Math.max(0, ...old.blocks.map((block) => parseId(block.id ?? "") ?? 0));
  const recorded = readMaxId(old.document);
  const maxIdRebuilt = input.sidecar !== null && recorded === null;
  const outcomes = match(blocks, old.blocks);
  let next = Math.max(recorded ?? 0, largestOld);
  const ids = outcomes.map((outcome) => {
    if (outcome.kind === "new") {
      next += 1;
      return formatId(next);
    }
    return idOf(outcome.old);
  });
  const paired = new Set(
    outcomes.flatMap((outcome) => (outcome.kind === "new" ? [] : [outcome.old])),
  );
  const changedOld = new Set(
    outcomes.flatMap((outcome) => (outcome.kind === "changed" ? [outcome.old] : [])),
  );
  const pick = (kind: Outcome["kind"]): readonly string[] =>
    ids.filter((_, index) => outcomes[index]?.kind === kind);
  const deletedOld = old.blocks.flatMap((_, index) => (paired.has(index) ? [] : [index]));
  const flagsDropped = old.blocks.flatMap((block, index) =>
    (changedOld.has(index) || !paired.has(index)) && flagged(block) ? [idOf(index)] : [],
  );
  const texts = blocks.map((block, index) => {
    const outcome = outcomes[index];
    if (outcome?.kind === "unchanged") {
      return (old.blocks[outcome.old]?.lines ?? []).join("\n");
    }
    return [`### ${ids[index] ?? ""} (pending)`, ...block.quoted, "", "flag:"].join("\n");
  });
  let written = 0;
  const pieces = items.map((item) => {
    if (item === "---") {
      return "---";
    }
    written += 1;
    return texts[written - 1] ?? "";
  });
  const document = documentLines(old.document, blocks.length, formatId(next));
  const text = [
    headerLine(input.formatPath),
    ["## Document", "", ...document].join("\n"),
    "## Whole document\n\n(pending)",
    ["## Blocks", ...pieces].join("\n\n"),
  ].join("\n\n");
  return {
    kind: "ok",
    text: `${text}\n`,
    unchanged: pick("unchanged"),
    changed: pick("changed"),
    new: pick("new"),
    deleted: deletedOld.map(idOf),
    flagsDropped,
    maxIdRebuilt,
  };
};
