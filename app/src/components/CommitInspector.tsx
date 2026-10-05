import { keepPreviousData } from "@tanstack/solid-query";
import { useQuery } from "../state/query";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import { formatAbsolute, relativeAge } from "../format";
import type { CommitFile } from "../ipc/bindings/CommitFile";
import type { IconName } from "../iconNames";
import type { GraphRef } from "../ipc/bindings/GraphRef";
import type { Signature } from "../ipc/bindings/Signature";
import { client, IpcError } from "../ipc/client";
import { createExternalTools } from "../state/externalTools";
import { featureAvailable, featuresOptions } from "../state/aiFeatures";
import { AI_RUNNING_REASON, useAiSheet } from "../state/aiSheet";
import { useNow } from "../state/clock";
import { repoKeys } from "../state/queryKeys";
import type { Anchor, RepoActions } from "../state/repoActions";
import type { MenuEntry } from "../state/refMenu";
import { fileViewTargetOf, type FileViewTarget } from "../state/fileView";
import { sameTarget, type DiffTarget } from "../state/diffModel";
import type { RepoSession } from "../state/repoSession";
import { createIssueChips } from "../state/jiraIssues";
import { createFolderState, useFileListMode } from "../state/fileList";
import { requestFileHistory } from "../state/fileHistoryRequest";
import { listRows, withUnchanged, type ListRow } from "../state/fileTree";
import { AiTrigger } from "./AiTrigger";
import { AuthorBadge } from "./AuthorBadge";
import { IssueChips } from "./IssueChip";
import { FileListTools, FileRow, FolderRow, listAttrs, UnchangedRow } from "./FileRow";
import { Icon } from "./Icon";
import { MessageForm } from "./MessageForm";
import { tip } from "./Tooltip";
import { ToolButton } from "./ToolButton";
import { fileRowHeight, VirtualRows } from "./VirtualRows";

const refIcon = { local_branch: "local", remote_branch: "remote", tag: "tag" } as const;

export function Delta(props: { file: Pick<CommitFile, "additions" | "deletions"> }) {
  return (
    <span class="delta" aria-label={props.file.additions === null ? "binary file" : `${props.file.additions} added, ${props.file.deletions} removed`}>
      <Show when={props.file.additions !== null} fallback={<span>BIN</span>}>
        <span class="plus">+{props.file.additions}</span> <span class="minus">−{props.file.deletions}</span>
      </Show>
    </span>
  );
}

function Person(props: { label: string; who: Signature; badge?: boolean }) {
  return (
    <div class="mrow">
      <span class="k">{props.label}</span>
      <span class="v" title={props.who.email}>
        <Show when={props.badge}>
          <AuthorBadge name={props.who.name} email={props.who.email} />
        </Show>
        {props.who.name}
      </span>
    </div>
  );
}

function RefChip(props: { entry: GraphRef }) {
  return (
    <span class="chip" title={props.entry.kind.replace("_", " ")}>
      <Icon name={refIcon[props.entry.kind]} size={14} />
      <span class="ref">{props.entry.name}</span>
    </span>
  );
}

type MenuItem = Extract<MenuEntry, { kind: "item" }>;

type Verb = { id: string; label: string; icon: IconName };

const anchorBelow = (element: Element): Anchor => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.bottom + 8 };
};

const plain = (entry: MenuItem) => entry.label.map((part) => (typeof part === "string" ? part : part.ref)).join("");

function CommitVerbs(props: { actions: RepoActions; sha: string; merge: boolean; current: string }) {
  const verbs = (): Verb[] => [
    { id: "create_branch", label: "Branch here", icon: "branch" },
    { id: "cherry_pick", label: "Cherry-pick", icon: "cherry" },
    { id: "revert", label: "Revert", icon: "undo" },
    { id: "reset", label: `Reset ${props.current} to here`, icon: "reset" },
  ];
  const items = () => props.actions.commitEntries(props.sha, props.merge).filter((entry): entry is MenuItem => entry.kind === "item");
  return (
    <div class="ihead-actions">
      <For each={verbs()}>
        {(verb) => {
          const item = () => items().find((entry) => entry.id === verb.id);
          const reason = () => item()?.disabledReason;
          return (
            <button
              type="button"
              class="icon-btn dense"
              {...tip(reason() ?? plain(item() as MenuItem), undefined, verb.label)}
              aria-disabled={reason() === undefined ? undefined : "true"}
              onClick={(event) => reason() === undefined && props.actions.runCommitItem(verb.id, props.sha, anchorBelow(event.currentTarget))}
            >
              <Icon name={verb.icon} />
            </button>
          );
        }}
      </For>
    </div>
  );
}

