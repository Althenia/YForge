import { useQuery } from "@tanstack/solid-query";
import { For, Show } from "solid-js";
import { client } from "../ipc/client";
import { dataOf } from "../state/queryData";
import { repoKeys } from "../state/queryKeys";
import type { RepoSession } from "../state/repoSession";
import type { WorktreeActions } from "../state/worktreeActions";
import { flagsOf, integrateBlock, laneLabel, removeBlock } from "../state/worktreeModel";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

export function WorktreePanel(props: { session: RepoSession; actions: WorktreeActions; onClose: () => void }) {
  const root = () => props.session.snapshot().root;
  const listing = useQuery(() => ({ queryKey: repoKeys.worktrees(root()), queryFn: () => client.worktreeList(root()) }));
  const lanes = () => dataOf(listing) ?? [];
  const linked = () => lanes().length > 1;

  return (
    <section
      class="panel rpanel"
      aria-label="Worktrees"
      aria-busy={listing.isFetching}
      tabindex="-1"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <div class="rhead">
        <Icon name="worktree" />
        <span>Worktrees</span>
        <span class="dim">{lanes().length}</span>
        <span class="spacer" />
        <button type="button" class="btn sm primary" onClick={props.actions.openCreate}>
          <Icon name="plus" />
          Create worktree…
        </button>
        <button type="button" class="btn sm" onClick={props.onClose}>
          Back to graph
        </button>
      </div>
      <div class="rbody">
        <Show when={listing.error}>
          {(error) => (
            <div class="graph-error" role="alert">
              {error() instanceof Error ? (error() as Error).message : String(error())}
            </div>
          )}
        </Show>
        <Show when={lanes().length > 0 && !linked()}>
          <div class="note" role="status">
            No linked worktrees. Create one to work on another branch in parallel.
          </div>
        </Show>
        <ul class="rlist" aria-label="Worktrees">
          <For each={lanes()}>
            {(worktree, index) => {
              const remove = () => removeBlock(worktree, lanes());
              const integrate = () => integrateBlock(worktree, lanes());
              return (
                <li class="wrow" classList={{ current: worktree.current }} aria-current={worktree.current ? "true" : undefined}>
                  <Icon name="worktree" />
                  <span class="ref wbranch">{laneLabel(worktree)}</span>
                  <Show when={index() === 0}>
                    <span class="chip">Main worktree</span>
                  </Show>
                  <For each={flagsOf(worktree)}>
                    {(flag) => (
                      <span class="chip" classList={{ "chip-attention": flag === "changes" || flag === "missing" }}>
                        {flag}
                      </span>
                    )}
                  </For>
                  <span class="path-line wpath" title={worktree.path}>
                    <bdi dir="ltr">{worktree.path}</bdi>
                  </span>
                  <span class="wactions">
                    <button
                      type="button"
                      class="icon-btn dense"
                      disabled={worktree.current || worktree.prunable}
                      title={worktree.current ? "This worktree is open here" : worktree.prunable ? "This worktree is missing from disk" : undefined}
                      {...tip("Open as tab", undefined, `Open ${worktree.path} as a tab`)}
                      onClick={() => void props.actions.open(worktree.path)}
                    >
                      <Icon name="open" />
                    </button>
                    <button
                      type="button"
                      class="icon-btn dense"
                      disabled={worktree.prunable}
                      title={worktree.prunable ? "This worktree is missing from disk" : undefined}
                      {...tip("Open in terminal", undefined, `Open ${worktree.path} in terminal`)}
                      onClick={() => void props.actions.openTerminal(worktree.path)}
                    >
                      <Icon name="terminal" />
                    </button>
                    <button
                      type="button"
                      class="icon-btn dense"
                      aria-disabled={integrate() !== undefined}
                      title={integrate()}
                      {...tip("Integrate into another worktree…", undefined, `Integrate ${laneLabel(worktree)}`)}
                      onClick={() => void props.actions.integrate(worktree.path)}
                    >
                      <Icon name="merge" />
                    </button>
                    <button
                      type="button"
                      class="icon-btn dense"
                      aria-disabled={remove() !== undefined}
                      title={remove()}
                      {...tip("Remove worktree…", undefined, `Remove ${worktree.path}`)}
                      onClick={() => void props.actions.remove(worktree.path)}
                    >
                      <Icon name="trash" />
                    </button>
                  </span>
                </li>
              );
            }}
          </For>
        </ul>
        <p class="setting-note">
          Integrate rebases the worktree's branch onto the target, then fast-forwards the target, so the history stays linear. A worktree is opened as its own tab, grouped under this repository.
        </p>
      </div>
    </section>
  );
}
