const UNITS: ReadonlyArray<readonly [number, string]> = [
  [60, "s"],
  [60, "m"],
  [24, "h"],
  [7, "d"],
  [4.348, "w"],
  [12, "mo"],
];

export function relativeAge(timeSeconds: number, nowSeconds: number): string {
  let value = Math.max(0, nowSeconds - timeSeconds);
  for (const [size, label] of UNITS) {
    if (value < size) return `${Math.floor(value)}${label}`;
    value /= size;
  }
  return `${Math.floor(value)}y`;
}

export const basename = (path: string): string => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

export function splitPath(path: string): { directory: string; name: string } {
  const cut = path.lastIndexOf("/");
  return { directory: path.slice(0, cut + 1), name: path.slice(cut + 1) };
}

export function formatAbsolute(timeSeconds: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(timeSeconds * 1000));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("year")} ${part("hour")}:${part("minute")}`;
}
