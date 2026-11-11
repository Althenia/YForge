import type { ConflictFile } from "../ipc/bindings/ConflictFile";
import type { ConflictSide } from "../ipc/bindings/ConflictSide";

export type Choice = "current" | "incoming" | "both";

export type Region = { current: string[]; incoming: string[]; base: string[] | null };

export type RegionPick = { side: ConflictSide; lineIndex: number };

export type ResolverState = { picks: RegionPick[][]; active: number };

export type SideLabels = { current: string; incoming: string };

export type CheckState = "true" | "false" | "mixed";

export type Assembled = { text: string; starts: number[] };

export type ResolverCommand = { kind: "choose"; choice: Choice } | { kind: "next" } | { kind: "previous" } | { kind: "save" };

export type ScrollAnchor = { segmentIndex: number; fraction: number };

export function regionsOf(file: ConflictFile): Region[] {
  return file.segments.flatMap((segment) => (segment.kind === "conflict" ? [{ current: segment.current, incoming: segment.incoming, base: segment.base }] : []));
}

export const initialState = (file: ConflictFile): ResolverState => ({ picks: regionsOf(file).map(() => []), active: 0 });

export function regionLines(region: Region, choice: Choice): string[] {
  switch (choice) {
    case "current":
      return region.current;
    case "incoming":
      return region.incoming;
    case "both":
      return [...region.current, ...region.incoming];
  }
}

const sideLines = (region: Region, side: ConflictSide): string[] => region[side];

const allPicks = (region: Region, side: ConflictSide): RegionPick[] => {
  const lines = sideLines(region, side);
  return lines.length === 0 ? [{ side, lineIndex: -1 }] : lines.map((_, lineIndex) => ({ side, lineIndex }));
};

export const hasPick = (picks: readonly RegionPick[], side: ConflictSide, lineIndex?: number): boolean =>
  picks.some((pick) => pick.side === side && (lineIndex === undefined || pick.lineIndex === lineIndex));

export function pickedLines(region: Region, picks: readonly RegionPick[]): string[] {
  return picks.flatMap((pick) => {
    const line = sideLines(region, pick.side)[pick.lineIndex];
    return line === undefined ? [] : [line];
  });
}

const picksForChoice = (region: Region, choice: Choice | undefined): RegionPick[] => {
  if (choice === undefined) return [];
  if (choice === "both") return [...allPicks(region, "current"), ...allPicks(region, "incoming")];
  return allPicks(region, choice);
};

export function choose(state: ResolverState, index: number, choice: Choice | undefined, regions: readonly Region[]): ResolverState {
  const region = regions[index];
  if (region === undefined || index < 0 || index >= state.picks.length) return state;
  return { ...state, picks: state.picks.map((existing, position) => (position === index ? picksForChoice(region, choice) : existing)) };
}

export function toggleLinePick(state: ResolverState, index: number, pick: RegionPick): ResolverState {
  const existing = state.picks[index];
  if (existing === undefined) return state;
  const present = existing.some((candidate) => candidate.side === pick.side && candidate.lineIndex === pick.lineIndex);
  const picks = present ? existing.filter((candidate) => !(candidate.side === pick.side && candidate.lineIndex === pick.lineIndex)) : [...existing, pick];
  return { ...state, active: index, picks: state.picks.map((current, position) => (position === index ? picks : current)) };
}

export function regionSideState(region: Region, picks: readonly RegionPick[], side: ConflictSide): CheckState {
  const lines = sideLines(region, side);
  if (lines.length === 0) return hasPick(picks, side, -1) ? "true" : "false";
  const count = new Set(picks.filter((pick) => pick.side === side && pick.lineIndex >= 0 && pick.lineIndex < lines.length).map((pick) => pick.lineIndex)).size;
  return count === 0 ? "false" : count === lines.length ? "true" : "mixed";
}

export function toggleSide(state: ResolverState, index: number, side: ConflictSide, region: Region): ResolverState {
  const existing = state.picks[index];
  if (existing === undefined) return state;
  const picks = regionSideState(region, existing, side) === "true" ? existing.filter((pick) => pick.side !== side) : [...existing.filter((pick) => pick.side !== side), ...allPicks(region, side)];
  return { ...state, active: index, picks: state.picks.map((current, position) => (position === index ? picks : current)) };
}

export function sideState(state: ResolverState, side: ConflictSide, regions: readonly Region[]): CheckState {
  if (regions.length === 0) return "false";
  const states = regions.map((region, index) => regionSideState(region, state.picks[index] ?? [], side));
  if (states.every((value) => value === "true")) return "true";
  return states.some((value) => value !== "false") ? "mixed" : "false";
}

export function toggleAll(state: ResolverState, side: ConflictSide, regions: readonly Region[]): ResolverState {
  const on = sideState(state, side, regions) !== "true";
  return {
    ...state,
    picks: regions.map((region, index) => {
      const existing = state.picks[index] ?? [];
      if (!on) return existing.filter((pick) => pick.side !== side);
      return [...existing.filter((pick) => pick.side !== side), ...allPicks(region, side)];
    }),
  };
}

