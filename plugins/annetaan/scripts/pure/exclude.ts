import { splitLines } from "./text.ts";

export const exclusions = (
  text: string,
  paths: readonly string[],
): { readonly append: string; readonly added: readonly string[] } => {
  const lines = new Set(splitLines(text));
  const added = [...new Set(paths)].filter((path) => !lines.has(path));
  if (added.length === 0) {
    return { append: "", added };
  }
  const lead = text !== "" && !text.endsWith("\n") ? "\n" : "";
  return { append: lead + added.map((path) => `${path}\n`).join(""), added };
};
