import type { ChangeCounts } from "../ipc/bindings/ChangeCounts";
import type { RebasePlan } from "../ipc/bindings/RebasePlan";
import type { RebaseResult } from "../ipc/bindings/RebaseResult";
import type { RebaseStep } from "../ipc/bindings/RebaseStep";
import type { RebaseTodo } from "../ipc/bindings/RebaseTodo";

export type RebaseAction = "pick" | "reword" | "squash" | "fixup" | "drop" | "edit";

export const REBASE_ACTIONS: ReadonlyArray<{ id: RebaseAction; label: string; note: string }> = [
  { id: "pick", label: "Pick", note: "keep the commit as it is" },
  { id: "reword", label: "Reword", note: "change the message" },
  { id: "squash", label: "Squash", note: "combine with the commit below and edit the message" },
  { id: "fixup", label: "Fixup", note: "combine with the commit below and keep its message" },
  { id: "drop", label: "Drop", note: "remove the commit" },
  { id: "edit", label: "Edit", note: "stop here so you can amend the commit" },
];

export type RebaseRow = RebaseTodo & { action: RebaseAction; message: string | undefined };

export type MessageOf = (row: RebaseRow) => string;

export const rowsOf = (plan: RebasePlan): RebaseRow[] => [...plan.commits].reverse().map((commit) => ({ ...commit, action: "pick", message: undefined }));

const replace = (rows: readonly RebaseRow[], sha: string, change: Partial<Pick<RebaseRow, "action" | "message">>): RebaseRow[] =>
  rows.map((row) => (row.sha === sha ? { ...row, ...change } : row));

export const setAction = (rows: readonly RebaseRow[], sha: string, action: RebaseAction): RebaseRow[] => replace(rows, sha, { action });

export const setMessage = (rows: readonly RebaseRow[], sha: string, message: string): RebaseRow[] => replace(rows, sha, { message });

export function moveRowTo(rows: readonly RebaseRow[], sha: string, to: number): RebaseRow[] {
  const from = rows.findIndex((row) => row.sha === sha);
  const moved = rows[from];
  if (moved === undefined) return [...rows];
  const rest = rows.filter((row) => row.sha !== sha);
  const target = Math.min(Math.max(to, 0), rest.length);
  return [...rest.slice(0, target), moved, ...rest.slice(target)];
}

export function moveRow(rows: readonly RebaseRow[], sha: string, delta: -1 | 1): RebaseRow[] {
  const from = rows.findIndex((row) => row.sha === sha);
  const to = from + delta;
  return from < 0 || to < 0 || to >= rows.length ? [...rows] : moveRowTo(rows, sha, to);
}

type Group = { leader: RebaseRow; members: RebaseRow[]; message: string; messageRow: RebaseRow | undefined };

const joined = (messages: readonly string[]): string => messages.join("\n\n");

function groupsOf(rows: readonly RebaseRow[], messageOf: MessageOf): Group[] {
  const groups: Group[] = [];
  for (const row of [...rows].reverse()) {
    if (row.action === "drop") continue;
    const current = groups.at(-1);
    if ((row.action === "squash" || row.action === "fixup") && current !== undefined) current.members.push(row);
    else groups.push({ leader: row, members: [], message: "", messageRow: undefined });
  }
  for (const group of groups) {
    const leaderMessage = group.leader.action === "reword" ? (group.leader.message ?? messageOf(group.leader)) : messageOf(group.leader);
    const squashes = group.members.filter((member) => member.action === "squash");
    const last = squashes.at(-1);
    group.messageRow = last ?? (group.leader.action === "reword" ? group.leader : undefined);
    group.message = last === undefined ? leaderMessage : (last.message ?? joined([leaderMessage, ...squashes.map(messageOf)]));
  }
  return groups;
}

export function stepsOf(rows: readonly RebaseRow[], messageOf: MessageOf): RebaseStep[] {
  const groupByRow = new Map<string, Group>();
  for (const group of groupsOf(rows, messageOf)) for (const row of [group.leader, ...group.members]) groupByRow.set(row.sha, group);
  return [...rows].reverse().map((row): RebaseStep => {
    const group = groupByRow.get(row.sha);
    switch (row.action) {
      case "reword":
        return { kind: "reword", sha: row.sha, message: row.message ?? messageOf(row) };
      case "squash":
        return { kind: "squash", sha: row.sha, message: group?.message ?? messageOf(row) };
      case "pick":
      case "fixup":
      case "drop":
      case "edit":
        return { kind: row.action, sha: row.sha };
    }
  });
}

export type Validation = { problems: string[]; rowProblems: Record<string, string>; changed: boolean; dropsAll: boolean; canApply: boolean };

const messageProblem = (message: string): string | undefined => (message.trim() === "" ? "Enter a message" : message.includes("\0") ? "The message cannot contain a NUL character" : undefined);

