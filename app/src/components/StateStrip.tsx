import { useQuery } from "../state/query";
import { createComputed, createSignal, For, Show } from "solid-js";
import { conflictLabel as predictionLabel, type Conflict } from "../state/conflicts";
import type { DiffTarget } from "../state/diffModel";
import type { Operation } from "../ipc/bindings/Operation";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import { useNow } from "../state/clock";
import { statusIcon, statusWord } from "../state/changes";
import { conflictLabel, firstConflict, operationButtons, operationSummary, operationTitle, stepLabel } from "../state/operationModel";
import { createPendingIndicator } from "../state/pending";
import { repoKeys } from "../state/queryKeys";
import type { Anchor, RepoActions } from "../state/repoActions";
import { SHORTCUTS } from "../state/shortcuts";
import { freshness, OFFLINE_REASON, runningText, type NextStep, type SyncState } from "../state/syncModel";
import { MenuLabel } from "./ContextMenu";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { tip } from "./Tooltip";

const countStatuses = ["modified", "added", "deleted", "renamed", "untracked", "conflicted"] as const;

const anchorBelow = (element: Element): Anchor => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.bottom + 8 };
};

function HeadChip(props: { snapshot: RepoSnapshot; actions: RepoActions; onRevealHead: () => void }) {
  const head = () => props.snapshot.head;
  const upstream = () => props.snapshot.upstream;
  const branch = () => {
    const value = head();
    return value.kind === "branch" ? value : undefined;
  };
  const counts = () => upstream()?.ahead_behind;
  const headText = () => {
    const value = head();
    return value.kind === "branch" ? value.name : value.kind === "detached" ? `detached at ${value.sha.slice(0, 7)}` : "";
  };
  return (
    <span class="chip-group" classList={{ "chip-attention": head().kind === "detached" }} role="group" aria-label="HEAD, branch, and sync">
      <Show
        when={head().kind !== "unborn"}
        fallback={
          <span class="chip-seg static">
            <span class="junction" aria-hidden="true" />
            HEAD
            <span class="ref">{head().kind === "unborn" ? (head() as { branch: string }).branch : ""}</span>
            <span>no commits yet</span>
          </span>
        }
      >
        <button type="button" class="chip-seg" {...tip("Reveal HEAD in the graph", SHORTCUTS.revealHead, `Reveal HEAD in the graph: ${headText()}`)} onClick={props.onRevealHead}>
          <Show when={head().kind === "detached"} fallback={<span class="junction" aria-hidden="true" />}>
            <Icon name="warning" />
          </Show>
          HEAD
          {(() => {
            const value = head();
            if (value.kind === "branch") return <span class="ref">{value.name}</span>;
            if (value.kind === "detached") return <span>detached at <span class="ref">{value.sha.slice(0, 7)}</span></span>;
            return null;
          })()}
        </button>
      </Show>
      <Show when={branch()}>
        <button
          type="button"
          class="chip-seg"
          aria-haspopup="menu"
          aria-label={`Branch menu: ${upstream() === null ? "no upstream" : `upstream ${upstream()?.name}`}`}
          onClick={(event) => props.actions.openBranchPicker(anchorBelow(event.currentTarget))}
        >
          <Show when={upstream()} fallback={<span>no upstream</span>}>
            {(value) => (
              <>
                <span aria-hidden="true">→</span>
                <span class="ref">{value().name}</span>
              </>
            )}
          </Show>
        </button>
        <Show when={upstream()}>
          <button
            type="button"
            class="chip-seg"
            aria-haspopup="menu"
            aria-label={`Pull menu: ${counts() === null || counts() === undefined ? "counts unknown" : `${counts()?.ahead} ahead, ${counts()?.behind} behind`}`}
            onClick={(event) => props.actions.openPullMenu(anchorBelow(event.currentTarget))}
          >
            <Show when={counts()} fallback={<span title="Fetch to compare">—</span>}>
              {(value) => (
                <>
                  <span class="ahead">↑{value().ahead} ahead</span>
                  <span>↓{value().behind} behind</span>
                  <Show when={value().ahead > 0 && value().behind > 0}>
                    <span>diverged</span>
                  </Show>
                  <span>· Pull</span>
                </>
              )}
            </Show>
          </button>
        </Show>
      </Show>
    </span>
  );
}

