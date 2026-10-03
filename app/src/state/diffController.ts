import { keepPreviousData } from "@tanstack/solid-query";
import { useQuery } from "./query";
import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { FileDiff } from "../ipc/bindings/FileDiff";
import { client } from "../ipc/client";
import { discardHunkCopy, discardLinesCopy, type ConfirmCopy } from "./confirmCopy";
import { highlightHunk, markSegments, type MarkedSegment } from "./diffHighlight";
import { hunkActions, WHITESPACE_REASON, type DiffTarget, type HunkAction } from "./diffModel";
import type { DiffPrefs } from "./diffPrefs";
import { fileViewError } from "./fileView";
import { changeStops, hunkRows, inlineRows, lineKey, rowIndex, selectableLines, splitRows, wordMarks, type LineRef } from "./diffRows";
import { extendSelection, isSelected, nextSelectable, toggleLine, type LineSelection } from "./lineSelection";
import { repoKeys } from "./queryKeys";
import type { RepoSession } from "./repoSession";
import { languageOf, loadLanguage, type LanguageId } from "./syntax";

export type PendingDiscard = { hunk: DiffHunk; lines: number[] | undefined; copy: ConfirmCopy };

export type Reveal = { nonce: number; hunk: number | undefined; index: number };

const order = (left: LineRef, right: LineRef): number => left.hunk - right.hunk || left.line - right.line;

function load(path: string, target: DiffTarget, ignoreWhitespace: boolean): Promise<FileDiff> {
  if (target.source === "working") return client.diffFile(path, target.file, target.area, ignoreWhitespace);
  if (target.source === "stash") return client.stashFileDiff(path, target.index, target.sha, target.file, ignoreWhitespace);
  return client.commitFileDiff(path, target.sha, target.file, ignoreWhitespace);
}

