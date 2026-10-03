import { batch, createContext, createSignal, useContext } from "solid-js";
import type { ComposeGroup } from "../ipc/bindings/ComposeGroup";
import type { ExplanationItem } from "../ipc/bindings/ExplanationItem";
import { client } from "../ipc/client";
import { draftNotes } from "./aiGenerate";
import { createAiRun } from "./aiRun";
import { fileList } from "./fileList";
import type { RepoSession } from "./repoSession";

export type SheetKind = "explain_changes" | "explain_commit" | "compose_commits";

export type SheetTarget = { kind: SheetKind; sha?: string };

export type ComposeDraftGroup = { id: number; message: string; files: string[]; include: boolean };

export const AI_RUNNING_REASON = "An AI request is already running";

export const sourceNotes = (source: { excluded: readonly string[]; truncated: readonly string[] }): string[] =>
  draftNotes({ excluded: [...source.excluded], truncated: [...source.truncated], summary_trimmed: false });

export const sheetHeading = (target: SheetTarget): string =>
  target.kind === "explain_changes" ? "Explain changes" : target.kind === "explain_commit" ? `Explain commit ${(target.sha ?? "").slice(0, 7)}` : "Compose commits";

export const sheetRunning = (target: SheetTarget): string =>
  target.kind === "explain_changes" ? "Explaining the changes…" : target.kind === "explain_commit" ? "Explaining the commit…" : "Composing commits…";

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function composeReason(groups: readonly ComposeDraftGroup[], applying: boolean): string | undefined {
  if (applying) return "Creating commits…";
  const included = groups.filter((group) => group.include);
  if (included.length === 0) return "Include at least one commit";
  const blank = groups.findIndex((group) => group.include && group.message.trim() === "");
  return blank === -1 ? undefined : `Write a message for commit ${blank + 1}`;
}

export const composeLabel = (groups: readonly ComposeDraftGroup[]): string => `Create ${plural(groups.filter((group) => group.include).length, "commit")}`;

export function composeFoot(groups: readonly ComposeDraftGroup[]): string {
  const files = groups.filter((group) => group.include).reduce((total, group) => total + group.files.length, 0);
  const left = groups.filter((group) => !group.include).flatMap((group) => group.files);
  const kept = left.length === 0 ? "" : ` Unchecked groups stay uncommitted: ${fileList(left)}.`;
  return `${plural(files, "file")} will be committed.${kept}`;
}

export function createAiSheet(session: RepoSession) {
  const path = session.path;
  const [target, setTarget] = createSignal<SheetTarget | undefined>();
  const [items, setItems] = createSignal<ExplanationItem[] | undefined>();
  const [groups, setGroups] = createSignal<ComposeDraftGroup[] | undefined>();
  const [notes, setNotes] = createSignal<string[]>([]);
  const [applying, setApplying] = createSignal(false);
  const [commitSha, setCommitSha] = createSignal("");
  let generation = 0;

  const explainChanges = createAiRun(session.queryClient, (id) => client.aiExplainChanges(path, id));
  const explainCommit = createAiRun(session.queryClient, (id) => client.aiExplainCommit(path, id, commitSha()));
  const compose = createAiRun(session.queryClient, (id) => client.aiComposeCommits(path, id));
  const runs = [explainChanges, explainCommit, compose];
  const runFor = (kind: SheetKind) => (kind === "explain_changes" ? explainChanges : kind === "explain_commit" ? explainCommit : compose);

  const running = () => runs.some((run) => run.running());
  const failure = () => {
    const current = target();
    return current === undefined ? undefined : runFor(current.kind).failure();
  };

  function close(): void {
    generation += 1;
    for (const run of runs) if (run.running()) run.cancel();
    batch(() => {
      setTarget(undefined);
      setItems(undefined);
      setGroups(undefined);
      setNotes([]);
    });
  }

  async function open(next: SheetTarget): Promise<void> {
    if (running()) return;
    generation += 1;
    const mine = generation;
    batch(() => {
      setTarget(next);
      setItems(undefined);
      setGroups(undefined);
      setNotes([]);
      setCommitSha(next.sha ?? "");
    });
    if (next.kind === "compose_commits") {
      const proposal = await compose.start();
      if (mine !== generation) return;
      if (proposal === undefined) {
        if (compose.failure() === undefined) close();
        return;
      }
      batch(() => {
        setGroups(proposal.groups.map((group, id) => ({ id, message: group.message, files: [...group.files], include: true })));
        setNotes(sourceNotes(proposal));
      });
      return;
    }
    const run = next.kind === "explain_changes" ? explainChanges : explainCommit;
    const explanation = await run.start();
    if (mine !== generation) return;
    if (explanation === undefined) {
      if (run.failure() === undefined) close();
      return;
    }
    batch(() => {
      setItems(explanation.items);
      setNotes(sourceNotes(explanation));
    });
  }

  const setMessage = (id: number, message: string) =>
    setGroups((current) => current?.map((group) => (group.id === id ? { ...group, message } : group)));

  const setInclude = (id: number, include: boolean) =>
    setGroups((current) => current?.map((group) => (group.id === id ? { ...group, include } : group)));

  async function create(): Promise<void> {
    const current = groups();
    if (current === undefined || composeReason(current, applying()) !== undefined) return;
    const chosen: ComposeGroup[] = current.filter((group) => group.include).map((group) => ({ message: group.message, files: group.files }));
    setApplying(true);
    const done = await session.mutate(() => client.composeApply(path, chosen));
    setApplying(false);
    if (done) close();
  }

  return {
    target,
    items,
    groups,
    notes,
    applying,
    running,
    failure,
    explainChanges: () => open({ kind: "explain_changes" }),
    explainCommit: (sha: string) => open({ kind: "explain_commit", sha }),
    compose: () => open({ kind: "compose_commits" }),
    close,
    setMessage,
    setInclude,
    create,
  };
}

export type AiSheet = ReturnType<typeof createAiSheet>;

export const AiSheetContext = createContext<AiSheet>();

export const useAiSheet = (): AiSheet | undefined => useContext(AiSheetContext);
