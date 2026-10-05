import { Show } from "solid-js";
import { basename } from "../format";
import type { IconName } from "../iconNames";
import type { PullMode } from "../ipc/bindings/PullMode";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RedoState, UndoState } from "../state/activityModel";
import { changeTotal } from "../state/changes";
import { pushRemote, type MenuEntry } from "../state/refMenu";
import type { Anchor, RepoActions } from "../state/repoActions";
import { SHORTCUTS } from "../state/shortcuts";
import { DEFAULT_PULL_MODE, fetchMenu, pullMenu, syncMenu } from "../state/syncModel";
import { createToolbarLabels } from "../state/viewport";
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

const reasonOf = (entries: MenuEntry[], id: string): string | undefined => {
  const entry = entries.find((item) => item.kind === "item" && item.id === id);
  return entry?.kind === "item" ? entry.disabledReason : undefined;
};

function Tool(props: {
  icon: IconName;
  label: string;
  labelled: boolean;
  shortcut?: string;
  name?: string;
  primary?: boolean;
  hint?: string;
  disabled?: boolean;
  ariaDisabled?: boolean;
  reason?: string | undefined;
  onClick: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void;
}) {
  const quietReason = () => props.ariaDisabled === true && !props.labelled;
  return (
    <button
      type="button"
      class="btn"
      classList={{ primary: props.primary === true, "icon-only": !props.labelled }}
      {...(props.labelled ? { "aria-label": props.name } : tip(quietReason() ? (props.reason ?? props.label) : (props.name ?? props.label), props.shortcut, props.name ?? props.label))}
      disabled={props.disabled === true}
      aria-disabled={props.ariaDisabled === true ? "true" : undefined}
      aria-description={props.ariaDisabled === true ? props.reason : undefined}
      title={quietReason() ? undefined : props.reason}
      onClick={(event) => props.ariaDisabled === true || props.onClick(event)}
    >
      <Icon name={props.icon} size={props.labelled ? 16 : 20} />
      <Show when={props.labelled}>{props.label}</Show>
      <Show when={props.hint}>{(hint) => <span class="hint">{hint()}</span>}</Show>
    </button>
  );
}

