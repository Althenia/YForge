import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { Select, type SelectOption } from "./Select";
import { flush, mountWithApp } from "./testkit";

const OPTIONS: readonly SelectOption[] = [
  { value: "main", label: "main" },
  { value: "feature/retry", label: "feature/retry", hint: "2 commits" },
  { value: "develop", label: "develop" },
];

function mount(props: { value?: string; disabled?: boolean; onChange?: (value: string) => void } = {}) {
  const [value, setValue] = createSignal(props.value ?? "");
  const view = mountWithApp(() => (
    <Select
      label="Branch"
      value={value()}
      options={OPTIONS}
      placeholder="Choose…"
      disabled={props.disabled}
      disabledReason="Nothing to choose yet"
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
    />
  ));
  return { ...view, value };
}

const trigger = (host: ParentNode) => host.querySelector<HTMLButtonElement>('button[aria-label="Branch"]');
const list = (host: ParentNode) => host.querySelector<HTMLElement>('[role="listbox"]');
const options = (host: ParentNode) => [...(host.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];

describe("owned select", () => {
  it("is a button, never a platform select, that names the chosen option or the placeholder", () => {
    const empty = mount();
    expect(empty.host.querySelector("select")).toBeNull();
    expect(trigger(empty.host)?.getAttribute("aria-haspopup")).toBe("listbox");
    expect(trigger(empty.host)?.getAttribute("aria-expanded")).toBe("false");
    expect(empty.host.querySelector(".select-value")?.textContent).toBe("Choose…");
    empty.dispose();

    const chosen = mount({ value: "feature/retry" });
    expect(chosen.host.querySelector(".select-value")?.textContent).toBe("feature/retry");
  });

  it("opens a listbox with one option per value, marks the chosen one, and closes on Escape returning focus to the button", async () => {
    const { host, dispose } = mount({ value: "main" });
    trigger(host)?.click();
    await flush();

    expect(trigger(host)?.getAttribute("aria-expanded")).toBe("true");
    expect(options(host).map((option) => option.querySelector(".select-option-label")?.firstChild?.textContent?.trim())).toEqual(["main", "feature/retry", "develop"]);
    expect(options(host)[1]?.querySelector(".select-option-hint")?.textContent).toBe("2 commits");
    expect(options(host)[0]?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(options(host)[0]);

    list(host)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();

    expect(options(host)).toHaveLength(0);
    expect(document.activeElement).toBe(trigger(host));
    dispose();
  });

  it("moves with the arrow keys and chooses with Enter, reporting the value once", async () => {
    const chosen: string[] = [];
    const { host, value, dispose } = mount({ value: "main", onChange: (next) => chosen.push(next) });
    trigger(host)?.click();
    await flush();

    const opened = list(host) as HTMLElement;
    opened.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await flush();
    expect(document.activeElement).toBe(options(host)[1]);

    opened.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await flush();
    expect(document.activeElement).toBe(options(host)[2]);

    opened.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    expect(chosen).toEqual(["develop"]);
    expect(value()).toBe("develop");
    expect(options(host)).toHaveLength(0);
    dispose();
  });

  it("chooses with a click and closes", async () => {
    const chosen: string[] = [];
    const { host, dispose } = mount({ onChange: (next) => chosen.push(next) });
    trigger(host)?.click();
    await flush();
    options(host)[2]?.click();
    await flush();

    expect(chosen).toEqual(["develop"]);
    expect(options(host)).toHaveLength(0);
    dispose();
  });

  it("does not open while disabled and keeps its reason as the tooltip", async () => {
    const { host, dispose } = mount({ disabled: true });
    expect(trigger(host)?.disabled).toBe(true);
    expect(trigger(host)?.title).toBe("Nothing to choose yet");
    trigger(host)?.click();
    await flush();
    expect(options(host)).toHaveLength(0);
    dispose();
  });
});
