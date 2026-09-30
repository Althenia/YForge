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

async function mountTabs(tabs = ["/work/sample"], mains: Record<string, string> = {}) {
  mockIPC(
    (cmd, args) => {
      if (cmd === "settings_load") return defaultSettings;
      if (cmd === "session_load") return { tabs, active: 0 };
      if (cmd === "activity_list" || cmd === "recents_list") return [];
      if (cmd === "launch_path") return "/nowhere";
      if (cmd === "repo_open") {
        const path = (args as { path: string }).path;
        if (!tabs.includes(path)) throw { kind: "not_a_repository", message: "no", output: null };
        return { root: path, main_root: mains[path] ?? path };
      }
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

  it("groups a worktree's tab under its repository with the worktree glyph instead of the logo, and leaves single tabs ungrouped", async () => {
    const host = await mountTabs(["/work/sample", "/work/other", "/work/sample-feature"], { "/work/sample-feature": "/work/sample" });

    const groups = [...host.querySelectorAll(".tab-group")];
    const names = (group: Element) => [...group.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute("title"));

    expect(groups.map(names)).toEqual([["/work/sample", "/work/sample-feature"], ["/work/other"]]);
    expect(groups[0]?.getAttribute("role")).toBe("group");
    expect(groups[0]?.getAttribute("aria-label")).toBe("sample and its worktrees");
    expect(groups[0]?.querySelectorAll("svg.brand-mark")).toHaveLength(1);
    expect(groups[0]?.querySelector(".tab.linked svg.brand-mark")).toBeNull();
    expect(groups[0]?.querySelector(".tab.linked .icon")).not.toBeNull();
    expect(groups[1]?.getAttribute("role")).toBeNull();
  });
});
