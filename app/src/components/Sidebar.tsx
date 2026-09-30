import { createSignal, For, Show, type JSX } from "solid-js";
import { basename } from "../format";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { changeTotal } from "../state/changes";
import { localTarget, remoteTarget, tagTarget, type RefTarget } from "../state/refMenu";
import type { Anchor, RepoActions } from "../state/repoActions";
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

export function Sidebar(props: { snapshot: RepoSnapshot; actions: RepoActions }) {
  const snapshot = () => props.snapshot;
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

  function NavRow(row: {
    id: string;
    title: string;
    current?: boolean;
    child?: boolean;
    label: string;
    onOpen: (anchor: Anchor) => void;
    onMenu: (anchor: Anchor) => void;
    onActivate?: () => void;
    children?: JSX.Element;
  }) {
    const first = () => activeRow() === undefined && row.id === "first";
    return (
      <div
        class="srow"
        classList={{ current: row.current === true, child: row.child === true }}
        role="button"
        aria-haspopup="menu"
        aria-label={row.label}
        aria-current={row.current === true ? "true" : undefined}
        data-nav={row.id}
        tabindex={activeRow() === row.id || first() ? 0 : -1}
        title={row.title}
        onFocus={() => setActiveRow(row.id)}
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

  const branchTarget = (name: string): RefTarget => localTarget(snapshot(), name);
  const checkoutOf = (target: RefTarget) => () => {
    if (target.kind !== "local_branch" || target.name !== currentBranch()) props.actions.checkoutRef(target);
  };

  return (
    <aside class="panel sidebar" aria-label="Repository" onKeyDown={onKeyDown}>
      <Section icon="changes" title="Changes" count={changeTotal(snapshot().counts)} />
      <Section icon="branch" title="Branches" count={snapshot().branches.length}>
        <For each={snapshot().branches}>
          {(name, index) => {
            const target = () => branchTarget(name);
            return (
              <NavRow
                id={index() === 0 ? "first" : `branch:${name}`}
                title={name}
                label={`Branch ${name}${name === currentBranch() ? ", checked out" : ""}`}
                current={name === currentBranch()}
                onOpen={(anchor) => props.actions.openRefMenu(target(), anchor)}
                onMenu={(anchor) => props.actions.openRefMenu(target(), anchor)}
                onActivate={checkoutOf(target())}
              >
                <span class="name">{name}</span>
                <Show when={branchMeta(name)}>
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
          }}
        </For>
      </Section>
      <Section icon="remote" title="Remotes" count={snapshot().remotes.length}>
        <For each={snapshot().remotes}>
          {(remote) => (
            <>
              <div class="srow folder" title={remote}>
                <span class="name">{remote}</span>
                <span class="meta">{remoteBranches(remote).length} branches</span>
              </div>
              <For each={remoteBranches(remote)}>
                {(name) => {
                  const target = () => remoteTarget(name);
                  return (
                    <NavRow
                      id={`remote:${name}`}
                      title={name}
                      label={`Remote branch ${name}`}
                      child
                      onOpen={(anchor) => props.actions.openRefMenu(target(), anchor)}
                      onMenu={(anchor) => props.actions.openRefMenu(target(), anchor)}
                      onActivate={checkoutOf(target())}
                    >
                      <span class="name">{name.slice(remote.length + 1)}</span>
                    </NavRow>
                  );
                }}
              </For>
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
              onOpen={(anchor) => props.actions.openStashMenu(stash, anchor)}
              onMenu={(anchor) => props.actions.openStashMenu(stash, anchor)}
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
