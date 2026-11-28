import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, parse, resolve } from "node:path";
import { entry, statusLine, stop, UsageError, type Output } from "../../../scripts/status.ts";
import { syncSidecar } from "./pure/sync.ts";
import { checkQuotes, verifySidecar } from "./pure/verify.ts";

const USAGE = `sidecar.sh: match, number and verify the blocks of a doc-meta sidecar.

Subcommands (each prints one JSON object on stdout; exit 1 is a usage error or an unexpected failure):

  sync <document> <blocks file>
      Match the blocks file (### <n> or ### <n> verbatim, its > lines, --- between paragraphs) against the
      sidecar next to the document, and write the sidecar. Prints sidecar, unchanged, changed, new, deleted,
      flagsDropped and maxIdRebuilt. Stops with is-sidecar, no-document, blocks {line}, sidecar {line} or
      not-in-document {block}, and then writes nothing.

  verify <document>
      Check the sidecar against the document. Prints ok and reasons [{code, block}]. Stops with is-sidecar,
      no-document or no-sidecar.

  quotes <document> <bullets file>
      Check that each id a bullet names is a block of the sidecar and carries a quote from it. Prints
      bullets [{index, ok, code}]. Stops with is-sidecar, no-document or no-sidecar.
`;

const formatPath = (): string => join(import.meta.dirname, "..", "format.md");

const sidecarPath = (document: string): string => {
  const { dir, name } = parse(resolve(document));
  return join(dir, `${name}.doc-meta.md`);
};

const expect = (args: readonly string[], names: readonly string[]): readonly string[] => {
  if (args.length !== names.length) {
    throw new UsageError(`expected ${names.join(" ")}`);
  }
  return args;
};

const requireFile = (path: string, what: string): void => {
  if (!existsSync(path)) {
    throw new UsageError(`no ${what}: ${path}`);
  }
};

const checkDocument = (document: string): void => {
  if (basename(document).endsWith(".doc-meta.md")) {
    stop("is-sidecar", `${document} is a sidecar, not a document`);
  }
  if (!existsSync(document)) {
    stop("no-document", `${document} does not exist`);
  }
};

const readSidecar = (document: string): string => {
  const sidecar = sidecarPath(document);
  if (!existsSync(sidecar)) {
    stop("no-sidecar", `${sidecar} does not exist; run doc-meta on ${document} first`);
  }
  return readFileSync(sidecar, "utf8");
};

const sync = (args: readonly string[]): Output => {
  const [document = "", blocksFile = ""] = expect(args, ["<document>", "<blocks file>"]);
  requireFile(blocksFile, "blocks file");
  checkDocument(document);
  const sidecar = sidecarPath(document);
  const result = syncSidecar({
    document: readFileSync(document, "utf8"),
    blocks: readFileSync(blocksFile, "utf8"),
    sidecar: existsSync(sidecar) ? readFileSync(sidecar, "utf8") : null,
    formatPath: formatPath(),
  });
  if (result.kind === "stop") {
    switch (result.reason) {
      case "blocks":
        return stop("blocks", `${blocksFile} is not a blocks file at line ${result.line}`, {
          line: result.line,
        });
      case "sidecar":
        return stop(
          "sidecar",
          `${sidecar} has a block with no id or a repeated id at line ${result.line}`,
          {
            line: result.line,
          },
        );
      case "not-in-document":
        return stop(
          "not-in-document",
          `block ${result.block} is not in ${document} after the block before it`,
          {
            block: result.block,
          },
        );
    }
  }
  writeFileSync(sidecar, result.text);
  return statusLine({
    status: "ok",
    sidecar,
    unchanged: result.unchanged,
    changed: result.changed,
    new: result.new,
    deleted: result.deleted,
    flagsDropped: result.flagsDropped,
    maxIdRebuilt: result.maxIdRebuilt,
  });
};

const verify = (args: readonly string[]): Output => {
  const [document = ""] = expect(args, ["<document>"]);
  checkDocument(document);
  const reasons = verifySidecar(readFileSync(document, "utf8"), readSidecar(document));
  return statusLine({ status: "ok", ok: reasons.length === 0, reasons });
};

const quotes = (args: readonly string[]): Output => {
  const [document = "", bulletsFile = ""] = expect(args, ["<document>", "<bullets file>"]);
  requireFile(bulletsFile, "bullets file");
  checkDocument(document);
  const bullets = checkQuotes(readSidecar(document), readFileSync(bulletsFile, "utf8"));
  return statusLine({ status: "ok", bullets });
};

const main = (argv: readonly string[]): Output => {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
      throw new UsageError("");
    case "sync":
      return sync(rest);
    case "verify":
      return verify(rest);
    case "quotes":
      return quotes(rest);
    default:
      throw new UsageError(`unknown subcommand: ${command}`);
  }
};

entry(import.meta.url, "sidecar", USAGE, main);
