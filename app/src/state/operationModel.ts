import type { Operation } from "../ipc/bindings/Operation";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { ConfirmCopy } from "./confirmCopy";
import type { MenuPart } from "./refMenu";

export const operationTitle: Record<Operation, string> = {
  merge: "Merge in progress",
  rebase: "Rebase in progress",
  cherry_pick: "Cherry-pick in progress",
  revert: "Revert in progress",
};

const noun: Record<Operation, string> = { merge: "merge", rebase: "rebase", cherry_pick: "cherry-pick", revert: "revert" };

const currentName = (snapshot: RepoSnapshot): string =>
  snapshot.head.kind === "branch" ? snapshot.head.name : snapshot.head.kind === "unborn" ? snapshot.head.branch : "HEAD";

export function operationSummary(snapshot: RepoSnapshot): MenuPart[] {
  const operation = snapshot.operation;
  if (operation === null) return [];
  const incoming = snapshot.operation_detail?.incoming ?? null;
  const named: MenuPart[] = incoming === null ? [] : [{ ref: incoming }];
  switch (operation) {
    case "merge":
      return ["Merging ", ...(named.length > 0 ? named : ["changes"]), " into ", { ref: currentName(snapshot) }];
    case "rebase":
      return ["Rebasing ", ...(named.length > 0 ? named : ["the branch"])];
    case "cherry_pick":
      return ["Cherry-picking ", ...(named.length > 0 ? named : ["a commit"])];
    case "revert":
      return ["Reverting ", ...(named.length > 0 ? named : ["a commit"])];
  }
}

export function stepLabel(snapshot: RepoSnapshot): string | undefined {
  const step = snapshot.operation_detail?.step;
  return step == null ? undefined : `step ${step.current} of ${step.total}`;
}

export const conflictLabel = (count: number): string => `${count} ${count === 1 ? "conflict" : "conflicts"}`;

export type OperationButtons = {
  resolve: { disabledReason: string | undefined };
  continue: { label: string; disabledReason: string | undefined };
  skip: boolean;
  abortLabel: string;
};

export function operationButtons(operation: Operation, conflicts: number, busy: boolean): OperationButtons {
  const unresolved = conflicts > 0 ? `Resolve ${conflictLabel(conflicts)} first` : undefined;
  return {
    resolve: { disabledReason: conflicts === 0 ? "No conflicts to resolve" : undefined },
    continue: {
      label: operation === "merge" ? "Complete merge" : "Continue",
      disabledReason: busy ? "Working…" : unresolved,
    },
    skip: operation === "rebase",
    abortLabel: `Abort ${noun[operation]}`,
  };
}

export function abortCopy(snapshot: RepoSnapshot): ConfirmCopy | undefined {
  const operation = snapshot.operation;
  if (operation === null) return undefined;
  const incoming = snapshot.operation_detail?.incoming ?? null;
  const consequences: Record<Operation, string[]> = {
    merge: ["The merge is undone and every conflict resolution made so far is discarded.", "The branch and the files return to how they were before the merge started."],
    rebase: ["The rebase stops and the branch returns to where it was before the rebase started.", "Conflict resolutions made during this rebase are discarded."],
    cherry_pick: ["The cherry-pick is cancelled and the files return to how they were before it started.", "Conflict resolutions made so far are discarded."],
    revert: ["The revert is cancelled and the files return to how they were before it started.", "Conflict resolutions made so far are discarded."],
  };
  return {
    title: `Abort the ${noun[operation]}?`,
    consequences: consequences[operation],
    names: incoming === null ? [] : [incoming],
    confirmLabel: `Abort ${noun[operation]}`,
  };
}

export type ConflictSides = { current: { name: string; role: string }; incoming: { name: string; role: string } };

export function conflictSides(snapshot: RepoSnapshot): ConflictSides {
  const detail = snapshot.operation_detail;
  const current = detail?.current ?? currentName(snapshot);
  const incoming = detail?.incoming ?? null;
  switch (snapshot.operation) {
    case "merge":
      return { current: { name: current, role: "your branch" }, incoming: { name: incoming ?? "incoming changes", role: "incoming" } };
    case "rebase":
      return { current: { name: current, role: "rebase target" }, incoming: { name: incoming ?? "your branch", role: "your commit being replayed" } };
    case "cherry_pick":
      return { current: { name: current, role: "your branch" }, incoming: { name: incoming ?? "a commit", role: "commit being picked" } };
    case "revert":
      return { current: { name: current, role: "your branch" }, incoming: { name: incoming ?? "a commit", role: "commit being reverted" } };
    case null:
      return { current: { name: current, role: "your branch" }, incoming: { name: "stash", role: "stashed changes being applied" } };
  }
}

export const conflictDescription = (snapshot: RepoSnapshot): MenuPart[] =>
  snapshot.operation === null ? ["Applying stashed changes to ", { ref: currentName(snapshot) }] : operationSummary(snapshot);

export function firstConflict(snapshot: RepoSnapshot): string | undefined {
  return snapshot.files.find((file) => file.area === "conflicted")?.path;
}
