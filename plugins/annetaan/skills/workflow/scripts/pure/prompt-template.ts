import { escapeRegExp } from "../../../../scripts/pure/text.ts";

const BLOCK = /^<if ([a-z]+)>$/u;

export const render = (
  template: string,
  values: readonly (readonly [string, string])[],
  holds: readonly string[],
): string => {
  const kept: string[] = [];
  const open: boolean[] = [];
  for (const line of template.split("\n")) {
    const block = BLOCK.exec(line);
    if (block !== null) {
      open.push(holds.includes(block[1] ?? ""));
    } else if (line === "<end>") {
      open.pop();
    } else if (open.every(Boolean)) {
      kept.push(line);
    }
  }
  const text = kept.join("\n").replace(/\n{3,}/gu, "\n\n");
  const table = new Map(values);
  const names = new RegExp(`<(${[...table.keys()].map(escapeRegExp).join("|")})>`, "gu");
  return text.replace(names, (whole: string, name: string) => table.get(name) ?? whole);
};
