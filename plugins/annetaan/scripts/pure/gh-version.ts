type Version = readonly [number, number, number];

const VERSION = /gh version (\d+)\.(\d+)\.(\d+)/;

const MINIMUM: Version = [2, 99, 0];

const ghVersion = (text: string): Version | null => {
  const found = VERSION.exec(text);
  if (found === null) {
    return null;
  }
  const [, major, minor, patch] = found;
  return [Number(major), Number(minor), Number(patch)];
};

const atLeast = (found: Version, wanted: Version): boolean => {
  for (const [i, part] of found.entries()) {
    const other = wanted[i] ?? 0;
    if (part !== other) {
      return part > other;
    }
  }
  return true;
};

export const requiredGh = (
  text: string,
):
  | { readonly kind: "ok"; readonly version: string }
  | { readonly kind: "old"; readonly message: string } => {
  const v = ghVersion(text);
  if (v !== null && atLeast(v, MINIMUM)) {
    return { kind: "ok", version: v.join(".") };
  }
  return {
    kind: "old",
    message: `gh ${MINIMUM.join(".")} or later is required, found ${v === null ? "an unknown version" : v.join(".")}`,
  };
};
