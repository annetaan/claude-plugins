import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newestProposal,
  type OpenPull,
  proposalBranch,
} from "../plugins/annetaan/skills/workflow/scripts/pure/proposal.ts";

const pull = (number: number, headRefName: string): OpenPull =>
  Object.freeze({ number, url: `https://github.com/o/r/pull/${number}`, headRefName });

test("newestProposal keeps <prefix>/* and takes the highest number", () => {
  const prs = Object.freeze([
    pull(3, "level/a"),
    pull(5, "level/b"),
    pull(9, "level-2026-01-01-0000"),
    pull(7, "pj-roadmap/c"),
    pull(8, "levelx/d"),
  ]);
  const before = JSON.stringify(prs);
  assert.deepEqual(newestProposal("level", prs), {
    number: 5,
    url: "https://github.com/o/r/pull/5",
  });
  assert.deepEqual(newestProposal("pj-roadmap", prs), {
    number: 7,
    url: "https://github.com/o/r/pull/7",
  });
  assert.equal(newestProposal("doc", prs), null);
  assert.equal(newestProposal("level", []), null);
  assert.equal(JSON.stringify(prs), before);
});

test("proposalBranch drops propose- and refuses other names", () => {
  assert.equal(proposalBranch("level", "propose-2026-11-26-1837-2"), "level/2026-11-26-1837-2");
  assert.equal(
    proposalBranch("pj-roadmap", "propose-2026-11-26-1837"),
    "pj-roadmap/2026-11-26-1837",
  );
  for (const name of ["run-x", "propose-", "xpropose-a"]) {
    assert.equal(proposalBranch("level", name), null, name);
  }
});
