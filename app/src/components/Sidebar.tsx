import { createMemo, createSignal, For, Index, Show, type JSX } from "solid-js";
import { basename } from "../format";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { localTarget, remoteTarget, tagTarget, type RefTarget } from "../state/refMenu";
import { treeRows, type TreeRow } from "../state/refTree";
import type { Anchor, RepoActions } from "../state/repoActions";
import type { Selection } from "../state/selection";
import { toggleFolder, type RepoUiPrefsStore } from "../state/repoUiPrefs";
import {
  bulkMenu,
  countLabel,
  extendRange,
  isSectionOpen,
  matchesFilter,
  selectOnly,
  toggleRow,
  toggleSection,
  type BulkGroup,
  type RowSelection,
  type SectionId,
} from "../state/sidebarModel";
import type { IconName } from "../iconNames";
import type { PanelRequest } from "../state/palette";
import type { WorktreeActions } from "../state/worktreeActions";
import type { PlatformActions } from "../state/platformActions";
import type { PullRequest } from "../ipc/bindings/PullRequest";
import type { JiraIssue } from "../ipc/bindings/JiraIssue";
import type { JiraSidebar } from "../state/jiraIssues";
import { issueRowLabel, loadingIssuesText, pullText, statusTone } from "../state/jiraModel";
import { IssueChips } from "./IssueChip";
import { prStateView } from "../state/platformModel";
import type { MenuState } from "../state/repoActions";
import { AuthorBadge } from "./AuthorBadge";
import { ContextMenu } from "./ContextMenu";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";
import { listRowHeight, VirtualRows, type VirtualRow } from "./VirtualRows";

const RECOVERY_ROWS: ReadonlyArray<{ panel: PanelRequest; title: string; label: string; note: string }> = [
  { panel: "reflog", title: "Reflog", label: "Reflog", note: "HEAD and branch history, restorable" },
  { panel: "lost", title: "Lost commits", label: "Lost commits", note: "Commits no ref reaches, found with git fsck" },
  { panel: "snapshots", title: "Snapshots", label: "Safety snapshots", note: "Saved before destructive actions, kept 30 days" },
];

const anchorOf = (element: HTMLElement): Anchor => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left + 24, top: rect.bottom };
};

const indent = (depth: number, base = 14): string => `${base + depth * 14}px`;

const branchCount = (count: number): string => `${count} ${count === 1 ? "branch" : "branches"}`;

const NO_FOLDERS: ReadonlySet<string> = new Set();

function TreeLines(props: { depth: number; last: boolean; lines: readonly boolean[] }) {
  return (
    <>
      <Index each={props.lines}>
        {(continues, level) => (
          <Show when={continues()}>
            <span class="tree-guide" data-level={level} style={{ "--level": level }} aria-hidden="true" />
          </Show>
        )}
      </Index>
      <Show when={props.depth > 0}>
        <span class="tree-elbow" classList={{ last: props.last }} data-level={props.depth - 1} style={{ "--level": props.depth - 1 }} aria-hidden="true" />
      </Show>
    </>
  );
}

type Tree = { last: boolean; lines: readonly boolean[] };

