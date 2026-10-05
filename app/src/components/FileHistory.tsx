import { keepPreviousData } from "@tanstack/solid-query";
import { createEffect, createMemo, For, on, onMount, Show } from "solid-js";
import type { BlameRun } from "../ipc/bindings/BlameRun";
import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { FileRevision } from "../ipc/bindings/FileRevision";
import { client } from "../ipc/client";
import { relativeAge } from "../format";
import { useNow } from "../state/clock";
import { createDiffController } from "../state/diffController";
import { diffModes, type DiffTarget } from "../state/diffModel";
import type { DiffPrefs } from "../state/diffPrefs";
import { blameRows, createFileHistory, historyViews, revertedNotice, revertReason, type FileHistoryState } from "../state/fileHistory";
import type { FileHistoryRequest } from "../state/fileHistoryRequest";
import { fileViewError } from "../state/fileView";
import { useQuery } from "../state/query";
import { repoKeys } from "../state/queryKeys";
import type { RepoSession } from "../state/repoSession";
import { createDiffStep, DiffBody } from "./DiffView";
import { FileBody, FileLines } from "./FileView";
import { Icon } from "./Icon";
import { Switch } from "./Switch";
import { tip } from "./Tooltip";

const optionId = (sha: string) => `file-history-${sha}`;

function ViewSwitch(props: { state: FileHistoryState }) {
  return (
    <span class="seg" role="group" aria-label="View">
      <For each={historyViews}>
        {(entry) => (
          <button type="button" classList={{ on: props.state.view() === entry.view }} aria-pressed={props.state.view() === entry.view} onClick={() => props.state.setView(entry.view)}>
            {entry.label}
          </button>
        )}
      </For>
    </span>
  );
}

function HistoryDiff(props: { session: RepoSession; state: FileHistoryState; revision: () => FileRevision; prefs: DiffPrefs }) {
  const target = (): DiffTarget => ({ source: "commit", sha: props.revision().sha, file: props.revision().path });
  const diff = createDiffController({ session: props.session, target, prefs: props.prefs, commitWhitespace: true });
  const mode = () => props.prefs.mode();
  let pane: HTMLDivElement | undefined;
  const { step, unit } = createDiffStep(diff, mode, () => pane);
  const reason = () => revertReason(props.prefs.ignoreWhitespace());

  const revert = (index: number) => {
    if (reason() !== undefined) return;
    const { sha, short, path } = props.revision();
    void props.session.mutate(() => client.revertHunk(props.session.path, sha, path, index)).then((ok) => {
      if (ok) props.session.inform(revertedNotice(path, short));
    });
  };

  const revertButton = (_: DiffHunk, index: number) => (
    <button
      type="button"
      class="btn sm"
      {...tip(reason() ?? "Undo this hunk in your working tree", undefined, "Revert hunk")}
      aria-disabled={reason() === undefined ? undefined : "true"}
      onClick={() => revert(index)}
    >
      <Icon name="undo" size={14} />
      Revert hunk
    </button>
  );

  return (
    <div class="hpane" ref={pane} aria-busy={diff.diff.isFetching}>
      <div class="dtool" role="toolbar" aria-label="History options">
        <ViewSwitch state={props.state} />
        <span class="seg" role="group" aria-label="Diff mode">
          <For each={diffModes}>
            {(entry) => (
              <button type="button" classList={{ on: mode() === entry.mode }} aria-pressed={mode() === entry.mode} onClick={() => props.prefs.setMode(entry.mode)}>
                {entry.label}
              </button>
            )}
          </For>
        </span>
        <span class="dws">
          <Switch label="Ignore whitespace" checked={props.prefs.ignoreWhitespace()} onChange={props.prefs.setIgnoreWhitespace} />
          <span>Ignore whitespace</span>
        </span>
        <span class="dnav" role="group" aria-label="Change navigation">
          <button type="button" class="icon-btn dense" {...tip(`Previous ${unit()}`, "P")} onClick={() => step(-1)}>
            <Icon name="previous" />
          </button>
          <button type="button" class="icon-btn dense" {...tip(`Next ${unit()}`, "N")} onClick={() => step(1)}>
            <Icon name="next" />
          </button>
        </span>
      </div>
      <DiffBody diff={diff} target={target()} mode={mode()} hunkActions={revertButton} />
    </div>
  );
}

function HistoryFile(props: { session: RepoSession; state: FileHistoryState; revision: () => FileRevision }) {
  return (
    <div class="hpane">
      <div class="dtool" role="toolbar" aria-label="History options">
        <ViewSwitch state={props.state} />
      </div>
      <FileBody session={props.session} file={props.revision().path} rev={props.revision().sha} />
    </div>
  );
}

