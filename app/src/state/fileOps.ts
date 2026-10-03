import { createSignal } from "solid-js";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { client } from "../ipc/client";
import type { ConfirmCopy } from "./confirmCopy";
import type { FileViewTarget } from "./fileView";
import type { RepoSession } from "./repoSession";

export type FilePurpose = "delete" | "view" | "edit";

export type FileDialog = { kind: "create" } | { kind: "pick"; purpose: FilePurpose; files: string[] };

export type EditingFile = { file: string; text: string; eol: string; size: number };

export type FileOpsDeps = {
  confirm: (copy: ConfirmCopy, run: () => void | Promise<void>) => void;
  fail: (failure: unknown) => void;
  showFile?: (target: FileViewTarget) => void;
};

const plural = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

const baseName = (path: string): string => path.split("/").filter((part) => part !== "").at(-1) ?? path;

export const changedFileCount = (files: RepoSnapshot["files"]): number => new Set(files.map((file) => file.path)).size;

export function deleteFileCopy(file: string): ConfirmCopy {
  return {
    title: `Delete ${file}?`,
    names: [file],
    confirmLabel: "Delete file",
    consequences: [
      "The file is removed from disk. A tracked file shows as a deleted change; an untracked file is in no commit, so Git cannot recover it. Undo restores its content from a snapshot taken before deleting, while the file has not been recreated.",
    ],
  };
}

export function discardAllCopy(count: number): ConfirmCopy {
  return {
    title: `Discard all ${plural(count, "changed file", "changed files")}?`,
    names: [],
    confirmLabel: "Discard all changes",
    consequences: [
      "The index and the working tree return to the last commit, and untracked files are removed from disk. Ignored files are kept. Undo restores the staged and working tree content of the changed and untracked files from a snapshot taken before discarding, while they are unchanged since.",
    ],
  };
}

export const discardAllReason = (snapshot: RepoSnapshot): string | undefined => {
  if (snapshot.operation !== null) return `Finish or abort the ${snapshot.operation.replace(/_/g, "-")} in progress first`;
  return changedFileCount(snapshot.files) === 0 ? "There are no changes to discard" : undefined;
};

export function createFileOps(session: RepoSession, deps: FileOpsDeps) {
  const path = session.path;
  const [dialog, setDialog] = createSignal<FileDialog | undefined>();
  const [editing, setEditing] = createSignal<EditingFile | undefined>();

  const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

  async function pick(purpose: FilePurpose): Promise<void> {
    try {
      setDialog({ kind: "pick", purpose, files: await client.worktreeFiles(path) });
    } catch (failure) {
      deps.fail(failure);
    }
  }

  async function submitCreate(name: string): Promise<string | undefined> {
    try {
      await client.fileCreate(path, name.trim());
    } catch (failure) {
      return message(failure);
    }
    setDialog(undefined);
    await session.refresh();
    return undefined;
  }

  function deleteFile(file?: string): void {
    if (file === undefined) {
      void pick("delete");
      return;
    }
    deps.confirm(deleteFileCopy(file), async () => {
      await session.mutate(() => client.fileDelete(path, file));
      if (editing()?.file === file) setEditing(undefined);
    });
  }

  function viewFile(file?: string): void {
    if (file === undefined) {
      void pick("view");
      return;
    }
    deps.showFile?.({ file, rev: ":worktree", source: "Working tree" });
  }

  async function editFile(file?: string): Promise<void> {
    if (file === undefined) {
      await pick("edit");
      return;
    }
    try {
      const content = await client.fileEditable(path, file);
      setEditing({ file, ...content });
    } catch (failure) {
      session.report(failure);
    }
  }

  function choose(purpose: FilePurpose, file: string): void {
    setDialog(undefined);
    if (purpose === "delete") deleteFile(file);
    else if (purpose === "view") viewFile(file);
    else void editFile(file);
  }

  const save = (file: string, text: string, eol: string): Promise<boolean> => session.mutate(() => client.fileSave(path, file, text, eol));

  function discardAll(): void {
    if (discardAllReason(session.snapshot()) !== undefined) return;
    deps.confirm(discardAllCopy(changedFileCount(session.snapshot().files)), () => void session.mutate(() => client.discardAll(path)));
  }

  async function createPatch(files?: string[]): Promise<void> {
    try {
      const destination = await client.pickSavePath("Create patch", "changes.patch");
      if (destination === undefined) return;
      await client.patchCreate(path, files ?? null, destination);
      session.inform(`Created ${baseName(destination)}`);
    } catch (failure) {
      deps.fail(failure);
    }
  }

  async function applyPatch(): Promise<void> {
    let patch: string | undefined;
    try {
      patch = await client.pickFile("Apply patch");
    } catch (failure) {
      deps.fail(failure);
      return;
    }
    if (patch === undefined) return;
    const chosen = patch;
    if (await session.mutate(() => client.patchApply(path, chosen))) session.inform(`Applied ${baseName(chosen)}`);
  }

  return {
    dialog,
    closeDialog: () => setDialog(undefined),
    editing,
    closeEditor: () => setEditing(undefined),
    createFile: () => setDialog({ kind: "create" }),
    submitCreate,
    deleteFile,
    viewFile,
    editFile,
    choose,
    save,
    discardAll,
    discardAllReason: () => discardAllReason(session.snapshot()),
    createPatch,
    applyPatch,
  };
}

export type FileOps = ReturnType<typeof createFileOps>;
