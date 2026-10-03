import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { StashDetails } from "../ipc/bindings/StashDetails";
import type { StashEntry } from "../ipc/bindings/StashEntry";
import type { RepoActions } from "../state/repoActions";
import { StashInspector } from "./StashInspector";
import { buttonNamed, flush, mountWithApp, stubLayout, testSession } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;
let calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
let toolsStatus: unknown = { editor: "Visual Studio Code", diff: "FileMerge", merge: "FileMerge" };

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe = () => undefined; unobserve = () => undefined; disconnect = () => undefined; });
  restoreLayout = stubLayout();
  calls = [];
  toolsStatus = { editor: "Visual Studio Code", diff: "FileMerge", merge: "FileMerge" };
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  restoreLayout?.();
  vi.unstubAllGlobals();
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const SHA = "5".repeat(40);
const entry: StashEntry = { index: 1, sha: SHA, base_sha: "a".repeat(40), author_name: "Ada", author_email: "a@example.test", message: "On main: half done", time: 1_700_000_000 };
const details = (files: StashDetails["files"]): StashDetails => ({ index: 1, sha: SHA, message: "On main: half done", base_sha: entry.base_sha, untracked_sha: files.some((file) => file.untracked) ? "7".repeat(40) : null, files });
const tracked = { path: "src/a.ts", original_path: null, status: "modified", additions: 3, deletions: 1, untracked: false } as const;
const untracked = { path: "notes.txt", original_path: null, status: "untracked", additions: 4, deletions: 0, untracked: true } as const;

function mount(files: StashDetails["files"], fail = false) {
  const actionCalls: unknown[][] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "external_tools_status") return toolsStatus;
    if (cmd === "app_ui_prefs_load") return { palette_recents: [], last_parent_folder: null, file_list_mode: "path" };
    if (cmd === "stash_details") {
      if (fail) throw { kind: "invalid_request", message: "stash@{1} is not the stash it was", output: null };
      return details(files);
    }
    return null;
  });
  const actions = {
    restoreStash: (...args: unknown[]) => actionCalls.push(["restore", ...args]),
    openRenameStash: (...args: unknown[]) => actionCalls.push(["rename", ...args]),
    dropStash: (...args: unknown[]) => actionCalls.push(["drop", ...args]),
  } as unknown as RepoActions;
  const opened: unknown[] = [];
  const viewed: unknown[] = [];
  const mounted = mountWithApp(() => (
    <StashInspector session={testSession("/r", { root: "/r" } as RepoSnapshot)} stash={entry} actions={actions} activeTarget={undefined} onOpenDiff={(target) => opened.push(target)} onViewFile={(view) => viewed.push(view)} />
  ));
  dispose = mounted.dispose;
  return { ...mounted, actionCalls, opened, viewed };
}

describe("stash inspector", () => {
  it("titles the inspector with the stash reference and lists the files of the stash, untracked ones included", async () => {
    const { host } = mount([tracked, untracked]);
    await flush(60);

    expect(host.querySelector("h2")?.textContent).toBe("stash@{1}: half done");
    expect(calls.find((call) => call.cmd === "stash_details")?.args).toEqual({ path: "/r", index: 1, sha: SHA });
    const rows = [...host.querySelectorAll(".frow")].map((row) => row.textContent);
    expect(rows[0]).toContain("a.ts");
    expect(rows[0]).toContain("+3");
    expect(rows[1]).toContain("notes.txt");
    expect(host.textContent).toContain("Files · 2");
    expect(host.textContent).toContain("1 untracked");
  });

  it("opens the diff of a file from the stash", async () => {
    const { host, opened } = mount([tracked, untracked]);
    await flush(60);

    host.querySelectorAll<HTMLElement>(".frow")[1]?.click();

    expect(opened).toEqual([{ source: "stash", index: 1, sha: SHA, file: "notes.txt" }]);
  });

  it("applies, pops, renames, and drops the stash", async () => {
    const { host, actionCalls } = mount([tracked]);
    await flush(60);

    buttonNamed(host, "Apply")?.click();
    buttonNamed(host, "Pop")?.click();
    buttonNamed(host, "Rename…")?.click();
    buttonNamed(host, "Drop…")?.click();

    expect(actionCalls.map((call) => call[0])).toEqual(["restore", "restore", "rename", "drop"]);
    expect(actionCalls[0]?.slice(1)).toEqual(["apply", entry]);
    expect(actionCalls[1]?.slice(1)).toEqual(["pop", entry]);
    expect(buttonNamed(host, "Drop…")?.classList.contains("danger")).toBe(true);
  });

  it("says when the stash cannot be read and offers the actions that do not need it", async () => {
    const { host } = mount([], true);
    await flush(60);

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("is not the stash it was");
    expect(buttonNamed(host, "Drop…")).toBeDefined();
  });
});

describe("file view entry", () => {
  it("opens a tracked file at the stash and an untracked file at the stash's untracked commit", async () => {
    const { host, viewed } = mount([tracked, untracked]);
    await flush(80);

    host.querySelector<HTMLButtonElement>('button[aria-label="View src/a.ts"]')?.click();
    host.querySelector<HTMLButtonElement>('button[aria-label="View notes.txt"]')?.click();

    expect(viewed).toEqual([
      { file: "src/a.ts", rev: SHA, source: "stash@{1}" },
      { file: "notes.txt", rev: "7".repeat(40), source: "stash@{1} (untracked)" },
    ]);
  });
});

describe("stash files tree", () => {
  it("groups the stash files by folder when the tree view is chosen", async () => {
    const { host, opened } = mount([tracked, untracked]);
    await flush(60);

    host.querySelector<HTMLButtonElement>('section[aria-label="Files"] button[aria-label="Tree view"]')?.click();
    await flush();

    const items = [...host.querySelectorAll<HTMLElement>('section[aria-label="Files"] [role="tree"] [role="treeitem"]')];
    expect(items.map((row) => [row.querySelector(".file")?.textContent, row.getAttribute("aria-level"), row.getAttribute("aria-expanded")])).toEqual([
      ["src", "1", "true"],
      ["a.ts", "2", null],
      ["notes.txt", "1", null],
    ]);
    items[1]?.click();
    expect(opened).toEqual([{ source: "stash", index: 1, sha: SHA, file: "src/a.ts" }]);
  });

  it("offers Open in editor on every stash file row, and keeps it aria-disabled with its reason when no editor is chosen", async () => {
    const enabled = mount([tracked, untracked]);
    await flush(60);
    const button = enabled.host.querySelector<HTMLButtonElement>('button[aria-label="Open src/a.ts in editor"]');
    expect(button?.getAttribute("aria-disabled")).toBeNull();
    button?.click();
    await flush();
    expect(calls.find((call) => call.cmd === "open_in_editor")?.args).toEqual({ path: "/r", file: "src/a.ts" });
    expect(enabled.host.querySelector('button[aria-label="Open notes.txt in editor"]')).not.toBeNull();
    enabled.dispose();
    document.body.innerHTML = "";
    calls = [];

    toolsStatus = { editor: null, diff: null, merge: null };
    const disabled = mount([tracked]);
    await flush(60);
    const off = disabled.host.querySelector<HTMLButtonElement>('button[aria-label="Open src/a.ts in editor"]');
    expect(off?.getAttribute("aria-disabled")).toBe("true");
    expect(off?.dataset.tip).toBe("Open in editor. Choose an external editor in Settings → External tools");
    off?.click();
    await flush();
    expect(calls.some((call) => call.cmd === "open_in_editor")).toBe(false);
  });
});
