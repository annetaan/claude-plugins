export const MARKERS: readonly string[] = [
  "**[pj3-doctor]**",
  "**[pj4-running]**",
  "**[pj-cleanup]**",
];

export const HANDOVER = "**[pj4-running]** Handover notes";

export const markerProblem = (path: string, text: string): string | null =>
  MARKERS.some((marker) => text.startsWith(marker)) ? null : `${path} does not start with a marker`;
