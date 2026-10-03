import { createEffect, createSignal, For, Show } from "solid-js";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import type { ChangeArea } from "../ipc/bindings/ChangeArea";
import type { FileChange } from "../ipc/bindings/FileChange";
import {
  areaOrder,
  canDiscard,
  changeTotal,
  extendSelection,
  filesIn,
  folderDiscardFiles,
  folderMenuEntries,
  folderStashPaths,
  isPartiallyStaged,
  neighborKey,
  pathsToMove,
  pruneSelection,
  rowKey,
  selectAll,
  selectOnly,
  selectedFiles,
  selectionMenuEntries,
  selectionPaths,
  selectionStashMessage,
  stagedFileCount,
  toggleSelected,
  type FileSelection,
} from "../state/changes";
import { featureAvailable, featuresOptions } from "../state/aiFeatures";
import { useQuery } from "../state/query";
import { createGenerateAction } from "../state/aiGenerate";
import { AI_RUNNING_REASON, useAiSheet } from "../state/aiSheet";
import { createStashMessageAction } from "../state/aiStash";
import { commitPushReason, createCommitAction, type Composer as ComposerState } from "../state/composer";
import { discardFilesCopy, discardFolderCopy, ignoreFilesCopy } from "../state/confirmCopy";
import { sameTarget, type DiffTarget, type WorkingArea } from "../state/diffModel";
import { createExternalTools } from "../state/externalTools";
import { createFolderState, useFileListMode } from "../state/fileList";
import { listRows, type FolderEntry, type ListRow } from "../state/fileTree";
import { pushRemote } from "../state/refMenu";
import type { Anchor, MenuState, RepoActions } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import { AiTrigger } from "./AiTrigger";
import { Composer } from "./Composer";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu } from "./ContextMenu";
import { FileListTools, FileRow, FolderRow, listAttrs, multiListAttrs, type PickMode } from "./FileRow";
import { Icon } from "./Icon";
import { anchorBelow } from "./TabGroupLayer";
import { ToolButton } from "./ToolButton";
import { fileRowHeight, VirtualRows, type VirtualRow } from "./VirtualRows";
import { tip } from "./Tooltip";

const sectionIcon = { conflicted: "warning", unstaged: "changes", untracked: "plus", staged: "check" } as const;

const treeAreas: readonly ChangeArea[] = ["unstaged", "untracked", "staged"];

const focusRow = (key: string) => document.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"]`)?.focus();

const folderKey = (area: ChangeArea, folder: string) => `${area}:${folder}/`;

type PendingDiscard = { files: FileChange[]; folder: string | undefined };

const discardCopy = (pending: PendingDiscard) => (pending.folder === undefined ? discardFilesCopy(pending.files) : discardFolderCopy(pending.folder, pending.files));

const keyOf = (area: ChangeArea, row: ListRow<FileChange>) => (row.kind === "folder" ? folderKey(area, row.path) : rowKey(row.item));