function Split(props: {
  icon: IconName;
  label: string;
  labelled: boolean;
  primary?: boolean;
  hint?: string;
  name?: string;
  shortcut?: string;
  disabled?: boolean;
  reason?: string | undefined;
  menuDisabled?: boolean;
  menuReason?: string | undefined;
  menuLabel: string;
  onClick: () => void;
  onMenu: (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void;
}) {
  const caretDisabled = () => props.menuDisabled ?? props.disabled === true;
  const caretReason = () => props.menuReason ?? props.reason;
  return (
    <span class="split-btn" role="group" aria-label={props.label}>
      <Tool
        icon={props.icon}
        label={props.label}
        labelled={props.labelled}
        primary={props.primary}
        hint={props.hint}
        name={props.name}
        shortcut={props.shortcut}
        disabled={props.disabled}
        reason={props.reason}
        onClick={props.onClick}
      />
      <button
        type="button"
        class="btn chev icon-only"
        classList={{ primary: props.primary === true }}
        aria-haspopup="menu"
        disabled={caretDisabled()}
        title={caretReason()}
        {...tip(props.menuLabel)}
        onClick={props.onMenu}
      >
        <Icon name="chevron" size={14} />
      </button>
    </span>
  );
}

export function CommandBar(props: {
  snapshot: RepoSnapshot;
  actions: RepoActions;
  undo: UndoState;
  redo: RedoState;
  online?: boolean;
  pullMode?: PullMode;
  onUndo: () => void;
  onRedo: () => void;
  onPalette: () => void;
  onSearch: () => void;
}) {
  const labelled = createToolbarLabels();
  const current = () => props.snapshot.worktrees.find((worktree) => worktree.current);
  const worktreeLabel = () => {
    const worktree = current();
    return worktree === undefined || worktree.path === props.snapshot.worktrees[0]?.path ? "main worktree" : basename(worktree.path);
  };
  const ahead = () => props.snapshot.upstream?.ahead_behind?.ahead;
  const behind = () => props.snapshot.upstream?.ahead_behind?.behind;
  const syncing = () => props.actions.sync().kind === "running";
  const offline = () => props.online === false;
  const mode = () => props.pullMode ?? DEFAULT_PULL_MODE;
  const unborn = () => props.snapshot.head.kind === "unborn";
  const publishing = () => props.snapshot.upstream === null && props.snapshot.head.kind !== "detached";
  const fetchReason = () => reasonOf(fetchMenu(props.snapshot, syncing(), offline()), "fetch");
  const pullReason = () => reasonOf(pullMenu(props.snapshot, syncing(), mode(), offline()), `pull:${mode()}`);
  const pushReason = () => reasonOf(syncMenu(props.snapshot, syncing(), mode(), offline()), "push");
  const pushToReason = () => reasonOf(syncMenu(props.snapshot, syncing(), mode(), offline()), "push_to");
  const stashReason = () => {
    if (syncing()) return "A sync is running";
    const counts = props.snapshot.counts;
    return counts === undefined || changeTotal(counts) === 0 ? "Nothing to stash" : undefined;
  };
  const publishReason = () => {
    if (props.snapshot.remotes.length === 0) return NO_REMOTE_REASON;
    if (unborn()) return "Make a first commit before publishing";
    return syncing() ? "A sync is running" : undefined;
  };
  const publish = (): void => {
    const remote = pushRemote(props.snapshot.remotes);
    if (remote !== undefined) void props.actions.publish(remote);
  };
  return (
    <div class="bar commandbar">
      <span class="crumb">
        <span class="crumb-repo" title={basename(props.snapshot.root)}>{basename(props.snapshot.root)}</span>
        <span class="sep">›</span>
        <span class="crumb-worktree" title={worktreeLabel()}>{worktreeLabel()}</span>
        <span class="sep">›</span>
        <button
          type="button"
          class="branch"
          aria-haspopup="menu"
          aria-label={`Branch menu: ${headLabel(props.snapshot)}`}
          disabled={unborn()}
          title={unborn() ? "Make a first commit before switching branches" : undefined}
          onClick={(event) => props.actions.openBranchPicker(below(event.currentTarget))}
        >
          <span class="branch-name">{headLabel(props.snapshot)}</span>
          <Icon name="chevron" />
        </button>
      </span>
      <button type="button" class="cmd" aria-label="Open the command palette" onClick={props.onPalette}>
        <Icon name="search" />
        <span class="cmd-text">Search commits, branches, or run a command</span>
        <span class="kbd">{SHORTCUTS.palette}</span>
      </button>
      <button type="button" class="icon-btn" {...tip("Search commits", SHORTCUTS.search)} onClick={props.onSearch}>
        <Icon name="search" />
      </button>
      <Split
        icon="fetch"
        label="Fetch"
        labelled={labelled()}
        shortcut={SHORTCUTS.fetch}
        disabled={fetchReason() !== undefined}
        reason={fetchReason()}
        menuLabel="Fetch menu"
        onClick={() => void props.actions.fetchAll()}
        onMenu={(event) => props.actions.openFetchMenu(below(event.currentTarget))}
      />
      <Split
        icon="pull"
        label="Pull"
        labelled={labelled()}
        primary={!publishing()}
        hint={behind() === undefined ? undefined : `↓${behind()}`}
        name={behind() === undefined ? "Pull" : `Pull, ${behind()} behind`}
        shortcut={SHORTCUTS.pull}
        disabled={pullReason() !== undefined}
        reason={pullReason()}
        menuLabel="Pull menu"
        onClick={() => void props.actions.pullDefault()}
        onMenu={(event) => props.actions.openPullMenu(below(event.currentTarget))}
      />
      <Show
        when={publishing()}
        fallback={
          <Split
            icon="push"
            label="Push"
            labelled={labelled()}
            hint={ahead() === undefined ? undefined : `↑${ahead()}`}
            name={ahead() === undefined ? "Push" : `Push, ${ahead()} ahead`}
            shortcut={SHORTCUTS.push}
            disabled={pushReason() !== undefined}
            reason={pushReason()}
            menuDisabled={pushToReason() !== undefined}
            menuReason={pushToReason()}
            menuLabel="Push to…"
            onClick={() => void props.actions.push()}
            onMenu={(event) => props.actions.openPushTo(below(event.currentTarget))}
          />
        }
      >
        <Split
          icon="push"
          label="Publish"
          labelled={labelled()}
          primary
          disabled={publishReason() !== undefined}
          reason={publishReason()}
          menuDisabled={pushToReason() !== undefined}
          menuReason={pushToReason()}
          menuLabel="Push to…"
          onClick={publish}
          onMenu={(event) => props.actions.openPushTo(below(event.currentTarget))}
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
      <Tool
        icon="stash"
        label="Stash"
        labelled={labelled()}
        shortcut={SHORTCUTS.stash}
        disabled={stashReason() !== undefined}
        reason={stashReason()}
        onClick={(event) => props.actions.openStashForm(below(event.currentTarget))}
      />
      <Tool
        icon="undo"
        label="Undo"
        labelled={labelled()}
        shortcut={SHORTCUTS.undo}
        name={props.undo.kind === "available" ? props.undo.scope : "Undo"}
        disabled={props.undo.kind !== "available"}
        reason={props.undo.kind === "available" ? (labelled() ? props.undo.scope : undefined) : props.undo.reason}
        onClick={props.onUndo}
      />
      <Tool
        icon="redo"
        label="Redo"
        labelled={labelled()}
        shortcut={SHORTCUTS.redo}
        name={props.redo.kind === "available" ? props.redo.scope : "Redo"}
        ariaDisabled={props.redo.kind !== "available"}
        reason={props.redo.kind === "available" ? (labelled() ? props.redo.scope : undefined) : props.redo.reason}
        onClick={props.onRedo}
      />
    </div>
  );
}