const OPERATION_REASON = "Finish the operation in progress first";

type CommitEntry = { path: string; item: CommitFile | undefined };

export function CommitInspector(props: {
  session: RepoSession;
  actions: RepoActions;
  sha: string;
  activeTarget: DiffTarget | undefined;
  onSelectCommit: (sha: string) => void;
  onOpenDiff: (target: DiffTarget) => void;
  onViewFile: (target: FileViewTarget) => void;
}) {
  const path = props.session.path;
  const tools = createExternalTools(props.session);
  const details = useQuery(() => ({
    queryKey: repoKeys.commit(path, props.sha),
    queryFn: () => client.commitDetails(path, props.sha),
    placeholderData: keepPreviousData,
  }));
  const features = useQuery(featuresOptions, () => props.session.queryClient);
  const sheet = useAiSheet();
  const explainable = () => sheet !== undefined && featureAvailable(features.data, "explain_commit");
  const chips = createIssueChips(() => (details.data === undefined ? [] : [`${details.data.summary}\n${details.data.body}`]));
  let scroller: HTMLDivElement | undefined;
  const [activeRow, setActiveRow] = createSignal<string | undefined>();
  const [editing, setEditing] = createSignal(false);
  createEffect(on(() => props.sha, () => setEditing(false), { defer: true }));
  const isHead = () => {
    const head = props.session.snapshot().head;
    return head.kind !== "unborn" && head.sha === shown()?.sha;
  };
  const currentLabel = () => {
    const head = props.session.snapshot().head;
    return head.kind === "branch" ? head.name : "HEAD";
  };
  const editReason = () => (props.session.snapshot().operation === null ? undefined : OPERATION_REASON);
  const now = useNow();
  const shown = () => (details.error == null ? details.data : undefined);
  const failure = () => (details.error instanceof IpcError ? details.error.message : details.error == null ? undefined : String(details.error));
  const commitTarget = (file: CommitFile): DiffTarget => ({ source: "commit", sha: shown()?.sha ?? props.sha, file: file.path });
  const folders = createFolderState();
  const fileListMode = useFileListMode().mode;
  const [viewAll, setViewAll] = createSignal(false);
  createEffect(on(() => props.sha, () => setViewAll(false), { defer: true }));
  const treePaths = useQuery(() => ({
    queryKey: [...repoKeys.commit(path, props.sha), "tree-paths"],
    queryFn: () => client.commitTreePaths(path, props.sha),
    enabled: viewAll(),
  }));
  const treeFailure = () => (treePaths.error instanceof IpcError ? treePaths.error.message : treePaths.error == null ? undefined : String(treePaths.error));
  const entries = (files: readonly CommitFile[]): CommitEntry[] =>
    viewAll() && treePaths.data !== undefined ? withUnchanged(files, (file) => file.path, treePaths.data) : files.map((file) => ({ path: file.path, item: file }));
  const fileRows = (files: readonly CommitFile[]) => listRows(entries(files), (entry) => entry.path, fileListMode(), folders.isOpen("commit"));
  const rowId = (row: ListRow<CommitEntry>) => (row.kind === "folder" ? `${row.path}/` : row.path);
  const tabStop = (index: number, key: string) => {
    const active = activeRow();
    return active !== undefined && fileRows(shown()?.files ?? []).some((row) => rowId(row) === active) ? active === key : index === 0;
  };
  return (
    <aside class="panel inspector" aria-label="Commit" aria-busy={details.isFetching}>
      <Show
        when={shown()}
        fallback={
          <div class="ihead">
            <h2>{failure() === undefined ? "Loading commit…" : "Commit unavailable"}</h2>
            <p class="ref">{props.sha.slice(0, 7)}</p>
            <Show when={failure()}>{(message) => <p role="alert">{message()}</p>}</Show>
          </div>
        }
      >
        {(commit) => (
          <>
            <div class="ihead">
              <h2>{commit().summary || "(no message)"}</h2>
              <p>{commit().parents.length > 1 ? "Merge commit" : "Commit"} · {commit().parents.length} {commit().parents.length === 1 ? "parent" : "parents"}</p>
              <Show when={explainable() || (isHead() && !editing())}>
                <span class="ihead-action ihead-tools">
                  <Show when={explainable()}>
                    <AiTrigger action="Explain this commit" reason={sheet?.running() ? AI_RUNNING_REASON : undefined} onRun={() => void sheet?.explainCommit(commit().sha)} />
                  </Show>
                  <Show when={isHead() && !editing()}>
                    <button
                      type="button"
                      class="icon-btn dense"
                      {...tip(editReason() ?? "Edit message", undefined, "Edit message")}
                      aria-disabled={editReason() === undefined ? undefined : "true"}
                      onClick={() => editReason() === undefined && setEditing(true)}
                    >
                      <Icon name="edit" />
                    </button>
                  </Show>
                </span>
              </Show>
              <CommitVerbs actions={props.actions} sha={commit().sha} merge={commit().parents.length > 1} current={currentLabel()} />
            </div>
            <div class="ilist commit-body" ref={scroller}>
              <Show when={editing()}>
                <MessageForm session={props.session} generateAvailable={featureAvailable(features.data, "generate_commit")} onClose={() => setEditing(false)} onSaved={props.onSelectCommit} />
              </Show>
              <Show when={commit().body && !editing()}>{(body) => <p class="cbody">{body()}</p>}</Show>
              <div class="cmeta">
                <Show when={chips.keysFor(`${commit().summary}\n${commit().body}`).length > 0}>
                  <div class="mrow">
                    <span class="k">Issues</span>
                    <span class="v issue-chips">
                      <IssueChips keys={chips.keysFor(`${commit().summary}\n${commit().body}`)} lookup={chips.lookup} />
                      <For each={chips.keysFor(`${commit().summary}\n${commit().body}`)}>
                        {(key) => (
                          <Show when={chips.lookup(key)}>
                            {(found) => (
                              <span class="issue-detail">
                                {found().issue === null ? `${key}: issue details unavailable${found().failure === null ? "" : `: ${found().failure}`}` : `${key} ${found().issue?.summary} · ${found().issue?.status}`}
                              </span>
                            )}
                          </Show>
                        )}
                      </For>
                    </span>
                  </div>
                </Show>
                <div class="mrow">
                  <span class="k">Commit</span>
                  <span class="v sha">{commit().sha.slice(0, 7)}</span>
                </div>
                <Person label="Author" who={commit().author} badge />
                <Person label="Committer" who={commit().committer} />
                <div class="mrow">
                  <span class="k">Date</span>
                  <span class="v" title={formatAbsolute(commit().committer.time)}>
                    {formatAbsolute(commit().committer.time)} <span class="ago">· {relativeAge(commit().committer.time, now())} ago</span>
                  </span>
                </div>
                <div class="mrow">
                  <span class="k">Parents</span>
                  <span class="v">
                    <Show when={commit().parents.length > 0} fallback={<span class="ago">none</span>}>
                      <For each={commit().parents}>
                        {(parent) => (
                          <button type="button" class="link" aria-label={`Select parent ${parent.slice(0, 7)}`} onClick={() => props.onSelectCommit(parent)}>
                            {parent.slice(0, 7)}
                          </button>
                        )}
                      </For>
                    </Show>
                  </span>
                </div>
                <div class="mrow">
                  <span class="k">Refs</span>
                  <span class="v">
                    <Show when={commit().refs.length > 0} fallback={<span class="ago">none</span>}>
                      <For each={commit().refs}>{(entry) => <RefChip entry={entry} />}</For>
                    </Show>
                  </span>
                </div>
              </div>
              <section aria-label="Files">
                <div class="lhead">
                  <span class="lhead-title">
                    <Icon name="diff" />
                    Files · {commit().files.length}
                  </span>
                  <span class="lhead-tools">
                    <FileListTools
                      folders={folders.folders([{ scope: "commit", paths: entries(commit().files).map((entry) => entry.path) }])}
                      anyClosed={folders.anyClosed([{ scope: "commit", paths: entries(commit().files).map((entry) => entry.path) }])}
                      onCollapseAll={() => folders.collapseAll([{ scope: "commit", paths: entries(commit().files).map((entry) => entry.path) }])}
                      onExpandAll={folders.expandAll}
                    />
                    <button
                      type="button"
                      class="chip-toggle"
                      role="checkbox"
                      aria-checked={viewAll()}
                      aria-busy={viewAll() && treePaths.isFetching}
                      title="Also list the files this commit did not change"
                      onClick={() => setViewAll(!viewAll())}
                    >
                      <Icon name="file" size={14} />
                      View all files
                    </button>
                  </span>
                </div>
                <Show when={viewAll() && treeFailure()}>{(message) => <p class="field-note error" role="alert">{message()}</p>}</Show>
                <Show when={entries(commit().files).length > 0} fallback={<div class="empty">No file changes in this commit</div>}>
                  <VirtualRows
                    class="flist"
                    items={fileRows(commit().files)}
                    attrs={listAttrs(fileListMode(), "Files in this commit")}
                    scroller={() => scroller}
                    estimate={fileRowHeight()}
                    keepIndex={fileRows(commit().files).findIndex((row) => rowId(row) === activeRow())}
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
                          onToggle={(open) => folders.toggle("commit", row.path, open)}
                          virtual={virtual}
                        />
                      ) : (
                        <Show
                          when={row.item.item}
                          fallback={<UnchangedRow rowId={row.path} path={row.path} depth={row.depth} tabStop={tabStop(virtual.index, row.path)} onFocusRow={setActiveRow} virtual={virtual} />}
                        >
                          {(file) => (
                            <FileRow
                              rowId={row.path}
                              path={row.path}
                              originalPath={file().original_path}
                              status={file().status}
                              selected={sameTarget(props.activeTarget, commitTarget(file()))}
                              tabStop={tabStop(virtual.index, row.path)}
                              depth={row.depth}
                              onFocusRow={setActiveRow}
                              onOpen={() => props.onOpenDiff(commitTarget(file()))}
                              virtual={virtual}
                            >
                              <Delta file={file()} />
                              <span class="acts">
                                <button
                                  type="button"
                                  class="icon-btn dense"
                                  tabindex="-1"
                                  {...tip("History", undefined, `History of ${row.path}`)}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    requestFileHistory({ file: row.path, sha: shown()?.sha ?? props.sha });
                                  }}
                                >
                                  <Icon name="history" />
                                </button>
                                <ToolButton
                                  row
                                  action="Open in editor"
                                  name={`Open ${row.path} in editor`}
                                  icon="edit"
                                  reason={tools.editorReason()}
                                  onRun={() => void tools.openEditor(row.path)}
                                />
                                <Show when={file().status !== "deleted"}>
                                  <button
                                    type="button"
                                    class="icon-btn dense"
                                    tabindex="-1"
                                    {...tip("View file", undefined, `View ${row.path}`)}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      props.onViewFile(fileViewTargetOf(commitTarget(file())));
                                    }}
                                  >
                                    <Icon name="file" />
                                  </button>
                                </Show>
                              </span>
                            </FileRow>
                          )}
                        </Show>
                      )
                    }
                  </VirtualRows>
                </Show>
              </section>
            </div>
            <div class="activity note-line">Select a file to open its diff. Esc returns to the graph.</div>
          </>
        )}
      </Show>
    </aside>
  );
}
