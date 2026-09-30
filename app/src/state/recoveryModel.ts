import type { ReflogEntry } from "../ipc/bindings/ReflogEntry";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { ResetMode } from "../ipc/bindings/ResetMode";
import type { SnapshotInfo } from "../ipc/bindings/SnapshotInfo";
import type { ConfirmCopy } from "./confirmCopy";

export const REFLOG_PAGE = 50;

export const RECOVERY_LIMITS = [
  "Work changed outside YForge and never committed cannot be recovered.",
  "Objects Git has already pruned cannot be recovered.",
  "Snapshots are kept for 30 days. Their refs appear in git log --all in other tools and are pushed only by git push --mirror.",
] as const;

const BRANCH_PREFIX = "refs/heads/";

const short = (sha: string): string => sha.slice(0, 7);

export const referenceLabel = (reference: string): string => (reference.startsWith(BRANCH_PREFIX) ? reference.slice(BRANCH_PREFIX.length) : reference);

export function nextReflogCursor(page: readonly Pick<ReflogEntry, "index">[]): number | undefined {
  return page.length === REFLOG_PAGE ? page[page.length - 1]?.index : undefined;
}

export function suggestBranchName(sha: string, existing: readonly string[]): string {
  const base = `restored-${short(sha)}`;
  let candidate = base;
  for (let number = 2; existing.includes(candidate); number += 1) candidate = `${base}-${number}`;
  return candidate;
}

export function restoreResetCopy(mode: ResetMode, current: string, sha: string): ConfirmCopy {
  const consequences = {
    soft: [`Moves ${current} to ${short(sha)} and keeps your changes staged.`],
    mixed: [`Moves ${current} to ${short(sha)} and keeps your changes in the working tree, unstaged.`],
    hard: [
      `Moves ${current} and the working tree to ${short(sha)}. Uncommitted changes to tracked files are discarded; untracked files stay.`,
      "A safety snapshot is saved first, and Undo moves the branch back.",
    ],
  }[mode];
  return {
    title: `${mode === "hard" ? "Hard reset" : mode === "soft" ? "Soft reset" : "Mixed reset"} ${current} to ${short(sha)}?`,
    consequences,
    names: [],
    confirmLabel: mode === "hard" ? "Hard reset" : mode === "soft" ? "Soft reset" : "Mixed reset",
    ...(mode === "hard" ? { warning: true } : { neutral: true }),
  };
}

export function restoreCheckoutCopy(sha: string): ConfirmCopy {
  return {
    title: `Check out ${short(sha)} as a detached HEAD?`,
    consequences: [
      "HEAD will point at this commit instead of a branch. Commits made here belong to no branch and can be lost when you switch away.",
      "The working tree must be clean, because nothing is stashed. Undo switches back.",
    ],
    names: [],
    confirmLabel: "Check out detached",
    neutral: true,
  };
}

const ACTION_LABELS: Record<string, string> = {
  discard: "Discard",
  discard_hunk: "Discard hunk",
  discard_lines: "Discard lines",
  reset_hard: "Hard reset",
  checkout: "Checkout",
  interactive_rebase: "Interactive rebase",
  squash_commits: "Squash",
  recompose: "Recompose",
  drop_stash: "Drop stash",
  delete_branch: "Delete branch",
  remove_worktree: "Remove worktree",
  restore_files: "Restore files",
  restore_snapshot: "Restore snapshot",
};

export function snapshotActionLabel(action: string): string {
  const known = ACTION_LABELS[action];
  if (known !== undefined) return known;
  const words = action.replace(/_/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function currentPosition(snapshot: RepoSnapshot): { sha: string | null; branch: string | null } {
  const head = snapshot.head;
  if (head.kind === "branch") return { sha: head.sha, branch: head.name };
  if (head.kind === "detached") return { sha: head.sha, branch: null };
  return { sha: null, branch: head.branch };
}

export function headMoved(info: SnapshotInfo, snapshot: RepoSnapshot): boolean {
  const current = currentPosition(snapshot);
  if (info.head_sha === null && current.sha === null) return false;
  return info.head_sha !== current.sha || info.branch !== current.branch;
}

export function restoreAllCopy(info: SnapshotInfo, moved: boolean, snapshot: RepoSnapshot): ConfirmCopy {
  const consequences = [
    "The index and the working tree return to their state in this snapshot, including untracked files. It never moves HEAD.",
    "The current state is saved as a new snapshot first, so restoring can be undone by restoring that snapshot.",
  ];
  if (moved) {
    const now = currentPosition(snapshot).sha;
    consequences.unshift(`HEAD moved from ${info.head_sha === null ? "the start" : short(info.head_sha)} to ${now === null ? "the start" : short(now)} since this snapshot. Restoring puts its files on the current HEAD.`);
  }
  return { title: "Restore everything from this snapshot?", consequences, names: [], confirmLabel: "Restore everything", warning: moved };
}
