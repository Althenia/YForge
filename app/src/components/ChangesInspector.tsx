import { createSignal, For, Show } from "solid-js";
import { client } from "../ipc/client";
import type { ChangeArea } from "../ipc/bindings/ChangeArea";
import type { FileChange } from "../ipc/bindings/FileChange";
import { canDiscard, changeTotal, filesIn, isPartiallyStaged, neighborKey, pathsToMove, rowKey, stagedFileCount, areaOrder } from "../state/changes";
import { createCommitAction, type Composer as ComposerState } from "../state/composer";
import { discardFilesCopy } from "../state/confirmCopy";
import { sameTarget, type DiffTarget, type WorkingArea } from "../state/diffModel";
import type { RepoActions } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import { ActionMenu } from "./ActionMenu";
import { Composer } from "./Composer";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileRow } from "./FileRow";
import { Icon } from "./Icon";
import { fileRowHeight, VirtualRows, type VirtualRow } from "./VirtualRows";
import { tip } from "./Tooltip";

const sectionIcon = { conflicted: "warning", unstaged: "changes", untracked: "plus", staged: "check" } as const;

const focusRow = (key: string) => document.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"]`)?.focus();

export function ChangesInspector(props: {
  session: RepoSession;
  actions: RepoActions;
  composer: ComposerState;
  activeTarget: DiffTarget | undefined;
  onOpenDiff: (target: DiffTarget) => void;
  onCommitted: (sha: string) => void;
}) {
  const snapshot = () => props.session.snapshot();
  const path = props.session.path;
  const [pendingDiscard, setPendingDiscard] = createSignal<FileChange[] | undefined>();
  const [menuFor, setMenuFor] = createSignal<string | undefined>();
  const [activeRow, setActiveRow] = createSignal<string | undefined>();
  let summary: HTMLInputElement | undefined;
  let scroller: HTMLDivElement | undefined;

  const action = createCommitAction({
    session: props.session,
    composer: props.composer,
    staged: () => stagedFileCount(snapshot().files),
    onCommitted: props.onCommitted,
  });

  const head = () => {
    const value = snapshot().head;
    return value.kind === "branch" ? value.name : value.kind === "unborn" ? value.branch : value.sha.slice(0, 7);
  };
  const total = () => changeTotal(snapshot().counts);

  const moveFile = async (file: FileChange) => {
    const next = neighborKey(filesIn(snapshot().files, file.area).map(rowKey), rowKey(file));
    const staged = file.area === "staged";
    await props.session.mutate(() => (staged ? client.unstageFiles(path, pathsToMove(file)) : client.stageFiles(path, pathsToMove(file))));
    if (next !== undefined) focusRow(next);
  };

  const stageEverything = async () => {
    if (await props.session.mutate(() => client.stageAll(path))) summary?.focus();
  };

  const confirmDiscard = async () => {
    const files = pendingDiscard();
    setPendingDiscard(undefined);
    if (files === undefined) return;
    await props.session.mutate(() => client.discardFiles(path, files.map((file) => file.path)));
  };

  const targetOf = (file: FileChange): DiffTarget => ({ source: "working", area: file.area as WorkingArea, file: file.path });

  const onRowKey = (file: FileChange, event: KeyboardEvent) => {
    if (event.key === "s" && file.area !== "staged" && file.area !== "conflicted") {
      event.preventDefault();
      void moveFile(file);
    } else if (event.key === "u" && file.area === "staged") {
      event.preventDefault();
      void moveFile(file);
    } else if ((event.key === "Backspace" || event.key === "Delete") && canDiscard(file)) {
      event.preventDefault();
      setPendingDiscard([file]);
    } else if ((event.key === "F10" && event.shiftKey || event.key === "ContextMenu") && canDiscard(file)) {
      event.preventDefault();
      setMenuFor(rowKey(file));
    }
  };

  function Row(rowProps: { file: FileChange; index: number; keys: string[]; virtual: VirtualRow }) {
    const file = () => rowProps.file;
    const key = () => rowKey(file());
    const target = () => targetOf(file());
    const tabStop = () => {
      const active = activeRow();
      return active !== undefined && rowProps.keys.includes(active) ? active === key() : rowProps.index === 0;
    };
    const staged = () => file().area === "staged";
    return (
      <FileRow
        rowId={key()}
        path={file().path}
        originalPath={file().original_path}
        status={file().status}
        selected={sameTarget(props.activeTarget, target())}
        partial={isPartiallyStaged(snapshot().files, file())}
        tabStop={tabStop()}
        onFocusRow={setActiveRow}
        onOpen={() => props.onOpenDiff(target())}
        onKey={(event) => onRowKey(file(), event)}
        virtual={rowProps.virtual}
      >
        <Show
          when={file().area !== "conflicted"}
          fallback={
            <span class="acts">
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
            <button
              type="button"
              class="icon-btn dense"
              tabindex="-1"
              {...tip("Open in editor", undefined, `Open ${file().path} in editor`)}
              onClick={(event) => {
                event.stopPropagation();
                void client.openPath(`${snapshot().root}/${file().path}`, "editor").catch(props.session.report);
              }}
            >
              <Icon name="edit" />
            </button>
            <button
              type="button"
              class="icon-btn dense"
              tabindex="-1"
              {...tip(staged() ? "Unstage" : "Stage", staged() ? "U" : "S", `${staged() ? "Unstage" : "Stage"} ${file().path}`)}
              onClick={(event) => {
                event.stopPropagation();
                void moveFile(file());
              }}
            >
              <Icon name={staged() ? "minus" : "plus"} />
            </button>
            <Show when={canDiscard(file())}>
              <ActionMenu
                label={`More actions for ${file().path}`}
                open={menuFor() === key()}
                onOpenChange={(open) => setMenuFor(open ? key() : undefined)}
                items={[
                  {
                    label: file().area === "untracked" ? "Delete untracked file…" : "Discard changes…",
                    icon: "trash",
                    danger: true,
                    onSelect: () => setPendingDiscard([file()]),
                  },
                ]}
              />
            </Show>
          </span>
        </Show>
      </FileRow>
    );
  }

  function Section(section: { area: ChangeArea; title: string; empty: string | undefined }) {
    const files = () => filesIn(snapshot().files, section.area);
    const keys = () => files().map(rowKey);
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
        <section aria-label={section.title}>
          <div class="lhead">
            <span class="lhead-title">
              <Icon name={sectionIcon[section.area]} />
              {section.title} · {files().length}
            </span>
            <Show when={bulk()}>
              {(entry) => (
                <button type="button" class="btn sm" onClick={() => void entry().run()}>
                  <Icon name={entry().icon} size={14} />
                  {entry().label}
                </button>
              )}
            </Show>
          </div>
          <Show when={files().length > 0} fallback={<div class="empty">{section.empty}</div>}>
            <VirtualRows class="flist" items={files()} scroller={() => scroller} estimate={fileRowHeight()} keepIndex={keys().indexOf(activeRow() ?? "")}>
              {(file, virtual) => <Row file={file} index={virtual.index} keys={keys()} virtual={virtual} />}
            </VirtualRows>
          </Show>
        </section>
      </Show>
    );
  }

  return (
    <aside
      class="panel inspector"
      aria-label="Changes"
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void action.submit();
        }
      }}
    >
      <div class="ihead">
        <h2>
          <Icon name="changes" />
          Changes
        </h2>
        <p>
          on <span class="ref">{head()}</span> · {total()} {total() === 1 ? "file" : "files"}
        </p>
      </div>
      <div class="ilist" aria-busy={props.composer.busy()} ref={scroller}>
        <Show
          when={total() > 0}
          fallback={
            <div class="empty">
              Working tree clean. Nothing to commit on <span class="ref">{head()}</span>.
            </div>
          }
        >
          <For each={areaOrder}>{(section) => <Section {...section} />}</For>
        </Show>
      </div>
      <Composer snapshot={snapshot()} state={props.composer} action={action} summaryRef={(element) => (summary = element)} />
      <Show when={pendingDiscard()}>
        {(files) => <ConfirmDialog copy={discardFilesCopy(files())} onConfirm={() => void confirmDiscard()} onCancel={() => setPendingDiscard(undefined)} />}
      </Show>
    </aside>
  );
}
