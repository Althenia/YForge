import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitDetails } from "../ipc/bindings/CommitDetails";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { CommitInspector } from "./CommitInspector";
import { buttonNamed, flush, mountWithApp, stubLayout, testSession, type } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;
let calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = () => undefined;
      unobserve = () => undefined;
      disconnect = () => undefined;
    },
  );
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

const HEAD = "a".repeat(40);
const OLDER = "b".repeat(40);
const person = { name: "Ada", email: "ada@example.test", time: 1_700_000_000 };

const details = (sha: string): CommitDetails => ({ sha, summary: "Tune retries", body: "Because.", author: person, committer: person, parents: [OLDER], refs: [], files: [] });

const snapshot = { root: "/r", head: { kind: "branch", name: "main", sha: HEAD }, upstream: { name: "origin/main", ahead_behind: { ahead: 0, behind: 0 } }, operation: null } as unknown as RepoSnapshot;

function mount(sha: string, options: { pushed?: boolean; operation?: boolean } = {}) {
  const selected: string[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "commit_details") return details(sha);
    if (cmd === "amend_info") return { sha: HEAD, summary: "Tune retries", description: "Because.", pushed: options.pushed ?? false };
    if (cmd === "edit_head_message") return { sha: "c".repeat(40), pushed: options.pushed ?? false };
    return null;
  });
  const current = options.operation === true ? ({ ...snapshot, operation: "rebase" } as unknown as RepoSnapshot) : snapshot;
  const mounted = mountWithApp(() => (
    <CommitInspector session={testSession("/r", current)} sha={sha} activeTarget={undefined} onSelectCommit={(next) => selected.push(next)} onOpenDiff={() => undefined} />
  ));
  dispose = mounted.dispose;
  return { ...mounted, selected };
}

const editButton = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="Edit message"]');
const field = (host: HTMLElement, label: string) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);

describe("edit the HEAD message", () => {
  it("is offered only for the HEAD commit", async () => {
    const head = mount(HEAD);
    await flush(60);
    expect(editButton(head.host)).not.toBeNull();
    head.dispose();
    document.body.innerHTML = "";

    const older = mount(OLDER);
    await flush(60);
    expect(editButton(older.host)).toBeNull();
  });

  it("is disabled with the reason while an operation is in progress", async () => {
    const { host } = mount(HEAD, { operation: true });
    await flush(60);

    expect(editButton(host)?.getAttribute("aria-disabled")).toBe("true");
    expect(editButton(host)?.getAttribute("data-tip")).toBe("Finish the operation in progress first");
    editButton(host)?.click();
    await flush();
    expect(field(host, "Summary")).toBeNull();
  });

  it("opens a form prefilled with the current message and saves the edited one", async () => {
    const { host, selected } = mount(HEAD);
    await flush(60);

    editButton(host)?.click();
    await flush(60);
    expect(field(host, "Summary")?.value).toBe("Tune retries");
    expect(field(host, "Description")?.value).toBe("Because.");
    type(field(host, "Summary") as HTMLInputElement, "Tune retry limits");
    await flush();
    buttonNamed(host, "Save message")?.click();
    await flush(80);

    expect(calls.filter((call) => call.cmd === "edit_head_message")).toEqual([
      { cmd: "edit_head_message", args: { path: "/r", sha: HEAD, summary: "Tune retry limits", description: "Because." } },
    ]);
    expect(selected).toEqual(["c".repeat(40)]);
    expect(field(host, "Summary")).toBeNull();
  });

  it("warns that the commit is already on its upstream", async () => {
    const { host } = mount(HEAD, { pushed: true });
    await flush(60);

    editButton(host)?.click();
    await flush(60);

    expect(host.querySelector(".note.attention")?.textContent).toContain("origin/main");
  });

  it("keeps Save disabled without a summary and closes on Cancel without saving", async () => {
    const { host } = mount(HEAD);
    await flush(60);
    editButton(host)?.click();
    await flush(60);

    type(field(host, "Summary") as HTMLInputElement, "  ");
    await flush();
    expect(buttonNamed(host, "Save message")?.disabled).toBe(true);
    expect(host.textContent).toContain("Enter a summary");
    buttonNamed(host, "Cancel")?.click();
    await flush();

    expect(field(host, "Summary")).toBeNull();
    expect(calls.some((call) => call.cmd === "edit_head_message")).toBe(false);
  });
});
