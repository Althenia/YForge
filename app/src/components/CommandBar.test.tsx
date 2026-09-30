import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { RepoActions } from "../state/repoActions";
import { CommandBar } from "./CommandBar";
import { flush, mountWithApp } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const snapshot = (head: RepoSnapshot["head"]): RepoSnapshot =>
  ({ root: "/work/repo", head, upstream: null, remotes: ["origin"], worktrees: [{ path: "/work/repo", current: true }] }) as unknown as RepoSnapshot;

function mount(head: RepoSnapshot["head"]) {
  const calls: unknown[][] = [];
  const actions = { sync: () => ({ kind: "idle" }), openBranchPicker: (...args: unknown[]) => calls.push(args) } as unknown as RepoActions;
  const mounted = mountWithApp(() => (
    <CommandBar snapshot={snapshot(head)} actions={actions} undo={{ kind: "unavailable", reason: "" }} onUndo={() => undefined} onPalette={() => undefined} onSearch={() => undefined} />
  ));
  dispose = mounted.dispose;
  return { ...mounted, calls };
}

describe("command bar breadcrumb", () => {
  it("opens the branch menu from the branch in the breadcrumb", () => {
    const { host, calls } = mount({ kind: "branch", name: "feature/x", sha: "a" });

    const crumb = host.querySelector<HTMLButtonElement>('button[aria-label="Branch menu: feature/x"]');
    crumb?.click();

    expect(crumb?.getAttribute("aria-haspopup")).toBe("menu");
    expect(calls).toHaveLength(1);
  });

  it("has no branch menu before the first commit", () => {
    const { host } = mount({ kind: "unborn", branch: "main" });

    expect(host.querySelector<HTMLButtonElement>('button[aria-label="Branch menu: main"]')?.disabled).toBe(true);
  });
});