function HistoryBlame(props: { session: RepoSession; state: FileHistoryState; revision: () => FileRevision; onPick: (sha: string) => void }) {
  const path = props.session.path;
  const now = useNow();
  const blame = useQuery(() => ({
    queryKey: repoKeys.read(path, "file-blame", props.revision().path, props.revision().sha),
    queryFn: () => client.fileBlame(path, props.revision().path, props.revision().sha),
    placeholderData: keepPreviousData,
  }));
  const runs = (): BlameRun[] => (blame.error == null ? (blame.data ?? []) : []);
  const rows = createMemo(() => blameRows(runs()));
  const lines = createMemo(() => rows().map((row) => row.text));
  let body: HTMLDivElement | undefined;

  const gutter = (index: number) => {
    const row = rows()[index];
    const run = row === undefined ? undefined : runs()[row.run];
    return (
      <span class="bgut" classList={{ alt: (row?.run ?? 0) % 2 === 1 }}>
        <Show when={row?.first === true && run}>
          {(entry) => (
            <button type="button" {...tip(`${entry().summary} · ${entry().short}`, undefined, `Select ${entry().short} by ${entry().author}`)} onClick={() => props.onPick(entry().sha)}>
              <span class="mono">{entry().short}</span>
              <span class="bauthor">{entry().author}</span>
              <span class="bage">{relativeAge(entry().time, now())} ago</span>
            </button>
          )}
        </Show>
      </span>
    );
  };

  return (
    <div class="hpane" aria-busy={blame.isFetching}>
      <div class="dtool" role="toolbar" aria-label="History options">
        <ViewSwitch state={props.state} />
      </div>
      <div class="dbody blame" ref={body}>
        <Show when={blame.error}>
          {(error) => (
            <div class="graph-error" role="alert">
              {fileViewError(error())}
            </div>
          )}
        </Show>
        <Show when={lines().length > 0}>
          <FileLines file={props.revision().path} lines={lines()} report={props.session.report} scroller={() => body} gutter={gutter} highlight={(index) => runs()[rows()[index]?.run ?? -1]?.sha === props.state.selected()?.sha} />
        </Show>
      </div>
    </div>
  );
}

export function FileHistory(props: { session: RepoSession; request: FileHistoryRequest; prefs: DiffPrefs; onClose: () => void; onSelectCommit: (sha: string) => void }) {
  const state = createFileHistory(props.session, props.request);
  const now = useNow();
  let list: HTMLDivElement | undefined;

  createEffect(on(() => state.selected()?.sha, (sha) => sha !== undefined && props.onSelectCommit(sha)));
  onMount(() => list?.focus());

  const onListKey = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || !state.step(event.key)) return;
    event.preventDefault();
    const sha = state.selected()?.sha;
    if (sha !== undefined) document.getElementById(optionId(sha))?.scrollIntoView({ block: "nearest" });
  };

  const pick = (sha: string) => {
    state.select(sha);
    list?.focus();
  };

  const pickBlame = (sha: string) => {
    state.select(sha);
    state.setView("diff");
    list?.focus();
  };

  const loaded = () => state.history.data !== undefined && state.history.error == null;

  return (
    <section
      class="panel dpanel hpanel"
      aria-label="File history"
      aria-busy={state.history.isFetching}
      tabindex="-1"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <div class="dhead">
        <nav class="crumbs" aria-label="Breadcrumb">
          <button type="button" class="link" onClick={props.onClose}>
            Graph
          </button>
          <span aria-hidden="true">›</span>
          <span>File history</span>
          <span aria-hidden="true">›</span>
          <span class="path" aria-current="page">
            {props.request.file}
          </span>
        </nav>
        <span class="spacer" />
        <button type="button" class="icon-btn dense" {...tip("Close file history", "Esc")} onClick={props.onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div class="hsplit">
        <div
          ref={list}
          class="hlist"
          role="listbox"
          tabindex="0"
          aria-label={`Commits that changed ${props.request.file}`}
          aria-activedescendant={state.selected() === undefined ? undefined : optionId((state.selected() as FileRevision).sha)}
          onKeyDown={onListKey}
        >
          <For each={state.revisions()}>
            {(revision) => (
              <div
                id={optionId(revision.sha)}
                class="hrow"
                classList={{ sel: state.selected()?.sha === revision.sha }}
                role="option"
                aria-selected={state.selected()?.sha === revision.sha}
                onClick={() => pick(revision.sha)}
              >
                <span class="htext">
                  <span class="hsum">{revision.summary}</span>
                  <span class="hmeta">
                    {revision.author} · {relativeAge(revision.time, now())} ago
                  </span>
                </span>
                <span class="mono hsha">{revision.short}</span>
              </div>
            )}
          </For>
        </div>
        <div class="hmain">
          <Show when={state.history.error}>
            {(error) => (
              <div class="graph-error" role="alert">
                {fileViewError(error())}
              </div>
            )}
          </Show>
          <Show when={loaded() && state.revisions().length === 0}>
            <div class="empty">No commit has changed {props.request.file} yet.</div>
          </Show>
          <Show when={state.selected() !== undefined}>
            <Show when={state.view() === "diff"}>
              <HistoryDiff session={props.session} state={state} revision={() => state.selected() as FileRevision} prefs={props.prefs} />
            </Show>
            <Show when={state.view() === "file"}>
              <HistoryFile session={props.session} state={state} revision={() => state.selected() as FileRevision} />
            </Show>
            <Show when={state.view() === "blame"}>
              <HistoryBlame session={props.session} state={state} revision={() => state.selected() as FileRevision} onPick={pickBlame} />
            </Show>
          </Show>
        </div>
      </div>
    </section>
  );
}
