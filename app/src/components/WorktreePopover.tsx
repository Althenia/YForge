import { For, Show } from "solid-js";
import type { WorktreeStatus } from "../ipc/bindings/WorktreeStatus";
import type { Anchor } from "../state/repoActions";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

export function WorktreePopover(props: { anchor: Anchor; worktrees: readonly WorktreeStatus[]; onClose: () => void }) {
  return (
    <Popover anchor={props.anchor} label="Worktrees" onClose={props.onClose}>
      <ul class="wt-list" tabindex="0" data-autofocus aria-label="Worktrees">
        <For each={props.worktrees}>
          {(worktree) => (
            <li class="wt-row" title={worktree.path}>
              <Icon name="worktree" />
              <span class="ref">{worktree.branch ?? (worktree.bare ? "bare" : "detached")}</span>
              <span class="path-line">
                <bdi dir="ltr">{worktree.path}</bdi>
              </span>
              <Show when={worktree.current}>
                <span class="wt-flag">current</span>
              </Show>
              <Show when={worktree.dirty}>
                <span class="wt-flag st-modified">changes</span>
              </Show>
              <Show when={worktree.locked}>
                <span class="wt-flag">locked</span>
              </Show>
              <Show when={worktree.prunable}>
                <span class="wt-flag">missing</span>
              </Show>
            </li>
          )}
        </For>
      </ul>
    </Popover>
  );
}
