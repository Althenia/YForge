import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { CommitBrief } from "../ipc/bindings/CommitBrief";
import type { FileChange } from "../ipc/bindings/FileChange";
import type { ForcePushPlan } from "../ipc/bindings/ForcePushPlan";
import type { ResetMode } from "../ipc/bindings/ResetMode";
import type { RevisionRange } from "../ipc/bindings/RevisionRange";
import type { StashEntry } from "../ipc/bindings/StashEntry";
import { hunkLineRange } from "./diffModel";

export type ConfirmCopy = {
  title: string;
  consequences: string[];
  names: string[];
  confirmLabel: string;
  neutral?: boolean;
  warning?: boolean;
  lead?: string;
  namesHeading?: string;
  also?: { heading: string; names: string[] };
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function discardFilesCopy(files: readonly FileChange[]): ConfirmCopy {
  const untracked = files.filter((file) => file.area === "untracked");
  const tracked = files.length - untracked.length;
  const consequences: string[] = [];
  if (tracked > 0) {
    consequences.push(
      tracked === 1
        ? "The file returns to its staged content, or to the last commit where nothing is staged. Undo can restore the unstaged edits from a snapshot taken before discarding, while the file is unchanged since; without a snapshot they are lost."
        : "The files return to their staged content, or to the last commit where nothing is staged. Undo can restore the unstaged edits from a snapshot taken before discarding, while the files are unchanged since; without a snapshot they are lost.",
    );
  }
  if (untracked.length > 0) {
    consequences.push(
      untracked.length === 1
        ? "This untracked file is removed from disk. It is in no commit, so Git cannot recover it. Undo can restore it from a snapshot taken before deleting; without a snapshot it is gone."
        : `${untracked.length} untracked files are removed from disk. They are in no commit, so Git cannot recover them. Undo can restore them from a snapshot taken before deleting; without a snapshot they are gone.`,
    );
  }
  const only = files[0];
  const title =
    files.length === 1 && only !== undefined
      ? `${only.area === "untracked" ? "Delete" : "Discard changes to"} ${only.path}?`
      : `Discard changes to ${plural(files.length, "file", "files")}?`;
  const confirmLabel =
    files.length === 1 && untracked.length === 1 ? "Delete file" : untracked.length === files.length ? "Delete files" : "Discard changes";
  return { title, consequences, names: files.map((file) => file.path), confirmLabel };
}

export function discardHunkCopy(file: string, hunk: DiffHunk): ConfirmCopy {
  return {
    title: "Discard this hunk?",
    consequences: [
      "Its lines return to their content in the index. Undo can restore the edit from a snapshot taken before discarding, while the file is unchanged since; without a snapshot it is lost.",
    ],
    names: [`${file} · ${hunkLineRange(hunk)}`],
    confirmLabel: "Discard hunk",
  };
}

export function detachCopy(label: string, dirty: boolean): ConfirmCopy {
  const consequences = [
    "HEAD will point at this commit instead of a branch. Commits you make here belong to no branch and can be lost when you switch away.",
    "Create a branch here first if you want to keep new work.",
  ];
  if (dirty) consequences.push("You have local changes, so you will be offered to stash them before the switch.");
  return { title: `Check out ${label} as a detached HEAD?`, consequences, names: [], confirmLabel: "Check out detached", neutral: true };
}

export function stashAndSwitchCopy(label: string): ConfirmCopy {
  return {
    title: `Stash your changes and switch to ${label}?`,
    consequences: [
      "Your local changes would be overwritten by this switch.",
      "They are stashed first, then restored on the new checkout. If restoring conflicts, the stash is kept and you are told.",
    ],
    names: [],
    confirmLabel: "Stash and switch",
    neutral: true,
  };
}

export function deleteBranchCopy(name: string, lost: readonly CommitBrief[]): ConfirmCopy {
  const count = lost.length;
  return {
    title: `Delete ${name}?`,
    consequences: [
      `${count === 1 ? "This commit is" : `These ${count} commits are`} on no other branch, remote branch, or tag, so deleting ${name} leaves ${count === 1 ? "it" : "them"} without a name. ${count === 1 ? "It" : "They"} can only be recovered through the reflog.`,
    ],
    names: lost.map((commit) => `${commit.sha.slice(0, 7)} ${commit.summary}`),
    confirmLabel: "Delete branch",
  };
}

export function dropStashCopy(stash: Pick<StashEntry, "index" | "message">): ConfirmCopy {
  return {
    title: `Drop stash@{${stash.index}}?`,
    consequences: ["The stash is removed from the list. Its changes are not applied anywhere and cannot be restored from YForge."],
    names: [stash.message],
    confirmLabel: "Drop stash",
  };
}

export function forcePushCopy(plan: ForcePushPlan): ConfirmCopy {
  const { lease, upstream, replaced } = plan;
  const shortLease = lease.expected_sha.slice(0, 7);
  return {
    title: "Force push with lease",
    warning: true,
    lead: `Your local ${lease.branch} has diverged from ${upstream}; its history no longer contains ${replaced.length === 1 ? "this remote commit" : "these remote commits"}.`,
    namesHeading: `${replaced.length === 1 ? "This remote commit" : "These remote commits"} will be replaced`,
    names: replaced.map((commit) => `${commit.sha.slice(0, 7)} ${commit.summary}`),
    consequences: [`Lease: ${upstream} must still be at ${shortLease}. If the remote moved since, git rejects the push and nothing is replaced.`],
    confirmLabel: "Force push with lease",
  };
}

export function undoForcePushCopy(scope: string): ConfirmCopy {
  return {
    title: "Undo the force push?",
    warning: true,
    lead: scope,
    names: [],
    consequences: [
      "The remote branch moves back to the commit it had before your force push; the commits your force push put there are removed from it for everyone who fetches from it.",
      "Your local branch is not changed.",
      "If the remote branch has moved since your force push, git refuses the push and nothing changes.",
    ],
    confirmLabel: "Force push back",
  };
}

const commitLine = (commit: { sha: string; summary: string }): string => `${commit.sha.slice(0, 7)} ${commit.summary}`;

export function rebaseCopy(current: string, onto: string, replayed: RevisionRange): ConfirmCopy {
  const count = replayed.count;
  return {
    title: `Rebase ${current} onto ${onto}?`,
    lead:
      count === 0
        ? `${current} has no commits of its own, so it simply moves forward to ${onto}.`
        : `${plural(count, "commit", "commits")} on ${current} ${count === 1 ? "is" : "are"} replayed on top of ${onto}.`,
    namesHeading: count === 0 ? undefined : `${count === 1 ? "This commit" : "These commits"} get new ids`,
    names: replayed.commits.map(commitLine),
    consequences: [
      "The original commits stay reachable through the reflog, but any copy already pushed now differs from your branch.",
      "If a commit conflicts, the rebase stops and you resolve it in the operation banner.",
    ],
    confirmLabel: "Rebase",
    neutral: true,
  };
}

const modeName: Record<ResetMode, string> = { soft: "Soft", mixed: "Mixed", hard: "Hard" };

export function uncommittedTracked(files: readonly FileChange[]): string[] {
  return [...new Set(files.filter((change) => change.area !== "untracked").map((change) => change.path))];
}

export function resetCopy(mode: ResetMode, current: string, target: string, leaving: RevisionRange, files: readonly FileChange[]): ConfirmCopy {
  const consequences: string[] = [];
  if (mode === "soft") consequences.push("The index and your files are untouched: changes from the commits that leave the branch stay staged.");
  else if (mode === "mixed") consequences.push("Your files are untouched: changes from the commits that leave the branch stay in the working tree, unstaged.");
  else consequences.push("The index and every tracked file match the target commit. Untracked files are kept.");
  if (leaving.count === 0) consequences.push(`No commits leave ${current}; only the index and files can change.`);
  else if (mode === "hard") consequences.push("Commits that leave the branch can only be recovered through the reflog.");
  const lost = uncommittedTracked(files);
  const copy: ConfirmCopy = {
    title: `${modeName[mode]} reset ${current} to ${target}?`,
    lead: `${current} moves to ${target}.`,
    namesHeading: leaving.count === 0 ? undefined : `${plural(leaving.count, "commit leaves", "commits leave")} ${current}`,
    names: leaving.commits.map(commitLine),
    consequences,
    confirmLabel: `${modeName[mode]} reset`,
    neutral: mode !== "hard",
    warning: mode === "hard",
  };
  if (mode !== "hard") return copy;
  if (lost.length === 0) consequences.push("There are no uncommitted changes to lose.");
  else copy.also = { heading: `${plural(lost.length, "uncommitted change", "uncommitted changes")} will be lost`, names: lost };
  return copy;
}

export function deleteTagCopy(name: string): ConfirmCopy {
  return {
    title: `Delete tag ${name}?`,
    consequences: ["The tag is removed from this repository. No commit changes. A copy on a remote stays there until you delete it from the remote too."],
    names: [],
    confirmLabel: "Delete tag",
  };
}

export function deleteRemoteTagCopy(name: string, remote: string): ConfirmCopy {
  return {
    title: `Delete ${name} from ${remote}?`,
    consequences: [
      `The tag is removed from ${remote} for everyone who fetches from it. Your local tag stays.`,
      "Other clones keep their copy until they prune it.",
    ],
    names: [],
    confirmLabel: `Delete from ${remote}`,
  };
}

export function removeRemoteCopy(name: string, url: string): ConfirmCopy {
  return {
    title: `Remove remote ${name}`,
    names: [`${name} → ${url}`],
    consequences: [
      "Its remote-tracking branches are deleted from this repository, and branches that track it lose their upstream.",
      "Nothing changes on the remote itself, and no local branch or commit is deleted.",
    ],
    confirmLabel: "Remove remote",
  };
}
