import { render } from "solid-js/web";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileEditor } from "./FileEditor";
import { buttonNamed, flush } from "./testkit";

let dispose: (() => void) | undefined;

beforeEach(() => {
  mockWindows("main");
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => ({ length: 0, item: () => null }) });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: () => new DOMRect() });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  clearMocks();
  delete (Range.prototype as unknown as Record<string, unknown>).getClientRects;
  delete (Range.prototype as unknown as Record<string, unknown>).getBoundingClientRect;
});

const target = { file: "src/a.txt", text: "one\r\ntwo\r\n", eol: "\r\n", size: 10 };

function mount(overrides: { save?: (file: string, text: string, eol: string) => Promise<boolean>; onClose?: () => void; servers?: Record<string, string> } = {}) {
  const save = overrides.save ?? vi.fn(async () => true);
  const onClose = overrides.onClose ?? vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <FileEditor target={target} repoPath="/r" servers={overrides.servers ?? {}} save={save} onClose={onClose} />, host);
  return { host, save, onClose };
}

const field = (host: ParentNode) => host.querySelector<HTMLElement>('.cm-content[aria-label="File content"]');
const view = (host: ParentNode) => EditorView.findFromDOM(host.querySelector<HTMLElement>(".cm-editor") as HTMLElement) as EditorView;
const textOf = (host: ParentNode) => view(host).state.doc.toString();
const typeInto = (host: ParentNode, text: string) => view(host).dispatch({ changes: { from: 0, to: view(host).state.doc.length, insert: text } });

describe("FileEditor", () => {
  it("locks the editor and close action during save, then restores editing after a failed save", async () => {
    let rejectSave: ((reason: Error) => void) | undefined;
    const save = vi.fn(() => new Promise<boolean>((_, reject) => { rejectSave = reject; }));
    const { host, onClose } = mount({ save });
    typeInto(host, "changed");
    buttonNamed(host, "Save")?.click();
    await flush();

    expect(buttonNamed(host, "Saving…")).not.toBeNull();
    expect(field(host)?.getAttribute("contenteditable")).toBe("false");
    buttonNamed(host, "Close")?.click();
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    rejectSave?.(new Error("Disk is full"));
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Disk is full");
    expect(field(host)?.getAttribute("contenteditable")).toBe("true");
    expect(buttonNamed(host, "Save")).not.toBeNull();
  });
  it("starts only a configured installed language server on request and stops it from the editor", async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      if (cmd === "lsp_start") return { id: "lsp-1", root_uri: "file:///r/", file_uri: "file:///r/src/a.txt", language_id: "text" };
      return null;
    });
    const { host } = mount({ servers: { txt: "/bin/cat" } });
    expect(calls).not.toContain("lsp_start");
    buttonNamed(host, "Start language server")?.click();
    await flush(80);

    expect(calls).toContain("lsp_start");
    expect(host.textContent).toContain("Connecting to language server");
    buttonNamed(host, "Stop language server")?.click();
    await flush(80);
    expect(calls).toContain("lsp_stop");
  });

  it("stops an active language server when the editor is closed", async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      if (cmd === "lsp_start") return { id: "lsp-2", root_uri: "file:///r/", file_uri: "file:///r/src/a.txt", language_id: "text" };
      return null;
    });
    const mounted = mount({ servers: { txt: "/bin/cat" } });
    buttonNamed(mounted.host, "Start language server")?.click();
    await flush(80);
    dispose?.();
    dispose = undefined;
    await flush(80);

    expect(calls).toContain("lsp_stop");
  });

  it("offers definition and references after an LSP initialize response", async () => {
    mockIPC((cmd, args) => {
      if (cmd === "lsp_start") return { id: "lsp-ready", root_uri: "file:///r/", file_uri: "file:///r/src/a.txt", language_id: "text" };
      if (cmd === "lsp_send") {
        const request = JSON.parse((args as { body: string }).body) as { method?: string; id?: number };
        if (request.method === "initialize") queueMicrotask(() => void emit("lsp-message", { id: "lsp-ready", body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { capabilities: { textDocumentSync: 1, definitionProvider: true, referencesProvider: true, hoverProvider: true, completionProvider: {} } } }) }));
      }
      return null;
    }, { shouldMockEvents: true });
    const { host } = mount({ servers: { txt: "/bin/cat" } });
    buttonNamed(host, "Start language server")?.click();
    await vi.waitFor(() => expect(host.textContent).toContain("Language server ready"));
    expect(buttonNamed(host, "Definition")).not.toBeNull();
    expect(buttonNamed(host, "References")).not.toBeNull();
  });
  it("offers an owned code editor with a toggleable Vim mode without closing on Vim Escape", async () => {
    const { host, onClose } = mount();
    expect(host.querySelector(".cm-editor .cm-content[contenteditable]")).not.toBeNull();
    const toggle = buttonNamed(host, "Vim");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    toggle?.click();
    await flush();
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    const content = host.querySelector<HTMLElement>(".cm-content");
    content?.dispatchEvent(new KeyboardEvent("keydown", { key: "i", bubbles: true, cancelable: true }));
    await flush();
    expect(host.querySelector(".cm-vim-panel")?.textContent?.toUpperCase()).toContain("INSERT");
    content?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();
    expect(host.querySelector(".cm-vim-panel")?.textContent?.toUpperCase()).toContain("NORMAL");
    content?.dispatchEvent(new KeyboardEvent("keydown", { key: "v", bubbles: true, cancelable: true }));
    await flush();
    expect(host.querySelector(".cm-vim-panel")?.textContent?.toUpperCase()).toContain("VISUAL");
    expect(onClose).not.toHaveBeenCalled();
  });
  it("opens the file in the owned code editor with its path, line ending, and nothing to save yet", () => {
    const { host } = mount();

    expect(host.querySelector('section[aria-label="Edit file"]')).not.toBeNull();
    expect(host.querySelector(".path")?.textContent).toBe("src/a.txt");
    expect(textOf(host)).toBe("one\ntwo\n");
    expect(field(host)?.getAttribute("contenteditable")).toBe("true");
    expect(host.textContent).toContain("CRLF");
    expect(buttonNamed(host, "Save")?.getAttribute("aria-disabled")).toBe("true");
    expect(buttonNamed(host, "Save")?.getAttribute("data-tip")).toBe("There are no unsaved changes");
    expect(host.textContent).not.toContain("Unsaved changes");
  });

  it("saves the edited text with the file's line ending from the Save button and clears the unsaved state", async () => {
    const { host, save } = mount();

    typeInto(host, "one\nTWO\nthree\n");
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
    typeInto(host, "changed\n");
    await flush();
    press();
    await flush();

    expect(save).toHaveBeenCalledWith("src/a.txt", "changed\n", "\r\n");
  });

  it("keeps the edits unsaved when saving fails", async () => {
    const { host } = mount({ save: vi.fn(async () => false) });

    typeInto(host, "changed\n");
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
    typeInto(host, "changed\n");
    await flush();

    buttonNamed(host, "Close")?.click();
    await flush();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.querySelector("h3")?.textContent).toBe("Discard unsaved edits to src/a.txt?");
    expect(onClose).not.toHaveBeenCalled();
    buttonNamed(document.body, "Cancel")?.click();
    await flush();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(textOf(host)).toBe("changed\n");

    field(host)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    buttonNamed(document.body, "Discard edits")?.click();
    await flush();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
