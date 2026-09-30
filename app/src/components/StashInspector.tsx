import { keepPreviousData, useQuery } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
import type { StashEntry } from "../ipc/bindings/StashEntry";
import type { StashFile } from "../ipc/bindings/StashFile";
import { client, IpcError } from "../ipc/client";
import { sameTarget, type DiffTarget } from "../state/diffModel";
import { dataOf } from "../state/queryData";
import { repoKeys } from "../state/queryKeys";
import type { RepoActions } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import { bareStashMessage } from "../state/stashName";
import { Delta } from "./CommitInspector";
import { FileRow } from "./FileRow";
import { Icon } from "./Icon";
import { fileRowHeight, VirtualRows } from "./VirtualRows";

export function StashInspector(props: {
  session: RepoSession;
  stash: StashEntry;
  actions: RepoActions;
  activeTarget: DiffTarget | undefined;
  onOpenDiff: (target: DiffTarget) => void;
}) {
  const path = props.session.path;
  const details = useQuery(() => ({
    queryKey: repoKeys.stash(path, props.stash.sha),
    queryFn: () => client.stashDetails(path, props.stash.index, props.stash.sha),
    placeholderData: keepPreviousData,
  }));
  let scroller: HTMLDivElement | undefined;
  const [activeRow, setActiveRow] = createSignal<string | undefined>();
  const shown = () => (details.error == null ? dataOf(details) : undefined);
  const failure = () => (details.error instanceof IpcError ? details.error.message : details.error == null ? undefined : String(details.error));
  const files = (): StashFile[] => shown()?.files ?? [];
  const untrackedCount = () => files().filter((file) => file.untracked).length;
  const target = (file: StashFile): DiffTarget => ({ source: "stash", index: props.stash.index, sha: props.stash.sha, file: file.path });
  const tabStop = (index: number, key: string) => {
    const active = activeRow();
    return active !== undefined && files().some((file) => file.path === active) ? active === key : index === 0;
  };
  const reference = () => `stash@{${props.stash.index}}`;
  const anchorOf = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.bottom + 8 };
  };
  return (
    <aside class="panel inspector" aria-label="Stash" aria-busy={details.isFetching}>
      <div class="ihead">
        <h2>
          {reference()}: {bareStashMessage(props.stash.message)}
        </h2>
        <p>
          Stash · {files().length} {files().length === 1 ? "file" : "files"} changed
        </p>
        <div class="hrow ihead-actions">
          <button type="button" class="btn sm" onClick={() => void props.actions.restoreStash("apply", props.stash)}>
            Apply
          </button>
          <button type="button" class="btn sm" onClick={() => void props.actions.restoreStash("pop", props.stash)}>
            Pop
          </button>
          <button type="button" class="btn sm" onClick={(event) => props.actions.openRenameStash(props.stash, anchorOf(event.currentTarget))}>
            Rename…
          </button>
          <button type="button" class="btn sm danger" onClick={() => props.actions.dropStash(props.stash)}>
            Drop…
          </button>
        </div>
      </div>
      <div class="ilist commit-body" ref={scroller}>
        <Show when={failure()}>{(message) => <p class="field-note error" role="alert">{message()}</p>}</Show>
        <Show when={shown()}>
          <section aria-label="Files">
            <div class="lhead">
              <span class="lhead-title">
                <Icon name="diff" />
                Files · {files().length}
                <Show when={untrackedCount() > 0}> · {untrackedCount()} untracked</Show>
              </span>
            </div>
            <Show when={files().length > 0} fallback={<div class="empty">No file changes in this stash</div>}>
              <VirtualRows class="flist" items={files()} scroller={() => scroller} estimate={fileRowHeight()} keepIndex={files().findIndex((file) => file.path === activeRow())}>
                {(file, virtual) => (
                  <FileRow
                    rowId={file.path}
                    path={file.path}
                    originalPath={file.original_path}
                    status={file.status}
                    selected={sameTarget(props.activeTarget, target(file))}
                    tabStop={tabStop(virtual.index, file.path)}
                    onFocusRow={setActiveRow}
                    onOpen={() => props.onOpenDiff(target(file))}
                    virtual={virtual}
                  >
                    <Delta file={file} />
                  </FileRow>
                )}
              </VirtualRows>
            </Show>
          </section>
        </Show>
      </div>
      <div class="activity note-line">Select a file to open its diff. Esc returns to the graph.</div>
    </aside>
  );
}
