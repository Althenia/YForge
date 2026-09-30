import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { basename } from "../format";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { changeTotal } from "../state/changes";
import { localTarget, remoteTarget, tagTarget, type RefTarget } from "../state/refMenu";
import { treeRows, type TreeRow } from "../state/refTree";
import type { Anchor, RepoActions } from "../state/repoActions";
import type { Selection } from "../state/selection";
import { toggleFolder, type RepoUiPrefsStore } from "../state/repoUiPrefs";
import type { IconName } from "../iconNames";
import { Icon } from "./Icon";

function Section(props: { icon: IconName; title: string; count: number; children?: JSX.Element }) {
  return (
    <section aria-label={props.title}>
      <div class="sec">
        <span class="sec-title">
          <Icon name={props.icon} />
          {props.title}
        </span>
        <span class="count">{props.count}</span>
      </div>
      {props.children}
    </section>
  );
}

const anchorOf = (element: HTMLElement): Anchor => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left + 24, top: rect.bottom };
};

const indent = (depth: number, base = 14): string => `${base + depth * 14}px`;

const branchCount = (count: number): string => `${count} ${count === 1 ? "branch" : "branches"}`;

export function Sidebar(props: { snapshot: RepoSnapshot; actions: RepoActions; uiPrefs: RepoUiPrefsStore; selection: Selection | undefined; onSelectStash: (sha: string) => void }) {
  const snapshot = () => props.snapshot;
  const collapsedFolders = createMemo((): ReadonlySet<string> => new Set(props.uiPrefs.prefs().collapsed_folders));
  const [activeRow, setActiveRow] = createSignal<string | undefined>();
  const currentBranch = () => {
    const head = snapshot().head;
    return head.kind === "branch" ? head.name : undefined;
  };
  const branchMeta = (name: string) => {
    if (name !== currentBranch()) return undefined;
    const counts = snapshot().upstream?.ahead_behind;
    return { ahead: counts?.ahead ?? 0, behind: counts?.behind ?? 0 };
  };
  const remoteBranches = (remote: string) => snapshot().remote_branches.filter((name) => name.startsWith(`${remote}/`));
  const localRows = () => treeRows(snapshot().branches, collapsedFolders(), "local:");
  const remoteRows = (remote: string) =>
    treeRows(
      remoteBranches(remote).map((name) => name.slice(remote.length + 1)),
      collapsedFolders(),
      `${remote}:`,
    );
  const firstRowId = () => {
    const first = localRows()[0];
    return first === undefined ? undefined : first.kind === "folder" ? `folder:${first.id}` : `branch:${first.path}`;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step === undefined || !(event.target instanceof HTMLElement) || event.target.dataset.nav === undefined) return;
    const rows = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[data-nav]")];
    const next = rows[rows.indexOf(event.target) + step];
    if (next !== undefined) {
      event.preventDefault();
      next.focus();
    }
  };

  const tabStop = (id: string) => activeRow() === id || (activeRow() === undefined && id === firstRowId());

  function NavRow(row: {
    id: string;
    title: string;
    current?: boolean;
    depth?: number;
    base?: number;
    label: string;
    onOpen: (anchor: Anchor) => void;
    onMenu: (anchor: Anchor) => void;
    onActivate?: () => void;
    onClick?: () => void;
    children?: JSX.Element;
  }) {
    return (
      <div
        class="srow"
        classList={{ current: row.current === true }}
        style={{ "padding-left": indent(row.depth ?? 0, row.base) }}
        role="button"
        aria-haspopup="menu"
        aria-label={row.label}
        aria-current={row.current === true ? "true" : undefined}
        data-nav={row.id}
        tabindex={tabStop(row.id) ? 0 : -1}
        title={row.title}
        onFocus={() => setActiveRow(row.id)}
        onClick={() => row.onClick?.()}
        onContextMenu={(event) => {
          event.preventDefault();
          row.onMenu({ left: event.clientX, top: event.clientY });
        }}
        onDblClick={() => row.onActivate?.()}
        onKeyDown={(event) => {
          if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
            event.preventDefault();
            row.onMenu(anchorOf(event.currentTarget));
          } else if (event.key === "Enter" && event.target === event.currentTarget) {
            event.preventDefault();
            if (row.onActivate === undefined) row.onOpen(anchorOf(event.currentTarget));
            else row.onActivate();
          }
        }}
      >
        {row.children}
      </div>
    );
  }

  function FolderRow(row: { id: string; scopeId: string; name: string; path: string; count: number; open: boolean; depth: number; base?: number; noun: "Folder" | "Remote" }) {
    const toggle = () => props.uiPrefs.update((current) => toggleFolder(current, row.scopeId));
    return (
      <div
        class="srow folder"
        style={{ "padding-left": indent(row.depth, row.base ?? 6) }}
        role="button"
        aria-expanded={row.open}
        aria-label={`${row.noun} ${row.path}, ${branchCount(row.count)}, ${row.open ? "expanded" : "collapsed"}`}
        data-nav={row.id}
        tabindex={tabStop(row.id) ? 0 : -1}
        title={row.path}
        onFocus={() => setActiveRow(row.id)}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " " || (event.key === "ArrowRight" && !row.open) || (event.key === "ArrowLeft" && row.open)) {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <span class="folder-chevron" classList={{ collapsed: !row.open }}>
          <Icon name="chevron" size={14} />
        </span>
        <span class="name">{row.name}</span>
        <span class="meta">{branchCount(row.count)}</span>
      </div>
    );
  }

  const branchTarget = (name: string): RefTarget => localTarget(snapshot(), name);
  const checkoutOf = (target: RefTarget) => () => {
    if (target.kind !== "local_branch" || target.name !== currentBranch()) props.actions.checkoutRef(target);
  };

  const localRow = (row: TreeRow) =>
    row.kind === "folder" ? (
      <FolderRow id={`folder:${row.id}`} scopeId={row.id} name={row.name} path={row.id.slice("local:".length)} count={row.count} open={row.open} depth={row.depth} noun="Folder" />
    ) : (
      <NavRow
        id={`branch:${row.path}`}
        title={row.path}
        label={`Branch ${row.path}${row.path === currentBranch() ? ", checked out" : ""}`}
        current={row.path === currentBranch()}
        depth={row.depth}
        onOpen={(anchor) => props.actions.openRefMenu(branchTarget(row.path), anchor)}
        onMenu={(anchor) => props.actions.openRefMenu(branchTarget(row.path), anchor)}
        onActivate={checkoutOf(branchTarget(row.path))}
      >
        <span class="name">{row.label}</span>
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

  const remoteRow = (remote: string, row: TreeRow) =>
    row.kind === "folder" ? (
      <FolderRow id={`folder:${row.id}`} scopeId={row.id} name={row.name} path={`${remote}/${row.id.slice(remote.length + 1)}`} count={row.count} open={row.open} depth={row.depth + 1} base={6} noun="Folder" />
    ) : (
      <NavRow
        id={`remote:${remote}/${row.path}`}
        title={`${remote}/${row.path}`}
        label={`Remote branch ${remote}/${row.path}`}
        depth={row.depth + 1}
        base={14}
        onOpen={(anchor) => props.actions.openRefMenu(remoteTarget(`${remote}/${row.path}`), anchor)}
        onMenu={(anchor) => props.actions.openRefMenu(remoteTarget(`${remote}/${row.path}`), anchor)}
        onActivate={checkoutOf(remoteTarget(`${remote}/${row.path}`))}
      >
        <span class="name">{row.label}</span>
      </NavRow>
    );

  return (
    <aside class="panel sidebar" aria-label="Repository" onKeyDown={onKeyDown}>
      <Section icon="changes" title="Changes" count={changeTotal(snapshot().counts)} />
      <Section icon="branch" title="Branches" count={snapshot().branches.length}>
        <For each={localRows()}>{localRow}</For>
      </Section>
      <Section icon="remote" title="Remotes" count={snapshot().remotes.length}>
        <For each={snapshot().remotes}>
          {(remote) => (
            <>
              <FolderRow
                id={`folder:remote:${remote}`}
                scopeId={`remote:${remote}`}
                name={remote}
                path={remote}
                count={remoteBranches(remote).length}
                open={!collapsedFolders().has(`remote:${remote}`)}
                depth={0}
                base={6}
                noun="Remote"
              />
              <Show when={!collapsedFolders().has(`remote:${remote}`)}>
                <For each={remoteRows(remote)}>{(row) => remoteRow(remote, row)}</For>
              </Show>
            </>
          )}
        </For>
      </Section>
      <Section icon="tag" title="Tags" count={snapshot().tags.length}>
        <For each={snapshot().tags}>
          {(name) => {
            const target = () => tagTarget(name);
            return (
              <NavRow
                id={`tag:${name}`}
                title={name}
                label={`Tag ${name}`}
                onOpen={(anchor) => props.actions.openRefMenu(target(), anchor)}
                onMenu={(anchor) => props.actions.openRefMenu(target(), anchor)}
                onActivate={checkoutOf(target())}
              >
                <span class="name">{name}</span>
              </NavRow>
            );
          }}
        </For>
      </Section>
      <Section icon="stash" title="Stashes" count={snapshot().stashes.length}>
        <For each={snapshot().stashes}>
          {(stash) => (
            <NavRow
              id={`stash:${stash.sha}`}
              title={stash.message}
              label={`Stash ${stash.index}: ${stash.message}`}
              current={props.selection?.kind === "stash" && props.selection.sha === stash.sha}
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
      <Section icon="worktree" title="Worktrees" count={snapshot().worktrees.length}>
        <For each={snapshot().worktrees}>
          {(worktree) => (
            <div class="srow" classList={{ current: worktree.current }} title={worktree.path}>
              <span class="name">{basename(worktree.path)}</span>
              <span class="meta">{worktree.branch ?? (worktree.bare ? "bare" : "detached")}</span>
            </div>
          )}
        </For>
      </Section>
    </aside>
  );
}
