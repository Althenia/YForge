import { For, Show } from "solid-js";
import { client } from "../ipc/client";
import { createDiffController, type DiffController } from "../state/diffController";
import { diffModes, diffNotice, hunkLabel, targetMode, targetSource, type DiffTarget } from "../state/diffModel";
import type { DiffPrefs } from "../state/diffPrefs";
import { fileViewTargetOf, type FileViewTarget } from "../state/fileView";
import type { DiffRow } from "../state/diffRows";
import { selectionLabel } from "../state/lineSelection";
import type { RepoSession } from "../state/repoSession";
import { ConfirmDialog } from "./ConfirmDialog";
import { GapRow, HunkHead, NoteRow, SplitRow, UnifiedLine } from "./DiffLines";
import { Icon } from "./Icon";
import { Switch } from "./Switch";
import { tip } from "./Tooltip";
import { VirtualRows, type VirtualRow } from "./VirtualRows";

const LINE_ESTIMATE = 20;

function FlatRow(props: { diff: DiffController; row: DiffRow; split: boolean; virtual: VirtualRow }) {
  const row = () => props.row;
  return (
    <>
      <Show when={row().kind === "head" && row()}>
        {(head) => {
          const hunk = () => props.diff.hunks()[(head() as Extract<DiffRow, { kind: "head" }>).hunk];
          return (
            <Show when={hunk()}>
              {(current) => (
                <div class="dhunk hunk-head" ref={props.virtual.measure} data-index={props.virtual.index} style={props.virtual.style}>
                  <HunkHead diff={props.diff} hunk={current()} />
                </div>
              )}
            </Show>
          );
        }}
      </Show>
      <Show when={row().kind === "gap" && (row() as Extract<DiffRow, { kind: "gap" }>)}>
        {(gap) => <GapRow hidden={gap().hidden} virtual={props.virtual} />}
      </Show>
      <Show when={row().kind === "line" && (row() as Extract<DiffRow, { kind: "line" }>)}>
        {(line) => <UnifiedLine diff={props.diff} cell={line().cell} virtual={props.virtual} />}
      </Show>
      <Show when={row().kind === "pair" && (row() as Extract<DiffRow, { kind: "pair" }>)}>
        {(pair) => <SplitRow diff={props.diff} left={pair().left} right={pair().right} virtual={props.virtual} />}
      </Show>
      <Show when={row().kind === "note" && (row() as Extract<DiffRow, { kind: "note" }>)}>
        {(note) => <NoteRow side={note().side} split={props.split} virtual={props.virtual} />}
      </Show>
    </>
  );
}

