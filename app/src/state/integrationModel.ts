import type { IntegrationPreview } from "../ipc/bindings/IntegrationPreview";
import type { MergeMode } from "../ipc/bindings/MergeMode";

export type MergeChoice = { mode: MergeMode; label: string; detail: string; disabledReason: string | undefined };

export type MergeChoices = { choices: MergeChoice[]; initial: MergeMode; outcome: (mode: MergeMode) => string };

const commits = (count: number): string => `${count} ${count === 1 ? "commit" : "commits"}`;

export function mergeChoices(current: string, source: string, preview: IntegrationPreview): MergeChoices {
  const incoming = preview.incoming.count;
  const own = preview.outgoing.count;
  const fastForward: MergeChoice = {
    mode: "fast_forward",
    label: "Fast-forward",
    detail: `Moves ${current} forward by ${commits(incoming)}. No new commit.`,
    disabledReason: preview.fast_forward ? undefined : `${current} has ${commits(own)} that ${source} does not`,
  };
  const mergeCommit: MergeChoice = {
    mode: "merge_commit",
    label: "Merge commit",
    detail: `Adds a merge commit that joins ${commits(incoming)} from ${source}.`,
    disabledReason: undefined,
  };
  return {
    choices: [fastForward, mergeCommit],
    initial: preview.fast_forward ? "fast_forward" : "merge_commit",
    outcome: (mode) =>
      mode === "fast_forward"
        ? `Result: ${current} points at the tip of ${source}.`
        : `Result: a new commit on ${current} with ${current} and ${source} as parents.`,
  };
}
