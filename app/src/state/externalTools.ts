import { createResource } from "solid-js";
import type { DiffToolSource } from "../ipc/bindings/DiffToolSource";
import { client } from "../ipc/client";
import type { DiffTarget } from "./diffModel";

export const EDITOR_REASON = "Choose an external editor in Settings → External tools";
export const DIFF_TOOL_REASON = "Choose an external diff tool in Settings → External tools";
export const MERGE_TOOL_REASON = "Choose an external merge tool in Settings → External tools";

export const COMPARISON_TOOL_REASON = "An external diff tool opens one commit or your changes, not a comparison";

export function diffToolSource(target: Exclude<DiffTarget, { source: "range" }>): DiffToolSource {
  if (target.source === "working") return target.area === "staged" ? { kind: "staged" } : { kind: "unstaged" };
  return { kind: "commit", sha: target.sha };
}

export function createExternalTools(session: { path: string; report: (failure: unknown) => void; refresh: () => Promise<unknown> }) {
  const [status] = createResource(() => client.externalToolsStatus(session.path).catch(() => undefined));
  const reasonOf = (tool: "editor" | "diff" | "merge", reason: string) => (status()?.[tool] === null ? reason : undefined);

  const run = (action: () => Promise<unknown>) => action().catch(session.report);

  return {
    editorReason: () => reasonOf("editor", EDITOR_REASON),
    diffReason: () => reasonOf("diff", DIFF_TOOL_REASON),
    mergeReason: () => reasonOf("merge", MERGE_TOOL_REASON),
    openEditor: (file: string) => run(() => client.openInEditor(session.path, file)),
    openDiff: (file: string, source: DiffToolSource) => run(() => client.openInDiffTool(session.path, file, source)),
    openMerge: async (file: string, onExit?: () => void) => {
      try {
        await client.openInMergeTool(session.path, file);
      } catch (failure) {
        session.report(failure);
      } finally {
        onExit?.();
        await session.refresh();
      }
    },
  };
}

export type ExternalTools = ReturnType<typeof createExternalTools>;