export function Sidebar(props: {
  snapshot: RepoSnapshot;
  actions: RepoActions;
  worktrees: WorktreeActions;
  uiPrefs: RepoUiPrefsStore;
  selection: Selection | undefined;
  onSelectStash: (sha: string) => void;
  onOpenPanel: (panel: PanelRequest) => void;
  platform?: PlatformActions;
  jira?: JiraSidebar;
  onSelectPull?: (number: number) => void;
}) {
  const snapshot = () => props.snapshot;
  const collapsedFolders = createMemo((): ReadonlySet<string> => new Set(props.uiPrefs.prefs().collapsed_folders));
  const [activeRow, setActiveRow] = createSignal<string | undefined>();
  const [worktreeMenu, setWorktreeMenu] = createSignal<MenuState | undefined>();
  const [pullMenu, setPullMenu] = createSignal<MenuState | undefined>();
  const [issueMenu, setIssueMenu] = createSignal<MenuState | undefined>();
  const [bulkMenuState, setBulkMenuState] = createSignal<MenuState | undefined>();
  const [filter, setFilter] = createSignal("");
  const [reveal, setReveal] = createSignal<{ list: string; nonce: number; index: number } | undefined>();
  let body: HTMLDivElement | undefined;
  let pendingNav: { list: string; pos: number } | undefined;
  const [multi, setMulti] = createSignal<RowSelection | undefined>();
  const filtering = () => filter() !== "";
  const fits = (...texts: string[]) => matchesFilter(filter(), ...texts);
  const currentBranch = () => {
    const head = snapshot().head;
    return head.kind === "branch" ? head.name : undefined;
  };
  const branchMeta = (name: string) => {
    if (name !== currentBranch()) return undefined;
    const counts = snapshot().upstream?.ahead_behind;
    return { ahead: counts?.ahead ?? 0, behind: counts?.behind ?? 0 };
  };

  const visibleBranches = createMemo(() => snapshot().branches.filter((name) => fits(name)));
  const foldersFor = () => (filtering() ? NO_FOLDERS : collapsedFolders());
  const remoteBranches = (remote: string) => snapshot().remote_branches.filter((name) => name.startsWith(`${remote}/`));
  const visibleRemoteBranches = (remote: string) => remoteBranches(remote).filter((name) => fits(name));
  const visibleRemotes = createMemo(() => snapshot().remotes.filter((remote) => fits(remote) || visibleRemoteBranches(remote).length > 0));
  const visibleTags = createMemo(() => snapshot().tags.filter((name) => fits(name)));
  const visibleStashes = createMemo(() => snapshot().stashes.filter((stash) => fits(stash.message, `stash@{${stash.index}}`)));
  const branchLabel = (worktree: { branch: string | null; bare: boolean }) => worktree.branch ?? (worktree.bare ? "bare" : "detached");
  const visibleWorktrees = createMemo(() => snapshot().worktrees.filter((worktree) => fits(basename(worktree.path), worktree.path, branchLabel(worktree))));
  const visiblePulls = createMemo(() => props.platform?.pulls().filter((pull) => fits(`#${pull.number}`, pull.title, pull.author, pull.source_ref, pull.target_ref)) ?? []);
  const visibleIssues = createMemo(() => props.jira?.state.issues().filter((issue) => fits(issue.key, issue.summary, issue.status)) ?? []);
  const visibleRecovery = createMemo(() => RECOVERY_ROWS.filter((entry) => fits(entry.title, entry.label)));

  const localRows = createMemo(() => treeRows(visibleBranches(), foldersFor(), "local:"));
  const remoteRowsByName = createMemo(
    () =>
      new Map(
        visibleRemotes().map((remote) => [
          remote,
          treeRows(
            visibleRemoteBranches(remote).map((name) => name.slice(remote.length + 1)),
            foldersFor(),
            `${remote}:`,
          ),
        ]),
      ),
  );
  const remoteRows = (remote: string): TreeRow[] => remoteRowsByName().get(remote) ?? [];
  const localRowId = (row: TreeRow): string => (row.kind === "folder" ? `folder:${row.id}` : `branch:${row.path}`);
  const remoteRowId = (remote: string, row: TreeRow): string => (row.kind === "folder" ? `folder:${row.id}` : `remote:${remote}/${row.path}`);
  const TAGS_LIST = "tags";
  const BRANCHES_LIST = "branches";
  const remoteList = (remote: string) => `remote:${remote}`;
  const listIds = (list: string): string[] => {
    if (list === BRANCHES_LIST) return localRows().map(localRowId);
    if (list === TAGS_LIST) return visibleTags().map((name) => `tag:${name}`);
    const remote = list.slice("remote:".length);
    return remoteRows(remote).map((row) => remoteRowId(remote, row));
  };
  const keepIn = (list: string): number => listIds(list).indexOf(activeRow() ?? firstRowId() ?? "");
  const revealIn = (list: string) => {
    const current = reveal();
    return current?.list === list ? current : undefined;
  };
  const focusInList = (list: string, pos: number) => {
    const mounted = body?.querySelector<HTMLElement>(`[data-nav][data-list="${CSS.escape(list)}"][data-pos="${pos}"]`);
    if (mounted !== null && mounted !== undefined) {
      mounted.focus();
      return;
    }
    pendingNav = { list, pos };
    setReveal((current) => ({ list, nonce: (current?.nonce ?? 0) + 1, index: pos }));
  };
  const mountNav = (list: string | undefined, virtual: VirtualRow | undefined, element: HTMLElement) => {
    virtual?.measure(element);
    if (list === undefined || virtual === undefined || pendingNav?.list !== list || pendingNav.pos !== virtual.index) return;
    pendingNav = undefined;
    queueMicrotask(() => element.focus());
  };
  const firstRowId = () => {
    const first = localRows()[0];
    return first === undefined ? undefined : first.kind === "folder" ? `folder:${first.id}` : `branch:${first.path}`;
  };

  const existingIds = (group: BulkGroup): string[] => {
    switch (group) {
      case "branches":
        return snapshot().branches.map((name) => `branch:${name}`);
      case "remotes":
        return snapshot().remotes.map((remote) => `folder:remote:${remote}`);
      case "tags":
        return snapshot().tags.map((name) => `tag:${name}`);
      case "stashes":
        return snapshot().stashes.map((stash) => `stash:${stash.sha}`);
      case "worktrees":
        return snapshot().worktrees.map((worktree) => `worktree:${worktree.path}`);
    }
  };
  const visibleIds = (group: BulkGroup): string[] => {
    switch (group) {
      case "branches":
        return localRows().flatMap((row) => (row.kind === "leaf" ? [`branch:${row.path}`] : []));
      case "remotes":
        return visibleRemotes().map((remote) => `folder:remote:${remote}`);
      case "tags":
        return visibleTags().map((name) => `tag:${name}`);
      case "stashes":
        return visibleStashes().map((stash) => `stash:${stash.sha}`);
      case "worktrees":
        return visibleWorktrees().map((worktree) => `worktree:${worktree.path}`);
    }
  };
  const chosen = createMemo((): RowSelection | undefined => {
    const current = multi();
    if (current === undefined) return undefined;
    const valid = new Set(existingIds(current.group));
    const ids = current.ids.filter((id) => valid.has(id));
    return ids.length === 0 ? undefined : { ...current, ids };
  });
  const isChosen = (id: string) => chosen()?.ids.includes(id) === true;

  const bulkBlock = (group: BulkGroup, ids: readonly string[]): string | undefined => {
    const branch = currentBranch();
    return group === "branches" && branch !== undefined && ids.includes(`branch:${branch}`) ? `${branch} is checked out` : undefined;
  };

  function runBulk(group: BulkGroup, ids: readonly string[]): void {
    setMulti(undefined);
    if (group === "branches") void props.actions.deleteBranches(ids.map((id) => id.slice("branch:".length)));
    else if (group === "tags") props.actions.deleteTags(ids.map((id) => id.slice("tag:".length)));
    else if (group === "remotes") void props.actions.fetchAll();
    else if (group === "stashes") props.actions.dropStashes(snapshot().stashes.filter((stash) => ids.includes(`stash:${stash.sha}`)));
    else void props.worktrees.removeMany(ids.map((id) => id.slice("worktree:".length)));
  }

  function openBulk(group: BulkGroup, id: string, anchor: Anchor): boolean {
    const current = chosen();
    if (current?.group !== group || current.ids.length < 2 || !current.ids.includes(id)) return false;
    const ids = current.ids;
    setBulkMenuState({ anchor, entries: bulkMenu(group, ids.length, bulkBlock(group, ids)), run: () => runBulk(group, ids) });
    return true;
  }

  function selectWithModifier(group: BulkGroup, id: string, event: MouseEvent): boolean {
    if (event.shiftKey) setMulti(extendRange(chosen(), group, visibleIds(group), id));
    else if (event.ctrlKey || event.metaKey) setMulti(toggleRow(chosen(), group, id));
    else return false;
    return true;
  }

  function selectFromContext(group: BulkGroup, id: string, event: MouseEvent): boolean {
    // macOS delivers a ctrl-click as a context menu on the secondary button, and some
    // drivers keep the primary button number; both must toggle instead of opening a menu.
    if (event.ctrlKey) {
      setMulti(toggleRow(chosen(), group, id));
      event.preventDefault();
      return true;
    }
    if (!openBulk(group, id, { left: event.clientX, top: event.clientY })) return false;
    event.preventDefault();
    return true;
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step === undefined || !(event.target instanceof HTMLElement) || event.target.dataset.nav === undefined) return;
    const list = event.target.dataset.list;
    const next = Number(event.target.dataset.pos) + step;
    if (list !== undefined && next >= 0 && next < listIds(list).length) {
      event.preventDefault();
      focusInList(list, next);
      return;
    }
    const rows = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[data-nav]")];
    const neighbour = rows[rows.indexOf(event.target) + step];
    if (neighbour === undefined) return;
    event.preventDefault();
    const neighbourList = neighbour.dataset.list;
    const edge = neighbourList === undefined ? undefined : step > 0 ? 0 : listIds(neighbourList).length - 1;
    if (neighbourList !== undefined && edge !== undefined && Number(neighbour.dataset.pos) !== edge) focusInList(neighbourList, edge);
    else neighbour.focus();
  };

  const tabStop = (id: string) => activeRow() === id || (activeRow() === undefined && id === firstRowId());

  function Section(section: {
    id: SectionId;
    icon: IconName;
    title: string;
    total?: number;
    shown?: number;
    countText?: string;
    open?: { label: string; run: () => void };
    add?: { label: string; run: () => void };
    children?: JSX.Element;
  }) {
    const expanded = () => isSectionOpen(props.uiPrefs.prefs(), section.id);
    return (
      <section aria-label={section.title}>
        <div class="sec">
          <button type="button" class="sec-title" aria-expanded={expanded()} onClick={() => props.uiPrefs.update((current) => toggleSection(current, section.id))}>
            <Icon name={section.icon} />
            {section.title}
            <span class="sec-chevron" classList={{ collapsed: !expanded() }}>
              <Icon name="chevron" size={14} />
            </span>
          </button>
          <Show when={section.total !== undefined}>
            <span class="count">{section.countText ?? countLabel(section.total ?? 0, section.shown ?? section.total ?? 0, filtering() && section.shown !== undefined)}</span>
          </Show>
          <Show when={section.open}>
            {(open) => (
              <button type="button" class="icon-btn dense" {...tip(open().label)} onClick={open().run}>
                <Icon name="open" size={14} />
              </button>
            )}
          </Show>
          <Show when={section.add}>
            {(add) => (
              <button type="button" class="icon-btn dense" {...tip(add().label)} onClick={add().run}>
                <Icon name="plus" size={14} />
              </button>
            )}
          </Show>
        </div>
        <Show when={expanded()}>{section.children}</Show>
      </section>
    );
  }

  function NavRow(row: {
    id: string;
    title: string;
    current?: boolean;
    depth?: number;
    base?: number;
    pull?: boolean;
    group?: BulkGroup;
    tree?: Tree;
    list?: string;
    virtual?: VirtualRow;
    label: string;
    onOpen: (anchor: Anchor) => void;
    onMenu: (anchor: Anchor) => void;
    onActivate?: () => void;
    onClick?: () => void;
    children?: JSX.Element;
  }) {
    const menu = (anchor: Anchor) => {
      if (row.group === undefined || !openBulk(row.group, row.id, anchor)) row.onMenu(anchor);
    };
    return (
      <div
        class="srow"
        classList={{ current: row.current === true, pull: row.pull === true, selected: isChosen(row.id) }}
        style={{ "padding-left": indent(row.depth ?? 0, row.base), ...row.virtual?.style }}
        ref={(element) => mountNav(row.list, row.virtual, element)}
        data-list={row.list}
        data-pos={row.virtual?.index}
        role="button"
        aria-haspopup="menu"
        aria-label={row.label}
        aria-current={row.current === true ? "true" : undefined}
        aria-pressed={isChosen(row.id) ? "true" : undefined}
        data-nav={row.id}
        tabindex={tabStop(row.id) ? 0 : -1}
        title={row.title}
        onFocus={() => setActiveRow(row.id)}
        onClick={(event) => {
          if (row.group !== undefined) {
            if (selectWithModifier(row.group, row.id, event)) return;
            setMulti(selectOnly(row.group, row.id));
          }
          row.onClick?.();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (row.group !== undefined && selectFromContext(row.group, row.id, event)) return;
          row.onMenu({ left: event.clientX, top: event.clientY });
        }}
        onDblClick={() => row.onActivate?.()}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
            event.preventDefault();
            menu(anchorOf(event.currentTarget));
          } else if (event.key === "Enter" && event.target === event.currentTarget) {
            event.preventDefault();
            if (row.onActivate === undefined) menu(anchorOf(event.currentTarget));
            else row.onActivate();
          }
        }}
      >
        <Show when={row.tree}>{(tree) => <TreeLines depth={row.depth ?? 0} last={tree().last} lines={tree().lines} />}</Show>
        {row.children}
      </div>
    );
  }

  function FolderRow(row: {
    id: string;
    scopeId: string;
    name: string;
    path: string;
    count: number;
    open: boolean;
    depth: number;
    base?: number;
    noun: "Folder" | "Remote";
    group?: BulkGroup;
    tree?: Tree;
    list?: string;
    virtual?: VirtualRow;
  }) {
    const toggle = () => props.uiPrefs.update((current) => toggleFolder(current, row.scopeId));
    const menu = (anchor: Anchor) => row.group !== undefined && openBulk(row.group, row.id, anchor);
    return (
      <div
        class="srow folder"
        classList={{ selected: isChosen(row.id) }}
        style={{ "padding-left": indent(row.depth, row.base ?? 6), ...row.virtual?.style }}
        ref={(element) => mountNav(row.list, row.virtual, element)}
        data-list={row.list}
        data-pos={row.virtual?.index}
        role="button"
        aria-expanded={row.open}
        aria-pressed={isChosen(row.id) ? "true" : undefined}
        aria-label={`${row.noun} ${row.path}, ${branchCount(row.count)}, ${row.open ? "expanded" : "collapsed"}`}
        data-nav={row.id}
        tabindex={tabStop(row.id) ? 0 : -1}
        title={row.path}
        onFocus={() => setActiveRow(row.id)}
        onClick={(event) => {
          if (row.group !== undefined) {
            if (selectWithModifier(row.group, row.id, event)) return;
            setMulti(selectOnly(row.group, row.id));
          }
          toggle();
        }}
        onContextMenu={(event) => {
          if (row.group !== undefined) selectFromContext(row.group, row.id, event);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
            if (menu(anchorOf(event.currentTarget))) event.preventDefault();
          } else if (event.key === "Enter" || event.key === " " || (event.key === "ArrowRight" && !row.open) || (event.key === "ArrowLeft" && row.open)) {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <Show when={row.tree}>{(tree) => <TreeLines depth={row.depth} last={tree().last} lines={tree().lines} />}</Show>
        <span class="folder-chevron" classList={{ collapsed: !row.open }}>
          <Icon name="chevron" size={14} />
        </span>
        <span class="name">{row.name}</span>
        <span class="meta">{branchCount(row.count)}</span>
      </div>
    );
  }

  function openWorktreeMenu(path: string, current: boolean, anchor: Anchor): void {
    setWorktreeMenu({
      anchor,
      entries: [
        { kind: "item", id: "open", label: ["Open as tab"], icon: "open", ...(current ? { disabledReason: "This worktree is open here" } : {}) },
        { kind: "item", id: "terminal", label: ["Open in terminal"], icon: "terminal" },
        { kind: "separator" },
        { kind: "item", id: "integrate", label: ["Integrate into another worktree…"], icon: "merge" },
        { kind: "item", id: "remove", label: ["Remove worktree…"], icon: "trash", danger: true },
      ],
      run: (id) => {
        if (id === "open") void props.worktrees.open(path);
        else if (id === "terminal") void props.worktrees.openTerminal(path);
        else if (id === "integrate") void props.worktrees.integrate(path);
        else if (id === "remove") void props.worktrees.remove(path);
      },
    });
  }

  function openPullMenu(pull: PullRequest, anchor: Anchor): void {
    const platform = props.platform;
    if (platform === undefined) return;
    setPullMenu({
      anchor,
      entries: [
        { kind: "item", id: "open", label: ["Open in browser"], icon: "open" },
        { kind: "item", id: "merge", label: [`Merge pull request #${pull.number}…`], icon: "merge", ...(pull.state === "open" ? {} : { disabledReason: `This pull request is already ${pull.state}` }) },
      ],
      run: (id) => {
        if (id === "open") platform.openInBrowser(pull);
        else if (id === "merge") platform.requestMerge(pull);
      },
    });
  }

  function openIssueMenu(issue: JiraIssue, anchor: Anchor): void {
    const jira = props.jira;
    if (jira === undefined) return;
    setIssueMenu({
      anchor,
      entries: [
        { kind: "item", id: "branch", label: [`Create branch from ${issue.key}…`], icon: "branch" },
        { kind: "item", id: "open", label: ["Open in browser"], icon: "open" },
      ],
      run: (id) => {
        if (id === "branch") void props.actions.openCreateBranchFromIssue(issue, anchor);
        else if (id === "open") jira.openInBrowser(issue);
      },
    });
  }

  const branchTarget = (name: string): RefTarget => localTarget(snapshot(), name);
  const checkoutOf = (target: RefTarget) => () => {
    if (target.kind !== "local_branch" || target.name !== currentBranch()) props.actions.checkoutRef(target);
  };

  const localRow = (row: TreeRow, virtual: VirtualRow) =>
    row.kind === "folder" ? (
      <FolderRow
        list={BRANCHES_LIST}
        virtual={virtual}
        id={`folder:${row.id}`}
        scopeId={row.id}
        name={row.name}
        path={row.id.slice("local:".length)}
        count={row.count}
        open={row.open}
        depth={row.depth + 1}
        base={6}
        noun="Folder"
        tree={{ last: row.last, lines: row.trail }}
      />
    ) : (
      <NavRow
        list={BRANCHES_LIST}
        virtual={virtual}
        id={`branch:${row.path}`}
        title={row.path}
        label={`Branch ${row.path}${row.path === currentBranch() ? ", checked out" : ""}`}
        current={row.path === currentBranch()}
        depth={row.depth + 1}
        base={6}
        group="branches"
        tree={{ last: row.last, lines: row.trail }}
        onOpen={(anchor) => props.actions.openRefMenu(branchTarget(row.path), anchor)}
        onMenu={(anchor) => props.actions.openRefMenu(branchTarget(row.path), anchor)}
        onActivate={checkoutOf(branchTarget(row.path))}
      >
        <span class="name">{row.label}</span>
        <Show when={props.jira}>{(jira) => <IssueChips keys={jira().chips.keysFor(row.path)} lookup={jira().chips.lookup} />}</Show>
        <Show when={branchMeta(row.path)}>
          {(meta) => (
            <span class="meta">
              <Show when={meta().ahead > 0}>
                <span class="up">↑{meta().ahead} </span>
              </Show>
              <Show when={meta().behind > 0}>↓{meta().behind} </Show>
              HEAD
            </span>
          )}
        </Show>
      </NavRow>
    );

  const remoteRow = (remote: string, row: TreeRow, remoteLast: boolean, virtual: VirtualRow) => {
    // The remote itself is the section's child, so its branches sit one level deeper.
    const lines = [!remoteLast, ...row.trail];
    const chrome = { depth: row.depth + 2, base: 6, tree: { last: row.last, lines }, list: remoteList(remote), virtual };
    return row.kind === "folder" ? (
      <FolderRow
        id={`folder:${row.id}`}
        scopeId={row.id}
        name={row.name}
        path={`${remote}/${row.id.slice(remote.length + 1)}`}
        count={row.count}
        open={row.open}
        noun="Folder"
        {...chrome}
      />
    ) : (
      <NavRow
        id={`remote:${remote}/${row.path}`}
        title={`${remote}/${row.path}`}
        label={`Remote branch ${remote}/${row.path}`}
        {...chrome}
        onOpen={(anchor) => props.actions.openRefMenu(remoteTarget(`${remote}/${row.path}`), anchor)}
        onMenu={(anchor) => props.actions.openRefMenu(remoteTarget(`${remote}/${row.path}`), anchor)}
        onActivate={checkoutOf(remoteTarget(`${remote}/${row.path}`))}
      >
        <span class="name">{row.label}</span>
      </NavRow>
    );
  };

  return (
    <aside class="panel sidebar" aria-label="Repository" onKeyDown={onKeyDown}>
      <label class="input sfilter">
        <Icon name="search" size={14} />
        <input
          type="text"
          aria-label="Filter sidebar"
          placeholder="Filter"
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && filtering()) {
              event.preventDefault();
              event.stopPropagation();
              setFilter("");
            }
          }}
        />
      </label>
      <div class="sidebar-body" ref={body}>
        <Section id="branches" icon="branch" title="Branches" total={snapshot().branches.length} shown={visibleBranches().length}>
          <VirtualRows as="div" items={localRows()} scroller={() => body} estimate={listRowHeight()} keepIndex={keepIn(BRANCHES_LIST)} reveal={revealIn(BRANCHES_LIST)} measured>
            {localRow}
          </VirtualRows>
        </Section>
        <Section id="remotes" icon="remote" title="Remotes" total={snapshot().remotes.length} shown={visibleRemotes().length}>
          <For each={visibleRemotes()}>
            {(remote, index) => {
              const open = () => filtering() || !collapsedFolders().has(`remote:${remote}`);
              const last = () => index() === visibleRemotes().length - 1;
              return (
                <>
                  <FolderRow
                    id={`folder:remote:${remote}`}
                    scopeId={`remote:${remote}`}
                    name={remote}
                    path={remote}
                    count={visibleRemoteBranches(remote).length}
                    open={open()}
                    depth={1}
                    base={6}
                    noun="Remote"
                    group="remotes"
                    tree={{ last: last(), lines: [] }}
                  />
                  <Show when={open()}>
                    <VirtualRows as="div" items={remoteRows(remote)} scroller={() => body} estimate={listRowHeight()} keepIndex={keepIn(remoteList(remote))} reveal={revealIn(remoteList(remote))} measured>
                      {(row, virtual) => remoteRow(remote, row, last(), virtual)}
                    </VirtualRows>
                  </Show>
                </>
              );
            }}
          </For>
        </Section>
        <Section id="tags" icon="tag" title="Tags" total={snapshot().tags.length} shown={visibleTags().length}>
          <VirtualRows as="div" items={visibleTags()} scroller={() => body} estimate={listRowHeight()} keepIndex={keepIn(TAGS_LIST)} reveal={revealIn(TAGS_LIST)} measured>
            {(name, virtual) => {
              const target = () => tagTarget(name);
              return (
                <NavRow
                  list={TAGS_LIST}
                  virtual={virtual}
                  id={`tag:${name}`}
                  title={name}
                  label={`Tag ${name}`}
                  depth={1}
                  base={6}
                  group="tags"
                  tree={{ last: virtual.index === visibleTags().length - 1, lines: [] }}
                  onOpen={(anchor) => props.actions.openRefMenu(target(), anchor)}
                  onMenu={(anchor) => props.actions.openRefMenu(target(), anchor)}
                  onActivate={checkoutOf(target())}
                >
                  <span class="name">{name}</span>
                </NavRow>
              );
            }}
          </VirtualRows>
        </Section>
        <Section id="stashes" icon="stash" title="Stashes" total={snapshot().stashes.length} shown={visibleStashes().length}>
          <For each={visibleStashes()}>
            {(stash, index) => (
              <NavRow
                id={`stash:${stash.sha}`}
                title={stash.message}
                label={`Stash ${stash.index}: ${stash.message}`}
                current={props.selection?.kind === "stash" && props.selection.sha === stash.sha}
                group="stashes"
                depth={1}
                base={6}
                tree={{ last: index() === visibleStashes().length - 1, lines: [] }}
                onClick={() => props.onSelectStash(stash.sha)}
                onOpen={(anchor) => props.actions.openStashMenu(stash, anchor)}
                onMenu={(anchor) => props.actions.openStashMenu(stash, anchor)}
                onActivate={() => props.onSelectStash(stash.sha)}
              >
                <span class="name">{stash.message}</span>
                <span class="meta">stash@&#123;{stash.index}&#125;</span>
              </NavRow>
            )}
          </For>
        </Section>
        <Section
          id="worktrees"
          icon="worktree"
          title="Worktrees"
          total={snapshot().worktrees.length}
          shown={visibleWorktrees().length}
          open={{ label: "Show worktrees", run: () => props.onOpenPanel("worktrees") }}
          add={{ label: "Create worktree", run: props.worktrees.openCreate }}
        >
          <For each={visibleWorktrees()}>
            {(worktree, index) => (
              <NavRow
                id={`worktree:${worktree.path}`}
                title={worktree.path}
                label={`Worktree ${basename(worktree.path)}, branch ${branchLabel(worktree)}`}
                current={worktree.current}
                group="worktrees"
                depth={1}
                base={6}
                tree={{ last: index() === visibleWorktrees().length - 1, lines: [] }}
                onOpen={(anchor) => openWorktreeMenu(worktree.path, worktree.current, anchor)}
                onMenu={(anchor) => openWorktreeMenu(worktree.path, worktree.current, anchor)}
                onClick={() => !worktree.current && void props.worktrees.open(worktree.path)}
                onActivate={() => !worktree.current && void props.worktrees.open(worktree.path)}
              >
                <span class="name">{basename(worktree.path)}</span>
                <span class="meta">{branchLabel(worktree)}</span>
              </NavRow>
            )}
          </For>
        </Section>
        <Show when={props.platform?.matched() !== undefined ? props.platform : undefined} keyed>
          {(platform) => (
            <Section
              id="pulls"
              icon="pullrequest"
              title="Pull requests"
              total={platform.pullsTotal()}
              shown={visiblePulls().length}
              add={{ label: "New pull request", run: () => void platform.openCreate() }}
            >
              <For each={visiblePulls()}>
                {(pull, index) => {
                  const state = () => prStateView(pull.state);
                  const select = () => props.onSelectPull?.(pull.number);
                  return (
                    <NavRow
                      id={`pull:${pull.number}`}
                      title={`#${pull.number} ${pull.title}`}
                      label={`Pull request #${pull.number}: ${pull.title}, by ${pull.author}, ${pull.source_ref} to ${pull.target_ref}, ${state().label}`}
                      current={props.selection?.kind === "pull" && props.selection.number === pull.number}
                      pull
                      depth={1}
                      base={6}
                      tree={{ last: index() === visiblePulls().length - 1, lines: [] }}
                      onClick={select}
                      onActivate={select}
                      onOpen={(anchor) => openPullMenu(pull, anchor)}
                      onMenu={(anchor) => openPullMenu(pull, anchor)}
                    >
                      <span class="pull-main">
                        <span class="pull-line">
                          <span class="pull-number">#{pull.number}</span>
                          <span class="name">{pull.title}</span>
                          <Show when={props.jira}>{(jira) => <IssueChips keys={jira().chips.keysFor(pullText(pull))} lookup={jira().chips.lookup} />}</Show>
                        </span>
                        <span class="pull-sub">
                          <AuthorBadge name={pull.author} />
                          <span class="pull-by">
                            {pull.author} · <span class="ref">{pull.source_ref}</span> → <span class="ref">{pull.target_ref}</span>
                          </span>
                        </span>
                      </span>
                      <span class="chip pull-state" classList={{ "chip-success": state().tone === "ok", "chip-danger": state().tone === "danger" }}>
                        <Icon name={state().icon} size={14} />
                        {state().label}
                      </span>
                      <span class="acts">
                        <button
                          type="button"
                          class="icon-btn dense"
                          tabindex="-1"
                          {...tip("Open in browser", undefined, `Open pull request #${pull.number} in browser`)}
                          onClick={(event) => {
                            event.stopPropagation();
                            platform.openInBrowser(pull);
                          }}
                        >
                          <Icon name="open" size={14} />
                        </button>
                        <button
                          type="button"
                          class="icon-btn dense"
                          tabindex="-1"
                          aria-disabled={pull.state !== "open"}
                          {...tip(pull.state === "open" ? "Merge pull request…" : `Already ${pull.state}`, undefined, `Merge pull request #${pull.number}`)}
                          onClick={(event) => {
                            event.stopPropagation();
                            platform.requestMerge(pull);
                          }}
                        >
                          <Icon name="merge" size={14} />
                        </button>
                      </span>
                    </NavRow>
                  );
                }}
              </For>
              <Show when={platform.failure()}>
                {(problem) => (
                  <div class="pull-note error" role="alert">
                    <span>{problem().message}</span>
                    <Show when={problem().action}>
                      <button type="button" class="btn sm" onClick={platform.editConnection}>
                        Edit connection
                      </button>
                    </Show>
                  </div>
                )}
              </Show>
              <Show when={platform.failure() === undefined && platform.pulls().length === 0 && !platform.loading()}>
                <div class="pull-note" role="status">
                  {platform.listState() === "open" ? "No open pull requests" : "No pull requests"}
                </div>
              </Show>
              <Show when={platform.pullsCappedText()}>{(text) => <div class="pull-note" role="status">{text()}</div>}</Show>
              <button type="button" class="srow pull-filter" onClick={() => platform.setListState(platform.listState() === "open" ? "all" : "open")}>
                {platform.listState() === "open" ? "Show merged and closed" : "Show open only"}
              </button>
            </Section>
          )}
        </Show>
        <Show when={props.jira?.state.connected() ? props.jira : undefined} keyed>
          {(jira) => (
            <Section
              id="issues"
              icon="issue"
              title="Jira issues"
              total={jira.state.total()}
              shown={visibleIssues().length}
              countText={jira.state.loading() && jira.state.total() === 0 ? "…" : undefined}
            >
              <For each={visibleIssues()}>
                {(issue, index) => (
                  <NavRow
                    id={`issue:${issue.key}`}
                    title={`${issue.key} ${issue.summary}`}
                    label={issueRowLabel(issue)}
                    current={props.selection?.kind === "issue" && props.selection.key === issue.key}
                    pull
                    depth={1}
                    base={6}
                    tree={{ last: index() === visibleIssues().length - 1, lines: [] }}
                    onClick={() => jira.select(issue.key)}
                    onActivate={() => jira.select(issue.key)}
                    onOpen={(anchor) => openIssueMenu(issue, anchor)}
                    onMenu={(anchor) => openIssueMenu(issue, anchor)}
                  >
                    <span class="pull-main">
                      <span class="pull-line">
                        <span class="pull-number">{issue.key}</span>
                        <span class="chip issue-status" classList={{ "chip-info": statusTone(issue.status_category) === "info", "chip-success": statusTone(issue.status_category) === "ok" }}>
                          {issue.status}
                        </span>
                      </span>
                      <span class="pull-sub">
                        <span class="pull-by">{issue.summary}</span>
                      </span>
                    </span>
                    <span class="acts">
                      <button
                        type="button"
                        class="icon-btn dense"
                        tabindex="-1"
                        {...tip("Create branch from issue", undefined, `Create branch from ${issue.key}`)}
                        onClick={(event) => {
                          event.stopPropagation();
                          void props.actions.openCreateBranchFromIssue(issue, anchorOf(event.currentTarget));
                        }}
                      >
                        <Icon name="branch" size={14} />
                      </button>
                      <button
                        type="button"
                        class="icon-btn dense"
                        tabindex="-1"
                        {...tip("Open in browser", undefined, `Open ${issue.key} in browser`)}
                        onClick={(event) => {
                          event.stopPropagation();
                          jira.openInBrowser(issue);
                        }}
                      >
                        <Icon name="open" size={14} />
                      </button>
                    </span>
                  </NavRow>
                )}
              </For>
              <For each={jira.state.sources().filter((source) => source.failure !== undefined)}>
                {(source) => (
                  <div class="pull-note error" role="alert">
                    <span>
                      {source.connection.host}: {source.failure?.message}
                    </span>
                    <button type="button" class="btn sm" onClick={jira.state.refresh}>
                      Retry
                    </button>
                    <Show when={source.failure?.action}>
                      <button type="button" class="btn sm" onClick={jira.openSettings}>
                        Edit connection
                      </button>
                    </Show>
                  </div>
                )}
              </For>
              <For each={jira.state.cappedNotes()}>{(note) => <div class="pull-note" role="status">{note}</div>}</For>
              <Show when={jira.state.loading()}>
                <div class="pull-note" role="status" aria-busy="true">
                  {loadingIssuesText(jira.state.sources().filter((source) => source.loading).map((source) => source.connection))}
                </div>
              </Show>
              <Show when={!jira.state.loading() && jira.state.issues().length === 0 && jira.state.sources().every((source) => source.failure === undefined)}>
                <div class="pull-note" role="status">
                  No open issues assigned to you
                </div>
              </Show>
            </Section>
          )}
        </Show>
        <Section id="recovery" icon="history" title="Recovery">
          <For each={visibleRecovery()}>
            {(entry, index) => (
              <div
                class="srow"
                role="button"
                tabindex="0"
                aria-label={entry.label}
                title={entry.note}
                style={{ "padding-left": `${6 + 14}px` }}
                onClick={() => props.onOpenPanel(entry.panel)}
                onKeyDown={(event) => event.key === "Enter" && event.target === event.currentTarget && props.onOpenPanel(entry.panel)}
              >
                <TreeLines depth={1} last={index() === visibleRecovery().length - 1} lines={[]} />
                <span class="name">{entry.title}</span>
              </div>
            )}
          </For>
        </Section>
      </div>
      <Show when={worktreeMenu()} keyed>
        {(menu) => <ContextMenu menu={menu} onClose={() => setWorktreeMenu(undefined)} />}
      </Show>
      <Show when={pullMenu()} keyed>
        {(menu) => <ContextMenu menu={menu} onClose={() => setPullMenu(undefined)} />}
      </Show>
      <Show when={issueMenu()} keyed>
        {(menu) => <ContextMenu menu={menu} onClose={() => setIssueMenu(undefined)} />}
      </Show>
      <Show when={bulkMenuState()} keyed>
        {(menu) => <ContextMenu menu={menu} onClose={() => setBulkMenuState(undefined)} />}
      </Show>
    </aside>
  );
}
