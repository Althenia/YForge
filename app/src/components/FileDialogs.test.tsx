import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateFileDialog, FilePickerDialog } from "./FileDialogs";
import { buttonNamed, choose, flush, type as typeInto } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

function mount(view: () => import("solid-js").JSX.Element): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(view, host);
  return host;
}

describe("CreateFileDialog", () => {
  it("creates the typed repository-relative path and keeps Create unavailable while the path is blank", async () => {
    const submit = vi.fn(async () => undefined);
    const host = mount(() => <CreateFileDialog submit={submit} onClose={() => undefined} />);

    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    expect(buttonNamed(host, "Create")?.getAttribute("aria-disabled")).toBe("true");
    buttonNamed(host, "Create")?.click();
    await flush();
    expect(submit).not.toHaveBeenCalled();

    typeInto(host.querySelector<HTMLInputElement>('input[aria-label="Path"]'), "src/new/file.txt");
    await flush();
    expect(buttonNamed(host, "Create")?.getAttribute("aria-disabled")).toBeNull();
    buttonNamed(host, "Create")?.click();
    await flush();

    expect(submit).toHaveBeenCalledWith("src/new/file.txt");
  });

  it("shows the refusal as text, keeps the dialog open, and clears it when the path changes", async () => {
    const closed = vi.fn();
    const submit = vi.fn(async () => "Invalid request: a.txt already exists");
    const host = mount(() => <CreateFileDialog submit={submit} onClose={closed} />);

    typeInto(host.querySelector<HTMLInputElement>('input[aria-label="Path"]'), "a.txt");
    await flush();
    buttonNamed(host, "Create")?.click();
    await flush();

    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Invalid request: a.txt already exists");
    expect(host.querySelector('input[aria-label="Path"]')?.getAttribute("aria-invalid")).toBe("true");
    expect(closed).not.toHaveBeenCalled();
    typeInto(host.querySelector<HTMLInputElement>('input[aria-label="Path"]'), "b.txt");
    await flush();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("closes on Cancel and on Escape", async () => {
    const closed = vi.fn();
    const host = mount(() => <CreateFileDialog submit={async () => undefined} onClose={closed} />);

    buttonNamed(host, "Cancel")?.click();
    host.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(closed).toHaveBeenCalledTimes(2);
  });
});

describe("FilePickerDialog", () => {
  it("chooses a file through the owned Select and hands it back", async () => {
    const chosen = vi.fn();
    const host = mount(() => <FilePickerDialog purpose="edit" files={["a.txt", "src/b.ts"]} onChoose={chosen} onClose={() => undefined} />);

    expect(host.querySelector("h3")?.textContent).toBe("Edit file");
    expect(host.querySelector("select")).toBeNull();
    expect(buttonNamed(host, "Edit")?.getAttribute("aria-disabled")).toBe("true");
    await choose(host, "File", "src/b.ts");
    expect(buttonNamed(host, "Edit")?.getAttribute("aria-disabled")).toBeNull();
    buttonNamed(host, "Edit")?.click();

    expect(chosen).toHaveBeenCalledWith("src/b.ts");
  });

  it("words each purpose and states when there are no files", async () => {
    const view = mount(() => <FilePickerDialog purpose="view" files={[]} onChoose={() => undefined} onClose={() => undefined} />);
    expect(view.querySelector("h3")?.textContent).toBe("View file");
    expect(view.textContent).toContain("This repository has no files.");
    expect(buttonNamed(view, "View")?.getAttribute("aria-disabled")).toBe("true");
    dispose?.();
    document.body.innerHTML = "";

    const remove = mount(() => <FilePickerDialog purpose="delete" files={["a.txt"]} onChoose={() => undefined} onClose={() => undefined} />);
    expect(remove.querySelector("h3")?.textContent).toBe("Delete file");
    expect(buttonNamed(remove, "Continue")).toBeDefined();
  });

  it("does not choose while no file is selected", async () => {
    const chosen = vi.fn();
    const host = mount(() => <FilePickerDialog purpose="delete" files={["a.txt"]} onChoose={chosen} onClose={() => undefined} />);

    buttonNamed(host, "Continue")?.click();
    await flush();

    expect(chosen).not.toHaveBeenCalled();
  });
});
