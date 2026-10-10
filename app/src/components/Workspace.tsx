import { createConflictPredictions } from "../state/conflicts";
import { COMPOSE_NEEDS_PLATFORM } from "../state/platformModel";
import { createHotkeys } from "@tanstack/solid-hotkeys";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import type { Geometry } from "../graph/geometry";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import { redoState, undoState } from "../state/activityModel";
import { createStoreValue } from "../state/clientStore";
import { AiSheetContext, createAiSheet } from "../state/aiSheet";
import { createComposer } from "../state/composer";
import { commitMessageOf } from "../state/hooks";
import { createDiffPrefs } from "../state/diffPrefs";
import { followTarget, isConflictTarget, type DiffTarget } from "../state/diffModel";
import { createRepoActions, type HistoryView, type PopoverState } from "../state/repoActions";
import { createRepoUiPrefs } from "../state/repoUiPrefs";
import type { PanelRequest } from "../state/palette";
import { createWorktreeActions } from "../state/worktreeActions";
import { createPlatformActions } from "../state/platformActions";
import { createIssueChips, createJiraIssues, type JiraSidebar } from "../state/jiraIssues";
import { pullText } from "../state/jiraModel";
import { takePullInspector } from "../state/connectRequest";
import { takeFileHistoryRequest, type FileHistoryRequest } from "../state/fileHistoryRequest";
import { createRepoSession } from "../state/repoSession";
import { createSearch } from "../state/search";
import { isDimmed } from "../state/searchModel";
import { selectedShas, type Selection } from "../state/selection";
import type { FileViewTarget } from "../state/fileView";
import { effectivePullMode } from "../state/settingsModel";
import type { WorkspaceView } from "../state/workspace";
import { ActivityBar } from "./ActivityBar";
import { AiSheet } from "./AiSheet";
import { BranchNameForm, StashForm } from "./BranchForms";
import { CommandBar } from "./CommandBar";
import { ComposePullView } from "./ComposePullView";
import { ConfirmDialog } from "./ConfirmDialog";
import { ConflictResolver } from "./ConflictResolver";
import { ContextMenu } from "./ContextMenu";
import { DiffView } from "./DiffView";
import { FileHistory } from "./FileHistory";
import { FileView } from "./FileView";
import { FileEditor } from "./FileEditor";
import { CreateFileDialog, FilePickerDialog } from "./FileDialogs";
import { EmptyRepository } from "./EmptyRepository";
import { GraphPanel } from "./GraphPanel";
import { Inspector } from "./Inspector";
import { MergeForm, TagForm } from "./IntegrationForms";
import { PushToForm, RenameStashForm, SetUpstreamForm } from "./RemoteForms";
import { RebaseEditor } from "./RebaseEditor";
import { RecomposeView } from "./RecomposeView";
import { SquashDialog } from "./SquashDialog";
import { CreateWorktreeDialog, IntegrateWorktreeDialog } from "./WorktreeDialogs";
import { RecoveryView, type RecoveryTab } from "./RecoveryView";
import { WorktreePanel } from "./WorktreePanel";
import { SearchBar } from "./SearchBar";
import { Sidebar } from "./Sidebar";
import { StateStrip } from "./StateStrip";
import { TabBar } from "./TabBar";

type Panel = { kind: "worktrees" } | { kind: "recovery"; tab: RecoveryTab };

const MINUTE_MS = 60_000;

