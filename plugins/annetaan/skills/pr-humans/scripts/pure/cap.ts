export const TEXT_CAP = 1500;

export const cap = (text: string | null | undefined, limit: number = TEXT_CAP): string => {
  const whole = text ?? "";
  const points = Array.from(whole);
  return points.length <= limit
    ? whole
    : `${points.slice(0, limit).join("")} …[${points.length - limit} more chars]`;
};
