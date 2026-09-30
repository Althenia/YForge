import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RepoActions } from "../state/repoActions";
import type { Selection } from "../state/selection";
import { Sidebar } from "./Sidebar";
import { flush, mountWithApp, testUiPrefs } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const counts = { modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, conflicted: 0 };

const snapshot = {
  root: "/r",
  head: { kind: "branch", name: "main", sha: "a" },
  upstream: { name: "origin/main", ahead_behind: { ahead: 0, behind: 0 } },
  counts,
  branches: ["feature/a", "feature/b/deep", "main"],
  remote_branches: ["origin/feature/a", "origin/main"],
  remotes: ["origin"],
  tags: ["v1"],
  stashes: [{ index: 0, sha: "s0", base_sha: null, author_name: "Yui", message: "On main: wip", time: 0 }],
  worktrees: [],
} as unknown as RepoSnapshot;

function mount(selection: Selection | undefined = undefined) {
  const calls: Array<[string, ...unknown[]]> = [];
  const actions = {
    openRefMenu: (...args: unknown[]) => calls.push(["ref-menu", ...args]),
    openStashMenu: (...args: unknown[]) => calls.push(["stash-menu", ...args]),
    checkoutRef: (...args: unknown[]) => calls.push(["checkout", ...args]),
  } as unknown as RepoActions;
  const selected = vi.fn();
  const uiPrefs = testUiPrefs();
  const mounted = mountWithApp(() => <Sidebar snapshot={snapshot} actions={actions} uiPrefs={uiPrefs} selection={selection} onSelectStash={selected} />);
  dispose = mounted.dispose;
  return { ...mounted, calls, selected };
}

const names = (host: ParentNode) => [...host.querySelectorAll('[data-nav]')].map((row) => row.getAttribute("aria-label"));
const folder = (host: ParentNode, label: string) => host.querySelector<HTMLElement>(`[aria-label^="${label}"]`) as HTMLElement;

describe("sidebar branch tree", () => {
  it("groups slash-separated branch names into folders with their branch counts", () => {
    const { host } = mount();

    expect(names(host.querySelector('section[aria-label="Branches"]') as HTMLElement)).toEqual([
      "Folder feature, 2 branches, expanded",
      "Branch feature/a",
      "Folder feature/b, 1 branch, expanded",
      "Branch feature/b/deep",
      "Branch main, checked out",
    ]);
    expect(host.querySelector('[aria-label="Branch feature/b/deep"] .name')?.textContent).toBe("deep");
  });

  it("collapses and expands a folder with a click, Enter, and the arrow keys, and reports the state", async () => {
    const { host } = mount();

    folder(host, "Folder feature,").click();
    await flush();
    expect(names(host)).not.toContain("Branch feature/a");
    expect(folder(host, "Folder feature,").getAttribute("aria-expanded")).toBe("false");

    folder(host, "Folder feature,").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flush();
    expect(names(host)).toContain("Branch feature/a");
    folder(host, "Folder feature,").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await flush();
    expect(names(host)).not.toContain("Branch feature/a");
    folder(host, "Folder feature,").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();
    expect(names(host)).toContain("Branch feature/a");
  });

  it("keeps each remote's folders separate from the local ones", async () => {
    const { host } = mount();

    expect(names(host)).toContain("Remote branch origin/feature/a");
    folder(host, "Remote origin,").click();
    await flush();
    expect(names(host)).not.toContain("Remote branch origin/feature/a");
    expect(names(host)).toContain("Branch feature/a");
  });

  it("opens the branch menu from the keyboard and checks a branch out on Enter", () => {
    const { host, calls } = mount();
    const row = host.querySelector<HTMLElement>('[aria-label="Branch feature/a"]') as HTMLElement;

    row.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(calls.map((call) => call[0])).toEqual(["ref-menu", "checkout"]);
  });
});

describe("sidebar stashes", () => {
  it("inspects a stash on click and marks the inspected one", async () => {
    const { host, selected } = mount({ kind: "stash", sha: "s0" });
    const row = host.querySelector<HTMLElement>('[aria-label^="Stash 0"]') as HTMLElement;

    row.click();

    expect(selected).toHaveBeenCalledWith("s0");
    expect(row.getAttribute("aria-current")).toBe("true");
  });
});
