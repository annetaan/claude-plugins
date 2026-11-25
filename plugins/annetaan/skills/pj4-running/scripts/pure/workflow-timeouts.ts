import { splitLines } from "../../../../scripts/pure/text.ts";

export type JobTimeout = { readonly job: string; readonly minutes: number | null };

const GITHUB_DEFAULT_MINUTES = 360;
const QUEUE_MINUTES = 30;

const JOBS = /^jobs:\s*(#.*)?$/u;
const JOB = /^([A-Za-z0-9_-]+):\s*(#.*)?$/u;
const TIMEOUT = /^timeout-minutes:/u;
const MINUTES = /^timeout-minutes:\s*(\d+)\s*(#.*)?$/u;

const indentOf = (line: string): number => line.length - line.trimStart().length;

export const jobTimeouts = (text: string): readonly JobTimeout[] => {
  const found: JobTimeout[] = [];
  let inJobs = false;
  let jobIndent: number | null = null;
  let keyIndent: number | null = null;
  for (const line of splitLines(text)) {
    const key = line.trim();
    if (key === "" || key.startsWith("#")) {
      continue;
    }
    const indent = indentOf(line);
    if (indent === 0) {
      inJobs = JOBS.test(line);
      jobIndent = null;
      continue;
    }
    if (!inJobs) {
      continue;
    }
    jobIndent ??= indent;
    if (indent === jobIndent) {
      const job = JOB.exec(key);
      if (job !== null) {
        found.push({ job: job[1] ?? "", minutes: null });
        keyIndent = null;
      }
      continue;
    }
    const last = found.at(-1);
    if (last === undefined || indent < jobIndent) {
      continue;
    }
    keyIndent ??= indent;
    if (indent === keyIndent && TIMEOUT.test(key)) {
      const minutes = MINUTES.exec(key);
      found[found.length - 1] = {
        job: last.job,
        minutes: minutes === null ? null : Number(minutes[1]),
      };
    }
  }
  return found;
};

export const ceilingSeconds = (workflows: readonly (readonly JobTimeout[])[]): number => {
  const sums = workflows.map((jobs) =>
    jobs.reduce((sum, { minutes }) => sum + (minutes ?? GITHUB_DEFAULT_MINUTES), 0),
  );
  const longest = sums.length === 0 ? GITHUB_DEFAULT_MINUTES : Math.max(...sums);
  return (longest + QUEUE_MINUTES) * 60;
};
