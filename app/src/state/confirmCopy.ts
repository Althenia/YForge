import type { DiffHunk } from "../ipc/bindings/DiffHunk";
import type { FileChange } from "../ipc/bindings/FileChange";
import type { Operation } from "../ipc/bindings/Operation";
import type { ForcePushPlan } from "../ipc/bindings/ForcePushPlan";
import type { ResetMode } from "../ipc/bindings/ResetMode";
import type { RevisionRange } from "../ipc/bindings/RevisionRange";
import type { StashEntry } from "../ipc/bindings/StashEntry";
import { hunkLineRange } from "./diffModel";

export type ConfirmCopy = {
  title: string;
  consequences: string[];
  names: string[];
  total?: number;
  confirmLabel: string;
  neutral?: boolean;
  warning?: boolean;
  lead?: string;
  namesHeading?: string;
  also?: { heading: string; names: string[]; total?: number };
};

const formatCount = (count: number) => count.toLocaleString("en-US");

const plural = (count: number, one: string, many: string) => `${formatCount(count)} ${count === 1 ? one : many}`;

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

export function discardLinesCopy(file: string, hunk: DiffHunk, count: number): ConfirmCopy {
  return {
    title: `Discard ${count} selected ${count === 1 ? "line" : "lines"}?`,
    consequences: [
      "The selected lines return to their content in the index. Undo can restore the edit from a snapshot taken before discarding, while the file is unchanged since; without a snapshot it is lost.",
    ],
    names: [`${file} · ${hunkLineRange(hunk)}`],
    confirmLabel: "Discard lines",
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

export function stashAndSwitchCopy(label: string, from: string | undefined): ConfirmCopy {
  return {
    title: `Stash your changes and switch to ${label}?`,
    consequences: [
      "Your local changes would be overwritten by this switch.",
      from === undefined
        ? "They are stashed first and kept in the stash list."
        : `They are stashed first, kept in the stash list, and offered back when you return to ${from}.`,
    ],
    names: [],
    confirmLabel: "Stash and switch",
    neutral: true,
  };
}

export function deleteBranchCopy(name: string, lost: RevisionRange): ConfirmCopy {
  const count = lost.count;
  return {
    title: `Delete ${name}?`,
    consequences: [
      `${count === 1 ? "This commit is" : `These ${formatCount(count)} commits are`} on no other branch, remote branch, or tag, so deleting ${name} leaves ${count === 1 ? "it" : "them"} without a name. ${count === 1 ? "It" : "They"} can only be recovered through the reflog.`,
    ],
    names: lost.commits.map(commitLine),
    total: count,
    confirmLabel: "Delete branch",
  };
}

export function deleteBranchesCopy(names: readonly string[], lost: ReadonlyArray<{ branch: string; range: RevisionRange }>): ConfirmCopy {
  const commits = lost.flatMap((entry) => entry.range.commits.map((commit) => `${entry.branch}: ${commitLine(commit)}`));
  const total = lost.reduce((sum, entry) => sum + entry.range.count, 0);
  const copy: ConfirmCopy = {
    title: `Delete ${names.length} branches?`,
    consequences: ["The branches are deleted from this repository. Remote branches stay."],
    names: [...names],
    confirmLabel: "Delete branches",
  };
  if (total === 0) return copy;
  return {
    ...copy,
    consequences: [
      ...copy.consequences,
      `${total === 1 ? "One commit is" : `${formatCount(total)} commits are`} on no other branch, remote branch, or tag, so deleting ${total === 1 ? "it leaves it" : "them leaves them"} without a name. ${total === 1 ? "It" : "They"} can only be recovered through the reflog.`,
    ],
    also: { heading: "Commits left without a name", names: commits, total },
    warning: true,
  };
}

export function deleteRemoteBranchCopy(remote: string, name: string): ConfirmCopy {
  return {
    title: `Delete ${remote}/${name} from ${remote}?`,
    consequences: [
      `The branch is removed from ${remote} for everyone who fetches from it. A local branch of the same name stays.`,
      "Undo pushes the branch back to the commit this repository last saw for it, unless the name has been used again or that commit is unknown.",
    ],
    names: [],
    confirmLabel: `Delete from ${remote}`,
  };
}

export function deleteBranchAndRemoteCopy(name: string, remote: string, lost: RevisionRange): ConfirmCopy {
  return {
    title: `Delete ${name} and ${remote}/${name}?`,
    consequences: [
      `The local branch is deleted first, then the branch is removed from ${remote} for everyone who fetches from it.`,
      "Each deletion is its own operation, so Undo restores them one at a time.",
    ],
    namesHeading: lost.count === 0 ? undefined : `${lost.count === 1 ? "This commit is" : "These commits are"} only on the local branch`,
    names: lost.commits.map(commitLine),
    total: lost.count,
    confirmLabel: "Delete both",
  };
}

export function pullStashKeptCopy(reason: "pull_conflicts" | "restore_conflicts" | "restore_failed"): string {
  switch (reason) {
    case "pull_conflicts":
      return "The pull stopped on conflicts. Your changes come back when you complete or abort it.";
    case "restore_conflicts":
      return "Restoring them conflicted with the pulled changes.";
    case "restore_failed":
      return "Git could not restore them.";
  }
}

export function dropStashCopy(stash: Pick<StashEntry, "index" | "message">): ConfirmCopy {
  return {
    title: `Drop stash@{${stash.index}}?`,
    consequences: ["The stash is removed from the list and its changes are not applied anywhere. A snapshot of it is saved first; bring it back from Recovery, Lost commits or Safety snapshots."],
    names: [stash.message],
    confirmLabel: "Drop stash",
  };
}

export function dropStashesCopy(stashes: ReadonlyArray<Pick<StashEntry, "index" | "message">>): ConfirmCopy {
  return {
    title: `Drop ${stashes.length} stashes?`,
    consequences: ["The stashes are removed from the list and their changes are not applied anywhere. A snapshot of each is saved first; bring them back from Recovery, Lost commits or Safety snapshots."],
    names: stashes.map((stash) => `stash@{${stash.index}} ${stash.message}`),
    confirmLabel: "Drop stashes",
  };
}

export function forcePushCopy(plan: ForcePushPlan): ConfirmCopy {
  const { lease, upstream, replaced } = plan;
  const shortLease = lease.expected_sha.slice(0, 7);
  return {
    title: "Force push with lease",
    warning: true,
    lead: `Your local ${lease.branch} has diverged from ${upstream}; its history no longer contains ${replaced.count === 1 ? "this remote commit" : "these remote commits"}.`,
    namesHeading: `${replaced.count === 1 ? "This remote commit" : "These remote commits"} will be replaced`,
    names: replaced.commits.map(commitLine),
    total: replaced.count,
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
    total: count,
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
  else if (mode === "hard") consequences.push("Commits that leave the branch can be brought back from Recovery, Reflog.");
  const lost = uncommittedTracked(files);
  if (mode === "hard" && lost.length > 0) consequences.push("A snapshot of your uncommitted changes is saved first; restore it from Recovery, Safety snapshots.");
  const copy: ConfirmCopy = {
    title: `${modeName[mode]} reset ${current} to ${target}?`,
    lead: `${current} moves to ${target}.`,
    namesHeading: leaving.count === 0 ? undefined : `${plural(leaving.count, "commit leaves", "commits leave")} ${current}`,
    names: leaving.commits.map(commitLine),
    total: leaving.count,
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

export function deleteTagsCopy(names: readonly string[]): ConfirmCopy {
  return {
    title: `Delete ${names.length} tags?`,
    consequences: ["The tags are removed from this repository. No commit changes. Copies on a remote stay there until you delete them from the remote too."],
    names: [...names],
    confirmLabel: "Delete tags",
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

export function clearUsageCopy(): ConfirmCopy {
  return {
    title: "Delete all usage data?",
    consequences: ["Every stored usage event is deleted from this Mac. This cannot be undone. Recording continues while the switch is on."],
    names: [],
    confirmLabel: "Delete usage data",
  };
}

export function clearCrashesCopy(): ConfirmCopy {
  return {
    title: "Clear crash reports?",
    consequences: ["Every stored crash report is deleted from this Mac. This cannot be undone. Export them first to keep a copy."],
    names: [],
    confirmLabel: "Clear crash reports",
  };
}

export function clearHistoryCopy(repository: string): ConfirmCopy {
  return {
    title: `Clear activity history for ${repository}?`,
    consequences: [
      "The stored history of this repository is deleted, and so is this session's list of its operations, so Undo no longer reaches them.",
      "Nothing changes in the repository itself.",
    ],
    names: [],
    confirmLabel: "Clear history",
  };
}

export function removeProviderCopy(name: string, hasKey: boolean, usedBy: readonly string[]): ConfirmCopy {
  const consequences = [hasKey ? "Its API key is deleted from the macOS Keychain." : "Nothing else on this Mac changes."];
  if (usedBy.length > 0) consequences.push(`It is set up for ${usedBy.join(" and ")}, so ${usedBy.length === 1 ? "that feature loses its setup and turns" : "those features lose their setup and turn"} off.`);
  return { title: "Remove this AI provider?", names: [name], consequences, confirmLabel: "Remove provider" };
}

export function removeConnectionCopy(name: string, host: string): ConfirmCopy {
  return {
    title: "Remove this platform connection?",
    names: [`${name} · ${host}`],
    consequences: ["Its access token is deleted from the macOS Keychain. Pull requests on the platform are not changed, and repositories on this host lose their Pull requests section until you connect again."],
    confirmLabel: "Remove connection",
  };
}

export function removeJiraConnectionCopy(host: string, displayName: string): ConfirmCopy {
  return {
    title: "Remove this Jira connection?",
    names: [`${host} · ${displayName}`],
    consequences: ["Its token is deleted from the macOS Keychain. Issues in Jira are not changed; issue keys from this site show the key only and its issues leave the sidebar until you connect again."],
    confirmLabel: "Remove connection",
  };
}

export function removeGitHostCopy(host: string): ConfirmCopy {
  return {
    title: "Remove this host identity?",
    names: [host],
    consequences: ["Remotes on this host use the app-wide key, or your SSH agent and ~/.ssh/config, again. The key files stay in ~/.ssh, saved key passphrases stay in the Keychain, and passwords or tokens stay in Git's credential helper."],
    confirmLabel: "Remove host",
  };
}

export function closeGroupCopy(name: string, tabs: readonly string[]): ConfirmCopy {
  return {
    title: `Close the ${name} group?`,
    namesHeading: `Closes ${plural(tabs.length, "tab", "tabs")}:`,
    names: [...tabs],
    consequences: ["Uncommitted changes stay on disk; the repositories stay in Recent."],
    confirmLabel: `Close ${plural(tabs.length, "tab", "tabs")}`,
  };
}

const OPERATION_NOUNS: Record<Operation, string> = {
  merge: "merge",
  rebase: "rebase",
  cherry_pick: "cherry-pick",
  revert: "revert",
  cherry_pick_sequence: "cherry-pick sequence",
  revert_sequence: "revert sequence",
  bisect: "bisect",
};

export function closeTabsCopy(count: number, busy: ReadonlyArray<{ name: string; operation: Operation }>): ConfirmCopy {
  const confirmLabel = `Close ${plural(count, "tab", "tabs")}`;
  const only = busy.length === 1 ? busy[0] : undefined;
  if (only !== undefined) {
    const noun = OPERATION_NOUNS[only.operation];
    return {
      title: `${confirmLabel}?`,
      lead: `${only.name} is in the middle of a ${noun}.`,
      names: [],
      consequences: [`Closing its tab does not stop or undo the ${noun}; it stays in the repository until you continue or abort it there.`],
      confirmLabel,
    };
  }
  return {
    title: `${confirmLabel}?`,
    namesHeading: "In progress:",
    names: busy.map((entry) => `${entry.name} · ${OPERATION_NOUNS[entry.operation]}`),
    consequences: ["Closing a tab does not stop or undo its operation; it stays in the repository until you continue or abort it there."],
    confirmLabel,
  };
}
