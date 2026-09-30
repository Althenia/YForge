import type { WorktreeIntegration } from "../ipc/bindings/WorktreeIntegration";
import type { WorktreeStatus } from "../ipc/bindings/WorktreeStatus";
import type { ConfirmCopy } from "./confirmCopy";

export type CreateMode = "new" | "existing";

export type IntegrationTarget = { branch: string; path: string };

export type StartPoint = { value: string; label: string };

export function laneLabel(worktree: WorktreeStatus): string {
  return worktree.branch ?? (worktree.bare ? "bare" : "detached");
}

export function flagsOf(worktree: WorktreeStatus): string[] {
  return [worktree.current ? "current" : "", worktree.dirty ? "changes" : "", worktree.locked ? "locked" : "", worktree.prunable ? "missing" : ""].filter((flag) => flag !== "");
}

export function removeBlock(worktree: WorktreeStatus, all: readonly WorktreeStatus[]): string | undefined {
  if (worktree.current) return "This worktree is open here. Switch to another worktree to remove it";
  if (all[0]?.path === worktree.path) return "The main worktree cannot be removed";
  if (worktree.locked) return `${worktree.path} is locked. Unlock it first`;
  return undefined;
}

export function removeCopy(worktree: WorktreeStatus, force: boolean): ConfirmCopy {
  const branch = worktree.branch === null ? [] : [`${worktree.branch} stays as a branch.`];
  if (!force) {
    return {
      title: `Remove the worktree at ${worktree.path}?`,
      consequences: ["The folder is deleted from disk.", ...branch],
      names: [worktree.path],
      confirmLabel: "Remove worktree",
    };
  }
  return {
    title: `Remove the worktree at ${worktree.path} and discard its changes?`,
    consequences: [
      "It has uncommitted changes and untracked files that are deleted with the folder.",
      "A safety snapshot of them is saved first; restore it from Recovery while it is kept (30 days).",
      ...branch,
    ],
    names: [worktree.path],
    confirmLabel: "Remove and discard changes",
    warning: true,
  };
}

export function integrationTargets(source: WorktreeStatus, all: readonly WorktreeStatus[]): IntegrationTarget[] {
  return all
    .filter((other) => other.path !== source.path && other.branch !== null && other.branch !== source.branch && !other.prunable && !other.bare)
    .map((other) => ({ branch: other.branch as string, path: other.path }));
}

export function defaultIntegrationTarget(targets: readonly IntegrationTarget[]): string {
  return (targets.find((target) => target.branch === "main" || target.branch === "master") ?? targets[0])?.branch ?? "";
}

export function integrateBlock(worktree: WorktreeStatus, all: readonly WorktreeStatus[]): string | undefined {
  if (worktree.prunable) return "This worktree is missing from disk";
  if (worktree.branch === null) return "Check out a branch in this worktree first";
  if (worktree.dirty) return "Commit or stash the changes in this worktree first";
  if (integrationTargets(worktree, all).length === 0) return "No other worktree has a branch checked out to integrate into";
  return undefined;
}

export function integrateCopy(worktree: WorktreeStatus, target: string, cleanup: boolean): ConfirmCopy {
  const branch = worktree.branch ?? "";
  return {
    title: `Integrate ${branch} into ${target}?`,
    consequences: [
      `Rebase ${branch} onto ${target} in ${worktree.path}, fast-forward ${target} to it, so the history stays linear.`,
      cleanup ? `Remove the worktree at ${worktree.path} and delete the branch ${branch}.` : `The worktree and ${branch} are kept.`,
    ],
    names: [],
    confirmLabel: "Integrate",
    neutral: true,
  };
}

export function integrationNotice(outcome: WorktreeIntegration, branch: string, target: string): string {
  if (outcome.kind === "conflicts") return `The rebase of ${branch} onto ${target} stopped on conflicts. Resolve them in ${outcome.worktree}, then continue.`;
  return `Integrated ${branch} into ${target} at ${outcome.target_sha.slice(0, 7)}${outcome.cleaned_up ? " and removed the worktree" : ""}.`;
}

export function newBranchProblem(name: string, branches: readonly string[]): string | undefined {
  if (name === "") return "Enter a branch name";
  return branches.includes(name) ? `A branch named ${name} already exists` : undefined;
}

export function existingBranchChoices(branches: readonly string[], all: ReadonlyArray<{ branch: string | null }>): string[] {
  const held = new Set(all.flatMap((worktree) => (worktree.branch === null ? [] : [worktree.branch])));
  return branches.filter((branch) => !held.has(branch));
}

export function startPointChoices(branches: readonly string[], remoteBranches: readonly string[]): StartPoint[] {
  return [
    { value: "", label: "Current HEAD" },
    ...branches.map((name) => ({ value: `refs/heads/${name}`, label: name })),
    ...remoteBranches.map((name) => ({ value: `refs/remotes/${name}`, label: name })),
  ];
}

export function destinationProblem(destination: string): string | undefined {
  if (destination.trim() === "") return "Enter the folder for the worktree";
  return destination.startsWith("/") ? undefined : "Use a full path, starting with /";
}

export function createBlock(mode: CreateMode, branch: string, destination: string, branches: readonly string[]): string | undefined {
  if (mode === "existing" && branch === "") return "Choose a branch";
  const name = mode === "new" ? newBranchProblem(branch, branches) : undefined;
  return name ?? destinationProblem(destination);
}
