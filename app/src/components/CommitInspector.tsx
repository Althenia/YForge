import { keepPreviousData, useQuery } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { formatAbsolute, relativeAge } from "../format";
import type { CommitFile } from "../ipc/bindings/CommitFile";
import type { GraphRef } from "../ipc/bindings/GraphRef";
import type { Signature } from "../ipc/bindings/Signature";
import { client, IpcError } from "../ipc/client";
import { dataOf } from "../state/queryData";
import { repoKeys } from "../state/queryKeys";
import { sameTarget, type DiffTarget } from "../state/diffModel";
import { FileRow } from "./FileRow";
import { Icon } from "./Icon";
import { fileRowHeight, VirtualRows } from "./VirtualRows";

const refIcon = { local_branch: "local", remote_branch: "remote", tag: "tag" } as const;

function Delta(props: { file: CommitFile }) {
  return (
    <span class="delta" aria-label={props.file.additions === null ? "binary file" : `${props.file.additions} added, ${props.file.deletions} removed`}>
      <Show when={props.file.additions !== null} fallback={<span>BIN</span>}>
        <span class="plus">+{props.file.additions}</span> <span class="minus">−{props.file.deletions}</span>
      </Show>
    </span>
  );
}

function Person(props: { label: string; who: Signature }) {
  return (
    <div class="mrow">
      <span class="k">{props.label}</span>
      <span class="v" title={props.who.email}>
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

export function CommitInspector(props: {
  path: string;
  sha: string;
  activeTarget: DiffTarget | undefined;
  onSelectCommit: (sha: string) => void;
  onOpenDiff: (target: DiffTarget) => void;
}) {
  const details = useQuery(() => ({
    queryKey: repoKeys.commit(props.path, props.sha),
    queryFn: () => client.commitDetails(props.path, props.sha),
    placeholderData: keepPreviousData,
  }));
  let scroller: HTMLDivElement | undefined;
  const [activeRow, setActiveRow] = createSignal<string | undefined>();
  const now = Math.floor(Date.now() / 1000);
  const shown = () => (details.error == null ? dataOf(details) : undefined);
  const failure = () => (details.error instanceof IpcError ? details.error.message : details.error == null ? undefined : String(details.error));
  const commitTarget = (file: CommitFile): DiffTarget => ({ source: "commit", sha: shown()?.sha ?? props.sha, file: file.path });
  const tabStop = (index: number, key: string) => {
    const files = shown()?.files ?? [];
    const active = activeRow();
    return active !== undefined && files.some((file) => file.path === active) ? active === key : index === 0;
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
            </div>
            <div class="ilist commit-body" ref={scroller}>
              <Show when={commit().body}>{(body) => <p class="cbody">{body()}</p>}</Show>
              <div class="cmeta">
                <div class="mrow">
                  <span class="k">Commit</span>
                  <span class="v sha">{commit().sha.slice(0, 7)}</span>
                </div>
                <Person label="Author" who={commit().author} />
                <Person label="Committer" who={commit().committer} />
                <div class="mrow">
                  <span class="k">Date</span>
                  <span class="v" title={formatAbsolute(commit().committer.time)}>
                    {formatAbsolute(commit().committer.time)} <span class="ago">· {relativeAge(commit().committer.time, now)} ago</span>
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
                </div>
                <Show when={commit().files.length > 0} fallback={<div class="empty">No file changes in this commit</div>}>
                  <VirtualRows class="flist" items={commit().files} scroller={() => scroller} estimate={fileRowHeight()} keepIndex={commit().files.findIndex((file) => file.path === activeRow())}>
                    {(file, virtual) => (
                      <FileRow
                        rowId={file.path}
                        path={file.path}
                        originalPath={file.original_path}
                        status={file.status}
                        selected={sameTarget(props.activeTarget, commitTarget(file))}
                        tabStop={tabStop(virtual.index, file.path)}
                        onFocusRow={setActiveRow}
                        onOpen={() => props.onOpenDiff(commitTarget(file))}
                        virtual={virtual}
                      >
                        <Delta file={file} />
                      </FileRow>
                    )}
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
