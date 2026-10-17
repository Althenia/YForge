import { createContext, createSignal, onCleanup, useContext } from "solid-js";

export type FindList = {
  element: HTMLElement;
  texts: () => readonly string[];
  reveal: (index: number, start: number, length: number) => void;
  rows: () => Iterable<readonly [number, HTMLElement]>;
};

export type FindRegistry = { register: (list: FindList) => () => void };

export const FindContext = createContext<FindRegistry>();

export const useFindRegistry = (): FindRegistry | undefined => useContext(FindContext);

export type FindState = { query: string; count: number; position: number };

type Unit = { kind: "text"; node: Text; text: string } | { kind: "row"; list: FindList; index: number; text: string };

type Match = { unit: Unit; start: number; occurrence: number };

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const idle: FindState = { query: "", count: 0, position: 0 };

export function occurrences(text: string, query: string): number[] {
  const needle = query.toLowerCase();
  if (needle === "") return [];
  const hay = text.toLowerCase();
  const found: number[] = [];
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + needle.length)) found.push(at);
  return found;
}

export function findLabel(state: FindState): string {
  if (state.query === "") return "";
  return state.count === 0 ? "No matches" : `${state.position + 1} of ${state.count}`;
}

const skipped = (element: Element): boolean =>
  element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true" || element.hasAttribute("data-find-skip") || element.classList.contains("sr-only");

function textNodes(root: Element): Text[] {
  const found: Text[] = [];
  const visit = (node: Node) => {
    if (node instanceof Text) {
      if (node.data.trim() !== "") found.push(node);
    } else if (node instanceof Element && !skipped(node)) {
      for (const child of node.childNodes) visit(child);
    }
  };
  visit(root);
  return found;
}

function collect(root: Element, lists: readonly FindList[]): Unit[] {
  const byElement = new Map(lists.map((list) => [list.element as Element, list]));
  const units: Unit[] = [];
  const visit = (node: Node) => {
    if (node instanceof Text) {
      if (node.data.trim() !== "") units.push({ kind: "text", node, text: node.data });
      return;
    }
    if (!(node instanceof Element) || skipped(node)) return;
    const list = byElement.get(node);
    if (list !== undefined) {
      list.texts().forEach((text, index) => units.push({ kind: "row", list, index, text }));
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return units;
}

const visible = (unit: Unit): boolean => unit.kind === "row" || unit.node.parentElement?.checkVisibility?.() !== false;

function matchesOf(units: readonly Unit[], query: string): Match[] {
  return units.flatMap((unit) => (visible(unit) ? occurrences(unit.text, query).map((start, occurrence) => ({ unit, start, occurrence })) : []));
}

const highlightSupport = (): boolean => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

function rangeOf(node: Text, start: number, length: number): Range {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, Math.min(start + length, node.data.length));
  return range;
}

function paint(matches: readonly Match[], current: Match | undefined, query: string): void {
  if (!highlightSupport()) return;
  const all = new Highlight();
  const now = new Highlight();
  for (const match of matches) {
    if (match.unit.kind === "text") (match === current ? now : all).add(rangeOf(match.unit.node, match.start, query.length));
  }
  const lists = new Set(matches.flatMap((match) => (match.unit.kind === "row" ? [match.unit.list] : [])));
  for (const list of lists) {
    for (const [index, row] of list.rows()) {
      let ordinal = 0;
      for (const node of textNodes(row)) {
        for (const start of occurrences(node.data, query)) {
          const isCurrent = current?.unit.kind === "row" && current.unit.list === list && current.unit.index === index && current.occurrence === ordinal;
          (isCurrent ? now : all).add(rangeOf(node, start, query.length));
          ordinal += 1;
        }
      }
    }
  }
  CSS.highlights.set("find", all);
  CSS.highlights.set("find-current", now);
}

function clearPaint(): void {
  if (!highlightSupport()) return;
  CSS.highlights.delete("find");
  CSS.highlights.delete("find-current");
}

function reveal(match: Match, length: number): void {
  if (match.unit.kind === "row") match.unit.list.reveal(match.unit.index, match.start, length);
  else match.unit.node.parentElement?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

export function createFindRegistry() {
  const [lists, setLists] = createSignal<readonly FindList[]>([]);
  const registry: FindRegistry = {
    register: (list) => {
      setLists((current) => [...current, list]);
      return () => setLists((current) => current.filter((entry) => entry !== list));
    },
  };
  return { registry, lists };
}

export function createPageFind(root: () => HTMLElement | undefined, lists: () => readonly FindList[]) {
  const [state, setState] = createSignal<FindState>(idle);
  const [open, setOpen] = createSignal(false);
  let matches: Match[] = [];
  let returnFocus: Element | null = null;
  let observer: MutationObserver | undefined;
  let frame: number | undefined;

  const current = (): Match | undefined => matches[state().position];

  function refresh(move: boolean, position = state().position): void {
    const element = root();
    const query = state().query;
    matches = element === undefined || query === "" ? [] : matchesOf(collect(element, lists()), query);
    const at = matches.length === 0 ? 0 : Math.min(position, matches.length - 1);
    setState({ query, count: matches.length, position: at });
    const chosen = current();
    if (move && chosen !== undefined) reveal(chosen, query.length);
    if (query === "") clearPaint();
    else paint(matches, current(), query);
  }

  function watch(): void {
    observer?.disconnect();
    const element = root();
    if (element === undefined || typeof MutationObserver === "undefined") return;
    observer = new MutationObserver(() => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (open() && state().query !== "") refresh(false);
      });
    });
    observer.observe(element, { childList: true, subtree: true, characterData: true });
  }

  function show(): void {
    if (!open()) returnFocus = document.activeElement;
    setOpen(true);
    watch();
  }

  function setQuery(query: string): void {
    setState({ ...state(), query });
    refresh(true, 0);
  }

  function step(direction: 1 | -1): void {
    refresh(false);
    if (matches.length === 0) return;
    refresh(true, (state().position + direction + matches.length) % matches.length);
  }

  function close(restore = true): void {
    observer?.disconnect();
    observer = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    matches = [];
    setState(idle);
    setOpen(false);
    clearPaint();
    const target = returnFocus;
    returnFocus = null;
    const view = root();
    if (!restore || view === undefined || !view.isConnected) return;
    if (target instanceof HTMLElement && view.contains(target)) target.focus();
    else (view.querySelector<HTMLElement>(FOCUSABLE) ?? view).focus();
  }

  onCleanup(() => close(false));

  return { state, open, show, setQuery, next: () => step(1), previous: () => step(-1), close };
}

export type PageFind = ReturnType<typeof createPageFind>;
