import { createSignal } from "solid-js";
import type { HookEntry } from "../ipc/bindings/HookEntry";
import type { HookMode } from "../ipc/bindings/HookMode";
import type { HookOutcome } from "../ipc/bindings/HookOutcome";
import type { HookStream } from "../ipc/bindings/HookStream";
import { client } from "../ipc/client";
import type { ConfirmCopy } from "./confirmCopy";

export type HookSheetMode = "view" | HookMode;

export type OutputLine = { stream: HookStream; text: string };

export type RunPhase = { kind: "idle" } | { kind: "running" } | { kind: "done"; outcome: HookOutcome } | { kind: "failed"; message: string };

export const hookStateWord = (hook: Pick<HookEntry, "active">): string => (hook.active ? "Active" : "Inactive");

export const hookRowLabel = (hook: HookEntry): string => `Hook ${hook.name}, ${hookStateWord(hook)}${hook.reason === null ? "" : `, ${hook.reason}`}`;

export const hooksDirectoryLabel = (directory: string, root: string): string => (directory.startsWith(`${root}/`) ? directory.slice(root.length + 1) : directory);

export const commitMessageOf = (summary: string, description: string): string => {
  const head = summary.trim();
  const body = description.trim();
  return body === "" ? head : `${head}\n\n${body}`;
};

export const runVerb = (mode: HookMode): string => (mode === "run" ? "Run" : "Test");

export const hookConfirmCopy = (hook: HookEntry, mode: HookMode): ConfirmCopy => ({
  title: `${runVerb(mode)} ${hook.name}?`,
  lead: "This script has not been approved in this repository yet, or it changed since you approved it.",
  namesHeading: "Script",
  names: [hook.path],
  consequences: [
    mode === "run"
      ? "It runs in this worktree with your permissions and can change files."
      : "It runs with your permissions in a temporary worktree that carries your staged and unstaged changes, which is removed afterwards.",
  ],
  confirmLabel: runVerb(mode),
  neutral: true,
});

export const outcomeText = (outcome: HookOutcome): string => {
  if (outcome.end === "timed_out") return "Stopped after 120 seconds.";
  if (outcome.end === "stopped") return "Stopped.";
  const code = outcome.exit_code === null ? "Ended by a signal." : `Exit code ${outcome.exit_code}.`;
  return `${code} ${outcome.stops_git ? "Git would stop the action." : "Git would not stop the action."}`;
};

export const TEST_NOTE = "Ran in a temporary worktree; nothing in the repository changed.";

export function createHookRunner(path: string) {
  const [lines, setLines] = createSignal<OutputLine[]>([]);
  const [phase, setPhase] = createSignal<RunPhase>({ kind: "idle" });
  let current: string | undefined;

  async function start(name: string, mode: HookMode, message: string): Promise<void> {
    const id = `hook-${name}-${Date.now()}`;
    current = id;
    setLines([]);
    setPhase({ kind: "running" });
    const unlisten = await client.onHookOutput((output) => {
      if (output.id === id) setLines((all) => [...all, { stream: output.stream, text: output.text }]);
    });
    try {
      setPhase({ kind: "done", outcome: await client.hookRun(path, id, name, mode, message) });
    } catch (failure) {
      setPhase({ kind: "failed", message: failure instanceof Error ? failure.message : "The hook could not run" });
    } finally {
      unlisten();
      current = undefined;
    }
  }

  const stop = (): void => {
    if (current !== undefined) void client.operationCancel(current);
  };

  return { lines, phase, start, stop };
}

export type HookRunner = ReturnType<typeof createHookRunner>;
