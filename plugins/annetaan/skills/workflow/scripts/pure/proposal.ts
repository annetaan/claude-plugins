export type OpenPull = {
  readonly number: number;
  readonly url: string;
  readonly headRefName: string;
};

const PROPOSE = "propose-";

export const proposalBranch = (prefix: string, name: string): string | null => {
  const rest = name.startsWith(PROPOSE) ? name.slice(PROPOSE.length) : "";
  return rest === "" ? null : `${prefix}/${rest}`;
};

export const newestProposal = (
  prefix: string,
  prs: readonly OpenPull[],
): { readonly number: number; readonly url: string } | null => {
  const newest = prs
    .filter((p) => p.headRefName.startsWith(`${prefix}/`))
    .toSorted((a, b) => b.number - a.number)[0];
  return newest === undefined ? null : { number: newest.number, url: newest.url };
};
