import { afterEach, describe, expect, it, vi } from "vitest";
import { SHORTCUT_GROUPS, SHORTCUTS } from "../state/shortcuts";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { flush, mountWithApp } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

function mount() {
  const onClose = vi.fn();
  const mounted = mountWithApp(() => <ShortcutsSheet onClose={onClose} />);
  dispose = mounted.dispose;
  return { ...mounted, onClose };
}

describe("keyboard shortcuts sheet (S61)", () => {
  it("is a dialog titled Keyboard shortcuts with one section per group", () => {
    const { host } = mount();

    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-labelledby")).not.toBeNull();
    expect(host.querySelector("h3")?.textContent).toBe("Keyboard shortcuts");
    expect([...host.querySelectorAll(".shortcut-group")].map((section) => section.getAttribute("aria-label"))).toEqual(SHORTCUT_GROUPS.map((group) => group.group));
  });

  it("lists every shortcut of the registry with its glyphs, in its group", () => {
    const { host } = mount();

    const listed = [...host.querySelectorAll(".shortcut-group li")].map((row) => row.querySelector(".kbd")?.textContent);
    expect([...listed].sort()).toEqual(Object.values(SHORTCUTS).sort());
    const tabs = host.querySelector('.shortcut-group[aria-label="Tabs"]');
    expect(tabs?.textContent).toContain("Reopen closed tab");
    expect(tabs?.textContent).toContain(SHORTCUTS.reopenClosedTab);
    const view = host.querySelector('.shortcut-group[aria-label="View"]');
    expect(view?.textContent).toContain("Zoom in");
    expect(view?.textContent).toContain("⌘=");
    expect(view?.textContent).toContain("⌥⌘\\");
  });

  it("closes with the Close button and with Escape", async () => {
    const { host, onClose } = mount();
    await flush();

    host.querySelector<HTMLButtonElement>(".foot button")?.click();
    host.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