export function createDiffController(deps: { session: RepoSession; target: () => DiffTarget; prefs: DiffPrefs; commitWhitespace?: boolean }) {
  const { session, prefs } = deps;
  const path = session.path;
  const ignoreWhitespace = () => (deps.target().source !== "commit" || deps.commitWhitespace === true) && prefs.ignoreWhitespace();
  const diff = useQuery(() => ({
    queryKey: repoKeys.diff(path, deps.target(), ignoreWhitespace()),
    queryFn: () => load(path, deps.target(), ignoreWhitespace()),
    placeholderData: keepPreviousData,
  }));
  const shown = () => (diff.error == null ? diff.data : undefined);
  const failure = () => (diff.error == null ? undefined : fileViewError(diff.error, "diff"));
  const hunks = (): DiffHunk[] => shown()?.hunks ?? [];

  const actions = (): HunkAction[] => hunkActions(deps.target());
  const selectable = () => actions().length > 0;
  const blocked = (): string | undefined => (ignoreWhitespace() && selectable() ? WHITESPACE_REASON : undefined);

  const [language, setLanguage] = createSignal<LanguageId | undefined>();
  createEffect(() => {
    const id = languageOf(deps.target().file);
    setLanguage((current) => (current === id ? current : undefined));
    if (id === undefined) return;
    let stale = false;
    onCleanup(() => (stale = true));
    loadLanguage(id).then(
      () => {
        if (!stale) setLanguage(id);
      },
      session.report,
    );
  });
  const highlighted = createMemo(() => hunks().map((hunk) => highlightHunk(language(), hunk)));
  const marks = createMemo(() => hunks().map(wordMarks));
  const segments = (ref: LineRef): MarkedSegment[] => markSegments(highlighted()[ref.hunk]?.[ref.line] ?? [], marks()[ref.hunk]?.get(ref.line));

  const hunkRowLists = createMemo(() => hunks().map(hunkRows));
  const hunkIndexes = createMemo(() => hunkRowLists().map(rowIndex));
  const flatRows = createMemo(() => (prefs.mode() === "inline" ? inlineRows(hunks()) : prefs.mode() === "split" ? splitRows(hunks()) : []));
  const flatIndex = createMemo(() => rowIndex(flatRows()));
  const stops = createMemo(() => changeStops(hunks()));

  const [selection, setSelection] = createSignal<LineSelection | undefined>();
  const [cursor, setCursor] = createSignal<LineRef | undefined>();
  const [focusRequest, setFocusRequest] = createSignal<string | undefined>();
  const [reveal, setReveal] = createSignal<Reveal | undefined>();
  const [pendingDiscard, setPendingDiscard] = createSignal<PendingDiscard | undefined>();
  let nonce = 0;

  createEffect(on([shown, () => deps.target(), ignoreWhitespace], () => setSelection(undefined), { defer: true }));
  createEffect(on(prefs.mode, () => setFocusRequest(undefined), { defer: true }));

  const firstKey = createMemo(() => {
    const first = selectableLines(hunks())[0];
    return first === undefined ? undefined : lineKey(first);
  });
  const tabKey = createMemo(() => {
    const current = cursor();
    return current !== undefined && hunks()[current.hunk]?.lines[current.line] !== undefined ? lineKey(current) : firstKey();
  });

  const locate = (ref: LineRef): Pick<Reveal, "hunk" | "index"> | undefined => {
    const key = lineKey(ref);
    const hunkMode = prefs.mode() === "hunk";
    const index = hunkMode ? hunkIndexes()[ref.hunk]?.get(key) : flatIndex().get(key);
    return index === undefined ? undefined : { hunk: hunkMode ? ref.hunk : undefined, index };
  };

  const keepIndex = (hunk: number | undefined): number | undefined => {
    const current = cursor();
    if (current === undefined) return undefined;
    if (hunk !== undefined && current.hunk !== hunk) return undefined;
    return locate(current)?.index;
  };

  function focusLine(ref: LineRef): void {
    setCursor(ref);
    const at = locate(ref);
    if (at !== undefined) setReveal({ nonce: (nonce += 1), ...at });
    setFocusRequest(lineKey(ref));
  }

  function stepChange(delta: 1 | -1, from: LineRef | undefined = cursor()): void {
    const list = stops();
    const target =
      delta === 1
        ? list.find((stop) => from === undefined || order(stop, from) > 0)
        : list.findLast((stop) => from === undefined || order(stop, from) < 0);
    if (target !== undefined) focusLine(target);
  }

  function pick(ref: LineRef, extend: boolean): void {
    if (!selectable() || blocked() !== undefined) return;
    setCursor(ref);
    setSelection(extend ? extendSelection(selection(), hunks(), ref) : toggleLine(selection(), ref));
  }

  function runLines(action: HunkAction, hunkIndex: number, lines: number[]): void {
    const target = deps.target();
    const hunk = hunks()[hunkIndex];
    if (target.source !== "working" || hunk === undefined || lines.length === 0 || blocked() !== undefined || !actions().includes(action)) return;
    if (action === "discard") {
      setPendingDiscard({ hunk, lines, copy: discardLinesCopy(target.file, hunk, lines.length) });
      return;
    }
    const run = () => (action === "stage" ? client.stageLines(path, target.file, hunk, lines) : client.unstageLines(path, target.file, hunk, lines));
    void session.mutate(run).then((ok) => ok && setSelection(undefined));
  }

  function runSelection(action: HunkAction): void {
    const chosen = selection();
    if (chosen !== undefined) runLines(action, chosen.hunk, [...chosen.lines]);
  }

  function runHunk(action: HunkAction, hunk: DiffHunk): void {
    const target = deps.target();
    if (target.source !== "working" || blocked() !== undefined || !actions().includes(action)) return;
    if (action === "discard") {
      setPendingDiscard({ hunk, lines: undefined, copy: discardHunkCopy(target.file, hunk) });
      return;
    }
    void session.mutate(() => (action === "stage" ? client.stageHunk(path, target.file, hunk) : client.unstageHunk(path, target.file, hunk)));
  }

  function confirmDiscard(): void {
    const pending = pendingDiscard();
    const target = deps.target();
    setPendingDiscard(undefined);
    if (pending === undefined || target.source !== "working") return;
    const { hunk, lines } = pending;
    void session.mutate(() => (lines === undefined ? client.discardHunk(path, target.file, hunk) : client.discardLines(path, target.file, hunk, lines))).then((ok) => {
      if (ok) setSelection(undefined);
    });
  }

  const lineShortcuts: Record<string, HunkAction> = { s: "stage", u: "unstage", Backspace: "discard", Delete: "discard" };

  function onLineKey(ref: LineRef, event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : undefined;
    if (step !== undefined) {
      const next = nextSelectable(hunks(), ref, step);
      if (next === undefined) return;
      event.preventDefault();
      if (event.shiftKey && selectable() && blocked() === undefined) {
        const chosen = selection();
        const anchored = chosen !== undefined && chosen.hunk === ref.hunk ? chosen : toggleLine(undefined, ref);
        setSelection(extendSelection(anchored, hunks(), next));
      }
      focusLine(next);
    } else if (event.key === "n" || event.key === "p") {
      event.preventDefault();
      stepChange(event.key === "n" ? 1 : -1, ref);
    } else if (event.key === "Escape" && selection() !== undefined) {
      event.preventDefault();
      setSelection(undefined);
    } else {
      const action = lineShortcuts[event.key];
      if (action === undefined) return;
      event.preventDefault();
      const chosen = selection();
      if (chosen !== undefined) runLines(action, chosen.hunk, [...chosen.lines]);
      else runLines(action, ref.hunk, [ref.line]);
    }
  }

  return {
    diff,
    shown,
    failure,
    hunks,
    actions,
    selectable,
    blocked,
    segments,
    hunkRowLists,
    flatRows,
    selection,
    clearSelection: () => setSelection(undefined),
    isSelected: (ref: LineRef) => isSelected(selection(), ref),
    tabStop: (ref: LineRef) => lineKey(ref) === tabKey(),
    setCursor,
    focusRequest,
    fulfilFocus: () => setFocusRequest(undefined),
    reveal,
    keepIndex,
    stepChange,
    pick,
    onLineKey,
    runSelection,
    runHunk,
    pendingDiscard,
    cancelDiscard: () => setPendingDiscard(undefined),
    confirmDiscard,
  };
}

export type DiffController = ReturnType<typeof createDiffController>;
