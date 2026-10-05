import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { LfsStatus } from "../ipc/bindings/LfsStatus";
import { LfsSettings } from "./LfsSettings";
import { buttonNamed, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

async function open(initial: LfsStatus, refuse?: { cmd: string; message: string }) {
  const state = { ...initial, patterns: [...initial.patterns] };
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    if (refuse?.cmd === cmd) throw { kind: "invalid_request", message: refuse.message, output: null };
    if (cmd === "lfs_status") return structuredClone(state);
    if (cmd === "lfs_initialize") {
      state.initialized = true;
      return null;
    }
    if (cmd === "lfs_track") {
      state.patterns.push(call.args.pattern as string);
      return null;
    }
    if (cmd === "lfs_untrack") {
      state.patterns = state.patterns.filter((pattern) => pattern !== call.args.pattern);
      return null;
    }
    if (cmd === "activity_list" || cmd === "recents_list" || cmd === "repo_aliases_list") return [];
    return null;
  });
  const mounted = mountWithApp(() => <LfsSettings path="/repo" />);
  dispose = mounted.dispose;
  await flush(40);
  return { ...mounted, calls };
}

const installed: LfsStatus = { installed: true, version: "3.5.1", initialized: false, patterns: ["*.psd"] };
const lfsCalls = (calls: Call[]) => calls.filter((call) => call.cmd !== "lfs_status" && call.cmd.startsWith("lfs_")).map((call) => [call.cmd, call.args]);

describe("Git LFS settings (S58)", () => {
  it("announces a running LFS action and prevents a second operation until it settles", async () => {
    let finish: (() => void) | undefined;
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      if (cmd === "lfs_status") return structuredClone(installed);
      if (cmd === "lfs_initialize") return new Promise<void>((resolve) => { finish = resolve; });
      return null;
    });
    const mounted = mountWithApp(() => <LfsSettings path="/repo" />);
    dispose = mounted.dispose;
    await flush(40);
    buttonNamed(mounted.host, "Initialize LFS")?.click();
    await flush();

    expect(mounted.host.querySelector('[role="status"][aria-busy="true"]')?.textContent).toContain("Initializing LFS");
    expect(mounted.host.querySelector('button[aria-busy="true"]')).not.toBeNull();
    buttonNamed(mounted.host, "Initializing LFS…")?.click();
    expect(calls.filter((cmd) => cmd === "lfs_initialize")).toHaveLength(1);
    finish?.();
    await flush(40);
    expect(mounted.host.querySelector('button[aria-busy="true"]')).toBeNull();
  });
  it("says Git LFS is not installed and offers no LFS action", async () => {
    const { host } = await open({ installed: false, version: null, initialized: false, patterns: [] });

    expect(host.textContent).toContain("Git LFS is not installed");
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });

  it("shows the installed version, that the repository is not initialized, and the tracked patterns", async () => {
    const { host } = await open(installed);

    expect(host.textContent).toContain("Git LFS 3.5.1");
    expect(buttonNamed(host, "Initialize LFS")).toBeDefined();
    expect([...host.querySelectorAll('[aria-label="Tracked patterns"] li')].map((row) => row.textContent?.replace(/\s+/g, " ").trim())).toEqual(["*.psdUntrack"]);
    expect(host.textContent).toContain("left unstaged for you to commit");
  });

  it("initializes LFS for this repository only and then reports it as initialized", async () => {
    const { host, calls } = await open(installed);

    buttonNamed(host, "Initialize LFS")?.click();
    await flush(40);

    expect(lfsCalls(calls)).toEqual([["lfs_initialize", { path: "/repo" }]]);
    expect(buttonNamed(host, "Initialize LFS")).toBeUndefined();
    expect(host.textContent).toContain("Initialized for this repository");
  });

  it("tracks a pattern from the form and lists it", async () => {
    const { host, calls } = await open(installed);

    buttonNamed(host, "Track pattern…")?.click();
    await flush();
    type(host.querySelector<HTMLInputElement>('input[aria-label="Pattern to track"]'), "assets/**");
    buttonNamed(host, "Track")?.click();
    await flush(40);

    expect(lfsCalls(calls)).toEqual([["lfs_track", { path: "/repo", pattern: "assets/**" }]]);
    expect([...host.querySelectorAll('[aria-label="Tracked patterns"] li')].map((row) => row.querySelector("bdi")?.textContent)).toEqual(["*.psd", "assets/**"]);
    expect(host.querySelector('input[aria-label="Pattern to track"]')).toBeNull();
  });

  it("untracks a pattern", async () => {
    const { host, calls } = await open(installed);

    host.querySelector<HTMLButtonElement>('button[aria-label="Untrack *.psd"]')?.click();
    await flush(40);

    expect(lfsCalls(calls)).toEqual([["lfs_untrack", { path: "/repo", pattern: "*.psd" }]]);
    expect(host.textContent).toContain("No pattern is tracked by Git LFS.");
  });

  it("shows the core's refusal and keeps the form open", async () => {
    const { host } = await open(installed, { cmd: "lfs_track", message: "*.psd is already tracked by Git LFS" });

    buttonNamed(host, "Track pattern…")?.click();
    await flush();
    type(host.querySelector<HTMLInputElement>('input[aria-label="Pattern to track"]'), "*.psd");
    buttonNamed(host, "Track")?.click();
    await flush(40);

    expect(host.querySelector('[role="alert"]')?.textContent).toBe("*.psd is already tracked by Git LFS");
    expect(host.querySelector('input[aria-label="Pattern to track"]')).not.toBeNull();
  });
});
