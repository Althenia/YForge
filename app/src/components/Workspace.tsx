import { createHotkeys } from "@tanstack/solid-hotkeys";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import type { Geometry } from "../graph/geometry";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import { undoState } from "../state/activityModel";
import { createStoreValue } from "../state/clientStore";
import { createComposer } from "../state/composer";
import { createDiffPrefs } from "../state/diffPrefs";
import { followTarget, isConflictTarget, type DiffTarget } from "../state/diffModel";
import { createRepoActions, type HistoryView, type PopoverState } from "../state/repoActions";
import { createRepoUiPrefs } from "../state/repoUiPrefs";
import { createRepoSession } from "../state/repoSession";
import { createSearch } from "../state/search";
import { isDimmed } from "../state/searchModel";
import { selectedShas, type Selection } from "../state/selection";
import { effectivePullMode } from "../state/settingsModel";
import type { WorkspaceView } from "../state/workspace";
import { ActivityBar } from "./ActivityBar";
import { BranchNameForm, StashForm } from "./BranchForms";
import { CommandBar } from "./CommandBar";
import { ConfirmDialog } from "./ConfirmDialog";
import { ConflictResolver } from "./ConflictResolver";
import { ContextMenu } from "./ContextMenu";
import { DiffView } from "./DiffView";
import { EmptyRepository } from "./EmptyRepository";
import { GraphPanel } from "./GraphPanel";
import { Inspector } from "./Inspector";
import { MergeForm, TagForm } from "./IntegrationForms";
import { PushToForm, RenameStashForm, SetUpstreamForm } from "./RemoteForms";
import { Notice } from "./Notice";
import { RebaseEditor } from "./RebaseEditor";
import { RecomposeView } from "./RecomposeView";
import { SquashDialog } from "./SquashDialog";
import { SearchBar } from "./SearchBar";
import { Sidebar } from "./Sidebar";
import { StateStrip } from "./StateStrip";
import { TabBar } from "./TabBar";

const root = document.documentElement;
const MINUTE_MS = 60_000;