function DetachedAction(props: { head: RepoSnapshot["head"]; actions: RepoActions }) {
  const sha = () => (props.head.kind === "detached" ? props.head.sha : undefined);
  return (
    <Show when={sha()}>
      {(value) => (
        <button type="button" class="btn sm" onClick={(event) => props.actions.openCreateBranchAt(value(), anchorBelow(event.currentTarget))}>
          <Icon name="branch" size={14} />
          Create branch here
        </button>
      )}
    </Show>
  );
}

function ChangesChip(props: { snapshot: RepoSnapshot; onOpen: () => void }) {
  const present = () => countStatuses.filter((key) => props.snapshot.counts[key] > 0);
  return (
    <button type="button" class="chip" onClick={props.onOpen}>
      <Icon name="changes" />
      Changes
      <Show when={present().length > 0} fallback={<span>clean</span>}>
        <For each={present()}>
          {(key) => (
            <span class={`st st-${key}`} role="img" aria-label={`${statusWord[key]}: ${props.snapshot.counts[key]}`} title={statusWord[key]}>
              <Icon name={statusIcon[key]} /> {props.snapshot.counts[key]}
            </span>
          )}
        </For>
      </Show>
    </button>
  );
}

function FreshnessChip(props: { snapshot: RepoSnapshot; actions: RepoActions; online: boolean }) {
  const now = useNow();
  const state = () => freshness(props.snapshot.last_fetch, now(), props.snapshot.remotes.length > 0);
  const paused = () => (props.online ? props.actions.autoFetchPause() : undefined);
  const reason = () => {
    if (!props.online) return OFFLINE_REASON;
    if (props.actions.sync().kind === "running") return "A sync is running";
    return props.snapshot.operation === null ? undefined : "Finish the operation in progress first";
  };
  return (
    <Show when={state()}>
      {(value) => {
        const text = () => {
          const reasonPaused = paused();
          return reasonPaused === undefined ? value().text : `Auto-fetch paused: ${reasonPaused}`;
        };
        const fresh = () => paused() === undefined && value().tone === "fresh";
        return (
          <button
            type="button"
            class="chip"
            classList={{ "chip-success": fresh(), "chip-attention": !fresh() }}
            aria-label={`${text()}. Fetch now`}
            title={reason() ?? `${text()}. Fetch now`}
            disabled={reason() !== undefined}
            onClick={() => void props.actions.fetchAll()}
          >
            <Icon name={fresh() ? "check" : "warning"} />
            <span class="chip-text">{text()}</span>
          </button>
        );
      }}
    </Show>
  );
}

function OfflineChip() {
  return (
    <span class="chip chip-attention" title="No network connection. Fetch, pull, and push are unavailable until you are back online.">
      <Icon name="warning" />
      Offline
    </span>
  );
}

function Notices(props: { actions: RepoActions; plain: boolean }) {
  return (
    <For each={props.actions.notices()}>
      {(notice) => (
        <span class="strip-notice" role="group" aria-label={notice.text}>
          <span classList={{ chip: !props.plain, "chip-attention": !props.plain }}>
            <Icon name={notice.icon ?? "stash"} />
            {notice.text}
          </span>
          <Show when={notice.detail}>{(detail) => <span class="hint-text">{detail()}</span>}</Show>
          <For each={notice.actions}>
            {(action) => (
              <button type="button" class="btn sm" onClick={() => void action.run()}>
                {action.label}
              </button>
            )}
          </For>
          <Show when={notice.dismiss !== false}>
            <button type="button" class="icon-btn dense" {...tip("Dismiss")} onClick={() => props.actions.dismissNotice(notice.id)}>
              <Icon name="close" size={14} />
            </button>
          </Show>
        </span>
      )}
    </For>
  );
}

function WorktreesChip(props: { snapshot: RepoSnapshot; onOpen: () => void }) {
  const worktrees = useQuery(() => ({ queryKey: repoKeys.worktrees(props.snapshot.root), queryFn: () => client.worktreeList(props.snapshot.root) }));
  const dirty = () => (worktrees.data ?? []).filter((worktree) => worktree.dirty).length;
  const count = () => props.snapshot.worktrees.length;
  return (
    <button type="button" class="chip" onClick={props.onOpen}>
      <Icon name="worktree" />
      {count()} {count() === 1 ? "worktree" : "worktrees"}
      <Show when={dirty() > 0}> · {dirty()} with changes</Show>
    </button>
  );
}