export function step(state: ResolverState, delta: 1 | -1): ResolverState {
  const count = state.picks.length;
  return count === 0 ? state : { ...state, active: (state.active + delta + count) % count };
}

export function draftLines(text: string): string[] {
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}

export function assemble(file: ConflictFile, state: ResolverState, labels: SideLabels, proposals: Record<number, string> = {}): Assembled {
  const lines: string[] = [];
  const starts: number[] = [];
  for (const segment of file.segments) {
    if (segment.kind === "text") {
      lines.push(...segment.lines);
      continue;
    }
    const index = starts.length;
    starts.push(lines.length);
    const proposal = proposals[index];
    const picks = state.picks[index] ?? [];
    if (proposal !== undefined) lines.push(...draftLines(proposal));
    else if (picks.length > 0) lines.push(...pickedLines(segment, picks));
    else lines.push(`<<<<<<< ${labels.current}`, ...segment.current, "=======", ...segment.incoming, `>>>>>>> ${labels.incoming}`);
  }
  return { text: lines.join("\n"), starts };
}

const MARKER = /^(?:<{7}|\|{7}|={7}|>{7})(?: |$)/;

export const markerCount = (text: string): number => text.split("\n").filter((line) => MARKER.test(line)).length;

export function markResolvedReason(text: string): string | undefined {
  const left = markerCount(text);
  return left === 0 ? undefined : `${left} ${left === 1 ? "conflict marker" : "conflict markers"} left: pick a side or remove the <<<<<<< ======= >>>>>>> markers`;
}

export function savedContent(file: ConflictFile, text: string): string {
  return text === "" ? "" : text.split("\n").join(file.eol) + (file.final_newline ? file.eol : "");
}

export function mergeProgress(input: { conflicted: number; resolved: number; busy: boolean }): { label: string; commitReason: string | undefined } {
  const total = input.conflicted + input.resolved;
  const commitReason = input.busy ? "Working…" : input.conflicted > 0 ? `Resolve ${input.conflicted} ${input.conflicted === 1 ? "file" : "files"} first` : undefined;
  return { label: `${input.resolved} of ${total} files resolved`, commitReason };
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

export function anchorAtScroll(counts: readonly number[], scrollTop: number, clientHeight: number, scrollHeight: number, lineHeight: number): ScrollAnchor {
  const total = counts.reduce((sum, count) => sum + Math.max(0, count), 0);
  if (total <= 0 || lineHeight <= 0 || scrollHeight <= clientHeight || scrollTop <= 0) return { segmentIndex: 0, fraction: 0 };
  const topLine = clamp(scrollTop / lineHeight, 0, total);
  let start = 0;
  let lastPositive = 0;
  for (const [index, raw] of counts.entries()) {
    const count = Math.max(0, raw);
    if (count <= 0) continue;
    lastPositive = index;
    if (topLine < start + count) return { segmentIndex: index, fraction: clamp((topLine - start) / count, 0, 1) };
    start += count;
  }
  return { segmentIndex: lastPositive, fraction: 1 };
}

export function scrollTopAtAnchor(counts: readonly number[], anchor: ScrollAnchor, clientHeight: number, scrollHeight: number, lineHeight: number): number {
  if (lineHeight <= 0 || scrollHeight <= clientHeight) return 0;
  const index = clamp(Math.trunc(anchor.segmentIndex) || 0, 0, Math.max(0, counts.length - 1));
  const start = counts.slice(0, index).reduce((sum, count) => sum + Math.max(0, count), 0);
  const count = Math.max(0, counts[index] ?? 0);
  const line = start + clamp(anchor.fraction || 0, 0, 1) * count;
  const value = line * lineHeight;
  return Number.isFinite(value) ? clamp(value, 0, Math.max(0, scrollHeight - clientHeight)) : 0;
}

export function mappedScrollTop(
  sourceCounts: readonly number[],
  targetCounts: readonly number[],
  scrollTop: number,
  clientHeight: number,
  sourceScrollHeight: number,
  targetScrollHeight: number,
  lineHeight: number,
): number {
  return scrollTopAtAnchor(targetCounts, anchorAtScroll(sourceCounts, scrollTop, clientHeight, sourceScrollHeight, lineHeight), clientHeight, targetScrollHeight, lineHeight);
}

type KeyLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function resolverCommand(event: KeyLike): ResolverCommand | undefined {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") return { kind: "save" };
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return undefined;
  switch (event.key) {
    case "1":
      return { kind: "choose", choice: "current" };
    case "2":
      return { kind: "choose", choice: "incoming" };
    case "3":
      return { kind: "choose", choice: "both" };
    case "[":
      return { kind: "previous" };
    case "]":
      return { kind: "next" };
    default:
      break;
  }
  switch (event.key.toLowerCase()) {
    case "n":
      return { kind: "next" };
    case "p":
      return { kind: "previous" };
    default:
      return undefined;
  }
}
