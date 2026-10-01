import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSignal } from "solid-js";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Select, type SelectOption } from "./Select";
import { flush, mountWithApp } from "./testkit";
import { stubScrollLayout } from "./virtualTestkit";

const OPTIONS: readonly SelectOption[] = [
  { value: "main", label: "main" },
  { value: "feature/retry", label: "feature/retry", hint: "2 commits" },
  { value: "develop", label: "develop" },
];

const MODELS: readonly SelectOption[] = [
  { value: "aion-2-0", label: "Aion-2.0", hint: "131k" },
  { value: "claude-sonnet", label: "Claude Sonnet", hint: "200k" },
  { value: "gpt-6-luna", label: "GPT-6 Luna" },
  { value: "gpt-6-sol", label: "GPT-6 Sol" },
  { value: "gpt-6-astra", label: "GPT-6 Astra" },
  { value: "llama-5", label: "Llama 5", hint: "1M" },
  { value: "mistral-large", label: "Mistral Large" },
  { value: "qwen-3", label: "Qwen 3" },
  { value: "zeta-9", label: "Zeta", hint: "64k" },
];

function mount(props: { value?: string; disabled?: boolean; options?: readonly SelectOption[]; onChange?: (value: string) => void } = {}) {
  const [value, setValue] = createSignal(props.value ?? "");
  const view = mountWithApp(() => (
    <Select
      label="Branch"
      value={value()}
      options={props.options ?? OPTIONS}
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
const search = (host: ParentNode) => host.querySelector<HTMLInputElement>('input[aria-label="Search Branch"]');
const optionLabels = (host: ParentNode) => options(host).map((option) => option.querySelector(".select-option-label")?.textContent);

const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

async function typeInto(input: HTMLInputElement, text: string) {
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  await flush();
}

const open = async (host: ParentNode) => {
  trigger(host)?.click();
  await flush();
};

afterEach(() => {
  document.body.innerHTML = "";
});

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
    expect(optionLabels(host)).toEqual(["main", "feature/retry", "develop"]);
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

describe("select option layout", () => {
  it("draws the label and the hint as separate sibling spans, so the hint never joins the label text", async () => {
    const { host, dispose } = mount({ value: "main" });
    await open(host);

    const [, retry] = options(host);
    const label = retry?.querySelector(".select-option-label");
    const hint = retry?.querySelector(".select-option-hint");
    expect(label?.textContent).toBe("feature/retry");
    expect(hint?.textContent).toBe("2 commits");
    expect(hint?.parentElement).toBe(retry);
    expect(label?.contains(hint ?? null)).toBe(false);
    expect(options(host)[0]?.querySelector(".select-option-hint")).toBeNull();
    dispose();
  });
});

describe("select list width", () => {
  it("opens a list at least as wide as its trigger", async () => {
    const { host, dispose } = mount({ value: "main" });
    const button = trigger(host) as HTMLButtonElement;
    button.getBoundingClientRect = () => ({ left: 40, top: 100, right: 560, bottom: 132, width: 520, height: 32, x: 40, y: 100, toJSON: () => ({}) }) as DOMRect;
    await open(host);

    expect(host.querySelector<HTMLElement>(".select-list")?.style.getPropertyValue("--select-anchor")).toBe("520px");
    dispose();
  });
});

describe("select chevron", () => {
  let stylesheet: HTMLStyleElement;

  beforeAll(() => {
    stylesheet = document.createElement("style");
    stylesheet.textContent = ["tokens.css", "app.css"].map((name) => readFileSync(resolve(import.meta.dirname, "../styles", name), "utf8")).join("\n");
    document.head.append(stylesheet);
  });

  it("points down and is never rotated on the trigger, open or closed", async () => {
    const { host, dispose } = mount({ value: "main" });
    const chevron = () => trigger(host)?.querySelector("svg") as SVGElement;

    expect(chevron().querySelector("path")?.getAttribute("d")).toBe("m6 9 6 6 6-6");
    expect(["", "none"]).toContain(getComputedStyle(chevron()).transform);
    await open(host);
    expect(["", "none"]).toContain(getComputedStyle(chevron()).transform);
    dispose();
  });

  it("styles the search field as an owned input with the text cursor", async () => {
    const { host, dispose } = mount({ options: MODELS });
    await open(host);
    const field = host.querySelector<HTMLInputElement>('input[aria-label="Search Branch"]') as HTMLInputElement;

    expect(getComputedStyle(field).cursor).toBe("var(--cursors-text)");
    expect(getComputedStyle(field.closest("label") as HTMLElement).cursor).toBe("var(--cursors-text)");
    dispose();
  });
});

describe("select search", () => {
  it("offers no search field for 8 options or fewer", async () => {
    const { host, dispose } = mount({ options: MODELS.slice(0, 8) });
    await open(host);

    expect(options(host)).toHaveLength(8);
    expect(host.querySelector("input")).toBeNull();
    dispose();
  });

  it("opens with a search field named after the select, focused, above the options, for more than 8 options", async () => {
    const { host, dispose } = mount({ options: MODELS, value: "qwen-3" });
    await open(host);

    const field = search(host);
    expect(field).not.toBeNull();
    expect(document.activeElement).toBe(field);
    expect(options(host)).toHaveLength(9);
    expect(field?.compareDocumentPosition(options(host)[0] as Element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(field?.closest('[role="listbox"]')).toBeNull();
    dispose();
  });

  it("keeps the options whose label, hint, or value contains the text, ignoring case", async () => {
    const { host, dispose } = mount({ options: MODELS });
    await open(host);
    const field = search(host) as HTMLInputElement;

    await typeInto(field, "GPT-6");
    expect(optionLabels(host)).toEqual(["GPT-6 Luna", "GPT-6 Sol", "GPT-6 Astra"]);

    await typeInto(field, "131K");
    expect(optionLabels(host)).toEqual(["Aion-2.0"]);

    await typeInto(field, "mistral-lar");
    expect(optionLabels(host)).toEqual(["Mistral Large"]);

    await typeInto(field, "");
    expect(options(host)).toHaveLength(9);
    dispose();
  });

  it("moves from the field to the first remaining option with ArrowDown", async () => {
    const { host, dispose } = mount({ options: MODELS });
    await open(host);
    const field = search(host) as HTMLInputElement;

    await typeInto(field, "sol");
    press(field, "ArrowDown");
    await flush();

    expect(document.activeElement).toBe(options(host)[0]);
    expect(options(host)[0]?.dataset.value).toBe("gpt-6-sol");
    dispose();
  });

  it("chooses the first remaining option with Enter in the field and closes", async () => {
    const chosen: string[] = [];
    const { host, value, dispose } = mount({ options: MODELS, value: "qwen-3", onChange: (next) => chosen.push(next) });
    await open(host);
    const field = search(host) as HTMLInputElement;

    await typeInto(field, "gpt-6 a");
    press(field, "Enter");
    await flush();

    expect(chosen).toEqual(["gpt-6-astra"]);
    expect(value()).toBe("gpt-6-astra");
    expect(options(host)).toHaveLength(0);
    expect(document.activeElement).toBe(trigger(host));
    dispose();
  });

  it("types spaces and Home or End into the field instead of choosing or jumping", async () => {
    const chosen: string[] = [];
    const { host, dispose } = mount({ options: MODELS, onChange: (next) => chosen.push(next) });
    await open(host);
    const field = search(host) as HTMLInputElement;
    const events = [" ", "Home", "End"].map((key) => new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    for (const event of events) field.dispatchEvent(event);
    await flush();

    expect(events.map((event) => event.defaultPrevented)).toEqual([false, false, false]);
    expect(chosen).toEqual([]);
    expect(document.activeElement).toBe(field);
    dispose();
  });

  it("closes on Escape from the field and returns focus to the trigger", async () => {
    const { host, dispose } = mount({ options: MODELS });
    await open(host);

    press(search(host) as HTMLInputElement, "Escape");
    await flush();

    expect(options(host)).toHaveLength(0);
    expect(trigger(host)?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger(host));
    dispose();
  });

  it("states No matches in text when nothing remains, chooses nothing on Enter, and recovers when the text is cleared", async () => {
    const chosen: string[] = [];
    const { host, dispose } = mount({ options: MODELS, value: "qwen-3", onChange: (next) => chosen.push(next) });
    await open(host);
    const field = search(host) as HTMLInputElement;

    await typeInto(field, "nothing like this");
    expect(options(host)).toHaveLength(0);
    expect(host.textContent).toContain("No matches");
    press(field, "Enter");
    await flush();
    expect(chosen).toEqual([]);
    expect(trigger(host)?.getAttribute("aria-expanded")).toBe("true");

    await typeInto(field, "");
    expect(host.textContent).not.toContain("No matches");
    expect(options(host)).toHaveLength(9);
    dispose();
  });

  it("never changes the chosen value while searching, and resets the field when the list reopens", async () => {
    const chosen: string[] = [];
    const { host, value, dispose } = mount({ options: MODELS, value: "qwen-3", onChange: (next) => chosen.push(next) });
    await open(host);
    await typeInto(search(host) as HTMLInputElement, "llama");

    expect(chosen).toEqual([]);
    expect(value()).toBe("qwen-3");
    expect(host.querySelector(".select-value")?.textContent).toBe("Qwen 3");

    press(search(host) as HTMLInputElement, "Escape");
    await flush();
    await open(host);

    expect(search(host)?.value).toBe("");
    expect(options(host)).toHaveLength(9);
    expect(value()).toBe("qwen-3");
    dispose();
  });

  it("keeps the option keyboard behavior: arrows wrap, Home and End jump, Enter chooses, Escape closes", async () => {
    const chosen: string[] = [];
    const { host, dispose } = mount({ options: MODELS, onChange: (next) => chosen.push(next) });
    await open(host);
    const field = search(host) as HTMLInputElement;

    press(field, "ArrowDown");
    await flush();
    const first = options(host)[0] as HTMLElement;
    press(first, "End");
    await flush();
    expect(document.activeElement).toBe(options(host)[8]);
    press(options(host)[8] as HTMLElement, "ArrowDown");
    await flush();
    expect(document.activeElement).toBe(options(host)[0]);
    press(options(host)[0] as HTMLElement, "Enter");
    await flush();

    expect(chosen).toEqual(["aion-2-0"]);
    expect(options(host)).toHaveLength(0);
    dispose();
  });
});

describe("owned select with thousands of options", () => {
  const TOTAL = 5000;
  const MANY: readonly SelectOption[] = Array.from({ length: TOTAL }, (_, index) => ({ value: `option-${index}`, label: `Option ${index}` }));
  let restoreLayout: (() => void) | undefined;

  beforeEach(() => {
    restoreLayout = stubScrollLayout({ viewport: 280, row: 32, total: TOTAL });
  });

  afterEach(() => {
    restoreLayout?.();
    vi.unstubAllGlobals();
  });

  it("renders only the options in view and keeps the search field focused on open", async () => {
    const { host } = mount({ options: MANY });

    await open(host);

    expect(options(host).length).toBeGreaterThan(0);
    expect(options(host).length).toBeLessThan(60);
    expect(optionLabels(host)[0]).toBe("Option 0");
    expect(document.activeElement).toBe(search(host));
  });

  it("reaches the last option with End, wraps to it with ↑ from the first, and chooses it with Enter", async () => {
    const chosen: string[] = [];
    const { host } = mount({ options: MANY, onChange: (value) => chosen.push(value) });
    await open(host);

    press(search(host) as HTMLElement, "ArrowDown");
    await flush();
    expect(document.activeElement?.getAttribute("data-value")).toBe("option-0");
    press(document.activeElement as HTMLElement, "ArrowUp");
    await flush(60);
    expect(document.activeElement?.getAttribute("data-value")).toBe(`option-${TOTAL - 1}`);
    press(document.activeElement as HTMLElement, "Home");
    await flush(60);
    expect(document.activeElement?.getAttribute("data-value")).toBe("option-0");
    press(document.activeElement as HTMLElement, "End");
    await flush(60);

    expect(document.activeElement?.getAttribute("data-value")).toBe(`option-${TOTAL - 1}`);
    expect(options(host).length).toBeLessThan(60);
    press(document.activeElement as HTMLElement, "Enter");
    await flush();
    expect(chosen).toEqual([`option-${TOTAL - 1}`]);
  });

  it("narrows the rendered options with the search text", async () => {
    const { host } = mount({ options: MANY });
    await open(host);

    await typeInto(search(host) as HTMLInputElement, "option-4999");

    expect(optionLabels(host)).toEqual(["Option 4999"]);
  });
});
