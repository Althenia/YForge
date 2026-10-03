import { keepPreviousData } from "@tanstack/solid-query";
import { useQuery } from "../state/query";
import { createSignal, Show } from "solid-js";
import type { StashEntry } from "../ipc/bindings/StashEntry";
import type { StashFile } from "../ipc/bindings/StashFile";
import { client, IpcError } from "../ipc/client";
import { createExternalTools } from "../state/externalTools";
import { sameTarget, type DiffTarget } from "../state/diffModel";
import { stashFileViewTarget, type FileViewTarget } from "../state/fileView";
import { createFolderState, useFileListMode } from "../state/fileList";
import { listRows, type ListRow } from "../state/fileTree";
import { repoKeys } from "../state/queryKeys";
import type { RepoActions } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import { bareStashMessage } from "../state/stashName";
import { Delta } from "./CommitInspector";
import { FileListTools, FileRow, FolderRow, listAttrs } from "./FileRow";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";
import { ToolButton } from "./ToolButton";
import { fileRowHeight, VirtualRows } from "./VirtualRows";

export function StashInspector(props: {
  session: RepoSession;
  stash: StashEntry;
  actions: RepoActions;
  activeTarget: DiffTarget | undefined;
  onOpenDiff: (target: DiffTarget) => void;
  onViewFile: (target: FileViewTarget) => void;
}) {
  const path = props.session.path;
  const tools = createExternalTools(props.session);
  const details = useQuery(() => ({
    queryKey: repoKeys.stash(path, props.stash.sha),
    queryFn: () => client.stashDetails(path, props.stash.index, props.stash.sha),
    placeholderData: keepPreviousData,
  }));
  let scroller: HTMLDivElement | undefined;
  const [activeRow, setActiveRow] = createSignal<string | undefined>();
  const shown = () => (details.error == null ? details.data : undefined);
  const failure = () => (details.error instanceof IpcError ? details.error.message : details.error == null ? undefined : String(details.error));
  const files = (): StashFile[] => shown()?.files ?? [];
  const untrackedCount = () => files().filter((file) => file.untracked).length;
  const target = (file: StashFile): DiffTarget => ({ source: "stash", index: props.stash.index, sha: props.stash.sha, file: file.path });
  const folders = createFolderState();
  const fileListMode = useFileListMode().mode;
  const rows = () => listRows(files(), (file) => file.path, fileListMode(), folders.isOpen("stash"));
  const rowId = (row: ListRow<StashFile>) => (row.kind === "folder" ? `${row.path}/` : row.path);
  const tabStop = (index: number, key: string) => {
    const active = activeRow();
    return active !== undefined && rows().some((row) => rowId(row) === active) ? active === key : index === 0;
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
              <FileListTools
                folders={folders.folders([{ scope: "stash", paths: files().map((file) => file.path) }])}
                anyClosed={folders.anyClosed([{ scope: "stash", paths: files().map((file) => file.path) }])}
                onCollapseAll={() => folders.collapseAll([{ scope: "stash", paths: files().map((file) => file.path) }])}
                onExpandAll={folders.expandAll}
              />
            </div>
            <Show when={files().length > 0} fallback={<div class="empty">No file changes in this stash</div>}>
              <VirtualRows
                class="flist"
                items={rows()}
                attrs={listAttrs(fileListMode(), "Files in this stash")}
                scroller={() => scroller}
                estimate={fileRowHeight()}
                keepIndex={rows().findIndex((row) => rowId(row) === activeRow())}
              >
                {(row, virtual) =>
                  row.kind === "folder" ? (
                    <FolderRow
                      rowId={rowId(row)}
                      path={row.path}
                      name={row.name}
                      depth={row.depth}
                      open={row.open}
                      count={row.items.length}
                      tabStop={tabStop(virtual.index, rowId(row))}
                      onFocusRow={setActiveRow}
                      onToggle={(open) => folders.toggle("stash", row.path, open)}
                      virtual={virtual}
                    />
                  ) : (
                    <FileRow
                      rowId={row.path}
                      path={row.path}
                      originalPath={row.item.original_path}
                      status={row.item.status}
                      selected={sameTarget(props.activeTarget, target(row.item))}
                      tabStop={tabStop(virtual.index, row.path)}
                      depth={row.depth}
                      onFocusRow={setActiveRow}
                      onOpen={() => props.onOpenDiff(target(row.item))}
                      virtual={virtual}
                    >
                      <Delta file={row.item} />
                      <span class="acts">
                        <ToolButton
                          row
                          action="Open in editor"
                          name={`Open ${row.path} in editor`}
                          icon="edit"
                          reason={tools.editorReason()}
                          onRun={() => void tools.openEditor(row.path)}
                        />
                        <Show when={row.item.status !== "deleted"}>
                          <button
                            type="button"
                            class="icon-btn dense"
                            tabindex="-1"
                            {...tip("View file", undefined, `View ${row.path}`)}
                            onClick={(event) => {
                              event.stopPropagation();
                              const current = shown();
                              if (current !== undefined) props.onViewFile(stashFileViewTarget(current, row.item));
                            }}
                          >
                            <Icon name="file" />
                          </button>
                        </Show>
                      </span>
                    </FileRow>
                  )
                }
              </VirtualRows>
            </Show>
          </section>
        </Show>
      </div>
      <div class="activity note-line">Select a file to open its diff. Esc returns to the graph.</div>
    </aside>
  );
}
