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

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe = () => undefined; unobserve = () => undefined; disconnect = () => undefined; });
  restoreLayout = stubLayout();
  calls = [];
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
const entry: StashEntry = { index: 1, sha: SHA, base_sha: "a".repeat(40), author_name: "Ada", message: "On main: half done", time: 1_700_000_000 };
const details = (files: StashDetails["files"]): StashDetails => ({ index: 1, sha: SHA, message: "On main: half done", base_sha: entry.base_sha, untracked_sha: files.some((file) => file.untracked) ? "7".repeat(40) : null, files });
const tracked = { path: "src/a.ts", original_path: null, status: "modified", additions: 3, deletions: 1, untracked: false } as const;
const untracked = { path: "notes.txt", original_path: null, status: "untracked", additions: 4, deletions: 0, untracked: true } as const;

function mount(files: StashDetails["files"], fail = false) {
  const actionCalls: unknown[][] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
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
