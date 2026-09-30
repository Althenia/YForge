import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { flush } from "./components/testkit";
import type { CrashReport } from "./ipc/bindings/CrashReport";
import { defaultSettings } from "./state/settingsModel";

class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

let dispose: (() => void) | undefined;

const settle = (event: Event) => event.preventDefault();

beforeEach(() => {
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
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

describe("application root", () => {
  it("reports an uncaught window error to the crash log with the current route as the view", async () => {
    const reports: CrashReport[] = [];
    mockIPC(
      (cmd, args) => {
        if (cmd === "crash_report") reports.push((args as { report: CrashReport }).report);
        if (cmd === "settings_load") return defaultSettings;
        if (cmd === "session_load") return { tabs: [], active: 0 };
        if (cmd === "launch_path") return "/nowhere";
        if (cmd === "repo_open") throw { kind: "not_a_repository", message: "not a repository", output: null };
        if (cmd === "activity_list" || cmd === "recents_list") return [];
        return null;
      },
      { shouldMockEvents: true },
    );
    window.location.hash = "#/launcher";
    const host = document.createElement("div");
    document.body.append(host);
    dispose = render(() => <App />, host);
    await flush(80);

    const error = new Error("uncaught in a handler");
    window.dispatchEvent(new ErrorEvent("error", { message: error.message, error, cancelable: true }));
    await flush();

    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ kind: "error", message: "uncaught in a handler", view: "/launcher" });
  });
});