function ConflictChip(props: { conflict: Conflict; branch: string; composeReason: string | undefined; onOpenDiff: (target: DiffTarget) => void; onRebase: () => void; onCompose: () => void }) {
  const [anchor, setAnchor] = createSignal<Anchor>();
  const run = (action: () => void) => {
    setAnchor(undefined);
    action();
  };
  const fileTarget = (file: string): DiffTarget => ({ source: "range", base: props.conflict.base, head: props.conflict.target, label: `${props.conflict.target} since ${props.conflict.base.slice(0, 7)}`, file });
  return (
    <>
      <button type="button" class="chip conflict-chip" aria-haspopup="dialog" aria-expanded={anchor() !== undefined} onClick={(event) => setAnchor(anchorBelow(event.currentTarget))}>
        <span class="st st-conflicted" role="img" aria-label={statusWord.conflicted} title={statusWord.conflicted}>
          <Icon name={statusIcon.conflicted} />
        </span>
        {predictionLabel(props.conflict)}
      </button>
      <Show when={anchor()}>
        {(at) => (
          <Popover anchor={at()} label="Predicted conflict" onClose={() => setAnchor(undefined)}>
            <div class="conflict-pop">
              <p class="conflict-pop-title">{predictionLabel(props.conflict)}</p>
              <p class="setting-note">
                Merge base <span class="mono">{props.conflict.base.slice(0, 7)}</span>
              </p>
              <ul class="conflict-files">
                <For each={props.conflict.files}>
                  {(file) => (
                    <li>
                      <button type="button" class="link mono" onClick={() => run(() => props.onOpenDiff(fileTarget(file)))}>
                        {file}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <div class="foot">
                <button type="button" class="btn sm" onClick={() => run(props.onRebase)}>
                  Rebase {props.branch} onto {props.conflict.target}…
                </button>
                <button
                  type="button"
                  class="btn sm"
                  {...(props.composeReason === undefined ? {} : tip(props.composeReason, undefined, "Compose pull request anyway"))}
                  aria-disabled={props.composeReason === undefined ? undefined : "true"}
                  onClick={() => props.composeReason === undefined && run(props.onCompose)}
                >
                  Compose pull request anyway
                </button>
              </div>
            </div>
          </Popover>
        )}
      </Show>
    </>
  );
}

type Running = Extract<SyncState, { kind: "running" }>;

const nextStepLabel: Record<NextStep, string> = { pull: "Pull", push: "Push" };

function OperationPill(props: { state: SyncState; actions: RepoActions; online: boolean }) {
  const app = useApp();
  const running = () => (props.state.kind === "running" ? props.state : undefined);
  const shown = createPendingIndicator(() => running() !== undefined);
  const [last, setLast] = createSignal<Running>();
  createComputed(() => {
    const current = running();
    if (current !== undefined) setLast(current);
  });
  const progress = () => (shown() ? last() : undefined);
  const result = () => (!shown() && props.state.kind === "done" ? props.state : undefined);
  const failed = () => (!shown() && props.state.kind === "failed" ? props.state : undefined);
  const nextReason = () => (props.online ? undefined : OFFLINE_REASON);
  return (
    <>
      <Show when={progress() !== undefined || result() !== undefined}>
        <span class="chip op-pill">
          <Show
            when={progress()}
            fallback={
              <Show when={result()}>
                {(done) => (
                  <>
                    <Icon name="check" />
                    <span class="op-outcome" title={done().outcome}>
                      {done().outcome}
                    </span>
                    <Show when={done().next}>
                      {(next) => (
                        <button
                          type="button"
                          class="btn sm"
                          {...(nextReason() === undefined ? {} : tip(nextReason() ?? "", undefined, nextStepLabel[next()]))}
                          aria-disabled={nextReason() === undefined ? undefined : "true"}
                          onClick={() => nextReason() === undefined && void props.actions.runNextStep()}
                        >
                          {nextStepLabel[next()]}
                        </button>
                      )}
                    </Show>
                    <button type="button" class="icon-btn dense" {...tip("Dismiss")} onClick={props.actions.dismissSync}>
                      <Icon name="close" />
                    </button>
                  </>
                )}
              </Show>
            }
          >
            {(step) => (
              <>
                <span role="group" aria-label={step().label}>
                  {runningText(step())}
                </span>
                <span
                  class="progress"
                  role="progressbar"
                  aria-label={step().label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={step().percent ?? undefined}
                  classList={{ indeterminate: step().percent === null }}
                >
                  <i style={{ width: `${step().percent ?? 40}%` }} />
                </span>
                <Show when={running()?.cancellable}>
                  <button type="button" class="btn sm" onClick={props.actions.cancelSync}>
                    Cancel
                  </button>
                </Show>
              </>
            )}
          </Show>
        </span>
      </Show>
      <Show when={failed()}>
        {(failed) => (
          <>
            <span class="chip chip-danger" role="alert" title={failed().hint}>
              <Icon name="warning" />
              {failed().message}
            </span>
            <span class="hint-text">{failed().hint}</span>
            <button type="button" class="btn sm" title={failed().fix.label} onClick={() => app.openSettings(failed().fix.section)}>
              <Icon name="settings" />
              Fix
            </button>
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
  const buttons = () => operationButtons(props.operation, conflicts(), props.actions.operationBusy(), props.snapshot.operation_detail?.stopped_edit != null);
  const step = () => stepLabel(props.snapshot);
  const target = () => firstConflict(props.snapshot);
  return (
    <div class="op-bar" role="group" aria-label={operationTitle[props.operation]}>
      <span>
        <MenuLabel parts={operationSummary(props.snapshot)} />
      </span>
      <Show when={step()}>{(text) => <span aria-label={text()}>· {text()}</span>}</Show>
      <Show when={conflicts() > 0}>
        <span class="st st-conflicted"><span role="img" aria-label={statusWord.conflicted} title={statusWord.conflicted}><Icon name={statusIcon.conflicted} /></span> {conflictLabel(conflicts())}</span>
      </Show>
      <Notices actions={props.actions} plain />
      <span class="spacer" />
      <Show when={buttons().resolvable}>
        <Show when={buttons().showResolve}>
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
        </Show>
        <button
          type="button"
          class="btn"
          disabled={buttons().continue.disabledReason !== undefined}
          title={buttons().continue.disabledReason}
          onClick={() => void props.actions.continueOperation(null)}
        >
          Continue
        </button>
      </Show>
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
        {buttons().abortText}
      </button>
    </div>
  );
}

export function StateStrip(props: {
  snapshot: RepoSnapshot;
  actions: RepoActions;
  online: boolean;
  onOpenChanges: () => void;
  onRevealHead: () => void;
  onResolve: (file: string) => void;
  onOpenWorktrees: () => void;
  conflict?: Conflict;
  composeReason?: string;
  onOpenDiff?: (target: DiffTarget) => void;
  onCompose?: () => void;
  onShowInspector?: () => void;
}) {
  const branch = () => (props.snapshot.head.kind === "branch" ? props.snapshot.head.name : undefined);
  return (
    <div class="bar chips" role="status">
      <Show
        when={props.snapshot.operation}
        fallback={
          <>
            <HeadChip snapshot={props.snapshot} actions={props.actions} onRevealHead={props.onRevealHead} />
            <DetachedAction head={props.snapshot.head} actions={props.actions} />
            <ChangesChip snapshot={props.snapshot} onOpen={props.onOpenChanges} />
            <FreshnessChip snapshot={props.snapshot} actions={props.actions} online={props.online} />
            <Show when={branch() !== undefined ? props.conflict : undefined}>
              {(conflict) => (
                <ConflictChip
                  conflict={conflict()}
                  branch={branch() ?? ""}
                  composeReason={props.composeReason}
                  onOpenDiff={(target) => props.onOpenDiff?.(target)}
                  onRebase={() => void props.actions.startRebase(conflict().target)}
                  onCompose={() => props.onCompose?.()}
                />
              )}
            </Show>
            <Show when={!props.online}>
              <OfflineChip />
            </Show>
            <OperationPill state={props.actions.sync()} actions={props.actions} online={props.online} />
            <Notices actions={props.actions} plain={false} />
            <span class="spacer" />
            <WorktreesChip snapshot={props.snapshot} onOpen={props.onOpenWorktrees} />
            <Show when={props.onShowInspector}>
              {(open) => <button type="button" class="chip" aria-label="Show inspector" onClick={open()}><Icon name="file" />Inspector</button>}
            </Show>
          </>
        }
      >
        {(operation) => <OperationBanner snapshot={props.snapshot} operation={operation()} actions={props.actions} onResolve={props.onResolve} />}
      </Show>
    </div>
  );
}
