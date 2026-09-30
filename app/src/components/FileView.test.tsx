import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileAtRevision } from "../ipc/bindings/FileAtRevision";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { FileViewTarget } from "../state/fileView";
import { FileView } from "./FileView";
import { flush, mountWithApp, stubLayout, testSession } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;
let calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe = () => undefined; unobserve = () => undefined; disconnect = () => undefined; });
  restoreLayout = stubLayout();
  calls = [];
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  restoreLayout?.();
  vi.unstubAllGlobals();
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const target: FileViewTarget = { file: "src/app.ts", rev: "abcdef1234567", source: "abcdef1" };

function mount(result: () => FileAtRevision, shown: FileViewTarget = target) {
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    return cmd === "file_at_revision" ? result() : null;
  });
  const closed = vi.fn();
  const mounted = mountWithApp(() => <FileView session={testSession("/r", { root: "/r" } as RepoSnapshot)} target={shown} onClose={closed} />);
  dispose = mounted.dispose;
  return { ...mounted, closed };
}

describe("file view", () => {
  it("reads the file at the revision and shows numbered, highlighted lines with the source and its size", async () => {
    const { host } = mount(() => ({ kind: "text", text: "const a = 1;\nreturn a;\n", size: 24, eol: "\n" }));
    await flush(80);

    expect(calls.find((call) => call.cmd === "file_at_revision")?.args).toEqual({ path: "/r", file: "src/app.ts", rev: "abcdef1234567" });
    const lines = [...host.querySelectorAll(".fline")];
    expect(lines.map((line) => [line.querySelector(".ln")?.textContent, line.querySelector(".code")?.textContent])).toEqual([["1", "const a = 1;"], ["2", "return a;"]]);
    expect(host.querySelector(".fline .syn-keyword")?.textContent).toBe("const");
    expect(host.querySelector(".crumbs")?.textContent).toContain("abcdef1");
    expect(host.querySelector(".crumbs")?.textContent).toContain("src/app.ts");
    expect(host.textContent).toContain("2 lines");
    expect(host.textContent).toContain("24 bytes");
    expect(host.textContent).toContain("LF");
  });

  it("names the line ending when the file uses CRLF, and keeps the lines free of the carriage return", async () => {
    const { host } = mount(() => ({ kind: "text", text: "a\r\nb\r\n", size: 6, eol: "\r\n" }));
    await flush(80);

    expect(host.textContent).toContain("CRLF");
    expect([...host.querySelectorAll(".fline .code")].map((code) => code.textContent)).toEqual(["a", "b"]);
  });

  it("shows plain lines for a file without a grammar", async () => {
    const { host } = mount(() => ({ kind: "text", text: "const a\n", size: 8, eol: "\n" }), { ...target, file: "notes.unknown" });
    await flush(80);

    expect(host.querySelector(".fline .code")?.textContent).toBe("const a");
    expect(host.querySelector(".fline [class*='syn-']")).toBeNull();
  });

  it("shows a placeholder with the size for a binary file", async () => {
    const { host } = mount(() => ({ kind: "binary", size: 2048 }));
    await flush(80);

    expect(host.querySelector(".fline")).toBeNull();
    expect(host.querySelector(".empty")?.textContent).toBe("Binary file, 2.0 KiB. There is no text view.");
  });

  it("says why a file over the limit is not shown, with its size, and offers the editor", async () => {
    const { host } = mount(() => {
      throw { kind: "file_too_large", message: "src/app.ts is too large", output: "3145728" };
    });
    await flush(80);

    expect(host.querySelector('[role="alert"]')?.textContent).toBe("This file is 3.0 MiB, over the 2.0 MiB limit of the file view. Open it in your editor instead.");
    host.querySelector<HTMLButtonElement>('button[aria-label="Open in editor"]')?.click();
    await flush();
    expect(calls.find((call) => call.cmd === "open_path")?.args).toEqual({ path: "/r/src/app.ts", with: "editor" });
  });

  it("shows another refusal as it is, such as a file that is not in that revision", async () => {
    const { host } = mount(() => {
      throw { kind: "invalid_request", message: "src/app.ts is not a file in that revision", output: null };
    });
    await flush(80);

    expect(host.querySelector('[role="alert"]')?.textContent).toBe("src/app.ts is not a file in that revision");
  });

  it("returns to the graph from the breadcrumb, the close button, and Escape", async () => {
    const { host, closed } = mount(() => ({ kind: "text", text: "a\n", size: 2, eol: "\n" }));
    await flush(80);

    host.querySelector<HTMLButtonElement>(".crumbs button")?.click();
    host.querySelector<HTMLButtonElement>('button[aria-label="Close file view"]')?.click();
    host.querySelector('[aria-label="File"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(closed).toHaveBeenCalledTimes(3);
  });
});
