import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileEditor } from "./FileEditor";
import { buttonNamed, flush, type as typeInto } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

const target = { file: "src/a.txt", text: "one\r\ntwo\r\n", eol: "\r\n", size: 10 };

function mount(overrides: { save?: (file: string, text: string, eol: string) => Promise<boolean>; onClose?: () => void } = {}) {
  const save = overrides.save ?? vi.fn(async () => true);
  const onClose = overrides.onClose ?? vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <FileEditor target={target} save={save} onClose={onClose} />, host);
  return { host, save, onClose };
}

const field = (host: ParentNode) => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="File content"]');

describe("FileEditor", () => {
  it("opens the file in the owned text area with its path, line ending, and nothing to save yet", () => {
    const { host } = mount();

    expect(host.querySelector('section[aria-label="Edit file"]')).not.toBeNull();
    expect(host.querySelector(".path")?.textContent).toBe("src/a.txt");
    expect(field(host)?.value).toBe("one\ntwo\n");
    expect(field(host)?.closest(".input.area")).not.toBeNull();
    expect(host.textContent).toContain("CRLF");
    expect(buttonNamed(host, "Save")?.getAttribute("aria-disabled")).toBe("true");
    expect(buttonNamed(host, "Save")?.getAttribute("data-tip")).toBe("There are no unsaved changes");
    expect(host.textContent).not.toContain("Unsaved changes");
  });

  it("saves the edited text with the file's line ending from the Save button and clears the unsaved state", async () => {
    const { host, save } = mount();

    typeInto(field(host), "one\nTWO\nthree\n");
    await flush();
    expect(host.textContent).toContain("Unsaved changes");
    expect(buttonNamed(host, "Save")?.getAttribute("aria-disabled")).toBeNull();
    buttonNamed(host, "Save")?.click();
    await flush();

    expect(save).toHaveBeenCalledWith("src/a.txt", "one\nTWO\nthree\n", "\r\n");
    expect(host.textContent).not.toContain("Unsaved changes");
    expect(buttonNamed(host, "Save")?.getAttribute("aria-disabled")).toBe("true");
  });

  it("saves on ⌘S and ignores it when nothing changed", async () => {
    const { host, save } = mount();
    const press = () => field(host)?.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true }));

    press();
    await flush();
    expect(save).not.toHaveBeenCalled();
    typeInto(field(host), "changed\n");
    await flush();
    press();
    await flush();

    expect(save).toHaveBeenCalledWith("src/a.txt", "changed\n", "\r\n");
  });

  it("keeps the edits unsaved when saving fails", async () => {
    const { host } = mount({ save: vi.fn(async () => false) });

    typeInto(field(host), "changed\n");
    await flush();
    buttonNamed(host, "Save")?.click();
    await flush();

    expect(host.textContent).toContain("Unsaved changes");
  });

  it("closes at once when there are no unsaved edits", async () => {
    const { host, onClose } = mount();

    buttonNamed(host, "Close")?.click();
    await flush();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("asks before discarding unsaved edits, on Close and on Escape, and keeps editing on Cancel", async () => {
    const { host, onClose } = mount();
    typeInto(field(host), "changed\n");
    await flush();

    buttonNamed(host, "Close")?.click();
    await flush();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.querySelector("h3")?.textContent).toBe("Discard unsaved edits to src/a.txt?");
    expect(onClose).not.toHaveBeenCalled();
    buttonNamed(document.body, "Cancel")?.click();
    await flush();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(field(host)?.value).toBe("changed\n");

    field(host)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    buttonNamed(document.body, "Discard edits")?.click();
    await flush();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
