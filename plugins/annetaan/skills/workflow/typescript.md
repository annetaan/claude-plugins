# What a TypeScript change needs

> This file holds what only a TypeScript change needs: the runtime, the type check, the checks of a new project and the lint rules that hold two rules of the work. A rule that sends a reader here names the section to read. Nothing in this file applies to code in another language.

## Runtime

The runtime is Bun, or Node.js 22.18 or later. Both run `.ts` files directly, Node by type stripping.

The runtime's type definitions are a dev dependency, named in the compiler options: `@types/bun` with `"types": ["bun"]` under Bun, `@types/node` with `"types": ["node"]` under Node. Without them, or with the package alone, `tsc` reports TS2591 on `process` at the edge.

Under Node's type stripping:

- `erasableSyntaxOnly` is on in `tsconfig.json`, so that `tsc` refuses the syntax Node cannot strip, such as an `enum`.
- Relative imports carry the `.ts` extension, as in `import { total } from "./logic.ts"`. An import without it fails in Node with `ERR_MODULE_NOT_FOUND`.
- `allowImportingTsExtensions` is on, so that `tsc` accepts those imports. It needs `noEmit`.
- `package.json` has `"type": "module"`. npm writes `"type": "commonjs"`, and Node then refuses `import` in a `.ts` file.

Running a file checks no type. A file that assigns a string to a `number` runs and exits 0. The type check is the next section.

## Type check

The type check is `tsc --noEmit`, or `tsgo --noEmit` where the repository uses `tsgo`. It is a command of its own, run apart from running the code.

## A new project's checks

The first task of a new project sets up these checks and makes them pass.

- Dev dependencies: `typescript`, `oxlint`, `oxlint-tsgolint` and `oxfmt`.
- Compiler options: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`.
- The runtime's type definitions, as **Runtime** gives them, and when the runtime is Node, the Node settings of **Runtime** as well.
- Commands: `tsc --noEmit`, `oxlint --type-aware` and `oxfmt --check`.

## Lint rules for effects and arguments

Two rules of the work are held by lint. Logic stays free of I/O, time and randomness, which enter at the edge files. No function changes an argument it was given.

This `.oxlintrc.json` block is the one statement of the rules and their options. `src/edge/**` is the one value a design fills in, with the edge files it names.

```json
{
  "rules": {
    "no-param-reassign": ["error", { "props": true }],
    "typescript/prefer-readonly-parameter-types": ["error", {
      "treatMethodsAsReadonly": true,
      "allow": [{ "from": "lib", "name": ["Date", "RegExpExecArray"] }]
    }],
    "no-restricted-imports": ["error", { "paths": ["node:fs", "node:child_process"] }],
    "no-restricted-globals": ["error", "process"],
    "no-restricted-properties": ["error",
      { "object": "Date", "property": "now" },
      { "object": "Math", "property": "random" }]
  },
  "overrides": [{
    "files": ["src/edge/**"],
    "rules": {
      "no-restricted-imports": "off",
      "no-restricted-globals": "off",
      "no-restricted-properties": "off",
      "typescript/prefer-readonly-parameter-types": "off"
    }
  }]
}
```

- `typescript/prefer-readonly-parameter-types` needs `oxlint --type-aware` and the `oxlint-tsgolint` package. Without the package, `oxlint --type-aware` stops with `Failed to find type-aware linter executable`.
- The `allow` list holds the library types that have no readonly form, such as `Date` and `RegExpExecArray`. It grows only by such a type.
- The `overrides` entry turns the three `no-restricted-*` rules and the readonly rule off in the edge files, because the edge receives the runtime's own mutable types. In a new project its `files` list names the edge files the design names.
- A probe copies the block into a configuration of its own, sets `files` to exactly the edge files the design names, and places that configuration at the root of the tree it lints, because `files` patterns resolve from the directory of the configuration file. It then runs `oxlint --type-aware -c <that file>` over the files the change touched.
- A rule oxlint lacks is written as an oxlint JS plugin, loaded through `jsPlugins` and turned on under `rules` as `<plugin name>/<rule>`, where the plugin name is its `meta.name`.