export function validate(rows: readonly RebaseRow[], plan: RebasePlan, messageOf: MessageOf): Validation {
  const problems: string[] = [];
  const rowProblems: Record<string, string> = {};
  if (plan.commits.some((commit) => commit.is_merge)) problems.push("This range contains a merge commit. Interactive rebase does not support merge commits.");
  const oldestKept = [...rows].reverse().find((row) => row.action !== "drop");
  if (oldestKept !== undefined && (oldestKept.action === "squash" || oldestKept.action === "fixup")) {
    rowProblems[oldestKept.sha] = "Nothing below to combine with. Move it above another kept commit, or pick it.";
  }
  for (const group of groupsOf(rows, messageOf)) {
    const problem = messageProblem(group.message);
    if (problem !== undefined && group.messageRow !== undefined) rowProblems[group.messageRow.sha] = problem;
  }
  const original = plan.commits.map((commit) => commit.sha).reverse();
  const changed = rows.some((row, index) => row.action !== "pick" || row.sha !== original[index]);
  const dropsAll = rows.length > 0 && rows.every((row) => row.action === "drop");
  return { problems, rowProblems, changed, dropsAll, canApply: problems.length === 0 && Object.keys(rowProblems).length === 0 && changed };
}

export type PreviewCommit = { subject: string; from: string[]; kind: "kept" | "reworded" | "combined"; stops: boolean };

export type Preview = { commits: PreviewCommit[]; dropped: RebaseRow[] };

const subjectOf = (message: string): string => message.split("\n")[0]?.trim() ?? "";

export function previewOf(rows: readonly RebaseRow[], messageOf: MessageOf): Preview {
  const commits = groupsOf(rows, messageOf)
    .map((group): PreviewCommit => ({
      subject: subjectOf(group.message),
      from: [group.leader.sha, ...group.members.map((member) => member.sha)],
      kind: group.members.length > 0 ? "combined" : group.leader.action === "reword" ? "reworded" : "kept",
      stops: [group.leader, ...group.members].some((row) => row.action === "edit"),
    }))
    .reverse();
  return { commits, dropped: rows.filter((row) => row.action === "drop") };
}

export function pushedRewriteWarning(rows: readonly RebaseRow[], upstream: string | undefined): string | undefined {
  const count = rows.filter((row) => row.pushed).length;
  if (count === 0) return undefined;
  const single = count === 1;
  return `${count} of these commits ${single ? "is" : "are"} already on ${upstream ?? "its upstream"}. Rewriting ${single ? "it" : "them"} means the next push needs a force push.`;
}

export function outcomeNotice(result: RebaseResult, verb: string): string | undefined {
  if (result.outcome === "conflicts") return `${verb} stopped on conflicts. Resolve them, then continue, or abort.`;
  if (result.outcome === "stopped_to_edit") return `${verb} stopped to edit a commit. Amend it or change files, then Continue.`;
  if (result.dropped_all) return "Every commit was dropped. The branch is back at the base.";
  if (result.pushed) return "Commits that are already on the upstream were rewritten. The next push needs a force push.";
  return undefined;
}

export type ChainCommit = { sha: string; parents: readonly string[] };

export function squashOrder(commits: readonly ChainCommit[]): string[] | undefined {
  const chosen = new Set(commits.map((commit) => commit.sha));
  const oldest = commits.filter((commit) => commit.parents[0] === undefined || !chosen.has(commit.parents[0]));
  const single = oldest.length === 1 ? oldest[0] : undefined;
  if (single === undefined) return undefined;
  const childOf = new Map<string, string>();
  for (const commit of commits) {
    const parent = commit.parents[0];
    if (parent === undefined || !chosen.has(parent)) continue;
    if (childOf.has(parent)) return undefined;
    childOf.set(parent, commit.sha);
  }
  const order = [single.sha];
  for (let next = childOf.get(single.sha); next !== undefined; next = childOf.get(next)) order.push(next);
  return order.length === commits.length ? order : undefined;
}

export function squashProblem(commits: readonly ChainCommit[]): string | undefined {
  if (commits.length < 2) return "Select at least two commits";
  if (commits.some((commit) => commit.parents.length > 1)) return "A merge commit cannot be squashed";
  const order = squashOrder(commits);
  if (order === undefined) return "The selected commits are not one contiguous run of the current branch";
  if (commits.find((commit) => commit.sha === order[0])?.parents.length === 0) return "The oldest selected commit has no parent, so there is nothing to rebase onto";
  return undefined;
}

export const squashMessage = (messagesOldestFirst: readonly string[]): string => joined(messagesOldestFirst);

export const dirtyReason = (counts: ChangeCounts): string | undefined =>
  counts.modified + counts.added + counts.deleted + counts.renamed + counts.conflicted > 0
    ? "Commit, stash, or discard your changes first. Git will not rewrite history over changes to tracked files."
    : undefined;

export function editableMessages(rows: readonly RebaseRow[], messageOf: MessageOf): Record<string, string> {
  const messages: Record<string, string> = {};
  for (const group of groupsOf(rows, messageOf)) if (group.messageRow !== undefined) messages[group.messageRow.sha] = group.message;
  return messages;
}
