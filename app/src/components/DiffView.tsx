import { keepPreviousData, useQuery } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { FileDiff } from "../ipc/bindings/FileDiff";
import { client, IpcError } from "../ipc/client";
import { discardHunkCopy, type ConfirmCopy } from "../state/confirmCopy";
import { diffNotice, hunkActions, hunkHeader, hunkLabel, hunkRows, lineMarker, targetMode, targetSource, type DiffTarget, type HunkAction } from "../state/diffModel";
import { dataOf } from "../state/queryData";
import { repoKeys } from "../state/queryKeys";
import type { RepoSession } from "../state/repoSession";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";
import { VirtualRows } from "./VirtualRows";

const LINE_ESTIMATE = 20;

const actionLabel: Record<HunkAction, string> = { stage: "Stage hunk", unstage: "Unstage hunk", discard: "Discard hunk" };
const actionShortcut = { stage: "S", unstage: "U" } as const;

function load(path: string, target: DiffTarget): Promise<FileDiff> {
  return target.source === "working" ? client.diffFile(path, target.file, target.area) : client.commitFileDiff(path, target.sha, target.file);
}

export function DiffView(props: { session: RepoSession; target: DiffTarget; onClose: () => void }) {
  const path = props.session.path;
  const diff = useQuery(() => ({
    queryKey: repoKeys.diff(path, props.target),
    queryFn: () => load(path, props.target),
    placeholderData: keepPreviousData,
  }));
  const [pendingDiscard, setPendingDiscard] = createSignal<{ hunk: DiffHunk; copy: ConfirmCopy } | undefined>();
  const actions = () => hunkActions(props.target);
  const shown = () => (diff.error == null ? dataOf(diff) : undefined);
  const failure = () => (diff.error instanceof IpcError ? diff.error.message : diff.error == null ? undefined : String(diff.error));

  const run = (action: HunkAction, hunk: DiffHunk) => {
    const target = props.target;
    if (target.source !== "working") return;
    if (action === "discard") {
      setPendingDiscard({ hunk, copy: discardHunkCopy(target.file, hunk) });
      return;
    }
    void props.session.mutate(() => (action === "stage" ? client.stageHunk(path, target.file, hunk) : client.unstageHunk(path, target.file, hunk)));
  };

  const confirmDiscard = () => {
    const pending = pendingDiscard();
    const target = props.target;
    setPendingDiscard(undefined);
    if (pending === undefined || target.source !== "working") return;
    void props.session.mutate(() => client.discardHunk(path, target.file, pending.hunk));
  };

  let panel: HTMLElement | undefined;
  let body: HTMLDivElement | undefined;

  const stepHunk = (delta: 1 | -1) => {
    const hunks = [...(panel?.querySelectorAll<HTMLElement>(".hunk") ?? [])];
    const at = hunks.indexOf(document.activeElement?.closest<HTMLElement>(".hunk") ?? document.body);
    hunks[at === -1 ? (delta === 1 ? 0 : hunks.length - 1) : at + delta]?.focus();
  };

  const onHunkKey = (event: KeyboardEvent, hunk: DiffHunk) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.target !== event.currentTarget) return;
    const section = event.currentTarget as HTMLElement;
    const shortcuts: Record<string, HunkAction> = { s: "stage", u: "unstage", Backspace: "discard", Delete: "discard" };
    const wanted = shortcuts[event.key];
    if (wanted !== undefined && actions().includes(wanted)) {
      event.preventDefault();
      run(wanted, hunk);
    } else if (event.key === "n" || event.key === "p") {
      const sibling = event.key === "n" ? section.nextElementSibling : section.previousElementSibling;
      if (sibling instanceof HTMLElement) {
        event.preventDefault();
        sibling.focus();
      }
    }
  };

  return (
    <section class="panel dpanel" aria-label="Diff" aria-busy={diff.isFetching} ref={panel}>
      <div class="dhead">
        <nav class="crumbs" aria-label="Breadcrumb">
          <button type="button" class="link" onClick={props.onClose}>
            Graph
          </button>
          <span aria-hidden="true">›</span>
          <span>{targetSource(props.target)}</span>
          <span aria-hidden="true">›</span>
          <Show when={shown()?.original_path}>
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
          <button type="button" class="on" aria-pressed="true">
            Hunk
          </button>
          <button type="button" disabled title="Not available yet">
            Inline
          </button>
          <button type="button" disabled title="Not available yet">
            Split
          </button>
        </span>
        <span class="dnav" role="group" aria-label="Hunk navigation">
          <button type="button" class="icon-btn dense" {...tip("Previous hunk", "P")} onClick={() => stepHunk(-1)}>
            <Icon name="previous" />
          </button>
          <button type="button" class="icon-btn dense" {...tip("Next hunk", "N")} onClick={() => stepHunk(1)}>
            <Icon name="next" />
          </button>
        </span>
      </div>
      <div class="dbody" ref={body}>
        <Show when={failure()}>{(message) => <div class="graph-error" role="alert">{message()}</div>}</Show>
        <Show when={shown()}>
          {(current) => (
            <Show when={diffNotice(current(), props.target)} fallback={
              <For each={current().hunks}>
                {(hunk, index) => (
                  <section
                    class="hunk diff"
                    tabindex="0"
                    aria-label={hunkLabel(index(), current().hunks.length, hunk)}
                    onKeyDown={(event) => onHunkKey(event, hunk)}
                  >
                    <div class="hunk-head">
                      <span class="range">{hunkHeader(hunk)}</span>
                      <span class="spacer" />
                      <span class="hacts">
                        <For each={actions()}>
                          {(action) => (
                            <Show
                              when={action === "discard"}
                              fallback={
                                <button
                                  type="button"
                                  class="icon-btn dense"
                                  {...tip(actionLabel[action], actionShortcut[action as "stage" | "unstage"])}
                                  onClick={() => run(action, hunk)}
                                >
                                  <Icon name={action === "stage" ? "plus" : "minus"} />
                                </button>
                              }
                            >
                              <button type="button" class="btn sm text-danger" onClick={() => run(action, hunk)}>
                                <Icon name="trash" size={14} />
                                {actionLabel[action]}
                              </button>
                            </Show>
                          )}
                        </For>
                      </span>
                    </div>
                    <VirtualRows as="div" items={hunkRows(hunk)} scroller={() => body} estimate={LINE_ESTIMATE}>
                      {(row, virtual) => (
                        <div class="dline" classList={{ add: row.kind === "line" && row.line.kind === "added", del: row.kind === "line" && row.line.kind === "removed", note: row.kind === "note" }} ref={virtual.measure} data-index={virtual.index} style={virtual.style}>
                          <Show
                            when={row.kind === "line" && row.line}
                            fallback={
                              <>
                                <span class="ln" />
                                <span class="ln" />
                                <span class="mk" />
                                <span class="code">No newline at end of file</span>
                              </>
                            }
                          >
                            {(line) => (
                              <>
                                <span class="ln" aria-hidden="true">{line().old_number}</span>
                                <span class="ln" aria-hidden="true">{line().new_number}</span>
                                <span class="mk" aria-hidden="true">{lineMarker[line().kind]}</span>
                                <span class="code">{line().text}</span>
                              </>
                            )}
                          </Show>
                        </div>
                      )}
                    </VirtualRows>
                  </section>
                )}
              </For>
            }>
              {(notice) => <div class="empty">{notice()}</div>}
            </Show>
          )}
        </Show>
      </div>
      <Show when={pendingDiscard()}>
        {(pending) => <ConfirmDialog copy={pending().copy} onConfirm={confirmDiscard} onCancel={() => setPendingDiscard(undefined)} />}
      </Show>
    </section>
  );
}
