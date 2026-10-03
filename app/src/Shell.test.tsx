import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { flush } from "./components/testkit";
import { stubScrollLayout } from "./components/virtualTestkit";
import { defaultSettings } from "./state/settingsModel";

class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;

Element.prototype.scrollIntoView = () => undefined;

const settle = (event: Event) => event.preventDefault();

beforeEach(() => {
  restoreLayout = stubScrollLayout({ viewport: 400, row: 32, total: 20_000 });
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubEnv("DEV", false);
  mockWindows("main");
  window.addEventListener("error", settle);
  window.scrollTo = () => undefined;
  window.matchMedia = (() => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  window.removeEventListener("error", settle);
  dispose?.();
  dispose = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  restoreLayout?.();
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

describe("shell sheets and the repository search palette", () => {
  function mountApp(extra: Record<string, unknown> = {}) {
    mockIPC(
      (cmd) => {
        if (cmd in extra) return extra[cmd];
        if (cmd === "repo_open") throw { kind: "not_a_repository", message: "not a repository", output: null };
        if (cmd === "settings_load") return defaultSettings;
        if (cmd === "repo_aliases_list") return [];
        if (cmd === "session_load") return { tabs: [], active: 0, groups: [] };
        if (cmd === "launch_path") return "/nowhere";
        if (cmd === "activity_list" || cmd === "recents_list") return [];
        return null;
      },
      { shouldMockEvents: true },
    );
    window.location.hash = "#/launcher";
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(() => <App />, host);
    return host;
  }

  it("opens the palette scoped to repositories with ⇧⌘O, listing the known repositories", async () => {
    const host = mountApp({ recents_list: [{ path: "/work/api", opened_at: 1 }], repositories_list: { folders: [], repos: [{ path: "/scan/web", folder: "/scan", opened_at: null }] } });
    await flush(80);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "O", metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await flush(80);

    expect(host.querySelector(".palette .pal-chip.scope")?.textContent).toContain("Open repo");
    expect(host.querySelector<HTMLInputElement>('.palette input[aria-label="Command"]')?.placeholder).toBe("Search for a repository to open");
    expect([...host.querySelectorAll(".palette .pal-item .pal-label")].map((label) => label.textContent)).toEqual(["/work/api", "/scan/web"]);
  });

  it("shows the keyboard shortcuts sheet for Help → Keyboard Shortcuts and closes it with Escape", async () => {
    const host = mountApp();
    await flush(80);

    await emit("menu-action", "help.shortcuts");
    await flush(80);

    expect(host.querySelector('[role="dialog"] h3')?.textContent).toBe("Keyboard shortcuts");
    expect(host.querySelector(".palette")).toBeNull();
    expect(host.querySelectorAll(".shortcut-group li").length).toBeGreaterThan(20);
    host.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows the logs sheet from the palette's Error log command", async () => {
    const host = mountApp({ crash_list: [] });
    await flush(80);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true }));
    await flush(40);
    const input = host.querySelector<HTMLInputElement>('.palette input[aria-label="Command"]');
    if (input === null) throw new Error("no palette");
    input.value = "error log";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await flush(40);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await flush(80);

    expect(host.querySelector('[role="dialog"] h3')?.textContent).toBe("Logs");
    expect(host.querySelector('.logs-tabs [role="tab"][aria-selected="true"]')?.textContent).toBe("Error log");
  });
});
