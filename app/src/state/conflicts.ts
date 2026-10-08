import { isCancelledError, keepPreviousData } from "@tanstack/solid-query";
import { createEffect, createMemo, on } from "solid-js";
import type { MergePrediction } from "../ipc/bindings/MergePrediction";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { client, IpcError } from "../ipc/client";
import type { PullLookup } from "./platformModel";
import { useQuery } from "./query";
import { repoKeys } from "./queryKeys";
import type { RepoSession } from "./repoSession";

export type ConflictCheck = { ours: string; theirs: string; target: string; marks: readonly string[] };

export type Conflict = ConflictCheck & { files: readonly string[]; base: string };

export function conflictChecks(snapshot: RepoSnapshot, lookup: PullLookup | undefined): ConflictCheck[] {
  const checks: ConflictCheck[] = [];
  const counts = snapshot.upstream?.ahead_behind;
  if (snapshot.head.kind === "branch" && snapshot.upstream != null && counts != null && counts.ahead > 0 && counts.behind > 0) {
    checks.push({ ours: snapshot.head.name, theirs: snapshot.upstream.name, target: snapshot.upstream.name, marks: [snapshot.head.name] });
  }
  if (lookup === undefined) return checks;
  for (const [source, pull] of lookup.byBranch) {
    const target = `${lookup.remote}/${pull.target_ref}`;
    const head = `${lookup.remote}/${source}`;
    if (!snapshot.remote_branches.includes(target) || !snapshot.remote_branches.includes(head)) continue;
    checks.push({ ours: target, theirs: head, target, marks: snapshot.branches.includes(source) ? [source, head] : [head] });
  }
  return checks;
}

export const conflictLabel = (conflict: Pick<Conflict, "target" | "files">): string =>
  `Conflicts with ${conflict.target} · ${conflict.files.length} ${conflict.files.length === 1 ? "file" : "files"}`;

let sequence = 0;

const aborted = (signal: AbortSignal) => signal.reason ?? new DOMException("The conflict prediction was superseded", "AbortError");

export async function predictMerge(path: string, ours: string, theirs: string, signal: AbortSignal, report: (failure: unknown) => void): Promise<MergePrediction> {
  if (signal.aborted) throw aborted(signal);
  const id = `predict-${Date.now()}-${(sequence += 1)}`;
  const cancel = () => void client.operationCancel(id).catch(report);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const prediction = await client.mergePrediction(path, id, ours, theirs);
    if (signal.aborted) throw aborted(signal);
    return prediction;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

export const isUnsupported = (failure: unknown): failure is IpcError => failure instanceof IpcError && failure.kind === "unsupported";

export async function runPredictions(path: string, checks: readonly ConflictCheck[], signal: AbortSignal, report: (failure: unknown) => void): Promise<Conflict[]> {
  const found: Conflict[] = [];
  for (const check of checks) {
    try {
      const prediction = await predictMerge(path, check.ours, check.theirs, signal, report);
      if (prediction.conflicted_files.length > 0) found.push({ ...check, files: prediction.conflicted_files, base: prediction.merge_base });
    } catch (failure) {
      if (isUnsupported(failure)) return [];
      throw failure;
    }
  }
  return found;
}

export function createConflictPredictions(session: RepoSession, lookup: () => PullLookup | undefined) {
  const checks = createMemo(() => conflictChecks(session.snapshot(), lookup()), [], { equals: (left, right) => JSON.stringify(left) === JSON.stringify(right) });
  const predictions = useQuery(
    () => ({
      queryKey: [...repoKeys.all(session.path), "conflicts", checks()],
      queryFn: ({ signal }: { signal: AbortSignal }) => runPredictions(session.path, checks(), signal, session.report),
      enabled: checks().length > 0,
      staleTime: Infinity,
      placeholderData: keepPreviousData,
    }),
    () => session.queryClient,
  );
  createEffect(
    on(
      () => predictions.error,
      (failure) => {
        if (failure != null && !isCancelledError(failure)) session.report(failure);
      },
      { defer: true },
    ),
  );
  const conflicts = (): readonly Conflict[] => (checks().length === 0 ? [] : (predictions.data ?? []));
  const conflictOf = (ref: string): Conflict | undefined => conflicts().find((conflict) => conflict.marks.includes(ref));
  const current = (): Conflict | undefined => {
    const head = session.snapshot().head;
    return head.kind === "branch" ? conflictOf(head.name) : undefined;
  };
  return { conflictOf, current };
}

export type ConflictPredictions = ReturnType<typeof createConflictPredictions>;
