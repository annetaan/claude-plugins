import { test } from "node:test";
import assert from "node:assert/strict";
import {
  flowList,
  glob,
  letsThrough,
  triggers,
  uncommented,
} from "../plugins/annetaan/skills/pj4-running/scripts/pure/workflow-triggers.ts";

const BASE = "pj/1";

const cases: readonly (readonly [string, boolean, string])[] = [
  ["a bare pull_request", true, "on:\n  pull_request:\n  push:\n    branches: [main]"],
  ["a pull_request for main only", false, "on:\n  pull_request:\n    branches: [main]"],
  ["no workflow trigger", false, "on:\n  push:\n    branches: [main]"],
  ["on: with pull_request inline", true, "on: [push, pull_request]"],
  ["on: with pull_request_target inline", true, "on: pull_request_target"],
  ["on: with pull_requests is no trigger", false, "on: pull_requests"],
  [
    "flow list with a comment",
    true,
    "on:\n  pull_request:\n    branches: [main, 'pj/**']  # the project branches too",
  ],
  [
    "item with a comment",
    true,
    "on:\n  pull_request:\n    branches:\n      - main\n      - 'pj/**'  # the project branches",
  ],
  [
    "comment after branches:",
    true,
    "on:\n  pull_request:\n    branches: # main and the project branches\n      - main\n      - 'pj/**'",
  ],
  ["a # inside quotes", true, "on:\n  pull_request:\n    branches: ['main #1', 'pj/**']"],
  [
    "items at the key's own indent",
    true,
    "on:\n  pull_request:\n    branches:\n    - main\n    - 'pj/**'",
  ],
  [
    "ignored items at the key's own indent",
    false,
    "on:\n  pull_request:\n    branches-ignore:\n    - 'pj/**'",
  ],
  [
    "flow list over several lines",
    true,
    "on:\n  pull_request:\n    branches: [\n      main,\n      'pj/**',\n    ]",
  ],
  ["a [...] pattern in a flow list", true, "on:\n  pull_request:\n    branches: [main, pj/[0-9]]"],
  [
    "a quoted [...] pattern before another",
    true,
    "on:\n  pull_request:\n    branches: ['v[0-9]+', 'pj/**']",
  ],
  [
    "a [...] pattern on a later line of a flow list",
    true,
    "on:\n  pull_request:\n    branches: [\n      'v[0-9]+',\n      'pj/**',\n    ]",
  ],
  [
    "a [...] pattern on the first line of a flow list",
    true,
    "on:\n  pull_request:\n    branches: ['v[0-9]+',\n      'pj/**']",
  ],
  ["a quoted ] in a flow list", true, "on:\n  pull_request:\n    branches: ['a]', 'pj/**']"],
  [
    "a negated pattern after a match",
    false,
    "on:\n  pull_request:\n    branches: ['pj/**', '!pj/1']",
  ],
];

for (const [name, expected, text] of cases) {
  test(`triggers: ${name}`, () => {
    assert.equal(triggers(text, BASE), expected);
  });
}

test("glob turns * into one path segment and ** into any", () => {
  assert.equal(glob("pj/*"), "pj\\/[^/]*");
  assert.equal(glob("pj/**"), "pj\\/.*");
  assert.equal(glob("v[0-9]+"), "v[0-9]+");
  assert.equal(glob("a.b"), "a\\.b");
  assert.equal(glob("a\\*"), "a\\*");
});

test("flowList reads items and says whether the list closed", () => {
  assert.deepEqual(flowList("[main, 'pj/**']"), { items: ["main", "pj/**"], closed: true });
  assert.deepEqual(flowList("['a]', b]"), { items: ["a]", "b"], closed: true });
  assert.deepEqual(flowList("[main,"), { items: [], closed: false });
});

test("letsThrough weighs the last matching pattern, and branches-ignore any match", () => {
  assert.equal(letsThrough("branches", ["pj/**"], BASE), true);
  assert.equal(letsThrough("branches", ["main"], BASE), false);
  assert.equal(letsThrough("branches", ["pj/**", "!pj/1"], BASE), false);
  assert.equal(letsThrough("branches-ignore", ["pj/**"], BASE), false);
  assert.equal(letsThrough("branches-ignore", ["main"], BASE), true);
});

test("uncommented drops a comment outside quotes only", () => {
  assert.equal(uncommented("branches: [main] # x"), "branches: [main]");
  assert.equal(uncommented("branches: ['main #1']"), "branches: ['main #1']");
  assert.equal(uncommented("# all"), "");
  assert.equal(uncommented("a#b"), "a#b");
});
