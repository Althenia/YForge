import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flush, mountWithApp } from "../components/testkit";
import { defaultSettings } from "./settingsModel";

let dispose: (() => void) | undefined;

beforeEach(() => {
  window.matchMedia = (() => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

function install(options: { tabs: string[]; launch: string; repositories: string[]; settings?: Partial<typeof defaultSettings> }) {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      switch (cmd) {
        case "settings_load":
          return { ...defaultSettings, ...options.settings };
        case "session_load":
          return { tabs: options.tabs, active: 0 };
        case "launch_path":
          return options.launch;
        case "repo_open": {
          const path = (args as { path: string }).path;
          if (!options.repositories.includes(path)) throw { kind: "not_a_repository", message: `${path} is not inside a Git repository`, output: null };
          return { root: path };
        }
        case "activity_list":
        case "recents_list":
        case "recent_add":
          return [];
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
  return calls;
}

async function boot(options: Parameters<typeof install>[0]) {
  const calls = install(options);
  const mounted = mountWithApp((app) => {
    app.bind();
    return null;
  });
  dispose = mounted.dispose;
  await mounted.app.boot();
  await flush();
  return { ...mounted, calls };
}

const key = (name: string, init: KeyboardEventInit = {}, target: EventTarget = document) => {
  const event = new KeyboardEvent("keydown", { key: name, metaKey: true, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

describe("app state", () => {
  it("restores the saved tabs and opens the launch path last when it is a repository", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/b", repositories: ["/a", "/b"] });

    expect(app.tabs().tabs).toEqual([{ kind: "repo", path: "/a" }, { kind: "repo", path: "/b" }]);
    expect(app.activePath()).toBe("/b");
    expect(app.ready()).toBe(true);
  });

  it("ignores a launch path that is not a repository and shows the launcher when nothing was saved", async () => {
    const restored = await boot({ tabs: ["/a"], launch: "/tmp", repositories: ["/a"] });
    expect(restored.app.tabs().tabs).toEqual([{ kind: "repo", path: "/a" }]);
    restored.dispose();
    document.body.innerHTML = "";

    const empty = await boot({ tabs: [], launch: "/", repositories: [] });
    expect(empty.app.activeTab()).toEqual({ kind: "launcher" });
  });

  it("applies the saved theme and density to the document", async () => {
    await boot({ tabs: [], launch: "/", repositories: [], settings: { theme: "light", density: "compact" } });

    expect([document.documentElement.dataset.theme, document.documentElement.dataset.density]).toEqual(["light", "compact"]);
  });

  it("follows the system colour scheme for the System theme", async () => {
    await boot({ tabs: [], launch: "/", repositories: [] });

    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("opens a repository as a tab, records it as recent, and saves the session; refuses a folder that is not a repository", async () => {
    const { app, calls } = await boot({ tabs: [], launch: "/", repositories: ["/r"] });

    expect(await app.openRepository("/r")).toBe(true);
    expect(await app.openRepository("/nope")).toBe(false);

    expect(app.activePath()).toBe("/r");
    expect(app.notice()).toBe("/nope is not a Git repository");
    expect(calls.find((call) => call.cmd === "recent_add")?.args).toEqual({ path: "/r" });
    expect(calls.filter((call) => call.cmd === "session_save").at(-1)?.args).toEqual({ session: { tabs: ["/r"], active: 0 } });
  });

  it("closing the last tab leaves the launcher", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"] });

    app.closeActiveTab();

    expect(app.activeTab()).toEqual({ kind: "launcher" });
  });

  it("⌘K toggles the palette, ⌘T opens a launcher tab, and ⌘, opens settings", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"] });

    key("k");
    expect(app.paletteOpen()).toBe(true);
    key("k");
    expect(app.paletteOpen()).toBe(false);
    key("t");
    expect(app.activeTab()).toEqual({ kind: "launcher" });
    key(",");
    expect(app.screen()).toEqual({ kind: "settings", section: "general" });
  });

  it("does not run shortcuts while the palette is open, and leaves ⌘Z to text fields", async () => {
    const { app } = await boot({ tabs: ["/a"], launch: "/", repositories: ["/a"] });
    const input = document.createElement("input");
    document.body.append(input);

    key("z", {}, input);
    key("k");
    key("t");

    expect(app.paletteOpen()).toBe(true);
    expect(app.activeTab()).toEqual({ kind: "repo", path: "/a" });
  });
});
