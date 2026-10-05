import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { TextArea } from "./TextArea";
import { mountWithApp, type } from "./testkit";

function mount(props: { value?: string; limit?: number; minRows?: number; maxRows?: number } = {}) {
  const [value, setValue] = createSignal(props.value ?? "");
  const view = mountWithApp(() => (
    <TextArea label="Prompt" value={value()} limit={props.limit} minRows={props.minRows} maxRows={props.maxRows} onInput={setValue} />
  ));
  return { ...view, value };
}

const editor = (host: ParentNode) => host.querySelector<HTMLTextAreaElement>("textarea");

describe("owned text area", () => {
  it("reserves enough height for the increased non-graph text line height", () => {
    const { host, dispose } = mount({ value: "one\ntwo\nthree", minRows: 3 });
    expect(host.querySelector<HTMLElement>(".input.area")?.style.height).toBe("78px");
    dispose();
  });
  it("wraps the field in the shared input frame so its label, field, and note align with a one-line input", () => {
    const { host, dispose } = mount({ value: "one\ntwo" });
    expect(host.querySelector(".input.area")).not.toBeNull();
    expect(editor(host)?.value).toBe("one\ntwo");
    expect(editor(host)?.getAttribute("aria-label")).toBe("Prompt");
    dispose();
  });

  it("starts at the minimum height, grows with its content, and stops at the maximum", async () => {
    const { host, value, dispose } = mount({ value: "one", minRows: 3, maxRows: 5 });
    const frame = () => host.querySelector<HTMLElement>(".input.area");
    const rows = () => Number(editor(host)?.getAttribute("rows"));

    expect(rows()).toBe(3);

    type(editor(host), "one\ntwo\nthree\nfour");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rows()).toBeGreaterThanOrEqual(3);
    expect(frame()).not.toBeNull();

    type(editor(host), Array.from({ length: 40 }, (_, index) => `line ${index}`).join("\n"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rows()).toBeLessThanOrEqual(5);
    expect(value().split("\n").length).toBe(40);
    dispose();
  });

  it("shows the remaining count when a limit is set and marks it over the limit", async () => {
    const { host, dispose } = mount({ value: "abc", limit: 5 });
    expect(host.querySelector(".count")?.textContent).toBe("2");
    expect(host.querySelector(".count")?.classList.contains("over")).toBe(false);

    type(editor(host), "abcdefg");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.querySelector(".count")?.textContent).toBe("-2");
    expect(host.querySelector(".count")?.classList.contains("over")).toBe(true);
    dispose();
  });

  it("shows no count when no limit is set", () => {
    const { host, dispose } = mount({ value: "abc" });
    expect(host.querySelector(".count")).toBeNull();
    dispose();
  });
});
