import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RecentRepo } from "../ipc/bindings/RecentRepo";
import type { RecentStatus } from "../ipc/bindings/RecentStatus";
import { CloneDialog, CreateDialog } from "./EntryDialogs";
import { Launcher } from "./Launcher";
import { buttonNamed, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

beforeEach(() => {
  mockWindows("main");
  window.localStorage.clear();
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

const counts = { modified: 1, added: 0, deleted: 0, renamed: 0, untracked: 1, conflicted: 0 };
const now = Math.floor(Date.now() / 1000);
const recents: RecentRepo[] = [
  { path: "/Users/yui/dev/sample", opened_at: now - 300 },
  { path: "/Users/yui/dev/other-repo", opened_at: now - 3600 },
  { path: "/Users/yui/dev/gone", opened_at: now - 86400 },
];
const status = (path: string, extra: Partial<RecentStatus> = {}): RecentStatus => ({ path, exists: true, branch: "main", unborn: false, ahead_behind: null, counts: { ...counts, modified: 0, untracked: 0 }, worktrees: 1, ...extra });

function install(handler: (call: Call) => unknown = () => undefined, list: RecentRepo[] = recents) {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
      calls.push(call);
      const custom = handler(call);
      if (custom !== undefined) return custom;
      switch (cmd) {
        case "recents_list":
          return list;
        case "plugin:path|resolve_directory":
          return "/Users/yui";
        case "recent_statuses":
          return list.map((recent) =>
            recent.path.endsWith("gone")
              ? status(recent.path, { exists: false, branch: null, counts: null, worktrees: 0 })
              : recent.path.endsWith("sample")
                ? status(recent.path, { branch: "feature/greeting", ahead_behind: { ahead: 2, behind: 0 }, counts, worktrees: 2 })
                : status(recent.path),
          );
        case "repo_open":
          return { root: (args as { path: string }).path };
        case "recent_add":
        case "recent_remove":
          return list;
        case "settings_load":
        case "session_load":
          return null;
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
  return calls;
}

async function mountLauncher(list: RecentRepo[] = recents, handler?: (call: Call) => unknown) {
  const calls = install(handler, list);
  const mounted = mountWithApp(() => <Launcher />);
  dispose = mounted.dispose;
  await flush(40);
  return { ...mounted, calls };
}

const rows = (host: HTMLElement) => [...host.querySelectorAll(".recent")];

describe("launcher", () => {
  it("lists recents with name, branch, ahead/behind, change counts, worktrees, home-relative path, and age", async () => {
    const { host } = await mountLauncher();

    const sample = rows(host)[0];
    expect(sample?.querySelector(".recent-name")?.textContent).toBe("sample");
    expect(sample?.querySelector(".recent-meta")?.textContent).toContain("feature/greeting");
    expect(sample?.querySelector(".recent-meta")?.textContent).toContain("↑2");
    expect(sample?.querySelector(".recent-meta")?.textContent).toContain("M 1 U 1");
    expect(sample?.querySelector(".recent-meta")?.textContent).toContain("2 worktrees");
    expect(sample?.querySelector(".recent-path")?.textContent).toBe("~/dev/sample");
    expect(sample?.querySelector(".recent-age")?.textContent).toBe("5m ago");
    expect(host.querySelector("h1")?.textContent).toBe("YForge");
    expect(host.querySelector("h1 .sr-only")?.textContent).toBe("YForge");
    const logo = host.querySelector("h1 svg.brand-mark");
    expect(logo?.getAttribute("aria-hidden")).toBe("true");
    expect(logo?.getAttribute("width")).toBe("72");
    expect(logo?.querySelector("circle")?.getAttribute("r")).toBe("76");
    expect(host.querySelector(".launcher-box h2")).toBeNull();
    expect(host.textContent).not.toContain("Open a repository");
    expect(["Open…", "Clone…", "Create…"].map((name) => buttonNamed(host, name) !== undefined)).toEqual([true, true, true]);
    expect(host.textContent).toContain("Drop a folder to open it");
  });

  it("marks a repository that no longer exists as Not found with Locate and Remove instead of opening it", async () => {
    const { host, calls } = await mountLauncher();

    const gone = rows(host)[2];
    expect(gone?.textContent).toContain("Not found");
    expect(gone?.querySelector<HTMLButtonElement>(".recent-main")?.disabled).toBe(true);
    expect(buttonNamed(gone as HTMLElement, "Locate…")).toBeDefined();
    gone?.querySelector<HTMLButtonElement>("button[aria-label^=\"Remove\"]")?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "recent_remove")?.args).toEqual({ path: "/Users/yui/dev/gone" });
  });

  it("filters the recents as you type and opens the highlighted one with Enter", async () => {
    const { host, calls, app } = await mountLauncher();
    const filter = host.querySelector<HTMLInputElement>('input[aria-label="Filter recent repositories"]');

    type(filter, "other");
    await flush();
    expect(rows(host).map((row) => row.querySelector(".recent-name")?.textContent)).toEqual(["other-repo"]);
    filter?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flush();

    expect(calls.find((call) => call.cmd === "repo_open")?.args).toEqual({ path: "/Users/yui/dev/other-repo" });
    expect(calls.find((call) => call.cmd === "recent_add")?.args).toEqual({ path: "/Users/yui/dev/other-repo" });
    expect(app.activePath()).toBe("/Users/yui/dev/other-repo");
  });

  it("says so when nothing matches the filter and when there are no recents at all", async () => {
    const { host } = await mountLauncher();
    type(host.querySelector<HTMLInputElement>('input[aria-label="Filter recent repositories"]'), "zzz");
    await flush();
    expect(host.textContent).toContain("No recent repository matches “zzz”.");
    dispose?.();
    document.body.innerHTML = "";

    const empty = await mountLauncher([]);
    expect(empty.host.textContent).toContain("No recent repositories. Open a folder, clone a URL, or create a new repository.");
  });

  it("shows placeholders while the per-repository status loads and does not reorder rows", async () => {
    let release: (value: unknown) => void = () => undefined;
    const { host } = await mountLauncher(recents, (call) => (call.cmd === "recent_statuses" ? new Promise((resolve) => (release = resolve)) : undefined));

    expect(rows(host).map((row) => row.querySelector(".recent-name")?.textContent)).toEqual(["sample", "other-repo", "gone"]);
    expect(rows(host)[0]?.querySelector(".recent-meta")?.textContent).toContain("…");
    release(recents.map((recent) => status(recent.path)));
    await flush();

    expect(rows(host).map((row) => row.querySelector(".recent-name")?.textContent)).toEqual(["sample", "other-repo", "gone"]);
  });

  it("opens the Clone and Create dialogs", async () => {
    const { host, app } = await mountLauncher();

    buttonNamed(host, "Clone…")?.click();
    expect(app.entryDialog()).toBe("clone");
    buttonNamed(host, "Create…")?.click();
    expect(app.entryDialog()).toBe("create");
  });
});

describe("clone dialog", () => {
  async function mountClone(handler: (call: Call) => unknown = () => undefined) {
    const calls = install(handler);
    const mounted = mountWithApp(() => <CloneDialog onClose={() => undefined} />);
    dispose = mounted.dispose;
    await flush(40);
    return { ...mounted, calls };
  }

  it("validates the address, previews the full destination path, and defaults to opening after the clone", async () => {
    const { host } = await mountClone();
    const clone = () => buttonNamed(host, "Clone");

    expect(clone()?.disabled).toBe(true);
    type(host.querySelector('input[aria-label="Repository URL"]'), "not a url");
    await flush();
    expect(host.textContent).toContain("Use an https or ssh address");
    expect(clone()?.disabled).toBe(true);
    type(host.querySelector('input[aria-label="Repository URL"]'), "https://github.com/example/lab-app.git");
    await flush();

    expect(clone()?.disabled).toBe(false);
    expect(host.textContent).toContain("Clones into /Users/yui/lab-app");
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
  });

  it("streams progress with Cancel, keeps the dialog open, and opens the repository when the clone finishes", async () => {
    let finish: (root: string) => void = () => undefined;
    const { host, calls, app } = await mountClone((call) => (call.cmd === "clone_repo" ? new Promise((resolve) => (finish = resolve)) : undefined));
    type(host.querySelector('input[aria-label="Repository URL"]'), "https://github.com/example/lab-app.git");
    await flush();

    buttonNamed(host, "Clone")?.click();
    await flush();
    const cloneCall = calls.find((call) => call.cmd === "clone_repo");
    expect(cloneCall?.args).toMatchObject({ url: "https://github.com/example/lab-app.git", destination: "/Users/yui/lab-app" });
    await emit("operation-progress", { id: cloneCall?.args.id, phase: "Receiving objects", percent: 64 });
    await flush();

    expect(host.querySelector(".entry-progress")?.textContent).toContain("Receiving objects 64%");
    expect(buttonNamed(host, "Clone")?.disabled).toBe(true);
    expect(buttonNamed(host, "Close")?.disabled).toBe(true);
    buttonNamed(host, "Cancel")?.click();
    await flush();
    expect(calls.find((call) => call.cmd === "operation_cancel")?.args).toEqual({ id: cloneCall?.args.id });
    finish("/Users/yui/lab-app");
    await flush(40);

    expect(calls.find((call) => call.cmd === "repo_open")?.args).toEqual({ path: "/Users/yui/lab-app" });
    expect(app.activePath()).toBe("/Users/yui/lab-app");
  });

  it("reports a failed or cancelled clone and offers Retry", async () => {
    let attempt = 0;
    const { host } = await mountClone((call) => {
      if (call.cmd !== "clone_repo") return undefined;
      attempt += 1;
      throw attempt === 1 ? { kind: "cancelled", message: "The operation was cancelled", output: null } : { kind: "git_failed", message: "network is down", output: null };
    });
    type(host.querySelector('input[aria-label="Repository URL"]'), "https://github.com/example/lab-app.git");
    await flush();

    buttonNamed(host, "Clone")?.click();
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Clone cancelled. The partial folder was removed.");
    buttonNamed(host, "Retry")?.click();
    await flush();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("network is down");
  });
});

describe("create dialog", () => {
  async function mountCreate(handler: (call: Call) => unknown = () => undefined) {
    const calls = install(handler);
    const mounted = mountWithApp(() => <CreateDialog onClose={() => undefined} />);
    dispose = mounted.dispose;
    await flush(40);
    return { ...mounted, calls };
  }

  it("previews the path, initializes the repository, and opens it", async () => {
    const { host, calls, app } = await mountCreate((call) => (call.cmd === "init_repo" ? "/Users/yui/brand-new" : undefined));

    expect(buttonNamed(host, "Create")?.disabled).toBe(true);
    type(host.querySelector('input[aria-label="Name"]'), "a/b");
    await flush();
    expect(host.textContent).toContain("cannot contain slashes");
    type(host.querySelector('input[aria-label="Name"]'), "brand-new");
    await flush();
    expect(host.textContent).toContain("Creates /Users/yui/brand-new");
    buttonNamed(host, "Create")?.click();
    await flush(40);

    expect(calls.find((call) => call.cmd === "init_repo")?.args).toEqual({ path: "/Users/yui/brand-new" });
    expect(app.activePath()).toBe("/Users/yui/brand-new");
  });

  it("offers to open the existing repository instead when the folder already is one", async () => {
    const { host, calls } = await mountCreate((call) => {
      if (call.cmd === "init_repo") throw { kind: "already_a_repository", message: "/Users/yui/there is already a Git repository", output: null };
      return undefined;
    });
    type(host.querySelector('input[aria-label="Name"]'), "there");
    await flush();

    buttonNamed(host, "Create")?.click();
    await flush();
    buttonNamed(host, "Open instead")?.click();
    await flush(40);

    expect(calls.find((call) => call.cmd === "repo_open")?.args).toEqual({ path: "/Users/yui/there" });
  });
});