export function DiffView(props: { session: RepoSession; target: DiffTarget; prefs: DiffPrefs; onClose: () => void; onViewFile: (target: FileViewTarget) => void }) {
  const diff = createDiffController({ session: props.session, target: () => props.target, prefs: props.prefs });
  const working = () => props.target.source === "working";
  const mode = () => props.prefs.mode();

  let panel: HTMLElement | undefined;
  let body: HTMLDivElement | undefined;

  const stepHunk = (delta: 1 | -1) => {
    const hunks = [...(panel?.querySelectorAll<HTMLElement>(".hunk") ?? [])];
    const at = hunks.indexOf(document.activeElement?.closest<HTMLElement>(".hunk") ?? document.body);
    hunks[at === -1 ? (delta === 1 ? 0 : hunks.length - 1) : at + delta]?.focus();
  };

  const step = (delta: 1 | -1) => (mode() === "hunk" ? stepHunk(delta) : diff.stepChange(delta));
  const unit = () => (mode() === "hunk" ? "hunk" : "change");

  const onHunkKey = (event: KeyboardEvent, index: number) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target !== event.currentTarget) return;
    const section = event.currentTarget as HTMLElement;
    const hunk = diff.hunks()[index];
    const shortcuts = { s: "stage", u: "unstage", Backspace: "discard", Delete: "discard" } as const;
    const wanted = shortcuts[event.key as keyof typeof shortcuts];
    if (wanted !== undefined && hunk !== undefined && diff.actions().includes(wanted)) {
      event.preventDefault();
      diff.runHunk(wanted, hunk);
    } else if (event.key === "n" || event.key === "p") {
      const sibling = event.key === "n" ? section.nextElementSibling : section.previousElementSibling;
      if (sibling instanceof HTMLElement) {
        event.preventDefault();
        sibling.focus();
      }
    }
  };

  const openInEditor = () =>
    void client.openPath(`${props.session.snapshot().root}/${props.target.file}`, "editor").catch(props.session.report);

  return (
    <section class="panel dpanel" aria-label="Diff" aria-busy={diff.diff.isFetching} ref={panel}>
      <div class="dhead">
        <nav class="crumbs" aria-label="Breadcrumb">
          <button type="button" class="link" onClick={props.onClose}>
            Graph
          </button>
          <span aria-hidden="true">›</span>
          <span>{targetSource(props.target)}</span>
          <span aria-hidden="true">›</span>
          <Show when={diff.shown()?.original_path}>
            {(original) => (
              <>
                <span class="path">{original()}</span>
                <span aria-hidden="true">→</span>
              </>
            )}
          </Show>
          <span class="path" aria-current="page">
            {props.target.file}
          </span>
        </nav>
        <span class="spacer" />
        <span class="chip">{targetMode(props.target)}</span>
      </div>
      <div class="dtool" role="toolbar" aria-label="Diff options">
        <span class="seg" role="group" aria-label="Diff mode">
          <For each={diffModes}>
            {(entry) => (
              <button type="button" classList={{ on: mode() === entry.mode }} aria-pressed={mode() === entry.mode} onClick={() => props.prefs.setMode(entry.mode)}>
                {entry.label}
              </button>
            )}
          </For>
        </span>
        <Show when={working()}>
          <span class="dws">
            <Switch label="Ignore whitespace" checked={props.prefs.ignoreWhitespace()} onChange={props.prefs.setIgnoreWhitespace} />
            <span>Ignore whitespace</span>
          </span>
        </Show>
        <Show when={diff.blocked()}>
          {(reason) => (
            <span class="reason" role="status">
              {reason()}
            </span>
          )}
        </Show>
        <Show when={diff.selection()}>
          {(chosen) => (
            <span class="dsel" role="group" aria-label="Selected lines">
              <span class="count">{selectionLabel(chosen().lines.length)}</span>
              <For each={diff.actions()}>
                {(action) => (
                  <Show
                    when={action === "discard"}
                    fallback={
                      <button
                        type="button"
                        class="icon-btn dense"
                        {...tip(action === "stage" ? "Stage lines" : "Unstage lines", action === "stage" ? "S" : "U")}
                        onClick={() => diff.runSelection(action)}
                      >
                        <Icon name={action === "stage" ? "plus" : "minus"} />
                      </button>
                    }
                  >
                    <button type="button" class="btn sm text-danger" onClick={() => diff.runSelection(action)}>
                      <Icon name="trash" size={14} />
                      Discard lines
                    </button>
                  </Show>
                )}
              </For>
              <button type="button" class="icon-btn dense" {...tip("Clear selection", "Esc")} onClick={diff.clearSelection}>
                <Icon name="close" />
              </button>
            </span>
          )}
        </Show>
        <span class="dnav" role="group" aria-label="Change navigation">
          <button type="button" class="icon-btn dense" {...tip(`Previous ${unit()}`, "P")} onClick={() => step(-1)}>
            <Icon name="previous" />
          </button>
          <button type="button" class="icon-btn dense" {...tip(`Next ${unit()}`, "N")} onClick={() => step(1)}>
            <Icon name="next" />
          </button>
          <button type="button" class="icon-btn dense" {...tip("View file")} onClick={() => props.onViewFile(fileViewTargetOf(props.target))}>
            <Icon name="file" />
          </button>
          <button type="button" class="icon-btn dense" {...tip("Open in editor")} onClick={openInEditor}>
            <Icon name="edit" />
          </button>
        </span>
      </div>
      <div class="dbody" ref={body}>
        <Show when={diff.failure()}>{(message) => <div class="graph-error" role="alert">{message()}</div>}</Show>
        <Show when={diff.shown()}>
          {(current) => (
            <Show when={diffNotice(current(), props.target)} fallback={
              <Show
                when={mode() === "hunk"}
                fallback={
                  <VirtualRows
                    as="div"
                    class="dflat"
                    measured={mode() === "split"}
                    items={diff.flatRows()}
                    scroller={() => body}
                    estimate={LINE_ESTIMATE}
                    keepIndex={diff.keepIndex(undefined)}
                    reveal={diff.reveal()}
                  >
                    {(row, virtual) => <FlatRow diff={diff} row={row} split={mode() === "split"} virtual={virtual} />}
                  </VirtualRows>
                }
              >
                <For each={current().hunks}>
                  {(hunk, index) => (
                    <section
                      class="hunk diff"
                      tabindex="0"
                      aria-label={hunkLabel(index(), current().hunks.length, hunk)}
                      onKeyDown={(event) => onHunkKey(event, index())}
                    >
                      <div class="hunk-head">
                        <HunkHead diff={diff} hunk={hunk} />
                      </div>
                      <VirtualRows
                        as="div"
                        class="dtrack"
                        items={diff.hunkRowLists()[index()] ?? []}
                        scroller={() => body}
                        estimate={LINE_ESTIMATE}
                        keepIndex={diff.keepIndex(index())}
                        reveal={diff.reveal()?.hunk === index() ? diff.reveal() : undefined}
                      >
                        {(row, virtual) => (
                          <FlatRow diff={diff} row={row} split={false} virtual={virtual} />
                        )}
                      </VirtualRows>
                    </section>
                  )}
                </For>
              </Show>
            }>
              {(notice) => <div class="empty">{notice()}</div>}
            </Show>
          )}
        </Show>
      </div>
      <Show when={diff.pendingDiscard()}>
        {(pending) => <ConfirmDialog copy={pending().copy} onConfirm={diff.confirmDiscard} onCancel={diff.cancelDiscard} />}
      </Show>
    </section>
  );
}
