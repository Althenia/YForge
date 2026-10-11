import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileAtRevision } from "../ipc/bindings/FileAtRevision";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import type { FileViewTarget } from "../state/fileView";
import { FileView } from "./FileView";
import { flush, mountWithApp, stubLayout, testSession } from "./testkit";

let dispose: (() => void) | undefined;
let restoreLayout: (() => void) | undefined;
let calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
let stylesheet: HTMLStyleElement;

beforeAll(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = ["tokens.css", "app.css", "markdown.css"].map((name) => readFileSync(resolve(import.meta.dirname, "../styles", name), "utf8")).join("\n");
  document.head.append(stylesheet);
});

afterAll(() => stylesheet.remove());

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
  vi.restoreAllMocks();
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const target: FileViewTarget = { file: "src/app.ts", rev: "abcdef1234567", source: "abcdef1" };

function mount(result: (file: string) => FileAtRevision, shown: FileViewTarget = target) {
  mockIPC((cmd, args) => {
    calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
    if (cmd === "file_at_revision") return result((args as { file: string }).file);
    if (cmd === "preview_start") return ["preview-token", `http://127.0.0.1:4321/preview-token/${(args as { file: string }).file}`];
    return null;
  });
  const closed = vi.fn();
  const mounted = mountWithApp(() => <FileView session={testSession("/r", { root: "/r" } as RepoSnapshot)} target={shown} onClose={closed} />);
  dispose = mounted.dispose;
  return { ...mounted, closed };
}

