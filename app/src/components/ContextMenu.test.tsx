import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { branchPickerMenu } from "../state/refMenu";
import type { MenuState } from "../state/repoActions";
import { ContextMenu } from "./ContextMenu";
import { flush } from "./testkit";
import { stubScrollLayout } from "./virtualTestkit";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

function mount(entries: MenuState["entries"]) {
  const chosen: string[] = [];
  const [open, setOpen] = createSignal<MenuState | undefined>({ anchor: { left: 10, top: 20 }, entries, run: (id) => chosen.push(id) });
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <Show when={open()} keyed>
        {(menu) => <ContextMenu menu={menu} onClose={() => setOpen(undefined)} />}
      </Show>
    ),
    host,
  );
  return { chosen, host, isOpen: () => open() !== undefined };
}

const items: MenuState["entries"] = [
  { kind: "item", id: "checkout", label: ["Checkout ", { ref: "feature/x" }] },
  { kind: "item", id: "merge", label: ["Merge"], disabledReason: "Not available yet" },
  { kind: "separator" },
  { kind: "item", id: "delete", label: ["Delete"], danger: true },
];

describe("context menu", () => {
  it("runs the chosen action after the menu has unmounted", () => {
    const { chosen, host, isOpen } = mount(items);

    host.querySelector<HTMLElement>('[role="menuitem"]')?.click();

    expect(chosen).toEqual(["checkout"]);
    expect(isOpen()).toBe(false);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("shows a disabled item with its reason and does not run it", () => {
    const { chosen, host, isOpen } = mount(items);
    const merge = host.querySelectorAll<HTMLElement>('[role="menuitem"]')[1];

    merge?.click();

    expect(merge?.getAttribute("aria-disabled")).toBe("true");
    expect(merge?.getAttribute("title")).toBe("Not available yet");
    expect(chosen).toEqual([]);
    expect(isOpen()).toBe(true);
  });

  it("renders refs in the mono style, a separator, and the danger item", () => {
    const { host } = mount(items);

    expect(host.querySelector(".r")?.textContent).toBe("feature/x");
    expect(host.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(host.querySelector(".item.danger")?.textContent).toBe("Delete");
  });

  it("closes on Escape without running anything and moves focus with the arrow keys", () => {
    const { chosen, host, isOpen } = mount(items);
    const menu = host.querySelector<HTMLElement>('[role="menu"]');
    const all = host.querySelectorAll<HTMLElement>('[role="menuitem"]');
    all[0]?.focus();

    menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(all[1]);
    menu?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(chosen).toEqual([]);
    expect(isOpen()).toBe(false);
  });

  it("closes when the pointer goes down outside the menu", () => {
    const { isOpen } = mount(items);

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(isOpen()).toBe(false);
  });

  it("shows the shortcut of an item after its label", () => {
    const { host } = mount([
      { kind: "item", id: "fetch", label: ["Fetch all"], shortcut: "⌘⇧F" },
      { kind: "item", id: "push", label: ["Push"], note: "default", shortcut: "⌘⇧P" },
      { kind: "item", id: "plain", label: ["Plain"] },
    ]);
    const [fetch, push, plain] = [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')];

    expect(fetch?.querySelector(".kbd")?.textContent).toBe("⌘⇧F");
    expect(push?.textContent).toBe("Pushdefault⌘⇧P");
    expect(plain?.querySelector(".kbd")).toBeNull();
  });
});

describe("context menu with thousands of branches", () => {
  const TOTAL = 5000;
  const branches = Array.from({ length: TOTAL }, (_, index) => `branch-${index}`);
  const current = "branch-1";
  let restoreLayout: (() => void) | undefined;

  beforeEach(() => {
    restoreLayout = stubScrollLayout({ viewport: 400, row: 28, total: TOTAL + 10 });
  });

  afterEach(() => restoreLayout?.());

  const menuItems = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const press = (key: string) => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const focusedLabel = () => document.activeElement?.querySelector(".label-text")?.textContent;

  it("renders only the entries in view and focuses the first branch that can be checked out", async () => {
    const { host } = mount(branchPickerMenu(branches, current, "origin/branch-1", ["origin"]));
    await flush(60);

    expect(menuItems(host).length).toBeGreaterThan(0);
    expect(menuItems(host).length).toBeLessThan(60);
    expect(menuItems(host)[0]?.textContent).toContain("branch-0");
    expect(focusedLabel()).toBe("branch-0");
  });

  it("reaches the last entry with End, wraps back with ↓, and runs the focused entry", async () => {
    const { host, chosen } = mount(branchPickerMenu(branches, current, null, ["origin"]));
    await flush(60);

    press("End");
    await flush(60);
    expect(focusedLabel()).toBe("Set upstream…");
    press("ArrowUp");
    await flush(60);
    expect(focusedLabel()).toBe(`branch-${TOTAL - 1}`);
    expect(menuItems(host).length).toBeLessThan(60);
    (document.activeElement as HTMLElement).click();

    expect(chosen).toEqual([`checkout:branch-${TOTAL - 1}`]);
  });

  it("steps through the rows with ↓ past the first window", async () => {
    mount(branchPickerMenu(branches, current, null, ["origin"]));
    await flush(60);

    for (let step = 0; step < 80; step += 1) {
      press("ArrowDown");
      await flush(0);
    }

    expect(focusedLabel()).toBe("branch-80");
  });
});
