import { createSignal, Show } from "solid-js";
import type { FileChange } from "../ipc/bindings/FileChange";
import { filesIn } from "../state/changes";
import type { DiffTarget } from "../state/diffModel";
import { conflictLabel, operationButtons, operationSummary, operationTitle } from "../state/operationModel";
import type { RepoActions } from "../state/repoActions";
import type { RepoSession } from "../state/repoSession";
import { MenuLabel } from "./ContextMenu";
import { FileRow } from "./FileRow";
import { Icon } from "./Icon";
import { fileRowHeight, VirtualRows } from "./VirtualRows";
import { tip } from "./Tooltip";

export function OperationInspector(props: {
  session: RepoSession;
  actions: RepoActions;
  activeTarget: DiffTarget | undefined;
  onOpenDiff: (target: DiffTarget) => void;
}) {
  const snapshot = () => props.session.snapshot();
  const operation = () => snapshot().operation;
  const conflicted = () => filesIn(snapshot().files, "conflicted");
  const resolved = () => snapshot().operation_detail?.resolved ?? [];
  const buttons = () => {
    const current = operation();
    return current === null ? undefined : operationButtons(current, conflicted().length, props.actions.operationBusy());
  };
  const [message, setMessage] = createSignal(snapshot().operation_detail?.message ?? "");
  const [activeRow, setActiveRow] = createSignal<string | undefined>();
  let scroller: HTMLDivElement | undefined;

  const openConflict = (file: FileChange) => props.onOpenDiff({ source: "working", area: "conflicted", file: file.path });
  const isOpen = (file: FileChange) => props.activeTarget?.source === "working" && props.activeTarget.area === "conflicted" && props.activeTarget.file === file.path;

  return (
    <Show when={operation()}>
      {(current) => (
        <aside class="panel inspector" aria-label={operationTitle[current()]}>
          <div class="ihead">
            <h2>{operationTitle[current()]}</h2>
            <p>
              <MenuLabel parts={operationSummary(snapshot())} />
            </p>
          </div>
          <div class="ilist" aria-busy={props.actions.operationBusy()} ref={scroller}>
            <section aria-label="Conflicted">
              <div class="lhead">
                <span class="lhead-title">
                  <Icon name="warning" />
                  Conflicted · {conflicted().length}
                </span>
              </div>
              <Show when={conflicted().length > 0} fallback={<div class="empty">No conflicts left. Continue when you are ready.</div>}>
                <VirtualRows class="flist" items={conflicted()} scroller={() => scroller} estimate={fileRowHeight()} keepIndex={conflicted().findIndex((file) => `conflicted:${file.path}` === activeRow())}>
                  {(file, virtual) => (
                      <FileRow
                        rowId={`conflicted:${file.path}`}
                        path={file.path}
                        originalPath={null}
                        status="conflicted"
                        selected={isOpen(file)}
                        tabStop={activeRow() === undefined ? virtual.index === 0 : activeRow() === `conflicted:${file.path}`}
                        onFocusRow={setActiveRow}
                        onOpen={() => openConflict(file)}
                        virtual={virtual}
                      >
                        <span class="acts">
                          <button
                            type="button"
                            class="icon-btn dense"
                            tabindex="-1"
                            {...tip("Resolve", "↵", `Resolve ${file.path}`)}
                            onClick={(event) => {
                              event.stopPropagation();
                              openConflict(file);
                            }}
                          >
                            <Icon name="merge" />
                          </button>
                          <button
                            type="button"
                            class="icon-btn dense"
                            tabindex="-1"
                            {...tip("Mark resolved", undefined, `Mark ${file.path} resolved`)}
                            onClick={(event) => {
                              event.stopPropagation();
                              void props.actions.markResolved([file.path]);
                            }}
                          >
                            <Icon name="check" />
                          </button>
                        </span>
                      </FileRow>
                  )}
                </VirtualRows>
              </Show>
            </section>
            <section aria-label="Resolved">
              <div class="lhead">
                <span class="lhead-title">
                  <Icon name="check" />
                  Resolved · {resolved().length}
                </span>
              </div>
              <Show when={resolved().length > 0} fallback={<div class="empty">No files resolved yet.</div>}>
                <VirtualRows class="flist" items={resolved()} scroller={() => scroller} estimate={fileRowHeight()}>
                  {(path, virtual) => (
                      <li class="frow" aria-label={`Resolved ${path}`} ref={virtual.measure} data-index={virtual.index} style={virtual.style}>
                        <span class="badge st-added" aria-hidden="true">
                          ✓
                        </span>
                        <span class="path">
                          <bdi dir="ltr">
                            <span class="file">{path}</span>
                          </bdi>
                        </span>
                      </li>
                  )}
                </VirtualRows>
              </Show>
            </section>
          </div>
          <div class="composer" role="group" aria-label="Continue or abort">
            <Show when={current() === "merge"}>
              <label class="input area mtext">
                <textarea aria-label="Merge message" placeholder="Merge message" value={message()} onInput={(event) => setMessage(event.currentTarget.value)} />
              </label>
            </Show>
            <div class="hrow">
              <button
                type="button"
                class="btn primary"
                disabled={buttons()?.continue.disabledReason !== undefined}
                aria-describedby={buttons()?.continue.disabledReason === undefined ? undefined : "operation-reason"}
                onClick={() => void props.actions.continueOperation(current() === "merge" ? message() : null)}
              >
                {buttons()?.continue.label}
              </button>
              <Show when={buttons()?.skip}>
                <button type="button" class="btn" disabled={props.actions.operationBusy()} onClick={() => void props.actions.skipOperation()}>
                  Skip
                </button>
              </Show>
              <span class="spacer" />
              <button type="button" class="btn danger" disabled={props.actions.operationBusy()} onClick={props.actions.abortOperation}>
                {buttons()?.abortLabel}
              </button>
            </div>
            <Show when={buttons()?.continue.disabledReason}>{(reason) => <span class="reason" id="operation-reason">{reason()}</span>}</Show>
            <Show when={conflicted().length > 0}>
              <span class="reason">{conflictLabel(conflicted().length)} left. Mark a file resolved once it has no conflict markers.</span>
            </Show>
          </div>
        </aside>
      )}
    </Show>
  );
}
