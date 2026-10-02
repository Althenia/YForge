import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { Submodule } from "../ipc/bindings/Submodule";
import { SubmoduleSection } from "./Submodules";
import { buttonNamed, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

const row = (overrides: Partial<Submodule> & Pick<Submodule, "path" | "status">): Submodule => ({
  name: overrides.path,
  url: "git@example.com:sample/theme.git",
  branch: null,
  recorded: "9f0e1aa000000000000000000000000000000000",
  checked_out: "9f0e1aa000000000000000000000000000000000",
  ...overrides,
});

const listed = [
  row({ path: "vendor/core", status: "current", url: "git@example.com:sample/core.git", recorded: "a1b2c3d000000000000000000000000000000000", checked_out: "a1b2c3d000000000000000000000000000000000" }),
  row({ path: "vendor/theme", status: "dirty", branch: "main", checked_out: "c4d5e6f000000000000000000000000000000000" }),
  row({ path: "ext/docs", status: "uninitialized", url: "git@example.com:sample/docs.git", recorded: "1122334000000000000000000000000000000000", checked_out: null }),
];

function mount(rows: Submodule[] = listed) {
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    if (cmd === "submodule_list") return rows;
    if (cmd === "repo_open") return { root: call.args.path, head: { kind: "branch", name: "main" } };
    if (cmd === "recent_add") return [];
    if (cmd === "session_save") return null;
    return null;
  });
  const mounted = mountWithApp(() => <SubmoduleSection root="/work/app" expanded filter="" onToggle={() => undefined} />);
  dispose = mounted.dispose;
  return { ...mounted, calls };
}

const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes(label));

const openMenu = async (host: ParentNode, path: string) => {
  const row = host.querySelector(`[data-nav="submodule:${path}"]`);
  row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 8, clientY: 12 }));
  await flush();
};

describe("submodules", () => {
  it("lists status words and the recorded and checked-out commits", async () => {
    const { host } = mount();
    await flush();

    expect(host.querySelector('[data-nav="submodule:vendor/core"]')?.textContent).toContain("current");
    expect(host.querySelector('[data-nav="submodule:vendor/core"]')?.textContent).toContain("a1b2c3d");
    expect(host.querySelector('[data-nav="submodule:vendor/theme"]')?.textContent).toContain("dirty");
    expect(host.querySelector('[data-nav="submodule:vendor/theme"]')?.textContent).toContain("recorded 9f0e1aa");
    expect(host.querySelector('[data-nav="submodule:vendor/theme"]')?.textContent).toContain("checked out c4d5e6f");
    expect(host.querySelector('[data-nav="submodule:ext/docs"]')?.textContent).toContain("uninitialized");
    expect(host.textContent).toContain("Update on fetch is off");
    expect(host.querySelector('button[aria-label="Update on fetch"]')?.getAttribute("aria-checked")).toBe("false");
  });

  it("adds a submodule without turning update on fetch on", async () => {
    const { host, calls } = mount([]);
    await flush();

    expect(host.textContent).toContain("No submodules");
    host.querySelector<HTMLButtonElement>('button[aria-label="Add submodule"]')?.click();
    await flush();
    type(document.querySelector<HTMLInputElement>('input[aria-label="Submodule path"]'), "vendor/icons");
    type(document.querySelector<HTMLInputElement>('input[aria-label="Submodule URL"]'), "git@example.com:sample/icons.git");
    expect(host.textContent).toContain("The parent stores one commit, not a copy of the history. Update on fetch starts off.");
    buttonNamed(document.body, "Add")?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "submodule_add")?.args).toEqual({
      path: "/work/app",
      url: "git@example.com:sample/icons.git",
      submodulePath: "vendor/icons",
      branch: null,
    });
    expect(calls.some((call) => call.cmd === "repo_settings_save")).toBe(false);
  });

  it("saves update on fetch only when the switch is turned on", async () => {
    const { host, calls } = mount([]);
    await flush();

    host.querySelector<HTMLButtonElement>('button[aria-label="Update on fetch"]')?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "repo_settings_save")?.args.settings).toEqual({
      pull_mode: null,
      ssh_key_path: null,
      submodule_update_on_fetch: true,
    });
  });

  it("deinits after naming the checkout and the gitlink, and stages only the pointer", async () => {
    const { host, calls } = mount();
    await flush();

    await openMenu(host, "vendor/theme");
    menuItem("Deinit…")?.click();
    await flush();
    expect(document.body.textContent).toContain("Deinit removes the checkout at vendor/theme. The gitlink stays in the index until you commit that change. Files inside the submodule are not staged.");
    buttonNamed(document.body, "Deinit")?.click();
    await flush();
    expect(calls.find((call) => call.cmd === "submodule_deinit")?.args).toEqual({ path: "/work/app", submodulePath: "vendor/theme" });

    await openMenu(host, "vendor/theme");
    menuItem("Stage pointer")?.click();
    await flush();
    expect(calls.find((call) => call.cmd === "submodule_stage")?.args).toEqual({ path: "/work/app", submodulePath: "vendor/theme" });
    expect(calls.some((call) => call.cmd === "stage_files")).toBe(false);
  });

  it("opens a checked-out submodule as a tab and keeps that action off until init", async () => {
    const { host, calls } = mount();
    await flush();

    await openMenu(host, "vendor/core");
    menuItem("Open as tab")?.click();
    await flush();
    expect(calls.find((call) => call.cmd === "repo_open")?.args.path).toBe("/work/app/vendor/core");

    await openMenu(host, "ext/docs");
    expect(menuItem("Init")?.getAttribute("aria-disabled")).toBeNull();
    expect(menuItem("Open as tab")?.getAttribute("aria-disabled")).toBe("true");
    expect(menuItem("Stage pointer")?.getAttribute("title")).toBe("Nothing to stage until the submodule is checked out");
    menuItem("Open as tab")?.click();
    await flush();
    expect(calls.filter((call) => call.cmd === "repo_open").map((call) => call.args.path)).toEqual(["/work/app/vendor/core"]);
  });
});
