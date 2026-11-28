import { squeeze, wordBoundary } from "../../../../scripts/pure/text.ts";
import { locate } from "./locate.ts";
import {
  fenceRecord,
  fileLines,
  ID,
  parseId,
  parseSidecar,
  quotedLines,
  quoteText,
  ROLES,
  type SidecarBlock,
  WEIGHTS,
} from "./sidecar-text.ts";

export type Reason = { readonly code: string; readonly block: string | null };

export type BulletCheck = {
  readonly index: number;
  readonly ok: boolean;
  readonly code: "no-block" | "no-quote" | null;
};

const isVerbatim = (block: SidecarBlock): boolean => block.heading.split(" ")[2] === "verbatim";

const headingReason = (block: SidecarBlock): string | null => {
  const ids = `${ID}(,${ID})*`;
  const shape = new RegExp(
    `^${ID} (${WEIGHTS.join("|")}) (${ROLES.join("|")})( echoes:${ids})?( needs:${ids})?$`,
    "u",
  );
  if (block.id === null) {
    return "heading";
  }
  if (new RegExp(`^${ID} \\(pending\\)$`, "u").test(block.heading)) {
    return "pending";
  }
  return shape.test(block.heading) ? null : "heading";
};

const field = (document: readonly string[], pattern: string): readonly string[] | null => {
  const regex = new RegExp(`^${pattern}$`, "u");
  const match = document.map((line) => regex.exec(line)).find((found) => found !== null);
  return match === undefined ? null : match.slice(1).map((group) => group ?? "");
};

const wholeFileReasons = (
  document: readonly string[],
  blocks: readonly SidecarBlock[],
  maxId: number | null,
): readonly Reason[] => {
  const count = field(document, "- blocks: ([0-9]+)");
  const weights = field(
    document,
    `- weights: ${WEIGHTS.map((weight) => `${weight} ([0-9]+)`).join(", ")}`,
  );
  const carried = WEIGHTS.map(
    (weight) => blocks.filter((block) => block.heading.split(" ")[1] === weight).length,
  );
  return [
    ...(count === null || Number(count[0]) !== blocks.length ? ["count"] : []),
    ...(weights === null || weights.some((n, index) => Number(n) !== carried[index])
      ? ["weights"]
      : []),
    ...(maxId === null ? ["max-id"] : []),
  ].map((code) => ({ code, block: null }));
};

export const verifySidecar = (document: string, sidecar: string): readonly Reason[] => {
  const parsed = parseSidecar(sidecar);
  const maxWord = field(parsed.document, `- max id: (${ID})`)?.[0];
  const maxId = maxWord === undefined ? null : parseId(maxWord);
  const placements = locate(
    document,
    parsed.blocks.map((block) => ({
      text: quoteText(quotedLines(block)),
      verbatim: isVerbatim(block),
      record: fenceRecord(quotedLines(block)),
    })),
  );
  const seen = new Set<string>();
  const perBlock = parsed.blocks.flatMap((block, index) => {
    const codes: string[] = [];
    const heading = headingReason(block);
    if (heading !== null) {
      codes.push(heading);
    }
    if (block.id !== null) {
      if (seen.has(block.id)) {
        codes.push("duplicate-id");
      }
      seen.add(block.id);
      if (maxId !== null && (parseId(block.id) ?? 0) > maxId) {
        codes.push("max-id");
      }
    }
    if (!block.lines.some((line) => line.startsWith("flag:"))) {
      codes.push("no-flag");
    }
    const placement = placements[index];
    if (placement === "order") {
      codes.push("order");
    } else if (placement === "missing") {
      codes.push("not-in-document");
    }
    return codes.map((code) => ({ code, block: block.id }));
  });
  return [...wholeFileReasons(parsed.document, parsed.blocks, maxId), ...perBlock];
};

const quoteHolds = (block: SidecarBlock, quote: string): boolean => {
  const text = quoteText(quotedLines(block));
  if (isVerbatim(block)) {
    return quote !== "" && text.includes(quote);
  }
  return squeeze(quote) !== "" && squeeze(text).includes(squeeze(quote));
};

const bulletCode = (
  bullet: string,
  blocks: ReadonlyMap<string, SidecarBlock>,
): "no-block" | "no-quote" | null => {
  const ids = new RegExp(`${wordBoundary("before")}${ID}${wordBoundary("after")}`, "gu");
  for (const match of bullet.matchAll(ids)) {
    const block = blocks.get(match[0]);
    if (block === undefined) {
      return "no-block";
    }
    const rest = bullet.slice(match.index + match[0].length);
    const end = rest.indexOf('")', 3);
    if (!rest.startsWith(' ("') || end === -1 || !quoteHolds(block, rest.slice(3, end))) {
      return "no-quote";
    }
  }
  return null;
};

export const checkQuotes = (sidecar: string, bullets: string): readonly BulletCheck[] => {
  const blocks = new Map<string, SidecarBlock>();
  for (const block of parseSidecar(sidecar).blocks) {
    if (block.id !== null && !blocks.has(block.id)) {
      blocks.set(block.id, block);
    }
  }
  return fileLines(bullets)
    .filter((line) => line.trim() !== "")
    .map((bullet, index) => {
      const code = bulletCode(bullet, blocks);
      return { index: index + 1, ok: code === null, code };
    });
};
