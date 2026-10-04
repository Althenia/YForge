import type { IconName } from "../iconNames";
import type { IntegrationPreview } from "../ipc/bindings/IntegrationPreview";
import type { Operation } from "../ipc/bindings/Operation";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { StashEntry } from "../ipc/bindings/StashEntry";
import { SHORTCUTS } from "./shortcuts";

export type MenuPart = string | { ref: string };

export type MenuEntry =
  | { kind: "separator" }
  | { kind: "item"; id: string; label: MenuPart[]; icon?: IconName; danger?: boolean; note?: string; shortcut?: string; disabledReason?: string };

export type RefTarget =
  | { kind: "local_branch"; name: string; remoteName: string | undefined; startPoint: string }
  | { kind: "remote_branch"; name: string; startPoint: string }
  | { kind: "tag"; name: string; startPoint: string };

export const NOT_AVAILABLE = "Not available yet";

export type MenuContext = {
  current: string | undefined;
  remotes: readonly string[];
  operation: Operation | null;
  upstream?: string | null;
  selection?: readonly string[];
};

const operationBlockReason: Record<Operation, string> = {
  merge: "Finish or abort the merge first",
  rebase: "Finish or abort the rebase first",
  cherry_pick: "Finish or abort the cherry-pick first",
  revert: "Finish or abort the revert first",
  cherry_pick_sequence: "Finish or abort the cherry-pick first",
  revert_sequence: "Finish or abort the revert first",
  bisect: "Reset the bisect first",
};

export const operationBlock = (operation: Operation | null): string | undefined => (operation === null ? undefined : operationBlockReason[operation]);

export const SINGLE_COMMIT_REASON = "Select a single commit";
export const MERGE_COMMIT_REASON = "A merge commit needs a parent choice, which is not available yet";
export const MERGE_REWRITE_REASON = "A merge commit cannot be rewritten";
export const NO_REMOTE = "This repository has no remote";

export function pushRemote(remotes: readonly string[]): string | undefined {
  return remotes.includes("origin") ? "origin" : remotes[0];
}

const separator: MenuEntry = { kind: "separator" };

const menuIcons: Partial<Record<string, IconName>> = {
  checkout: "check",
  create_branch: "branch",
  create_tag: "tag",
  create_worktree: "worktree",
  merge: "merge",
  push_tag: "push",
  rename: "edit",
  edit_message: "edit",
  delete: "trash",
  delete_remote: "trash",
  delete_both: "trash",
  push_to: "push",
  inspect: "diff",
  rename_stash: "edit",
  delete_tag: "trash",
  delete_remote_tag: "trash",
  drop: "trash",
  revert: "undo",
  reset: "reset",
  copy: "copy",
  edit_history: "rebase",
  squash: "squash",
  recompose: "recompose",
};

const item = (id: string, label: MenuPart[], extra: Partial<Extract<MenuEntry, { kind: "item" }>> = {}): MenuEntry => {
  const icon = menuIcons[id];
  return { kind: "item", id, label, ...(icon === undefined ? {} : { icon }), ...extra };
};

const unavailable = (id: string, label: MenuPart[]): MenuEntry => item(id, label, { disabledReason: NOT_AVAILABLE });

export function shortRefName(target: Pick<RefTarget, "kind" | "name">, remotes: readonly string[]): string {
  if (target.kind !== "remote_branch") return target.name;
  const remote = remotes.filter((name) => target.name.startsWith(`${name}/`)).sort((left, right) => right.length - left.length)[0];
  return remote === undefined ? target.name : target.name.slice(remote.length + 1);
}

export function remoteOf(target: Pick<RefTarget, "kind" | "name">, remotes: readonly string[]): string | undefined {
  return target.kind === "remote_branch" ? remotes.filter((name) => target.name.startsWith(`${name}/`)).sort((left, right) => right.length - left.length)[0] : undefined;
}

function integrationEntries(other: string, context: MenuContext, sameBranch: boolean): MenuEntry[] {
  const ref = { ref: other };
  const current: MenuPart = { ref: context.current ?? "HEAD" };
  const blocked = operationBlock(context.operation) ?? (sameBranch ? "Already the checked-out branch" : undefined);
  const withReason = blocked === undefined ? {} : { disabledReason: blocked };
  return [
    item("merge", ["Merge ", ref, " into ", current], withReason),
    item("rebase", ["Rebase ", current, " onto ", ref], withReason),
    item("fast_forward", ["Fast-forward ", current, " to ", ref], context.current === undefined ? { disabledReason: "HEAD is detached" } : withReason),
  ];
}

