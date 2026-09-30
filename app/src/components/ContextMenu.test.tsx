import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type { MenuState } from "../state/repoActions";
import { ContextMenu } from "./ContextMenu";

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
});
