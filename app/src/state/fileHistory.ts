import { createMemo, createSignal } from "solid-js";
import type { BlameRun } from "../ipc/bindings/BlameRun";
import type { FileRevision } from "../ipc/bindings/FileRevision";
import { client } from "../ipc/client";
import type { FileHistoryRequest } from "./fileHistoryRequest";
import { useQuery } from "./query";
import { repoKeys } from "./queryKeys";
import type { RepoSession } from "./repoSession";

export type HistoryView = "file" | "diff" | "blame";

export const historyViews: ReadonlyArray<{ view: HistoryView; label: string }> = [
  { view: "file", label: "File" },
  { view: "diff", label: "Diff" },
  { view: "blame", label: "Blame" },
];

export type BlameRow = { text: string; run: number; first: boolean };

export const REVERT_WHITESPACE_REASON = "Turn off Ignore whitespace to revert a hunk";

export const revertReason = (ignoreWhitespace: boolean): string | undefined => (ignoreWhitespace ? REVERT_WHITESPACE_REASON : undefined);

export const revertedNotice = (file: string, short: string): string => `Reverted a hunk of ${file} from ${short}. The change is in Unstaged; nothing is committed.`;

export function pickRevision(revisions: readonly FileRevision[], sha: string | undefined): FileRevision | undefined {
  return (sha === undefined ? undefined : revisions.find((revision) => revision.sha.startsWith(sha))) ?? revisions[0];
}

const stepKeys: Record<string, (index: number, last: number) => number> = {
  ArrowDown: (index, last) => Math.min(index + 1, last),
  ArrowUp: (index) => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_, last) => last,
};

export function stepRevision(revisions: readonly FileRevision[], current: string | undefined, key: string): string | undefined {
  const step = stepKeys[key];
  if (step === undefined || revisions.length === 0) return undefined;
  const index = Math.max(revisions.findIndex((revision) => revision.sha === current), 0);
  return revisions[step(index, revisions.length - 1)]?.sha;
}

export function blameRows(runs: readonly BlameRun[]): BlameRow[] {
  return runs.flatMap((run, index) => run.lines.map((text, at) => ({ text, run: index, first: at === 0 })));
}

export function createFileHistory(session: RepoSession, request: FileHistoryRequest) {
  const path = session.path;
  const history = useQuery(() => ({
    queryKey: repoKeys.read(path, "file-history", request.file),
    queryFn: () => client.fileHistory(path, request.file),
  }));
  const revisions = (): FileRevision[] => (history.error == null ? (history.data ?? []) : []);
  const [chosen, setChosen] = createSignal<string | undefined>(request.sha);
  const [view, setView] = createSignal<HistoryView>(request.view ?? "diff");
  const selected = createMemo(() => pickRevision(revisions(), chosen()));

  return {
    history,
    revisions,
    selected,
    select: (sha: string) => setChosen(sha),
    step: (key: string): boolean => {
      const next = stepRevision(revisions(), selected()?.sha, key);
      if (next === undefined) return false;
      setChosen(next);
      return true;
    },
    view,
    setView,
  };
}

export type FileHistoryState = ReturnType<typeof createFileHistory>;
