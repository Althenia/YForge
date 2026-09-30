import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { createComposer } from "../state/composer";
import { createRepoActions } from "../state/repoActions";
import { ChangesInspector } from "./ChangesInspector";
import { flush, mountWithApp, stubLayout, testSession, type } from "./testkit";

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

const snapshot = (overrides: Partial<RepoSnapshot> = {}): RepoSnapshot =>
  ({
    root: "/r",
    head: { kind: "branch", name: "main", sha: "a".repeat(40) },
    upstream: { name: "origin/main", ahead_behind: { ahead: 0, behind: 0 } },
    counts: { modified: 0, added: 1, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 },
    files: [{ path: "a.txt", original_path: null, area: "staged", status: "added" }],
    operation: null,
    operation_detail: null,
    last_fetch: null,
    worktrees: [],
    branches: ["main"],
    remote_branches: ["origin/main"],
    remotes: ["origin"],
    tags: [],
    stashes: [],
    ...overrides,
  }) as RepoSnapshot;

function mount(current: RepoSnapshot, respond: (cmd: string) => unknown = () => null) {
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "commit") return "c0ffee";
    if (cmd === "repo_open") return current;
    return respond(cmd);
  });
  const committed: string[] = [];
  const mounted = mountWithApp(() => {
    const session = testSession("/r", current);
    const composer = createComposer();
    const actions = createRoot(() => createRepoActions(session, { selectedSha: () => undefined, onSelectionGone: () => undefined, pullMode: () => "fast_forward_or_merge", undoEntry: () => undefined }));
    return (
      <ChangesInspector
        session={session}
        actions={actions}
        composer={composer}
        activeTarget={undefined}
        onOpenDiff={() => undefined}
        onCommitted={(sha) => committed.push(sha)}
      />
    );
  });
  dispose = mounted.dispose;
  return { ...mounted, committed };
}

const summaryOf = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[aria-label="Summary"]');
const commands = () => calls.map((call) => call.cmd).filter((cmd) => cmd !== "repo_open");
const chord = (host: HTMLElement, init: KeyboardEventInit) =>
  summaryOf(host)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }));

describe("commit and push", () => {
  it("offers Commit and Commit & Push from the split button, with the shortcut on the second", async () => {
    const { host } = mount(snapshot());
    await flush();
    type(summaryOf(host), "Ship it");
    await flush();

    host.querySelector<HTMLElement>('button[aria-label="More commit actions"]')?.click();
    await flush();

    const items = [...host.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => [item.querySelector(".label-text")?.textContent, item.querySelector(".note-k")?.textContent])).toEqual([
      ["Commit", "⌘↵"],
      ["Commit & Push", "⌘⇧↵"],
    ]);
  });

  it("commits and pushes the current branch to its upstream", async () => {
    const { host, committed } = mount(snapshot());
    await flush();
    type(summaryOf(host), "Ship it");
    await flush();

    host.querySelector<HTMLElement>('button[aria-label="More commit actions"]')?.click();
    await flush();
    [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]?.click();
    await flush(80);

    expect(commands()).toEqual(["commit", "push"]);
    expect(committed).toEqual(["c0ffee"]);
  });

  it("creates the upstream through publish when the branch has none", async () => {
    const { host } = mount(snapshot({ upstream: null }));
    await flush();
    type(summaryOf(host), "Ship it");
    await flush();

    chord(host, { metaKey: true, shiftKey: true });
    await flush(80);

    expect(commands()).toEqual(["commit", "publish"]);
    expect(calls.find((call) => call.cmd === "publish")?.args).toMatchObject({ path: "/r", remote: "origin" });
  });

  it("keeps the commit and shows the push error when the push is rejected", async () => {
    const { host, committed } = mount(snapshot(), (cmd) => {
      if (cmd === "push") throw { kind: "git_failed", message: "remote hung up", output: null };
      return null;
    });
    await flush();
    type(summaryOf(host), "Ship it");
    await flush();

    chord(host, { metaKey: true, shiftKey: true });
    await flush(80);

    expect(commands()).toEqual(["commit", "push"]);
    expect(committed).toEqual(["c0ffee"]);
    expect(summaryOf(host)?.value).toBe("");
  });

  it("only commits for ⌘↵", async () => {
    const { host } = mount(snapshot());
    await flush();
    type(summaryOf(host), "Local");
    await flush();

    chord(host, { metaKey: true });
    await flush(80);

    expect(commands()).toEqual(["commit"]);
  });

  it("disables Commit & Push with the reason when the repository has no remote", async () => {
    const { host } = mount(snapshot({ remotes: [], upstream: null }));
    await flush();
    type(summaryOf(host), "Ship it");
    await flush();

    host.querySelector<HTMLElement>('button[aria-label="More commit actions"]')?.click();
    await flush();
    const push = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')][1];
    expect(push?.getAttribute("aria-disabled")).toBe("true");
    expect(push?.textContent).toContain("This repository has no remotes");
    push?.click();
    chord(host, { metaKey: true, shiftKey: true });
    await flush(80);

    expect(commands()).toEqual([]);
  });
});
