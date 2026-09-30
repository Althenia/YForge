import { For, Show } from "solid-js";
import type { Operation } from "../ipc/bindings/Operation";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { conflictLabel, firstConflict, operationButtons, operationSummary, operationTitle, stepLabel } from "../state/operationModel";
import type { RepoActions } from "../state/repoActions";
import { freshness, runningText, type SyncState } from "../state/syncModel";
import { MenuLabel } from "./ContextMenu";
import { Icon } from "./Icon";

const countLetters = [
  ["modified", "M"],
  ["added", "A"],
  ["deleted", "D"],
  ["renamed", "R"],
  ["untracked", "U"],
  ["conflicted", "!"],
] as const;

function HeadChip(props: { snapshot: RepoSnapshot }) {
  const head = () => props.snapshot.head;
  const upstream = () => props.snapshot.upstream;
  return (
    <span class="chip" classList={{ "chip-attention": head().kind === "detached" }}>
      <Show when={head().kind === "detached"} fallback={<span class="junction" aria-hidden="true" />}>
        <Icon name="warning" />
      </Show>
      HEAD
      {(() => {
        const value = head();
        switch (value.kind) {
          case "branch":
            return <span class="ref">{value.name}</span>;
          case "detached":
            return (
              <>
                <span class="ref">{value.sha.slice(0, 7)}</span>
                <span>detached</span>
              </>
            );
          case "unborn":
            return (
              <>
                <span class="ref">{value.branch}</span>
                <span>no commits yet</span>
              </>
            );
        }
      })()}
      <Show when={head().kind === "branch"}>
        <Show when={upstream()} fallback={<span>no upstream</span>}>
          {(value) => (
            <>
              <span aria-hidden="true">→</span>
              <span class="ref">{value().name}</span>
              <Show when={value().ahead_behind} fallback={<span title="Fetch to compare">—</span>}>
                {(counts) => (
                  <>
                    <span class="ahead" aria-label={`${counts().ahead} ahead`}>
                      ↑{counts().ahead}
                    </span>
                    <span aria-label={`${counts().behind} behind`}>↓{counts().behind}</span>
                    <Show when={counts().ahead > 0 && counts().behind > 0}>
                      <span>diverged</span>
                    </Show>
                  </>
                )}
              </Show>
            </>
          )}
        </Show>
      </Show>
    </span>
  );
}

function ChangesChip(props: { snapshot: RepoSnapshot; onOpen: () => void }) {
  const present = () => countLetters.filter(([key]) => props.snapshot.counts[key] > 0);
  return (
    <button type="button" class="chip" onClick={props.onOpen}>
      <Icon name="changes" />
      Changes
      <Show when={present().length > 0} fallback={<span>clean</span>}>
        <For each={present()}>
          {([key, letter]) => (
            <span class={`st st-${key}`}>
              {letter} {props.snapshot.counts[key]}
            </span>
          )}
        </For>
      </Show>
    </button>
  );
}

function FreshnessChip(props: { snapshot: RepoSnapshot }) {
  const state = () => freshness(props.snapshot.last_fetch, Math.floor(Date.now() / 1000), props.snapshot.remotes.length > 0);
  return (
    <Show when={state()}>
      {(value) => (
        <span class="chip" classList={{ "chip-success": value().tone === "fresh", "chip-attention": value().tone !== "fresh" }} title={value().text}>
          <Icon name={value().tone === "fresh" ? "check" : "warning"} />
          <span class="chip-text">{value().text}</span>
        </span>
      )}
    </Show>
  );
}

function SyncChip(props: { state: SyncState; actions: RepoActions }) {
  return (
    <>
      <Show when={props.state.kind === "running" && props.state}>
        {(running) => (
          <>
            <span class="chip" role="group" aria-label={running().label}>
              <span>{runningText(running())}</span>
              <span
                class="progress"
                role="progressbar"
                aria-label={running().label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={running().percent ?? undefined}
                classList={{ indeterminate: running().percent === null }}
              >
                <i style={{ width: `${running().percent ?? 40}%` }} />
              </span>
            </span>
            <button type="button" class="btn sm" onClick={props.actions.cancelSync}>
              Cancel
            </button>
          </>
        )}
      </Show>
      <Show when={props.state.kind === "failed" && props.state}>
        {(failed) => (
          <>
            <span class="chip chip-danger" role="alert" title={failed().hint}>
              <Icon name="warning" />
              {failed().message}
            </span>
            <span class="hint-text">{failed().hint}</span>
            <button type="button" class="btn sm" onClick={() => void props.actions.retrySync()}>
              Retry
            </button>
            <button type="button" class="btn sm" onClick={props.actions.dismissSync}>
              Dismiss
            </button>
          </>
        )}
      </Show>
    </>
  );
}

function OperationBanner(props: { snapshot: RepoSnapshot; operation: Operation; actions: RepoActions; onResolve: (file: string) => void }) {
  const conflicts = () => props.snapshot.counts.conflicted;
  const buttons = () => operationButtons(props.operation, conflicts(), props.actions.operationBusy());
  const step = () => stepLabel(props.snapshot);
  const target = () => firstConflict(props.snapshot);
  return (
    <div class="op-bar" role="group" aria-label={operationTitle[props.operation]}>
      <span>
        <MenuLabel parts={operationSummary(props.snapshot)} />
      </span>
      <Show when={step()}>{(text) => <span aria-label={text()}>· {text()}</span>}</Show>
      <Show when={conflicts() > 0}>
        <span class="st st-conflicted">! {conflictLabel(conflicts())}</span>
      </Show>
      <span class="spacer" />
      <button
        type="button"
        class="btn primary"
        disabled={buttons().resolve.disabledReason !== undefined}
        title={buttons().resolve.disabledReason}
        onClick={() => {
          const file = target();
          if (file !== undefined) props.onResolve(file);
        }}
      >
        Resolve
      </button>
      <button
        type="button"
        class="btn"
        disabled={buttons().continue.disabledReason !== undefined}
        title={buttons().continue.disabledReason}
        onClick={() => void props.actions.continueOperation(null)}
      >
        Continue
      </button>
      <Show when={buttons().skip}>
        <button type="button" class="btn" disabled={props.actions.operationBusy()} onClick={() => void props.actions.skipOperation()}>
          Skip
        </button>
      </Show>
      <button
        type="button"
        class="btn danger"
        disabled={props.actions.operationBusy()}
        aria-label={buttons().abortLabel}
        onClick={props.actions.abortOperation}
      >
        Abort
      </button>
    </div>
  );
}

export function StateStrip(props: { snapshot: RepoSnapshot; actions: RepoActions; onOpenChanges: () => void; onResolve: (file: string) => void }) {
  return (
    <div class="bar chips" role="status">
      <Show
        when={props.snapshot.operation}
        fallback={
          <>
            <HeadChip snapshot={props.snapshot} />
            <ChangesChip snapshot={props.snapshot} onOpen={props.onOpenChanges} />
            <FreshnessChip snapshot={props.snapshot} />
            <SyncChip state={props.actions.sync()} actions={props.actions} />
            <span class="spacer" />
            <span class="chip">
              <Icon name="worktree" />
              {props.snapshot.worktrees.length} {props.snapshot.worktrees.length === 1 ? "worktree" : "worktrees"}
            </span>
          </>
        }
      >
        {(operation) => <OperationBanner snapshot={props.snapshot} operation={operation()} actions={props.actions} onResolve={props.onResolve} />}
      </Show>
    </div>
  );
}
