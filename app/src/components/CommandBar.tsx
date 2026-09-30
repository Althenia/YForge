import { Show } from "solid-js";
import { basename } from "../format";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { UndoState } from "../state/activityModel";
import { pushRemote } from "../state/refMenu";
import type { Anchor, RepoActions } from "../state/repoActions";
import { createToolbarLabels } from "../state/viewport";
import type { IconName } from "../iconNames";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

export const NO_REMOTE_REASON = "No remote configured";

function headLabel(snapshot: RepoSnapshot): string {
  switch (snapshot.head.kind) {
    case "branch":
      return snapshot.head.name;
    case "unborn":
      return snapshot.head.branch;
    case "detached":
      return snapshot.head.sha.slice(0, 7);
  }
}

const below = (element: HTMLElement): Anchor => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.bottom + 8 };
};

function Tool(props: {
  icon: IconName;
  label: string;
  labelled: boolean;
  shortcut?: string;
  name?: string;
  primary?: boolean;
  hint?: string;
  caret?: boolean;
  menu?: boolean;
  disabled?: boolean;
  reason?: string | undefined;
  onClick: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void;
}) {
  return (
    <button
      type="button"
      class="btn"
      classList={{ primary: props.primary === true, "icon-only": !props.labelled }}
      {...(props.labelled ? { "aria-label": props.name } : tip(props.name ?? props.label, props.shortcut))}
      aria-haspopup={props.menu === true ? "menu" : undefined}
      disabled={props.disabled === true}
      title={props.reason}
      onClick={props.onClick}
    >
      <Icon name={props.icon} size={props.labelled ? 16 : 20} />
      <Show when={props.labelled}>{props.label}</Show>
      <Show when={props.hint}>{(hint) => <span class="hint">{hint()}</span>}</Show>
      <Show when={props.labelled && props.caret === true}>
        <Icon name="chevron" size={14} />
      </Show>
    </button>
  );
}

export function CommandBar(props: {
  snapshot: RepoSnapshot;
  actions: RepoActions;
  undo: UndoState;
  onUndo: () => void;
  onPalette: () => void;
  onSearch: () => void;
}) {
  const labelled = createToolbarLabels();
  const current = () => props.snapshot.worktrees.find((worktree) => worktree.current);
  const worktreeLabel = () => {
    const worktree = current();
    return worktree === undefined || worktree.path === props.snapshot.worktrees[0]?.path ? "main worktree" : basename(worktree.path);
  };
  const ahead = () => props.snapshot.upstream?.ahead_behind?.ahead ?? 0;
  const syncing = () => props.actions.sync().kind === "running";
  const unborn = () => props.snapshot.head.kind === "unborn";
  const publishing = () => props.snapshot.upstream === null && props.snapshot.head.kind !== "detached";
  const publishReason = () => {
    if (props.snapshot.remotes.length === 0) return NO_REMOTE_REASON;
    if (unborn()) return "Make a first commit before publishing";
    return syncing() ? "A sync is running" : undefined;
  };
  const publish = (anchor: Anchor) => {
    const remotes = props.snapshot.remotes;
    if (remotes.length > 1) props.actions.openPublishMenu(anchor);
    else if (pushRemote(remotes) !== undefined) void props.actions.publish(pushRemote(remotes) ?? "");
  };
  return (
    <div class="bar commandbar">
      <span class="crumb">
        {basename(props.snapshot.root)}
        <span class="sep">›</span>
        {worktreeLabel()}
        <span class="sep">›</span>
        <span class="branch">{headLabel(props.snapshot)}</span>
        <Icon name="chevron" />
      </span>
      <button type="button" class="cmd" aria-label="Open the command palette" onClick={props.onPalette}>
        <Icon name="search" />
        <span class="cmd-text">Search commits, branches, or run a command</span>
        <span class="kbd">⌘K</span>
      </button>
      <button type="button" class="icon-btn" {...tip("Search commits", "⌘F")} onClick={props.onSearch}>
        <Icon name="search" />
      </button>
      <Show
        when={publishing()}
        fallback={
          <Tool
            icon="sync"
            label="Sync"
            labelled={labelled()}
            name={labelled() ? undefined : ahead() > 0 ? `Sync, ${ahead()} ahead` : "Sync"}
            primary
            menu
            caret
            hint={ahead() > 0 ? `↑${ahead()}` : undefined}
            disabled={syncing()}
            reason={syncing() ? "A sync is running" : undefined}
            onClick={(event) => props.actions.openSyncMenu(below(event.currentTarget))}
          />
        }
      >
        <Tool
          icon="push"
          label="Publish"
          labelled={labelled()}
          primary
          menu={props.snapshot.remotes.length > 1}
          disabled={publishReason() !== undefined}
          reason={publishReason()}
          onClick={(event) => publish(below(event.currentTarget))}
        />
      </Show>
      <Tool
        icon="branch"
        label="Branch"
        labelled={labelled()}
        disabled={unborn()}
        reason={unborn() ? "Make a first commit before creating branches" : undefined}
        onClick={(event) => props.actions.openCreateBranch(below(event.currentTarget))}
      />
      <Tool icon="stash" label="Stash" labelled={labelled()} shortcut="⌘⇧S" onClick={(event) => props.actions.openStashForm(below(event.currentTarget))} />
      <Tool
        icon="undo"
        label="Undo"
        labelled={labelled()}
        shortcut="⌘Z"
        name={props.undo.kind === "available" ? `Undo: ${props.undo.scope}` : "Undo"}
        disabled={props.undo.kind !== "available"}
        reason={props.undo.kind === "available" ? (labelled() ? props.undo.scope : undefined) : props.undo.reason}
        onClick={props.onUndo}
      />
    </div>
  );
}
