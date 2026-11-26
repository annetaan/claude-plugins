import { DIGIT } from "./text.ts";

const STAMP = new RegExp(`^${DIGIT}{4}-${DIGIT}{2}-${DIGIT}{2}-${DIGIT}{4}(?:-|$)`, "u");

export const isStamped = (name: string): boolean => STAMP.test(name);

const two = (n: number): string => String(n).padStart(2, "0");

export const stampOf = (now: Date): string =>
  `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;

export const REPORTS_KEPT = 100;

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const oldReports = (
  names: readonly string[],
  incoming: readonly string[] = [],
): readonly string[] =>
  [...names, ...incoming]
    .toSorted((a, b) => byName(b, a))
    .slice(REPORTS_KEPT)
    .toSorted(byName);

export type Landing = { readonly report: string; readonly dest: string };

const firstFree = (name: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(name)) {
    return name;
  }
  let n = 2;
  while (taken.has(`${name}-${n}`)) {
    n += 1;
  }
  return `${name}-${n}`;
};

export const landings = (
  taken: readonly string[],
  reports: readonly string[],
): readonly Landing[] => {
  const used = new Set(taken);
  return reports.map((report) => {
    const dest = firstFree(report, used);
    used.add(dest);
    return { report, dest };
  });
};
