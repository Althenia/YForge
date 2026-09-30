import type { ConflictFile } from "../ipc/bindings/ConflictFile";
import type { ConflictSide } from "../ipc/bindings/ConflictSide";

export type Choice = "current" | "incoming" | "current_incoming" | "incoming_current" | { manual: string[] };

export type Region = { current: string[]; incoming: string[]; base: string[] | null };

export type ResolverState = { choices: (Choice | undefined)[]; active: number };

export type Gutter = "C" | "I" | "!" | "";

export type ResultLine = { number: number; gutter: Gutter; text: string; region: number | undefined };

export type SideLabels = { current: string; incoming: string };

export type ResolverCommand =
  | { kind: "choose"; choice: Choice }
  | { kind: "edit" }
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "save" };

export function regionsOf(file: ConflictFile): Region[] {
  return file.segments.flatMap((segment) => (segment.kind === "conflict" ? [{ current: segment.current, incoming: segment.incoming, base: segment.base }] : []));
}

export const initialState = (file: ConflictFile): ResolverState => ({ choices: regionsOf(file).map(() => undefined), active: 0 });

export const isManual = (choice: Choice | undefined): choice is { manual: string[] } => typeof choice === "object";

export function regionLines(region: Region, choice: Choice): string[] {
  if (isManual(choice)) return choice.manual;
  switch (choice) {
    case "current":
      return region.current;
    case "incoming":
      return region.incoming;
    case "current_incoming":
      return [...region.current, ...region.incoming];
    case "incoming_current":
      return [...region.incoming, ...region.current];
  }
}

export function choose(state: ResolverState, index: number, choice: Choice): ResolverState {
  if (index < 0 || index >= state.choices.length) return state;
  return { ...state, choices: state.choices.map((existing, position) => (position === index ? choice : existing)) };
}

export const takeAll = (state: ResolverState, side: ConflictSide): ResolverState => ({
  ...state,
  choices: state.choices.map(() => (side === "current" ? "current" : "incoming")),
});

export function step(state: ResolverState, delta: 1 | -1): ResolverState {
  const count = state.choices.length;
  return count === 0 ? state : { ...state, active: (state.active + delta + count) % count };
}

export const unresolvedCount = (state: ResolverState): number => state.choices.filter((choice) => choice === undefined).length;

const sources: Record<Exclude<Choice, { manual: string[] }>, ("C" | "I")[]> = {
  current: ["C"],
  incoming: ["I"],
  current_incoming: ["C", "I"],
  incoming_current: ["I", "C"],
};

export function resultLines(file: ConflictFile, state: ResolverState, labels: SideLabels): ResultLine[] {
  const lines: ResultLine[] = [];
  const add = (gutter: Gutter, text: string, region?: number) => lines.push({ number: lines.length + 1, gutter, text, region });
  let index = 0;
  for (const segment of file.segments) {
    if (segment.kind === "text") {
      for (const text of segment.lines) add("", text);
      continue;
    }
    const region = index;
    index += 1;
    const choice = state.choices[region];
    if (choice === undefined) {
      add("!", `<<<<<<< ${labels.current}`, region);
      for (const text of segment.current) add("C", text, region);
      add("", "=======", region);
      for (const text of segment.incoming) add("I", text, region);
      add("", `>>>>>>> ${labels.incoming}`, region);
    } else if (isManual(choice)) {
      for (const text of choice.manual) add("", text, region);
    } else {
      for (const side of sources[choice]) for (const text of side === "C" ? segment.current : segment.incoming) add(side, text, region);
    }
  }
  return lines;
}

export function resultText(file: ConflictFile, state: ResolverState): string | undefined {
  if (unresolvedCount(state) > 0) return undefined;
  const lines: string[] = [];
  let index = 0;
  for (const segment of file.segments) {
    if (segment.kind === "text") lines.push(...segment.lines);
    else {
      const choice = state.choices[index];
      const region = regionsOf(file)[index];
      index += 1;
      if (choice === undefined || region === undefined) return undefined;
      lines.push(...regionLines(region, choice));
    }
  }
  return lines.length === 0 ? "" : lines.join(file.eol) + (file.final_newline ? file.eol : "");
}

export function choiceLabel(choice: Choice | undefined): string {
  if (choice === undefined) return "Unresolved";
  if (isManual(choice)) return "Manual";
  return { current: "Current", incoming: "Incoming", current_incoming: "Both · current first", incoming_current: "Both · incoming first" }[choice];
}

export const markResolvedReason = (state: ResolverState): string | undefined => {
  const left = unresolvedCount(state);
  return left === 0 ? undefined : `Resolve ${left} conflict ${left === 1 ? "region" : "regions"} first`;
};

export function draftLines(text: string): string[] {
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
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
      return { kind: "choose", choice: "current_incoming" };
    case "e":
      return { kind: "edit" };
    case "n":
      return { kind: "next" };
    case "p":
      return { kind: "previous" };
    default:
      return undefined;
  }
}
