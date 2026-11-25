export type Version = readonly [number, number, number];

const VERSION = /gh version (\d+)\.(\d+)\.(\d+)/;

export const ghVersion = (text: string): Version | null => {
  const found = VERSION.exec(text);
  if (found === null) {
    return null;
  }
  const [, major, minor, patch] = found;
  return [Number(major), Number(minor), Number(patch)];
};

export const atLeast = (found: Version, wanted: Version): boolean => {
  for (const [i, part] of found.entries()) {
    const other = wanted[i] ?? 0;
    if (part !== other) {
      return part > other;
    }
  }
  return true;
};
