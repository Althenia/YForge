import type { ConflictFile } from "../ipc/bindings/ConflictFile";
import type { ConflictSide } from "../ipc/bindings/ConflictSide";

export type Choice = "current" | "incoming" | "both";

export type Region = { current: string[]; incoming: string[]; base: string[] | null };

export type ResolverState = { choices: (Choice | undefined)[]; active: number };

export type SideLabels = { current: string; incoming: string };

export type CheckState = "true" | "false" | "mixed";

export type Assembled = { text: string; starts: number[] };

export type ResolverCommand = { kind: "choose"; choice: Choice } | { kind: "next" } | { kind: "previous" } | { kind: "save" };

export function regionsOf(file: ConflictFile): Region[] {
  return file.segments.flatMap((segment) => (segment.kind === "conflict" ? [{ current: segment.current, incoming: segment.incoming, base: segment.base }] : []));
}

export const initialState = (file: ConflictFile): ResolverState => ({ choices: regionsOf(file).map(() => undefined), active: 0 });

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

export const hasSide = (choice: Choice | undefined, side: ConflictSide): boolean => choice === side || choice === "both";

const choiceOf = (current: boolean, incoming: boolean): Choice | undefined => (current && incoming ? "both" : current ? "current" : incoming ? "incoming" : undefined);

const withSide = (choice: Choice | undefined, side: ConflictSide, on: boolean): Choice | undefined =>
  choiceOf(side === "current" ? on : hasSide(choice, "current"), side === "incoming" ? on : hasSide(choice, "incoming"));

export function choose(state: ResolverState, index: number, choice: Choice | undefined): ResolverState {
  if (index < 0 || index >= state.choices.length) return state;
  return { ...state, choices: state.choices.map((existing, position) => (position === index ? choice : existing)) };
}

export function toggleSide(state: ResolverState, index: number, side: ConflictSide): ResolverState {
  const next = choose(state, index, withSide(state.choices[index], side, !hasSide(state.choices[index], side)));
  return next === state ? state : { ...next, active: index };
}

export function sideState(state: ResolverState, side: ConflictSide): CheckState {
  const count = state.choices.filter((choice) => hasSide(choice, side)).length;
  return count === 0 ? "false" : count === state.choices.length ? "true" : "mixed";
}

export function toggleAll(state: ResolverState, side: ConflictSide): ResolverState {
  const on = sideState(state, side) !== "true";
  return { ...state, choices: state.choices.map((choice) => withSide(choice, side, on)) };
}

export function step(state: ResolverState, delta: 1 | -1): ResolverState {
  const count = state.choices.length;
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
    const choice = state.choices[index];
    if (proposal !== undefined) lines.push(...draftLines(proposal));
    else if (choice !== undefined) lines.push(...regionLines(segment, choice));
    else lines.push(`<<<<<<< ${labels.current}`, ...segment.current, "=======", ...segment.incoming, `>>>>>>> ${labels.incoming}`);
  }
  return { text: lines.join("\n"), starts };
}

const OPENING = /^<{7}(?: |$)/gm;
const CLOSING = /^>{7}(?: |$)/gm;

export const markerCount = (text: string): number => Math.max(text.match(OPENING)?.length ?? 0, text.match(CLOSING)?.length ?? 0);

export function markResolvedReason(text: string): string | undefined {
  const left = markerCount(text);
  return left === 0 ? undefined : `${left} ${left === 1 ? "conflict" : "conflicts"} left: pick a side or remove the <<<<<<< ======= >>>>>>> markers`;
}

export function savedContent(file: ConflictFile, text: string): string {
  return text === "" ? "" : text.split("\n").join(file.eol) + (file.final_newline ? file.eol : "");
}

export function mergeProgress(input: { conflicted: number; resolved: number; busy: boolean }): { label: string; commitReason: string | undefined } {
  const total = input.conflicted + input.resolved;
  const commitReason = input.busy ? "Working…" : input.conflicted > 0 ? `Resolve ${input.conflicted} ${input.conflicted === 1 ? "file" : "files"} first` : undefined;
  return { label: `${input.resolved} of ${total} files resolved`, commitReason };
}

type KeyLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

export function resolverCommand(event: KeyLike): ResolverCommand | undefined {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") return { kind: "save" };
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return undefined;
  switch (event.key.toLowerCase()) {
    case "1":
      return { kind: "choose", choice: "current" };
    case "2":
      return { kind: "choose", choice: "incoming" };
    case "3":
      return { kind: "choose", choice: "both" };
    case "n":
      return { kind: "next" };
    case "p":
      return { kind: "previous" };
    default:
      return undefined;
  }
}