export function Workspace(props: { view: Extract<WorkspaceView, { status: "ready" }>; geometry: Geometry }) {
  const app = useApp();
  const uiPrefs = createRepoUiPrefs(props.view.path, app.queryClient, (failure) => session.report(failure));
  const session = createRepoSession(props.view.path, props.view.snapshot, app.queryClient, () => uiPrefs.prefs().branch_visibility);
  const composer = createComposer();
  const diffPrefs = createDiffPrefs();
  const [selection, setSelection] = createStoreValue<Selection | undefined>(undefined);
  const [diffTarget, setDiffTarget] = createStoreValue<DiffTarget | undefined>(undefined);
  const [graphFocus, setGraphFocus] = createSignal<{ nonce: number; index?: number; ref?: string; select?: boolean } | undefined>();
  let focusNonce = 0;
  const revealRow = (index: number, select = true) => setGraphFocus({ nonce: (focusNonce += 1), index, select });
  const search = createSearch(session.searchCommits, session.report, revealRow);
  const matches = createMemo(() => new Set(search.state().rows));
  const repoSettings = () => app.repoSettings(session.path);
  const actions = createRepoActions(session, {
    selectedSha: () => {
      const current = selection();
      return current?.kind === "commit" ? current.sha : undefined;
    },
    onSelectionGone: () => select({ kind: "changes" }),
    pullMode: () => effectivePullMode(app.settings(), repoSettings()).mode,
    offline: () => !app.online(),
    inspectStash: (sha) => inspectStash(sha),
    undoEntry: (id) => app.activity().find((entry) => entry.id === id),
  });
  const popoverOf = <K extends PopoverState["kind"]>(...kinds: K[]) => {
    const state = actions.popover();
    return state !== undefined && (kinds as string[]).includes(state.kind) ? (state as Extract<PopoverState, { kind: K }>) : undefined;
  };
  const historyOf = <K extends HistoryView["kind"]>(kind: K) => {
    const view = actions.history();
    return view?.kind === kind ? (view as Extract<HistoryView, { kind: K }>) : undefined;
  };
  const undo = () => undoState(app.activity(), session.path);
  const runUndo = (id?: number) => {
    const state = undo();
    const target = id ?? (state.kind === "available" ? state.entry.id : undefined);
    if (target !== undefined) void actions.undo(target);
  };

  const focusGraph = () => document.querySelector<HTMLElement>(".gscroll")?.focus();
  const select = (next: Selection) => {
    setSelection(next);
    setDiffTarget(undefined);
  };
  const closeDiff = () => {
    setDiffTarget(undefined);
    queueMicrotask(focusGraph);
  };
  const committed = (sha: string) => {
    select({ kind: "commit", sha });
    queueMicrotask(focusGraph);
  };
  async function closeHistory(): Promise<void> {
    actions.closeHistory();
    queueMicrotask(focusGraph);
    for (const sha of selectedShas(selection())) {
      try {
        if ((await session.searchCommits(`sha:${sha}`)).rows.length === 0) {
          select({ kind: "changes" });
          return;
        }
      } catch (failure) {
        session.report(failure);
        return;
      }
    }
  }

  const unborn = () => session.snapshot().head.kind === "unborn";

  async function revealSha(sha: string, select = true): Promise<void> {
    try {
      const found = await session.searchCommits(`sha:${sha}`);
      const row = found.rows[0];
      if (row !== undefined) revealRow(row, select);
    } catch (failure) {
      session.report(failure);
    }
  }

  function revealHead(select = true): void {
    const head = session.snapshot().head;
    if (head.kind === "branch") setGraphFocus({ nonce: (focusNonce += 1), ref: head.name, select });
    else if (head.kind === "detached") void revealSha(head.sha, select);
  }

  function inspectStash(sha: string): void {
    select({ kind: "stash", sha });
    void revealSha(sha, false);
  }

  const headKey = createMemo(() => {
    const head = session.snapshot().head;
    return head.kind === "branch" ? `branch:${head.name}` : head.kind === "detached" ? `detached:${head.sha}` : "unborn";
  });
  const checkedOutBranch = createMemo(() => {
    const head = session.snapshot().head;
    return head.kind === "branch" ? head.name : undefined;
  });
  createEffect(on(headKey, () => revealHead(false)));
  createEffect(on(checkedOutBranch, () => void actions.offerSwitchStashes()));

  async function loadCommits() {
    const page = await client.repoGraph(session.path, 0, 200);
    return page.rows.flatMap((row) => (row.sha === null || row.kind === "stash" ? [] : [{ sha: row.sha, summary: row.summary, merge: row.kind === "merge", root: row.parents.length === 0 }]));
  }

  createEffect(() => {
    const target = diffTarget();
    if (target === undefined) return;
    const next = followTarget(session.snapshot().files, target);
    if (next === undefined) closeDiff();
    else if (next !== target) setDiffTarget(next);
  });

  createEffect(() => {
    const current = selection();
    if (current?.kind === "stash" && !session.snapshot().stashes.some((entry) => entry.sha === current.sha)) select({ kind: "changes" });
  });

  createEffect(() => {
    root.toggleAttribute("data-operation", session.snapshot().operation != null);
  });

  let pausedAutoFetch = false;
  createEffect(() => {
    const minutes = app.settings().auto_fetch_minutes;
    if (minutes === 0) return;
    pausedAutoFetch = false;
    const timer = setInterval(() => {
      if (pausedAutoFetch || document.hidden) return;
      void actions.autoFetch().then((ok) => {
        if (!ok) pausedAutoFetch = true;
      });
    }, minutes * MINUTE_MS);
    onCleanup(() => clearInterval(timer));
  });

  createHotkeys(
    () => [
      {
        hotkey: "Escape",
        callback: (event: KeyboardEvent) => {
          if (!event.defaultPrevented && diffTarget() !== undefined) closeDiff();
        },
      },
      ...(["Mod+G", "Mod+Shift+G"] as const).map((hotkey) => ({
        hotkey,
        options: { enabled: search.open() },
        callback: (event: KeyboardEvent) => {
          event.preventDefault();
          if (event.shiftKey) search.previous();
          else search.next();
        },
      })),
    ],
    { preventDefault: false, stopPropagation: false },
  );

  onMount(() => {
    app.setBridge({
      path: session.path,
      snapshot: session.snapshot,
      actions,
      selectedSha: () => {
        const current = selection();
        return current?.kind === "commit" ? current.sha : undefined;
      },
      selectedShas: () => selectedShas(selection()),
      revealCommit: (sha) => {
        select({ kind: "commit", sha });
        void revealSha(sha);
      },
      revealRef: (name) => setGraphFocus({ nonce: (focusNonce += 1), ref: name }),
      revealHead: () => revealHead(true),
      openSearch: search.show,
      focusComposer: () => {
        select({ kind: "changes" });
        queueMicrotask(() => document.querySelector<HTMLInputElement>('input[aria-label="Summary"]')?.focus());
      },
      loadCommits,
    });
    onCleanup(() => app.setBridge(undefined));
    const unlisten = client.onRepoChanged((change) => {
      if (change.path === session.path) void session.refresh();
    });
    onCleanup(() => void unlisten.then((stop) => stop()));
    const unlistenProgress = client.onOperationProgress(actions.onProgress);
    onCleanup(() => void unlistenProgress.then((stop) => stop()));
    client.repoWatch(session.path).catch(session.report);
  });

  return (
    <div class="app">
      <TabBar count={session.snapshot().worktrees.length} />
      <CommandBar
        snapshot={session.snapshot()}
        actions={actions}
        undo={undo()}
        onUndo={() => runUndo()}
        onPalette={() => app.setPaletteOpen(true)}
        onSearch={search.show}
      />
      <StateStrip
        snapshot={session.snapshot()}
        actions={actions}
        online={app.online()}
        onOpenChanges={() => select({ kind: "changes" })}
        onRevealHead={() => revealHead(true)}
        onResolve={(file) => setDiffTarget({ source: "working", area: "conflicted", file })}
      />
      <div class="main">
        <Sidebar snapshot={session.snapshot()} actions={actions} uiPrefs={uiPrefs} selection={selection()} onSelectStash={inspectStash} />
        <div class="center">
          <Show
            when={!unborn()}
            fallback={<EmptyRepository snapshot={session.snapshot()} actions={actions} />}
          >
            <GraphPanel
              path={session.path}
              snapshot={session.snapshot()}
              geometry={props.geometry}
              selection={selection()}
              revision={session.revision()}
              covered={diffTarget() !== undefined || historyOf("rebase") !== undefined || historyOf("recompose") !== undefined}
              actions={actions}
              dimmed={(index) => isDimmed(search.state(), matches(), index)}
              searching={search.open()}
              focus={graphFocus()}
              uiPrefs={uiPrefs}
              onSelect={select}
              onRevealHead={() => revealHead(true)}
            />
          </Show>
          <Show when={search.open()}>
            <SearchBar search={search} onClosed={focusGraph} />
          </Show>
          <Show when={historyOf("rebase")} keyed>
            {(view) => <RebaseEditor session={session} base={view.base} from={view.from} onClose={() => void closeHistory()} />}
          </Show>
          <Show when={historyOf("recompose")} keyed>
            {(view) => <RecomposeView session={session} base={view.base} onClose={() => void closeHistory()} onOpenAiSettings={() => app.openSettings("ai")} />}
          </Show>
          <Show when={actions.history() === undefined || historyOf("squash") !== undefined ? diffTarget() : undefined}>
            {(target) => (
              <Show when={isConflictTarget(target())} fallback={<DiffView session={session} target={target()} prefs={diffPrefs} onClose={closeDiff} />}>
                <ConflictResolver session={session} file={target().file} onClose={closeDiff} onOpenAiSettings={() => app.openSettings("ai")} />
              </Show>
            )}
          </Show>
        </div>
        <Inspector
          session={session}
          actions={actions}
          composer={composer}
          selection={selection()}
          activeTarget={diffTarget()}
          onOpenDiff={setDiffTarget}
          onSelectCommit={(sha) => select({ kind: "commit", sha })}
          onCommitted={committed}
        />
      </div>
      <ActivityBar info={props.view.info} root={session.snapshot().root} />
      <Show when={actions.menu()} keyed>
        {(menu) => <ContextMenu menu={menu} onClose={actions.closeMenu} />}
      </Show>
      <Show when={popoverOf("stash")} keyed>
        {(state) => <StashForm state={state} session={session} actions={actions} />}
      </Show>
      <Show when={popoverOf("create_branch", "rename_branch")} keyed>
        {(state) => <BranchNameForm state={state} session={session} actions={actions} />}
      </Show>
      <Show when={popoverOf("merge")} keyed>
        {(state) => <MergeForm state={state} actions={actions} />}
      </Show>
      <Show when={popoverOf("create_tag")} keyed>
        {(state) => <TagForm state={state} actions={actions} />}
      </Show>
      <Show when={popoverOf("set_upstream")} keyed>
        {(state) => <SetUpstreamForm state={state} snapshot={session.snapshot()} actions={actions} />}
      </Show>
      <Show when={popoverOf("push_to")} keyed>
        {(state) => <PushToForm state={state} snapshot={session.snapshot()} actions={actions} />}
      </Show>
      <Show when={popoverOf("rename_stash")} keyed>
        {(state) => <RenameStashForm state={state} actions={actions} />}
      </Show>
      <Show when={historyOf("squash")} keyed>
        {(view) => <SquashDialog session={session} shas={view.shas} onClose={() => void closeHistory()} />}
      </Show>
      <Show when={actions.dialog()} keyed>
        {(dialog) => (
          <ConfirmDialog
            copy={dialog.copy}
            onConfirm={() => {
              const run = dialog.run;
              actions.closeDialog();
              void run();
            }}
            onCancel={actions.closeDialog}
          />
        )}
      </Show>
      <Notice message={session.notice()} onDismiss={session.dismissNotice} />
    </div>
  );
}