export function Workspace(props: { view: Extract<WorkspaceView, { status: "ready" }>; geometry: Geometry }) {
  const app = useApp();
  const uiPrefs = createRepoUiPrefs(props.view.path, app.queryClient, (failure) => session.report(failure));
  const session = createRepoSession(props.view.path, props.view.snapshot, app.queryClient, () => uiPrefs.prefs().branch_visibility);
  onCleanup(app.showRepoNotice({ message: session.notice, dismiss: session.dismissNotice }));
  const worktrees = createWorktreeActions(session, { openRepository: app.openRepository, closeTabsAt: app.closeTabsAt, notify: app.setNotice });
  const [panel, setPanel] = createSignal<Panel | undefined>();
  const [fileTarget, setFileTarget] = createSignal<FileViewTarget | undefined>();
  const [historyRequest, setHistoryRequest] = createSignal<FileHistoryRequest | undefined>();
  const composer = createComposer();
  const aiSheet = createAiSheet(session);
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
    submoduleUpdateOnFetch: () => repoSettings()?.submodule_update_on_fetch === true,
    showFile: (target) => viewFile(target),
  });
  createEffect(on(selection, (current) => selectedShas(current).forEach(actions.seeIncoming)));
  const platform = createPlatformActions(session, {
    notify: session.inform,
    fetchAll: () => actions.fetchAll(),
    openSettings: () => app.openSettings("platforms"),
    announce: app.announce,
    showPull: (number) => select({ kind: "pull", number }),
  });
  const conflicts = createConflictPredictions(session, () => platform.pullLookup());
  const jira: JiraSidebar = {
    state: createJiraIssues(),
    select: (key) => select({ kind: "issue", key }),
    chips: createIssueChips(() => [...session.snapshot().branches, ...platform.pulls().map(pullText)]),
    openSettings: () => app.openSettings("jira"),
    openInBrowser: (issue) => {
      try {
        client.openUrl(issue.web_url);
      } catch (failure) {
        session.report(failure);
      }
    },
  };
  createEffect(() => {
    const problem = platform.matchFailure();
    if (problem !== undefined) session.inform(problem.message);
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
  const redo = () => redoState(app.redoScopes(), session.path);
  const runRedo = async (): Promise<void> => {
    try {
      await client.redo(session.path);
    } catch (failure) {
      session.report(failure);
    }
    await session.refresh();
  };
  const createAnnotatedTag = async (name: string, message: string): Promise<void> => {
    try {
      await client.createTag(session.path, name, selectedShaOf(selection()) ?? null, message);
    } catch (failure) {
      session.report(failure);
    }
    await session.refresh();
  };
  const selectedShaOf = (current: Selection | undefined) => (current?.kind === "commit" ? current.sha : undefined);

  createEffect(() => {
    if (actions.files.editing() === undefined) return;
    setPanel(undefined);
    setFileTarget(undefined);
    setHistoryRequest(undefined);
    setDiffTarget(undefined);
  });
  const closeEditor = () => {
    actions.files.closeEditor();
    queueMicrotask(focusGraph);
  };
  const closeFile = () => {
    setFileTarget(undefined);
    queueMicrotask(focusGraph);
  };
  const viewFile = (target: FileViewTarget) => {
    setPanel(undefined);
    setHistoryRequest(undefined);
    setFileTarget(target);
  };
  const openHistory = (request: FileHistoryRequest) => {
    setPanel(undefined);
    setFileTarget(undefined);
    setDiffTarget(undefined);
    setHistoryRequest(request);
  };
  const closeFileHistory = () => {
    setHistoryRequest(undefined);
    queueMicrotask(focusGraph);
  };
  const closePanel = () => {
    setPanel(undefined);
    queueMicrotask(focusGraph);
  };
  const openPanel = (next: Panel) => {
    setDiffTarget(undefined);
    setFileTarget(undefined);
    setHistoryRequest(undefined);
    setPanel(next);
  };
  const requestPanel = (request: PanelRequest) => {
    if (request === "reflog" || request === "lost" || request === "snapshots") openPanel({ kind: "recovery", tab: request });
    else {
      openPanel({ kind: "worktrees" });
      if (request === "create_worktree") worktrees.openCreate();
    }
  };
  const showDiff = (target: DiffTarget | undefined) => {
    if (target !== undefined) {
      setPanel(undefined);
      setFileTarget(undefined);
      setHistoryRequest(undefined);
    }
    setDiffTarget(target);
  };

  const focusGraph = () => document.querySelector<HTMLElement>(".gscroll")?.focus();
  const select = (next: Selection) => {
    setSelection(next);
    setDiffTarget(undefined);
  };
  createEffect(() => {
    const number = takePullInspector(session.path);
    if (number !== undefined) select({ kind: "pull", number });
  });
  createEffect(() => {
    const request = takeFileHistoryRequest();
    if (request !== undefined) openHistory(request);
  });
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
    const minutes = app.settings().auto_fetch_minutes;
    if (minutes === 0) return;
    const timer = setInterval(() => {
      if (!document.hidden) void actions.autoFetch();
    }, minutes * MINUTE_MS);
    onCleanup(() => clearInterval(timer));
  });

  createHotkeys(
    () => [
      {
        hotkey: "Escape",
        callback: (event: KeyboardEvent) => {
          if (event.defaultPrevented) return;
          event.preventDefault();
          if (aiSheet.target() !== undefined) aiSheet.close();
          else if (fileTarget() !== undefined) closeFile();
          else if (historyRequest() !== undefined) closeFileHistory();
          else if (diffTarget() !== undefined) closeDiff();
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
      viewChanges: () => {
        app.showInspector();
        select({ kind: "changes" });
      },
      redo: runRedo,
      refresh: session.refresh,
      createTag: createAnnotatedTag,
      focusComposer: () => {
        app.showInspector();
        select({ kind: "changes" });
        queueMicrotask(() => document.querySelector<HTMLInputElement>('input[aria-label="Summary"]')?.focus());
      },
      loadCommits,
      openPanel: requestPanel,
      platform,
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
    <AiSheetContext.Provider value={aiSheet}>
      <div class="app">
        <TabBar count={session.snapshot().worktrees.length} />
        <CommandBar
          snapshot={session.snapshot()}
          actions={actions}
          undo={undo()}
          online={app.online()}
          pullMode={effectivePullMode(app.settings(), repoSettings()).mode}
          onUndo={() => runUndo()}
          redo={redo()}
          onRedo={() => void runRedo()}
          onPalette={() => app.setPaletteOpen(true)}
          onSearch={search.show}
        />
        <StateStrip
          snapshot={session.snapshot()}
          actions={actions}
          online={app.online()}
          onOpenChanges={() => select({ kind: "changes" })}
          onRevealHead={() => revealHead(true)}
          onResolve={(file) => showDiff({ source: "working", area: "conflicted", file })}
          onOpenWorktrees={() => openPanel({ kind: "worktrees" })}
          conflict={conflicts.current()}
          composeReason={platform.matched() === undefined ? COMPOSE_NEEDS_PLATFORM : undefined}
          onOpenDiff={showDiff}
          onCompose={() => {
            const conflict = conflicts.current();
            const head = session.snapshot().head;
            const prefix = `${platform.matched()?.remote ?? ""}/`;
            void platform.openCompose({
              source: head.kind === "branch" ? head.name : undefined,
              target: conflict !== undefined && conflict.target.startsWith(prefix) ? conflict.target.slice(prefix.length) : undefined,
            });
          }}
        />
        <div class="main" classList={{ "no-sidebar": app.sidebarHidden(), "no-inspector": app.inspectorHidden() }}>
          <Sidebar snapshot={session.snapshot()} actions={actions} conflictOf={conflicts.conflictOf} worktrees={worktrees} uiPrefs={uiPrefs} selection={selection()} onSelectStash={inspectStash} onOpenPanel={requestPanel} platform={platform} jira={jira} onSelectPull={(number) => select({ kind: "pull", number })} commitMessage={() => commitMessageOf(composer.summary(), composer.description())} />
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
                covered={platform.compose() !== undefined || diffTarget() !== undefined || panel() !== undefined || fileTarget() !== undefined || actions.files.editing() !== undefined || historyRequest() !== undefined || historyOf("rebase") !== undefined || historyOf("recompose") !== undefined}
                actions={actions}
                incoming={actions.incoming()}
                pulls={platform.pullLookup()}
                conflictOf={conflicts.conflictOf}
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
            <Show when={actions.files.editing()} keyed>
              {(target) => <FileEditor target={target} repoPath={session.path} servers={app.settings().language_servers} save={actions.files.save} onClose={closeEditor} />}
            </Show>
            <Show when={historyOf("rebase")} keyed>
              {(view) => <RebaseEditor session={session} base={view.base} from={view.from} onClose={() => void closeHistory()} />}
            </Show>
            <Show when={historyOf("recompose")} keyed>
              {(view) => <RecomposeView session={session} base={view.base} onClose={() => void closeHistory()} onOpenAiSettings={() => app.openSettings("ai")} />}
            </Show>
            <Show when={platform.compose()} keyed>
              {(request) => <ComposePullView session={session} platform={platform} actions={actions} request={request} onOpenAiSettings={() => app.openSettings("ai")} />}
            </Show>
            <Show when={panel()?.kind === "worktrees"}>
              <WorktreePanel session={session} actions={worktrees} onClose={closePanel} />
            </Show>
            <Show when={panel()} keyed>
              {(current) => (
                <Show when={current.kind === "recovery" && current}>{(recovery) => <RecoveryView session={session} tab={recovery().tab} onClose={closePanel} />}</Show>
              )}
            </Show>
            <Show when={historyRequest()} keyed>
              {(request) => <FileHistory session={session} request={request} prefs={diffPrefs} onClose={closeFileHistory} onSelectCommit={(sha) => select({ kind: "commit", sha })} />}
            </Show>
            <Show when={fileTarget()} keyed>
              {(target) => <FileView session={session} target={target} onClose={closeFile} />}
            </Show>
            <Show when={fileTarget() === undefined && (actions.history() === undefined || historyOf("squash") !== undefined) ? diffTarget() : undefined}>
              {(target) => (
                <Show when={isConflictTarget(target())} fallback={<DiffView session={session} target={target()} prefs={diffPrefs} onClose={closeDiff} onViewFile={viewFile} />}>
                  <ConflictResolver session={session} actions={actions} file={target().file} onClose={closeDiff} onOpenAiSettings={() => app.openSettings("ai")} />
                </Show>
              )}
            </Show>
            <AiSheet sheet={aiSheet} onOpenAiSettings={() => app.openSettings("ai")} />
          </div>
          <Inspector
            session={session}
            actions={actions}
            platform={platform}
            jira={jira}
            composer={composer}
            selection={selection()}
            activeTarget={diffTarget()}
            onOpenDiff={showDiff}
            onViewFile={viewFile}
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
        <Show when={worktrees.dialog()} keyed>
          {(dialog) => (
            <Show
              when={dialog.kind === "integrate" && dialog}
              fallback={<CreateWorktreeDialog snapshot={session.snapshot()} actions={worktrees} />}
            >
              {(integrate) => <IntegrateWorktreeDialog worktree={integrate().worktree} all={integrate().all} actions={worktrees} />}
            </Show>
          )}
        </Show>
        <Show when={worktrees.confirm()} keyed>
          {(pending) => (
            <ConfirmDialog
              copy={pending.copy}
              onConfirm={() => {
                worktrees.closeConfirm();
                void pending.run();
              }}
              onCancel={worktrees.closeConfirm}
            />
          )}
        </Show>
        <Show when={platform.confirm()} keyed>
          {(pending) => (
            <ConfirmDialog
              copy={pending.copy}
              onConfirm={() => {
                platform.closeConfirm();
                void pending.run();
              }}
              onCancel={platform.closeConfirm}
            />
          )}
        </Show>
        <Show when={actions.files.dialog()} keyed>
          {(dialog) => (
            <Show when={dialog.kind === "pick" && dialog} fallback={<CreateFileDialog submit={actions.files.submitCreate} onClose={actions.files.closeDialog} />}>
              {(pick) => <FilePickerDialog purpose={pick().purpose} files={pick().files} onChoose={(file) => actions.files.choose(pick().purpose, file)} onClose={actions.files.closeDialog} />}
            </Show>
          )}
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
      </div>
    </AiSheetContext.Provider>
  );
}
