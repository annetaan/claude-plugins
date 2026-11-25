import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ceilingSeconds,
  jobTimeouts,
  type JobTimeout,
} from "../plugins/annetaan/skills/pj4-running/scripts/pure/workflow-timeouts.ts";

const WORKFLOWS = join(import.meta.dirname, "..", ".github/workflows");

const jobs = (...minutes: readonly (number | null)[]): readonly JobTimeout[] =>
  minutes.map((m, i) => ({ job: `job${String(i)}`, minutes: m }));

test("every job of every workflow has a timeout-minutes under six hours", () => {
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/u.test(f));
  let total = 0;
  for (const file of files) {
    for (const { job, minutes } of jobTimeouts(readFileSync(join(WORKFLOWS, file), "utf8"))) {
      total += 1;
      assert.ok(
        minutes !== null && minutes >= 1 && minutes <= 359,
        `${file}: job ${job} has timeout-minutes ${String(minutes)}, not from 1 to 359`,
      );
    }
  }
  assert.ok(total > 0, "no job found under .github/workflows");
});

test("jobTimeouts names a job without timeout-minutes", () => {
  const text = [
    "on: push",
    "jobs:",
    "  a:",
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 10",
    "    steps:",
    "      - run: true",
    "  b:  # the second",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: true",
  ].join("\n");
  assert.deepEqual(jobTimeouts(text), [
    { job: "a", minutes: 10 },
    { job: "b", minutes: null },
  ]);
});

test("jobTimeouts ignores timeout-minutes under a step", () => {
  const text = [
    "jobs:",
    "  a:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: true",
    "        timeout-minutes: 3",
    "env:",
    "  b:",
    "    timeout-minutes: 4",
  ].join("\n");
  assert.deepEqual(jobTimeouts(text), [{ job: "a", minutes: null }]);
});

test("jobTimeouts reads a workflow indented by four spaces", () => {
  const text = [
    "on:",
    "    pull_request:",
    "jobs:",
    "    a:",
    "        runs-on: ubuntu-latest",
    "        timeout-minutes: 7",
    "    b:",
    "        runs-on: ubuntu-latest",
    "        steps:",
    "            - run: sleep 3600",
    "              timeout-minutes: 3",
  ].join("\n");
  assert.deepEqual(jobTimeouts(text), [
    { job: "a", minutes: 7 },
    { job: "b", minutes: null },
  ]);
});

test("jobTimeouts gives null for an expression", () => {
  const text = ["jobs:", "  a:", "    timeout-minutes: ${{ inputs.t }}"].join("\n");
  assert.deepEqual(jobTimeouts(text), [{ job: "a", minutes: null }]);
});

test("ceilingSeconds adds the jobs of a workflow and takes the largest workflow", () => {
  assert.equal(ceilingSeconds([jobs(15, 5, 15), jobs(10)]), (35 + 30) * 60);
});

test("ceilingSeconds counts a job without a timeout as 360 minutes", () => {
  assert.equal(ceilingSeconds([jobs(15, null)]), (15 + 360 + 30) * 60);
});

test("ceilingSeconds with no workflow is 390 minutes", () => {
  assert.equal(ceilingSeconds([]), 390 * 60);
});