describe("file view", () => {
  it("renders collapsed front matter, a GFM table, a word-labelled alert and a local heading anchor", async () => {
    const text = "---\nname: Forge\n---\n\n[Jump](#notes)\n\n# Notes\n\n| Key | Value |\n| --- | --- |\n| Name | Forge |\n\n> [!NOTE]\n> Read this";
    const { host } = mount(() => ({ kind: "text", text, size: text.length, eol: "\n" }), { ...target, file: "README.md" });
    await flush(80);
    expect(host.querySelector("details summary")?.textContent).toBe("Front matter");
    expect(host.querySelector<HTMLDetailsElement>("details")?.open).toBe(false);
    expect(host.querySelector("td")?.textContent).toBe("Name");
    expect(host.querySelector(".markdown-alert-title")?.textContent).toBe("Note");
    expect(getComputedStyle(host.querySelector("article")!).cursor).toBe("var(--cursors-text)");
    expect(getComputedStyle(host.querySelector("summary")!).cursor).toBe("var(--cursors-action)");
    expect(getComputedStyle(host.querySelector('a[href="#notes"]')!).cursor).toBe("var(--cursors-action)");
    const heading = host.querySelector<HTMLElement>("h1#notes");
    expect(heading).not.toBeNull();
    const scroll = vi.fn();
    if (heading) heading.scrollIntoView = scroll;
    host.querySelector<HTMLAnchorElement>('a[href="#notes"]')?.click();
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
  });

  it("opens a relative file in this view at the same revision and keeps an external link non-navigable", async () => {
    const text = "[File](../src/app.ts) [Visit](https://example.test/path)";
    const { host } = mount(() => ({ kind: "text", text, size: text.length, eol: "\n" }), { ...target, file: "docs/README.md" });
    await flush(80);
    const external = [...host.querySelectorAll<HTMLAnchorElement>("article a")].find((link) => link.textContent === "Visit");
    expect(external?.hasAttribute("href")).toBe(false);
    expect(external?.title).toBe("https://example.test/path");
    expect(getComputedStyle(external!).cursor).toBe("var(--cursors-text)");
    [...host.querySelectorAll<HTMLAnchorElement>("article a")].find((link) => link.textContent === "File")?.click();
    await flush(80);
    expect(calls.some((call) => call.cmd === "file_at_revision" && call.args.file === "src/app.ts" && call.args.rev === target.rev)).toBe(true);
    expect(host.querySelector(".crumbs .path")?.textContent).toBe("src/app.ts");
  });

  it("scrolls to the fragment after opening another Markdown file at the same revision", async () => {
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const { host } = mount((file) => {
        const text = file === "docs/README.md" ? "[Other](other.md#notes)" : "# Notes\n\nContent";
        return { kind: "text", text, size: text.length, eol: "\n" };
      }, { ...target, file: "docs/README.md" });
      await flush(80);
      host.querySelector<HTMLAnchorElement>("article a")?.click();
      await flush(80);
      expect(host.querySelector(".crumbs .path")?.textContent).toBe("docs/other.md");
      expect(host.querySelector("h1#notes")?.textContent).toBe("Notes");
      expect(scroll).toHaveBeenCalledWith({ block: "start" });
      expect(scroll.mock.contexts).toContain(host.querySelector("h1#notes"));
    } finally { delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; }
  });

  it("scrolls to a fragment carried by the initial file view target", async () => {
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      const text = "# Notes\n\nContent";
      mount(() => ({ kind: "text", text, size: text.length, eol: "\n" }), { ...target, file: "README.md", fragment: "notes" });
      await flush(80);
      expect(scroll).toHaveBeenCalledWith({ block: "start" });
    } finally { delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; }
  });

  it("previews a binary image from the selected revision and stops the server when closed", async () => {
    const { host } = mount(() => ({ kind: "binary", size: 1024 }), { ...target, file: "assets/logo.png" });
    await flush(80);

    expect(host.querySelector<HTMLImageElement>('.file-preview img')?.src).toBe("http://127.0.0.1:4321/preview-token/assets/logo.png");
    expect(calls.find((call) => call.cmd === "preview_start")?.args).toEqual({ path: "/r", file: "assets/logo.png", rev: target.rev });
    dispose?.();
    dispose = undefined;
    await flush();
    expect(calls.find((call) => call.cmd === "preview_stop")?.args).toEqual({ id: "preview-token" });
  });

  it("renders Markdown as sanitized content with local revision images and allows source view", async () => {
    const { host } = mount(() => ({ kind: "text", text: "# Notes\n\n**Bold** <script>bad()</script> ![Logo](assets/logo.png)", size: 70, eol: "\n" }), { ...target, file: "README.md" });
    await flush(80);

    expect(host.querySelector('.file-preview h1')?.textContent).toBe("Notes");
    expect(host.querySelector('.file-preview strong')?.textContent).toBe("Bold");
    expect(host.querySelector('.file-preview script')).toBeNull();
    expect(host.querySelector<HTMLImageElement>('.file-preview img')?.src).toBe("http://127.0.0.1:4321/preview-token/assets/logo.png");
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === "Source")?.click();
    await flush();
    expect(host.querySelector('.fline .code')?.textContent).toBe("# Notes");
    expect(calls.some((call) => call.cmd === "preview_stop")).toBe(true);
  });

  it("refuses external and unsupported Markdown asset and link schemes", async () => {
    const text = "![External](https://example.test/pixel.png) ![Local file](file:///etc/hosts) [Visit](https://example.test/) <img src='javascript:bad()'>";
    const { host } = mount(() => ({ kind: "text", text, size: text.length, eol: "\n" }), { ...target, file: "README.md" });
    await flush(80);

    expect([...host.querySelectorAll('.file-preview img')].every((image) => !image.hasAttribute("src"))).toBe(true);
    expect(host.querySelector('.file-preview a')?.hasAttribute("href")).toBe(false);
  });

  it("isolates HTML in a script-only sandbox while its revision-relative assets use the preview server", async () => {
    const { host } = mount(() => ({ kind: "text", text: "<script src='app.js'></script>", size: 31, eol: "\n" }), { ...target, file: "pages/index.html" });
    await flush(80);

    const frame = host.querySelector<HTMLIFrameElement>('.file-preview iframe');
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.src).toBe("http://127.0.0.1:4321/preview-token/pages/index.html");
    expect(host.querySelector('.file-preview script')).toBeNull();
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === "Source")?.click();
    await flush();
    expect(host.querySelector('.fline .code')?.textContent).toContain("script src");
  });
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
