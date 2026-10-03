import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FolderScan } from "../ipc/bindings/FolderScan";
import type { Repositories } from "../ipc/bindings/Repositories";
import type { ScannedFolder } from "../ipc/bindings/ScannedFolder";
import { ScanFolderDialog } from "./ScanFolderDialog";
import { buttonNamed, choose, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
  vi.restoreAllMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

const code: FolderScan = {
  root: "/u/Code",
  depth: 2,
  checked: 41,
  capped: false,
  found: [
    { path: "/u/Code/api", branch: "main", listed: true },
    { path: "/u/Code/cli", branch: "develop", listed: false },
    { path: "/u/Code/personal/notes", branch: "main", listed: false },
  ],
};

const saved: Repositories = { folders: [], repos: [] };

async function mount(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const onClose = vi.fn();
  const onAdded = vi.fn<(next: Repositories, text: string, folder: ScannedFolder) => void>();
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    return answer(call);
  });
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const view = mountWithApp(() => <ScanFolderDialog onClose={onClose} onAdded={onAdded} />);
  dispose = () => {
    view.dispose();
  };
  await flush();
  return { ...view, calls, onClose, onAdded, opener };
}

const field = () => document.querySelector<HTMLInputElement>('input[aria-label="Folder to scan"]');
const scan = async () => {
  buttonNamed(document.body, "Scan")?.click();
  await flush(40);
};

describe("Add a folder to scan (S46)", () => {
  it("starts on the folder field with 2 levels, and Scan stays off until a folder is given", async () => {
    await mount(() => null);

    expect(document.activeElement).toBe(field());
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    expect(document.querySelector('button[aria-label="Levels of folders to look inside"]')?.textContent).toContain("2 levels");
    expect(buttonNamed(document.body, "Scan")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("YForge only reads; nothing on disk changes.");
  });

  it("states the core's refusal and changes nothing", async () => {
    const { calls } = await mount((call) => {
      if (call.cmd === "folder_scan") throw { kind: "invalid_request", message: "There is no folder at /u/Cod.", output: null };
      return null;
    });
    type(field(), "/u/Cod");
    await scan();

    expect(document.querySelector('[role="alert"]')?.textContent).toBe("There is no folder at /u/Cod.");
    expect(calls.map((call) => call.cmd)).toEqual(["folder_scan"]);
  });

  it("scans with the chosen depth, ticks every new repository, marks listed ones, and adds only the ticked ones", async () => {
    const { calls, onAdded, onClose } = await mount((call) => (call.cmd === "folder_scan" ? code : call.cmd === "scan_folder_save" ? saved : null));
    type(field(), "/u/Code");
    await choose(document.body, "Levels of folders to look inside", "3 levels");
    await scan();

    expect(calls.find((call) => call.cmd === "folder_scan")?.args).toEqual({ root: "/u/Code", depth: 3 });
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Found 3 repositories in /u/Code · 41 folders checked, 2 levels deep");
    expect(document.querySelector(".scan-list li.listed")?.textContent).toContain("Already listed");
    expect(buttonNamed(document.body, "Add 2 repositories")).toBeDefined();

    document.querySelector<HTMLInputElement>('input[aria-label="Add notes"]')?.click();
    await flush();
    buttonNamed(document.body, "Add 1 repository")?.click();
    await flush(40);

    const folder = calls.find((call) => call.cmd === "scan_folder_save")?.args.folder as ScannedFolder;
    expect(folder).toMatchObject({ path: "/u/Code", depth: 2, repos: ["/u/Code/cli"], skipped: ["/u/Code/personal/notes"] });
    expect(onAdded).toHaveBeenCalledWith(saved, "Added 1 repository from /u/Code.", folder);
    expect(onClose).toHaveBeenCalled();
  });

  it("says when nothing was found and offers to look one level deeper", async () => {
    const { calls } = await mount((call) => {
      if (call.cmd !== "folder_scan") return null;
      const depth = (call.args as { depth: number }).depth;
      return depth === 2 ? { root: "/u/Downloads", depth, checked: 18, capped: false, found: [] } : { root: "/u/Downloads", depth, checked: 30, capped: false, found: [{ path: "/u/Downloads/a/b/kit", branch: "main", listed: false }] };
    });
    type(field(), "/u/Downloads");
    await scan();

    expect(document.body.textContent).toContain("No Git repositories in /u/Downloads");
    expect(document.body.textContent).toContain("Looked 2 levels deep in /u/Downloads and checked 18 folders. Nothing was added.");
    buttonNamed(document.body, "Look 3 levels deep")?.click();
    await flush(40);

    expect(calls.filter((call) => call.cmd === "folder_scan").map((call) => call.args.depth)).toEqual([2, 3]);
    expect(document.querySelectorAll(".scan-list li")).toHaveLength(1);
  });

  it("fills the folder from Choose… and closes with Esc, returning focus", async () => {
    const { onClose, opener } = await mount((call) => (call.cmd === "plugin:dialog|open" ? "/u/Code" : null));
    buttonNamed(document.body, "Choose…")?.click();
    await flush(40);
    expect(field()?.value).toBe("/u/Code");

    field()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    expect(onClose).toHaveBeenCalled();
    dispose?.();
    dispose = undefined;
    expect(document.activeElement).toBe(opener);
  });
});