export function refMenu(target: RefTarget, context: MenuContext): MenuEntry[] {
  const { current: currentBranch, remotes } = context;
  const shown = shortRefName(target, remotes);
  const ref = { ref: target.name };
  const current: MenuPart = { ref: currentBranch ?? "HEAD" };
  const isCurrent = target.kind === "local_branch" && target.name === currentBranch;
  const remote = pushRemote(remotes);
  const checkout =
    target.kind === "local_branch"
      ? item("checkout", ["Checkout ", ref], isCurrent ? { disabledReason: "Already checked out" } : {})
      : target.kind === "remote_branch"
        ? item("checkout", ["Checkout ", { ref: shown }], { note: "creates a tracking branch" })
        : item("checkout", ["Checkout ", ref], { note: "detached" });
  const entries: MenuEntry[] = [checkout];
  if (target.kind !== "tag") entries.push(...integrationEntries(target.name, context, isCurrent));
  entries.push(
    separator,
    item("create_branch", ["Create branch here…"]),
    unavailable("create_worktree", ["Create worktree from ", ref, "…"]),
    item("create_tag", ["Create tag here…"]),
  );
  if (target.kind === "tag") {
    entries.push(
      separator,
      item("push_tag", ["Push ", ref, " to ", { ref: remote ?? "remote" }], remote === undefined ? { disabledReason: NO_REMOTE } : {}),
    );
  } else {
    entries.push(
      separator,
      item("reset", ["Reset ", current, " to ", ref], operationBlock(context.operation) === undefined ? {} : { disabledReason: operationBlock(context.operation) }),
      unavailable("edit_message", ["Edit commit message"]),
    );
  }
  entries.push(separator);
  if (target.kind === "local_branch") {
    const noRemote = remotes.length === 0 ? { disabledReason: NO_REMOTE } : {};
    entries.push(item("set_upstream", ["Set upstream of ", ref, "…"], noRemote));
    if (isCurrent && context.upstream != null) entries.push(item("unset_upstream", ["Unset upstream of ", ref]));
    if (isCurrent) entries.push(item("push_to", ["Push ", ref, " to…"], noRemote));
    entries.push(
      separator,
      item("rename", ["Rename ", ref, "…"]),
      item("delete", ["Delete ", ref, "…"], isCurrent ? { danger: true, disabledReason: "Checked out; switch to another branch first" } : { danger: true }),
    );
    if (target.remoteName !== undefined) {
      entries.push(
        item("delete_remote", ["Delete ", { ref: target.remoteName }, "…"], { danger: true }),
        item(
          "delete_both",
          ["Delete ", ref, " and ", { ref: target.remoteName }, "…"],
          isCurrent ? { danger: true, disabledReason: "Checked out; switch to another branch first" } : { danger: true },
        ),
      );
    }
  } else if (target.kind === "remote_branch") {
    entries.push(item("delete_remote", ["Delete ", ref, "…"], { danger: true }));
  } else {
    entries.push(
      item("delete_tag", ["Delete ", ref, "…"], { danger: true }),
      item("delete_remote_tag", ["Delete ", ref, " from ", { ref: remote ?? "remote" }, "…"], remote === undefined ? { danger: true, disabledReason: NO_REMOTE } : { danger: true }),
    );
  }
  entries.push(separator, unavailable("copy", ["Copy"]), separator, unavailable("hide", ["Hide in graph"]));
  return entries;
}

export const localTarget = (snapshot: Pick<RepoSnapshot, "remote_branches" | "remotes">, name: string): RefTarget => ({
  kind: "local_branch",
  name,
  remoteName: snapshot.remote_branches.find((candidate) => snapshot.remotes.some((remote) => candidate === `${remote}/${name}`)),
  startPoint: `refs/heads/${name}`,
});

export const remoteTarget = (name: string): RefTarget => ({ kind: "remote_branch", name, startPoint: `refs/remotes/${name}` });

export const tagTarget = (name: string): RefTarget => ({ kind: "tag", name, startPoint: `refs/tags/${name}` });

export function resetModeMenu(): MenuEntry[] {
  return [
    item("soft", ["Soft"], { note: "keep changes staged" }),
    item("mixed", ["Mixed"], { note: "keep changes unstaged" }),
    separator,
    item("hard", ["Hard"], { danger: true, note: "discard changes" }),
  ];
}

export type DropPlan = { title: MenuPart[]; entries: MenuEntry[]; into: string; other: string };

export function dropBase(dragged: RefTarget, dropped: RefTarget, current: string | undefined): { into: string; other: string } | undefined {
  if (dragged.kind === "tag" || dropped.kind === "tag" || dragged.name === dropped.name) return undefined;
  if (dropped.kind === "local_branch" && (dropped.name === current || dragged.name !== current)) return { into: dropped.name, other: dragged.name };
  if (dragged.kind === "local_branch" && dragged.name === current) return { into: dragged.name, other: dropped.name };
  return undefined;
}

