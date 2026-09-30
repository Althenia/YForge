import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSettings } from "../state/settingsModel";
import { TabBar } from "./TabBar";
import { flush, mountWithApp } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

async function mountTabs() {
  mockIPC(
    (cmd) => {
      if (cmd === "settings_load") return defaultSettings;
      if (cmd === "session_load") return { tabs: ["/work/sample"], active: 0 };
      if (cmd === "activity_list" || cmd === "recents_list") return [];
      if (cmd === "launch_path") return "/nowhere";
      if (cmd === "repo_open") throw { kind: "not_a_repository", message: "no", output: null };
      return null;
    },
    { shouldMockEvents: true },
  );
  const mounted = mountWithApp(() => <TabBar count={1} />);
  dispose = mounted.dispose;
  await mounted.app.boot();
  await flush();
  return mounted.host;
}

describe("tab bar", () => {
  it("leads a repository tab with the hidden YForge logo (small-size variant), so the tab is named by its repository alone", async () => {
    const host = await mountTabs();

    const tab = host.querySelector<HTMLElement>('[role="tab"]');
    const mark = tab?.querySelector("svg.brand-mark");
    expect(mark?.getAttribute("viewBox")).toBe("0 0 1024 1024");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.getAttribute("width")).toBe("24");
    expect(mark?.querySelector("circle")?.getAttribute("r")).toBe("96");
    expect(tab?.textContent).not.toContain("Y");
    expect(tab?.textContent?.replace(/\s+/g, " ").trim().startsWith("sample")).toBe(true);
  });
});