export function ChangesInspector(props: {
  session: RepoSession;
  actions: RepoActions;
  composer: ComposerState;
  activeTarget: DiffTarget | undefined;
  onOpenDiff: (target: DiffTarget) => void;
  onCommitted: (sha: string) => void;
}) {
  const app = useApp();
  const snapshot = () => props.session.snapshot();
  const path = props.session.path;
  const [pendingDiscard, setPendingDiscard] = createSignal<PendingDiscard | undefined>();
  const [pendingIgnore, setPendingIgnore] = createSignal<FileChange[] | undefined>();
  const [selection, setSelection] = createSignal<FileSelection | undefined>();
  const [rowMenu, setRowMenu] = createSignal<{ menu: MenuState; owner: string } | undefined>();
  const [activeRow, setActiveRow] = createSignal<string | undefined>();
  const folders = createFolderState();
  const tools = createExternalTools(props.session);
  createEffect(() => setSelection((current) => pruneSelection(current, snapshot().files)));
  const fileListMode = useFileListMode().mode;
  let summary: HTMLInputElement | undefined;
  let scroller: HTMLDivElement | undefined;

  const action = createCommitAction({
    session: props.session,
    composer: props.composer,
    staged: () => stagedFileCount(snapshot().files),
    onCommitted: props.onCommitted,
    push: async () => {
      const remote = pushRemote(snapshot().remotes);
      if (snapshot().upstream === null && remote !== undefined) await props.actions.publish(remote);
      else await props.actions.push();
    },
  });

  const generate = createGenerateAction({ session: props.session, composer: props.composer });
  const stashDraft = createStashMessageAction({ session: props.session, composer: props.composer });
  const features = useQuery(featuresOptions, () => props.session.queryClient);
  const sheet = useAiSheet();
  const sheetReason = (empty: string) => (sheet?.running() ? AI_RUNNING_REASON : total() === 0 ? empty : undefined);

  const pushReason = () =>
    commitPushReason({
      button: action.button(),
      snapshot: snapshot(),
      amend: props.composer.amend(),
      amendPushed: props.composer.pushed(),
      syncing: props.actions.sync().kind === "running",
    });

  const head = () => {
    const value = snapshot().head;
    return value.kind === "branch" ? value.name : value.kind === "unborn" ? value.branch : value.sha.slice(0, 7);
  };
  const total = () => changeTotal(snapshot().counts);
  const treeLists = () => treeAreas.map((area) => ({ scope: area, paths: filesIn(snapshot().files, area).map((file) => file.path) }));
  const rowsOf = (area: ChangeArea): ListRow<FileChange>[] =>
    listRows(filesIn(snapshot().files, area), (file) => file.path, area === "conflicted" ? "path" : fileListMode(), folders.isOpen(area));

  const move = async (staged: boolean, files: string[], next: string | undefined) => {
    await props.session.mutate(() => (staged ? client.unstageFiles(path, files) : client.stageFiles(path, files)));
    if (next !== undefined) focusRow(next);
  };

  const moveFile = (file: FileChange) =>
    move(file.area === "staged", pathsToMove(file), neighborKey(rowsOf(file.area).map((row) => keyOf(file.area, row)), rowKey(file)));

  const moveFolder = (area: ChangeArea, folder: FolderEntry<FileChange>) =>
    move(area === "staged", folder.items.flatMap(pathsToMove), neighborKey(rowsOf(area).map((row) => keyOf(area, row)), folderKey(area, folder.path)));

  const stageEverything = async () => {
    if (await props.session.mutate(() => client.stageAll(path))) summary?.focus();
  };

  const confirmDiscard = async () => {
    const pending = pendingDiscard();
    setPendingDiscard(undefined);
    if (pending === undefined) return;
    if (pending.files.some((file) => file.area === "staged")) await props.session.mutate(() => client.discardStagedFiles(path, selectionPaths(pending.files)));
    else await props.session.mutate(() => client.discardFiles(path, pending.files.map((file) => file.path)));
  };

  const ignoreFiles = (files: FileChange[], untrack: boolean) =>
    props.session.mutate(() => client.ignorePaths(path, files.map((file) => file.path), untrack));

  const confirmIgnore = async () => {
    const files = pendingIgnore();
    setPendingIgnore(undefined);
    if (files !== undefined) await ignoreFiles(files, true);
  };

  const createPatch = async (files: FileChange[]) => {
    try {
      const destination = await client.pickSavePath("Create patch", "changes.patch");
      if (destination === undefined) return;
      await client.patchCreate(path, selectionPaths(files), destination);
      props.session.inform(`Saved a patch of ${files.length === 1 ? "1 file" : `${files.length} files`} to ${destination}`);
    } catch (failure) {
      props.session.report(failure);
    }
  };

  const moveFiles = (files: FileChange[]) => {
    const paths = selectionPaths(files);
    return props.session.mutate(() => (files[0]?.area === "staged" ? client.unstageFiles(path, paths) : client.stageFiles(path, paths)));
  };

  const orderOf = (area: ChangeArea): string[] => rowsOf(area).flatMap((row) => (row.kind === "folder" ? [] : [row.item.path]));

  const isPicked = (file: FileChange): boolean => selection()?.area === file.area && selection()?.paths.includes(file.path) === true;

  const pick = (file: FileChange, mode: PickMode) =>
    setSelection((current) =>
      mode === "one"
        ? selectOnly(file.area, file.path)
        : mode === "toggle"
          ? toggleSelected(current, file.area, file.path)
          : extendSelection(current, file.area, orderOf(file.area), file.path, undefined),
    );

  const extend = (file: FileChange, step: 1 | -1) => {
    const order = orderOf(file.area);
    const next = order[order.indexOf(file.path) + step];
    if (next === undefined) return;
    setSelection((current) => extendSelection(current, file.area, order, next, file.path));
    focusRow(rowKey({ area: file.area, path: next }));
  };

  const runSelection = (id: string, files: FileChange[]) => {
    if (id === "move") void moveFiles(files);
    else if (id === "discard") setPendingDiscard({ files, folder: undefined });
    else if (id === "ignore") {
      if (files.some((file) => file.area !== "untracked")) setPendingIgnore(files);
      else void ignoreFiles(files, false);
    } else if (id === "stash") {
      void props.session.mutate(() => client.stashPushPaths(path, selectionStashMessage(files), files.some((file) => file.area === "untracked"), selectionPaths(files)));
    } else if (id === "patch") void createPatch(files);
  };

  const openFileMenu = (file: FileChange, anchor: Anchor) => {
    const current = isPicked(file) ? selection() : selectOnly(file.area, file.path);
    setSelection(current);
    const files = selectedFiles(current, snapshot().files);
    setRowMenu({
      owner: rowKey(file),
      menu: { anchor, entries: selectionMenuEntries(files), run: (id) => {
        setRowMenu(undefined);
        runSelection(id, files);
      } },
    });
  };

  const onSectionKey = (area: ChangeArea, event: KeyboardEvent) => {
    if (!(event.target instanceof HTMLElement) || event.target.closest(".flist") === null) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelection(selectAll(area, filesIn(snapshot().files, area).map((file) => file.path)));
    } else if (event.key === "Escape" && selection()?.area === area) {
      const several = (selection()?.paths.length ?? 0) > 1;
      setSelection(undefined);
      if (several) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };

  const stashFolder = (folder: string) =>
    props.session.mutate(() => client.stashPushPaths(path, `Stash ${folder}/`, true, folderStashPaths(snapshot().files, folder)));

  const openFolderMenu = (area: ChangeArea, folder: FolderEntry<FileChange>, anchor: Anchor) => {
    const discardable = folderDiscardFiles(snapshot().files, folder.path);
    setRowMenu({
      owner: folderKey(area, folder.path),
      menu: {
        anchor,
        entries: folderMenuEntries(area === "staged", discardable.length),
        run: (id) => {
          setRowMenu(undefined);
          if (id === "move") void moveFolder(area, folder);
          else if (id === "stash") void stashFolder(folder.path);
          else if (id === "discard") setPendingDiscard({ files: discardable, folder: folder.path });
        },
      },
    });
  };

  const targetOf = (file: FileChange): DiffTarget => ({ source: "working", area: file.area as WorkingArea, file: file.path });

  const onRowKey = (file: FileChange, event: KeyboardEvent) => {
    if (event.key === "s" && file.area !== "staged" && file.area !== "conflicted") {
      event.preventDefault();
      void moveFile(file);
    } else if (event.key === "u" && file.area === "staged") {
      event.preventDefault();
      void moveFile(file);
    } else if (event.key === "Backspace" || event.key === "Delete") {
      const chosen = isPicked(file) ? selectedFiles(selection(), snapshot().files) : [file];
      if (chosen.length < 2 && !canDiscard(file)) return;
      event.preventDefault();
      setPendingDiscard({ files: chosen, folder: undefined });
    }
  };

  const tabStopFor = (keys: string[], key: string, index: number) => {
    const active = activeRow();
    return active !== undefined && keys.includes(active) ? active === key : index === 0;
  };

  function MoveButton(moveProps: { staged: boolean; label: string; name: string; shortcut: string; onMove: () => void }) {
    return (
      <button
        type="button"
        class="icon-btn dense row-move"
        tabindex="-1"
        {...tip(moveProps.label, moveProps.shortcut, moveProps.name)}
        onClick={(event) => {
          event.stopPropagation();
          moveProps.onMove();
        }}
      >
        <Icon name={moveProps.staged ? "minus" : "plus"} size={14} />
      </button>
    );
  }

  function Row(rowProps: { file: FileChange; depth: number | undefined; index: number; keys: string[]; virtual: VirtualRow }) {
    const file = () => rowProps.file;
    const key = () => rowKey(file());
    const target = () => targetOf(file());
    const staged = () => file().area === "staged";
    return (
      <FileRow
        rowId={key()}
        path={file().path}
        originalPath={file().original_path}
        status={file().status}
        selected={sameTarget(props.activeTarget, target())}
        partial={isPartiallyStaged(snapshot().files, file())}
        picked={file().area === "conflicted" ? undefined : isPicked(file())}
        tabStop={tabStopFor(rowProps.keys, key(), rowProps.index)}
        depth={rowProps.depth}
        onFocusRow={setActiveRow}
        onOpen={() => props.onOpenDiff(target())}
        onPick={(mode) => file().area !== "conflicted" && pick(file(), mode)}
        onExtend={file().area === "conflicted" ? undefined : (step) => extend(file(), step)}
        onMenu={file().area === "conflicted" ? undefined : (anchor) => openFileMenu(file(), anchor)}
        onKey={(event) => onRowKey(file(), event)}
        virtual={rowProps.virtual}
      >
        <Show
          when={file().area !== "conflicted"}
          fallback={
            <span class="acts">
              <ToolButton
                row
                action="Open in external merge tool"
                name={`Open ${file().path} in external merge tool`}
                icon="merge"
                reason={tools.mergeReason()}
                onRun={() => void tools.openMerge(file().path)}
              />
              <button
                type="button"
                class="icon-btn dense"
                tabindex="-1"
                {...tip("Mark resolved", undefined, `Mark ${file().path} resolved`)}
                onClick={(event) => {
                  event.stopPropagation();
                  void props.actions.markResolved([file().path]);
                }}
              >
                <Icon name="check" />
              </button>
            </span>
          }
        >
          <span class="acts">
            <button
              type="button"
              class="icon-btn dense"
              tabindex="-1"
              {...tip("Open diff", "↵", `Open diff of ${file().path}`)}
              onClick={(event) => {
                event.stopPropagation();
                props.onOpenDiff(target());
              }}
            >
              <Icon name="diff" />
            </button>
            <ToolButton
              row
              action="Open in editor"
              name={`Open ${file().path} in editor`}
              icon="edit"
              reason={tools.editorReason()}
              onRun={() => void tools.openEditor(file().path)}
            />
            <button
              type="button"
              class="icon-btn dense"
              tabindex="-1"
              {...tip("More actions", undefined, `More actions for ${file().path}`)}
              aria-haspopup="menu"
              aria-expanded={rowMenu()?.owner === key()}
              onClick={(event) => {
                event.stopPropagation();
                openFileMenu(file(), anchorBelow(event.currentTarget));
              }}
            >
              <Icon name="more" />
            </button>
          </span>
          <MoveButton
            staged={staged()}
            label={staged() ? "Unstage" : "Stage"}
            shortcut={staged() ? "U" : "S"}
            name={`${staged() ? "Unstage" : "Stage"} ${file().path}`}
            onMove={() => void moveFile(file())}
          />
        </Show>
      </FileRow>
    );
  }

  function Section(section: { area: ChangeArea; title: string; empty: string | undefined }) {
    const files = () => filesIn(snapshot().files, section.area);
    const rows = () => rowsOf(section.area);
    const keys = () => rows().map((row) => keyOf(section.area, row));
    const mode = () => (section.area === "conflicted" ? "path" : fileListMode());
    const selectable = section.area !== "conflicted";
    const chosen = () => (selection()?.area === section.area ? selectedFiles(selection(), snapshot().files) : []);
    const bulk = () => {
      if (section.area === "unstaged" && files().length + filesIn(snapshot().files, "untracked").length > 0) {
        return { label: "Stage all", icon: "plus" as const, run: stageEverything };
      }
      if (section.area === "staged" && files().length > 0) {
        return { label: "Unstage all", icon: "minus" as const, run: () => props.session.mutate(() => client.unstageAll(path)) };
      }
      return undefined;
    };
    return (
      <Show when={files().length > 0 || section.empty !== undefined}>
        <section aria-label={section.title} onKeyDown={(event) => selectable && onSectionKey(section.area, event)}>
          <div class="lhead">
            <span class="lhead-title">
              <Icon name={sectionIcon[section.area]} />
              {section.title} <span class="count">{files().length}</span>
            </span>
            <Show
              when={chosen().length > 1}
              fallback={
                <Show when={bulk()}>
                  {(entry) => (
                    <button type="button" class="icon-btn dense" {...tip(entry().label)} onClick={() => void entry().run()}>
                      <Icon name={entry().icon} size={14} />
                    </button>
                  )}
                </Show>
              }
            >
              <button type="button" class="btn sm" onClick={() => void moveFiles(chosen())}>
                <Icon name={section.area === "staged" ? "minus" : "plus"} size={14} />
                {section.area === "staged" ? "Unstage" : "Stage"} {chosen().length} files
              </button>
            </Show>
          </div>
          <Show when={files().length > 0} fallback={<div class="empty">{section.empty}</div>}>
            <VirtualRows
              class="flist"
              items={rows()}
              attrs={selectable ? multiListAttrs(mode(), `${section.title} files`) : listAttrs(mode(), `${section.title} files`)}
              scroller={() => scroller}
              estimate={fileRowHeight()}
              keepIndex={keys().indexOf(activeRow() ?? "")}
            >
              {(row, virtual) =>
                row.kind === "folder" ? (
                  <FolderRow
                    rowId={folderKey(section.area, row.path)}
                    path={row.path}
                    name={row.name}
                    depth={row.depth}
                    open={row.open}
                    count={row.items.length}
                    tabStop={tabStopFor(keys(), folderKey(section.area, row.path), virtual.index)}
                    onFocusRow={setActiveRow}
                    onToggle={(open) => folders.toggle(section.area, row.path, open)}
                    onSpace={() => void moveFolder(section.area, row)}
                    onMenu={(anchor) => openFolderMenu(section.area, row, anchor)}
                    virtual={virtual}
                  >
                    <span class="acts">
                      <button
                        type="button"
                        class="icon-btn dense"
                        tabindex="-1"
                        {...tip("More actions", undefined, `More actions for folder ${row.path}`)}
                        aria-haspopup="menu"
                        aria-expanded={rowMenu()?.owner === folderKey(section.area, row.path)}
                        onClick={(event) => {
                          event.stopPropagation();
                          openFolderMenu(section.area, row, anchorBelow(event.currentTarget));
                        }}
                      >
                        <Icon name="more" />
                      </button>
                    </span>
                    <MoveButton
                      staged={section.area === "staged"}
                      label={section.area === "staged" ? "Unstage folder" : "Stage folder"}
                      shortcut="Space"
                      name={`${section.area === "staged" ? "Unstage" : "Stage"} folder ${row.path}`}
                      onMove={() => void moveFolder(section.area, row)}
                    />
                  </FolderRow>
                ) : (
                  <Row file={row.item} depth={row.depth} index={virtual.index} keys={keys()} virtual={virtual} />
                )
              }
            </VirtualRows>
          </Show>
        </section>
      </Show>
    );
  }

  return (
    <aside
      class="panel inspector changes"
      aria-label="Changes"
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && (props.composer.tab() === "commit" || snapshot().operation !== null)) {
          event.preventDefault();
          if (!event.shiftKey) void action.submit();
          else if (pushReason() === undefined) void action.submit({ push: true });
        }
      }}
    >
      <div class="ihead changes-head">
        <h2>
          <Icon name="changes" />
          Changes <span class="count">{total()}</span>
        </h2>
        <span class="ihead-tools">
          <Show when={sheet !== undefined && featureAvailable(features.data, "explain_changes")}>
            <AiTrigger action="Explain the working-tree changes" reason={sheetReason("There are no changes to explain")} onRun={() => void sheet?.explainChanges()} />
          </Show>
          <Show when={total() > 0}>
            <FileListTools
              folders={folders.folders(treeLists())}
              anyClosed={folders.anyClosed(treeLists())}
              onCollapseAll={() => folders.collapseAll(treeLists())}
              onExpandAll={folders.expandAll}
            />
          </Show>
        </span>
      </div>
      <div class="ilist" aria-busy={props.composer.busy()} ref={scroller}>
        <Show
          when={total() > 0}
          fallback={
            <div class="clean-state" role="status">
              <Icon name="changes" size={32} />
              <strong>Working tree clean</strong>
              <span>
                Nothing to commit on <span class="ref">{head()}</span>
              </span>
            </div>
          }
        >
          <For each={areaOrder}>{(section) => <Section {...section} />}</For>
        </Show>
      </div>
      <Composer
        snapshot={snapshot()}
        state={props.composer}
        action={action}
        generate={generate}
        generateAvailable={featureAvailable(features.data, "generate_commit")}
        stashDraft={stashDraft}
        stashDraftAvailable={featureAvailable(features.data, "stash_message")}
        compose={{
          available: sheet !== undefined && featureAvailable(features.data, "compose_commits"),
          reason: sheetReason("There are no changes to compose"),
          run: () => void sheet?.compose(),
        }}
        clean={total() === 0}
        staged={stagedFileCount(snapshot().files)}
        onOpenAiSettings={() => app.openSettings("ai")}
        pushReason={pushReason()}
        summaryRef={(element) => (summary = element)}
        stash={props.actions.stashChanges}
      />
      <Show when={rowMenu()} keyed>
        {(open) => <ContextMenu menu={open.menu} onClose={() => setRowMenu(undefined)} />}
      </Show>
      <Show when={pendingIgnore()}>
        {(files) => <ConfirmDialog copy={ignoreFilesCopy(files())} onConfirm={() => void confirmIgnore()} onCancel={() => setPendingIgnore(undefined)} />}
      </Show>
      <Show when={pendingDiscard()}>
        {(pending) => (
          <ConfirmDialog
            copy={discardCopy(pending())}
            onConfirm={() => void confirmDiscard()}
            onCancel={() => setPendingDiscard(undefined)}
          />
        )}
      </Show>
    </aside>
  );
}