export function dropPlan(dragged: RefTarget, dropped: RefTarget, context: MenuContext, preview: IntegrationPreview): DropPlan | undefined {
  const base = dropBase(dragged, dropped, context.current);
  if (base === undefined) return undefined;
  const { into, other } = base;
  const count = preview.incoming.count;
  const blocked = operationBlock(context.operation);
  const upToDate = count === 0 ? "Already up to date" : undefined;
  const ffReason = blocked ?? upToDate ?? (preview.fast_forward ? undefined : `${into} has commits that ${other} does not`);
  const entries: MenuEntry[] = [
    item("fast_forward", ["Fast-forward ", { ref: into }, ` by ${count} ${count === 1 ? "commit" : "commits"}`], ffReason === undefined ? {} : { disabledReason: ffReason }),
  ];
  if (into === context.current) {
    const reason = blocked ?? upToDate;
    const extra = reason === undefined ? {} : { disabledReason: reason };
    entries.push(
      item("merge", ["Merge ", { ref: other }, " into ", { ref: into }], extra),
      item("rebase", ["Rebase ", { ref: into }, " onto ", { ref: other }], extra),
    );
  }
  return { title: ["Drop ", { ref: dragged.name }, " on ", { ref: dropped.name }], entries, into, other };
}

export function stashMenu(stash: Pick<StashEntry, "index">): MenuEntry[] {
  const ref = { ref: `stash@{${stash.index}}` };
  return [
    item("inspect", ["Inspect ", ref]),
    item("apply", ["Apply ", ref], { note: "keeps the stash" }),
    item("pop", ["Pop ", ref], { note: "applies and drops" }),
    item("rename_stash", ["Rename ", ref, "…"]),
    separator,
    item("drop", ["Drop ", ref, "…"], { danger: true }),
  ];
}

export function startLabel(startPoint: string): string {
  for (const prefix of ["refs/heads/", "refs/remotes/", "refs/tags/"]) {
    if (startPoint.startsWith(prefix)) return startPoint.slice(prefix.length);
  }
  return startPoint.slice(0, 7);
}

export function startPointText(at: string | null, summary?: string): string {
  if (at === null) return "from HEAD";
  const label = startLabel(at);
  return summary === undefined || summary === "" ? `from ${label}` : `from ${label} ${summary}`;
}

export type CommitMenuContext = MenuContext & { sha: string; merge: boolean; root?: boolean; squashReason?: string };

export function commitMenu(context: CommitMenuContext): MenuEntry[] {
  const short = { ref: context.sha.slice(0, 7) };
  const current: MenuPart = { ref: context.current ?? "HEAD" };
  const blocked = operationBlock(context.operation);
  const several = (context.selection?.length ?? 0) > 1;
  const single = (reason: string | undefined) => (several ? SINGLE_COMMIT_REASON : reason);
  const reasoned = (reason: string | undefined) => (reason === undefined ? {} : { disabledReason: reason });
  const applyReason = single(blocked ?? (context.merge ? MERGE_COMMIT_REASON : undefined));
  return [
    item("cherry_pick", ["Cherry-pick ", short, " onto ", current], reasoned(applyReason)),
    item("revert", ["Revert ", short], reasoned(applyReason)),
    separator,
    item("create_branch", ["Create branch here…"], { shortcut: SHORTCUTS.createBranch, ...reasoned(single(undefined)) }),
    item("create_tag", ["Create tag here…"], reasoned(single(undefined))),
    separator,
    item("reset", ["Reset ", current, " to ", short], reasoned(single(blocked))),
    separator,
    item("edit_history", ["Edit history from ", short, "…"], reasoned(single(blocked ?? (context.merge ? MERGE_REWRITE_REASON : context.root === true ? "The root commit has no parent to rebase onto" : undefined)))),
    ...(several ? [item("squash", [`Squash ${context.selection?.length} commits…`], reasoned(blocked ?? context.squashReason))] : []),
    item("recompose", ["Recompose from ", short, "…"], reasoned(single(blocked ?? (context.merge ? MERGE_REWRITE_REASON : context.root === true ? "The root commit has no parent to recompose from" : undefined)))),
  ];
}

export function branchPickerMenu(branches: readonly string[], current: string | undefined, upstream: string | null, remotes: readonly string[]): MenuEntry[] {
  const upstreamReason = current === undefined ? "Check out a branch to set its upstream" : remotes.length === 0 ? NO_REMOTE : undefined;
  return [
    ...branches.map((name) => item(`checkout:${name}`, [{ ref: name }], name === current ? { icon: "check", disabledReason: "Already checked out" } : { icon: "local" })),
    separator,
    item("set_upstream", ["Set upstream…"], upstreamReason === undefined ? {} : { disabledReason: upstreamReason }),
    ...(current !== undefined && upstream !== null ? [item("unset_upstream", ["Unset upstream"])] : []),
  ];
}
