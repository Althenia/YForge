import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TabBar } from "../components/TabBar";
import { flush, mountWithApp } from "../components/testkit";
import { defaultSettings } from "../state/settingsModel";

let stylesheet: HTMLStyleElement;
let dispose: (() => void) | undefined;

beforeAll(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = ["tokens.css", "app.css"].map((name) => readFileSync(resolve(import.meta.dirname, name), "utf8")).join("\n");
  document.head.append(stylesheet);
});

afterAll(() => stylesheet.remove());

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

describe("tab bar layout rules (S45)", () => {
  it("lets the tab list shrink and scroll sideways while tabs shrink to the minimum width with a truncating name and the controls stay fixed", async () => {
    const tabs = Array.from({ length: 6 }, (_, index) => `/work/repository-${index}`);
    mockIPC(
      (cmd) => {
        if (cmd === "settings_load") return defaultSettings;
        if (cmd === "session_load") return { tabs, active: 0, groups: [] };
        if (cmd === "activity_list" || cmd === "recents_list" || cmd === "repo_aliases_list") return [];
        if (cmd === "launch_path") return "/nowhere";
        if (cmd === "repo_open") return { root: (tabs[0] as string), main_root: (tabs[0] as string) };
        return null;
      },
      { shouldMockEvents: true },
    );
    const mounted = mountWithApp(() => <TabBar count={1} />);
    dispose = mounted.dispose;
    await mounted.app.boot();
    await flush();

    const list = getComputedStyle(mounted.host.querySelector(".tab-scroll") as HTMLElement);
    const tab = getComputedStyle(mounted.host.querySelector(".tab") as HTMLElement);
    const label = getComputedStyle(mounted.host.querySelector(".tab-label") as HTMLElement);
    const newTab = getComputedStyle(mounted.host.querySelector('button[aria-label="New tab"]') as HTMLElement);

    expect(list.overflowX).toBe("auto");
    expect(list.minWidth).toBe("0px");
    expect(tab.minWidth).toBe("var(--controls-tab-min)");
    expect(tab.flexShrink).toBe("1");
    expect([label.overflow, label.textOverflow, label.minWidth]).toEqual(["hidden", "ellipsis", "0px"]);
    expect(newTab.flexShrink).toBe("0");
  });
});
