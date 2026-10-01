import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { Suspense } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHost } from "../ipc/bindings/GitHost";
import type { GitHostDraft } from "../ipc/bindings/GitHostDraft";
import { GitHostsSettings } from "./GitHostsSettings";
import { buttonNamed, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;
const writeText = vi.fn(async (_text: string) => undefined);

beforeEach(() => {
  mockWindows("main");
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

const identity = (overrides: Partial<GitHost> = {}): GitHost => ({
  id: "h1",
  host: "gitlab.corp-a.com",
  ssh_key_path: "/Users/you/.ssh/yforge_gitlab.corp-a.com",
  https_user: "you",
  key_kind: "ed25519",
  key_fingerprint: "SHA256:q4VdAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAT1o",
  has_public_key: true,
  ...overrides,
});

const corpA = identity();
const corpB = identity({ id: "h2", host: "gitlab.corp-b.com:2222", ssh_key_path: "/Users/you/.ssh/id_corp_b", https_user: "you", key_kind: "ed25519", key_fingerprint: null, has_public_key: false });
const github = identity({ id: "h3", host: "github.com", ssh_key_path: null, key_kind: null, key_fingerprint: null, has_public_key: false });

const EXISTING_FILE = { title: "A file already exists there", detail: "YForge never overwrites a key. Choose another path, or pick that file with Choose key file…" };
const PUBLIC_KEY = { title: "That is a public key", detail: "Choose the private key file (usually the same name without .pub). Nothing was saved." };

async function mount(initial: GitHost[], respond: (call: Call) => unknown = () => undefined) {
  const calls: Call[] = [];
  let list = initial;
  mockIPC(
    (cmd, args) => {
      const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
      calls.push(call);
      const custom = respond(call);
      if (custom instanceof Error) throw { kind: "invalid_request", message: custom.message, output: null };
      if (custom !== undefined) {
        if (cmd === "git_host_save") list = call.args.id === null ? [...list, custom as GitHost] : list.map((entry) => (entry.id === call.args.id ? (custom as GitHost) : entry));
        return custom;
      }
      switch (cmd) {
        case "git_hosts_list":
          return list;
        case "git_host_field_problem": {
          const { field, value } = call.args as { field: string; value: string };
          if (field === "host") return value.trim() === "" ? { title: "Enter the host name, such as gitlab.corp-a.com", detail: null } : null;
          if (field === "new_key") return value.endsWith("taken") ? EXISTING_FILE : value.endsWith("/file/child") ? { title: "The parent of that path is not a folder", detail: null } : null;
          return value.endsWith(".pub") ? PUBLIC_KEY : null;
        }
        case "git_host_default_key_path": {
          return `~/.ssh/yforge_${String(call.args.host).replace(/:\d+$/, "")}`;
        }
        case "git_host_remove":
          list = list.filter((entry) => entry.id !== call.args.id);
          return null;
        case "ssh_public_key":
          return "ssh-ed25519 AAAAC3Nza yforge@gitlab.corp-a.com";
        case "plugin:path|resolve_directory":
          return "/Users/you";
        default:
          return undefined;
      }
    },
    { shouldMockEvents: true },
  );
  const view = mountWithApp(() => (
    <Suspense fallback={<p>Loading the page…</p>}>
      <GitHostsSettings />
    </Suspense>
  ));
  dispose = view.dispose;
  await flush(40);
  return { ...view, calls };
}

const input = (host: ParentNode, label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
const card = (host: ParentNode, name: string) => host.querySelector<HTMLElement>(`section[aria-label="${name}"]`);
const saves = (calls: Call[]) => calls.filter((call) => call.cmd === "git_host_save");
const iconButton = (host: ParentNode, label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe("Settings → Git hosts", () => {
  it("says it is loading until the identities arrive", async () => {
    const calls: Call[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      if (cmd === "plugin:path|resolve_directory") return "/Users/you";
      return cmd === "git_hosts_list" ? new Promise(() => undefined) : undefined;
    });
    const view = mountWithApp(() => (
    <Suspense fallback={<p>Loading the page…</p>}>
      <GitHostsSettings />
    </Suspense>
  ));
    dispose = view.dispose;
    await flush(40);

    const status = view.host.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Loading Git hosts…");
    expect(status?.getAttribute("aria-busy")).toBe("true");
  });

  it("explains the empty state and how an identity is chosen", async () => {
    const { host } = await mount([]);

    expect(host.textContent).toContain("No host identities yet.");
    expect(host.textContent).toContain("Add a host to use a different key or HTTPS user name per server.");
    expect([...host.querySelectorAll(".order li")].map((item) => item.textContent)).toEqual([
      "The repository's own SSH key (Repository settings)",
      "The identity whose host matches the remote URL",
      "The app-wide SSH key (General)",
      "Your SSH agent and ~/.ssh/config",
    ]);
    expect(buttonNamed(host, "Add host")?.classList.contains("primary")).toBe(true);
    expect(host.querySelector("select, option, textarea")).toBeNull();
  });

  it("lists each identity with its key, fingerprint, and HTTPS user, or says the agent is used", async () => {
    const { host } = await mount([corpA, corpB, github]);

    expect([...host.querySelectorAll("section.card strong")].map((name) => name.textContent)).toEqual(["gitlab.corp-a.com", "gitlab.corp-b.com:2222", "github.com"]);
    expect(card(host, "gitlab.corp-a.com")?.querySelector(".kv")?.textContent).toContain("~/.ssh/yforge_gitlab.corp-a.com · ed25519 · SHA256:q4Vd…T1o");
    expect(card(host, "gitlab.corp-a.com")?.querySelector(".kv")?.textContent).toContain("you");
    expect(card(host, "gitlab.corp-b.com:2222")?.querySelector(".kv")?.textContent).toContain("~/.ssh/id_corp_b");
    expect(card(host, "github.com")?.querySelector(".kv")?.textContent).toContain("None: uses your SSH agent and ~/.ssh/config");
    expect(host.textContent).toContain("HTTPS passwords and tokens are kept by Git's credential helper");
    expect(buttonNamed(host, "Add host")?.classList.contains("primary")).toBe(false);
  });

  it("names every icon-only control and offers Copy public key only where a .pub exists", async () => {
    const { host } = await mount([corpA, corpB, github]);

    for (const name of ["gitlab.corp-a.com", "gitlab.corp-b.com:2222", "github.com"]) {
      expect(iconButton(host, `Edit ${name}`)?.dataset.tip).toBe("Edit");
      expect(iconButton(host, `Remove ${name}`)?.dataset.tip).toBe("Remove");
    }
    expect(iconButton(host, "Copy public key for gitlab.corp-a.com")?.dataset.tip).toBe("Copy public key");
    expect(iconButton(host, "Copy public key for gitlab.corp-b.com:2222")).toBeNull();
    expect(iconButton(host, "Copy public key for github.com")).toBeNull();
  });

  it("copies the .pub text and states Copied", async () => {
    const { host, calls } = await mount([corpA]);

    iconButton(host, "Copy public key for gitlab.corp-a.com")?.click();
    await flush(40);

    expect(calls.find((call) => call.cmd === "ssh_public_key")?.args).toEqual({ path: "/Users/you/.ssh/yforge_gitlab.corp-a.com" });
    expect(writeText).toHaveBeenCalledWith("ssh-ed25519 AAAAC3Nza yforge@gitlab.corp-a.com");
    const copied = card(host, "gitlab.corp-a.com")?.querySelector('[role="status"]');
    expect(copied?.textContent).toContain("Copied the public key.");
    expect(copied?.textContent).toContain("Add it to your account on gitlab.corp-a.com.");
  });

  it("reports a public key that cannot be read instead of saying Copied", async () => {
    const { host } = await mount([corpA], (call) => (call.cmd === "ssh_public_key" ? new Error("there is no public key next to this key") : undefined));

    iconButton(host, "Copy public key for gitlab.corp-a.com")?.click();
    await flush(40);

    expect(writeText).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("there is no public key next to this key");
    expect(host.textContent).not.toContain("Copied");
  });

  it("adds a host with its key file and HTTPS user, then lists it", async () => {
    const saved = identity({ id: "h9", host: "gitlab.corp-b.com:2222", ssh_key_path: "/keys/id_corp_b", https_user: "you", key_kind: null, key_fingerprint: null, has_public_key: false });
    const { host, calls } = await mount([], (call) => {
      if (call.cmd === "plugin:dialog|open") return "/keys/id_corp_b";
      if (call.cmd === "git_host_save") return saved;
      return undefined;
    });

    buttonNamed(host, "Add host")?.click();
    await flush();
    expect(host.querySelector("h3")?.textContent).toBe("Add host");
    expect(buttonNamed(host, "Save host")?.getAttribute("aria-disabled")).toBe("true");
    type(input(host, "Host"), "gitlab.corp-b.com:2222");
    type(input(host, "HTTPS user name (optional)"), "you");
    buttonNamed(host, "Choose key file…")?.click();
    await flush(40);

    expect(input(host, "SSH key")?.value).toBe("/keys/id_corp_b");
    expect(calls.find((call) => call.cmd === "plugin:dialog|open")?.args.options).toMatchObject({ directory: false, defaultPath: "/Users/you/.ssh" });
    expect(buttonNamed(host, "Save host")?.getAttribute("aria-disabled")).toBe("false");
    buttonNamed(host, "Save host")?.click();
    await flush(40);

    expect(saves(calls).map((call) => call.args)).toEqual([{ id: null, draft: { host: "gitlab.corp-b.com:2222", ssh_key_path: "/keys/id_corp_b", https_user: "you" } satisfies GitHostDraft }]);
    expect(host.querySelector("section.card strong")?.textContent).toBe("gitlab.corp-b.com:2222");
    expect(host.querySelector("form")).toBeNull();
  });

  it("requires a host and states what to enter", async () => {
    const { host, calls } = await mount([]);

    buttonNamed(host, "Add host")?.click();
    await flush();
    type(input(host, "Host"), "  ");
    await flush(40);

    expect(host.textContent).toContain("Enter the host name, such as gitlab.corp-a.com");
    expect(input(host, "Host")?.getAttribute("aria-invalid")).toBe("true");
    buttonNamed(host, "Save host")?.click();
    await flush();
    expect(saves(calls)).toEqual([]);
  });

  it("prefills the new key file with ~/.ssh/yforge_<host> without the port and follows the host until the path is edited", async () => {
    const { host } = await mount([]);
    buttonNamed(host, "Add host")?.click();
    await flush();
    expect(input(host, "New key file")?.value).toBe("");

    type(input(host, "Host"), "gitlab.corp-b.com:2222");
    await flush(60);
    expect(input(host, "New key file")?.value).toBe("~/.ssh/yforge_gitlab.corp-b.com");
    type(input(host, "Host"), "github.com");
    await flush(60);
    expect(input(host, "New key file")?.value).toBe("~/.ssh/yforge_github.com");
    type(input(host, "New key file"), "~/keys/mine");
    type(input(host, "Host"), "gitlab.corp-a.com");
    await flush(60);

    expect(input(host, "New key file")?.value).toBe("~/keys/mine");
  });

  it("keeps the typing cursor in the Host and New key file inputs while their problems and defaults load", async () => {
    const { host } = await mount([]);
    buttonNamed(host, "Add host")?.click();
    await flush();
    const hostInput = input(host, "Host");
    hostInput?.focus();

    type(hostInput, "g");
    await flush(60);

    expect(input(host, "Host")).toBe(hostInput);
    expect(document.activeElement).toBe(hostInput);
    const newKeyInput = input(host, "New key file");
    newKeyInput?.focus();
    type(newKeyInput, "~/keys/mine");
    await flush(60);
    expect(document.activeElement).toBe(newKeyInput);
  });

  it("generates an ed25519 key at the edited path with a passphrase, names the file it writes, selects the key, and says the passphrase went to the Keychain", async () => {
    let finish: (path: string) => void = () => undefined;
    const { host, calls } = await mount([], (call) => {
      if (call.cmd === "git_host_generate_key") return new Promise((resolve) => (finish = resolve));
      if (call.cmd === "ssh_public_key") return "ssh-ed25519 AAAAC3Nza yforge@gitlab.corp-b.com";
      return undefined;
    });
    buttonNamed(host, "Add host")?.click();
    await flush();
    expect(buttonNamed(host, "Generate key")?.getAttribute("aria-disabled")).toBe("true");
    type(input(host, "Host"), "gitlab.corp-b.com:2222");
    await flush(60);
    type(input(host, "New key file"), "~/.ssh/yforge_corp_b");
    type(input(host, "Passphrase (optional)"), "correct horse");
    await flush(60);
    expect(host.textContent).toContain("saves this passphrase in the macOS Keychain");

    buttonNamed(host, "Generate key")?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "git_host_generate_key")?.args).toEqual({ host: "gitlab.corp-b.com:2222", keyPath: "~/.ssh/yforge_corp_b", passphrase: "correct horse" });
    const busy = host.querySelector('[role="status"][aria-busy="true"]');
    expect(busy?.textContent).toContain("Writing ~/.ssh/yforge_corp_b and its .pub…");
    expect(buttonNamed(host, "Generating ed25519 key…")?.getAttribute("aria-disabled")).toBe("true");
    finish("/Users/you/.ssh/yforge_corp_b");
    await flush(40);

    expect(input(host, "SSH key")?.value).toBe("/Users/you/.ssh/yforge_corp_b");
    expect(input(host, "Passphrase (optional)")?.value).toBe("");
    expect(host.textContent).toContain("Generated ~/.ssh/yforge_corp_b");
    expect(host.textContent).toContain("The passphrase is saved in the macOS Keychain for this key file.");
    expect(buttonNamed(host, "Generate key")?.getAttribute("aria-disabled")).toBe("true");
    buttonNamed(host, "Copy public key")?.click();
    await flush(40);
    expect(writeText).toHaveBeenCalledWith("ssh-ed25519 AAAAC3Nza yforge@gitlab.corp-b.com");
    expect(host.textContent).toContain("Copied the public key.");
  });

  it("generates without a passphrase at the default path, says nothing about the Keychain, and reports a refused generation", async () => {
    const { host, calls } = await mount([], (call) => (call.cmd === "git_host_generate_key" ? new Error("~/.ssh/yforge_github.com: A file already exists there") : undefined));
    buttonNamed(host, "Add host")?.click();
    await flush();
    type(input(host, "Host"), "github.com");
    await flush(60);

    buttonNamed(host, "Generate key")?.click();
    await flush(40);

    expect(calls.find((call) => call.cmd === "git_host_generate_key")?.args).toEqual({ host: "github.com", keyPath: "~/.ssh/yforge_github.com", passphrase: null });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("A file already exists there");
    expect(input(host, "SSH key")?.value).toBe("");
    expect(host.textContent).not.toContain("is saved in the macOS Keychain");
  });

  it("refuses a path where a file exists or whose parent is not a folder and keeps Generate key disabled", async () => {
    const { host, calls } = await mount([]);
    buttonNamed(host, "Add host")?.click();
    await flush();
    type(input(host, "Host"), "github.com");
    await flush(60);

    type(input(host, "New key file"), "~/.ssh/id_taken");
    await flush(60);
    expect(host.textContent).toContain("A file already exists there");
    expect(host.textContent).toContain("YForge never overwrites a key.");
    expect(input(host, "New key file")?.getAttribute("aria-invalid")).toBe("true");
    expect(buttonNamed(host, "Generate key")?.getAttribute("aria-disabled")).toBe("true");
    buttonNamed(host, "Generate key")?.click();
    await flush();
    expect(calls.some((call) => call.cmd === "git_host_generate_key")).toBe(false);

    type(input(host, "New key file"), "/etc/file/child");
    await flush(60);
    expect(host.textContent).toContain("The parent of that path is not a folder");
    expect(buttonNamed(host, "Generate key")?.getAttribute("aria-disabled")).toBe("true");
    type(input(host, "New key file"), "~/.ssh/fresh");
    await flush(60);
    expect(buttonNamed(host, "Generate key")?.getAttribute("aria-disabled")).toBe("false");
  });

  it("refuses a public key with the proposal's copy, keeps Save disabled, and saves nothing", async () => {
    const { host, calls } = await mount([corpB], (call) => (call.cmd === "plugin:dialog|open" ? "/Users/you/.ssh/id_corp_b" : undefined));

    iconButton(host, "Edit gitlab.corp-b.com:2222")?.click();
    await flush();
    expect(host.querySelector("h3")?.textContent).toBe("Edit host");
    expect(input(host, "Host")?.value).toBe("gitlab.corp-b.com:2222");
    type(input(host, "SSH key"), "/Users/you/.ssh/id_corp_b.pub");
    await flush(40);

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.querySelector("strong")?.textContent).toBe("That is a public key");
    expect(alert?.textContent).toContain("Choose the private key file (usually the same name without .pub). Nothing was saved.");
    expect(input(host, "SSH key")?.getAttribute("aria-invalid")).toBe("true");
    expect(buttonNamed(host, "Save host")?.getAttribute("aria-disabled")).toBe("true");
    buttonNamed(host, "Save host")?.click();
    await flush();
    expect(saves(calls)).toEqual([]);

    (alert?.querySelector("button") as HTMLButtonElement).click();
    await flush(40);
    expect(input(host, "SSH key")?.value).toBe("/Users/you/.ssh/id_corp_b");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(buttonNamed(host, "Save host")?.getAttribute("aria-disabled")).toBe("false");
  });

  it("edits an identity under its id and shows a refused save", async () => {
    let refuse = true;
    const { host, calls } = await mount([corpA], (call) => {
      if (call.cmd !== "git_host_save") return undefined;
      if (refuse) {
        refuse = false;
        return new Error("there is already an identity for gitlab.corp-b.com; edit that one instead");
      }
      return { ...corpA, https_user: "yui" };
    });

    iconButton(host, "Edit gitlab.corp-a.com")?.click();
    await flush();
    expect(input(host, "SSH key")?.value).toBe("/Users/you/.ssh/yforge_gitlab.corp-a.com");
    type(input(host, "HTTPS user name (optional)"), "yui");
    buttonNamed(host, "Save host")?.click();
    await flush(40);

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("there is already an identity for gitlab.corp-b.com");
    buttonNamed(host, "Save host")?.click();
    await flush(40);

    expect(saves(calls).map((call) => call.args)).toEqual([
      { id: "h1", draft: { host: "gitlab.corp-a.com", ssh_key_path: "/Users/you/.ssh/yforge_gitlab.corp-a.com", https_user: "yui" } },
      { id: "h1", draft: { host: "gitlab.corp-a.com", ssh_key_path: "/Users/you/.ssh/yforge_gitlab.corp-a.com", https_user: "yui" } },
    ]);
    expect(host.querySelector("form")).toBeNull();
    expect(card(host, "gitlab.corp-a.com")?.querySelector(".kv")?.textContent).toContain("yui");
  });

  it("cancels an edit without saving", async () => {
    const { host, calls } = await mount([corpA]);

    iconButton(host, "Edit gitlab.corp-a.com")?.click();
    await flush();
    buttonNamed(host, "Cancel")?.click();
    await flush();

    expect(saves(calls)).toEqual([]);
    expect(card(host, "gitlab.corp-a.com")).not.toBeNull();
  });

  it("confirms before removing an identity and keeps the key files", async () => {
    const { host, calls } = await mount([corpA, github]);

    iconButton(host, "Remove gitlab.corp-a.com")?.click();
    await flush();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Remove this host identity?");
    expect(dialog?.textContent).toContain("The key files stay in ~/.ssh");
    expect(document.activeElement?.textContent).toBe("Cancel");
    buttonNamed(document.body, "Cancel")?.click();
    await flush();
    expect(calls.some((call) => call.cmd === "git_host_remove")).toBe(false);

    iconButton(host, "Remove gitlab.corp-a.com")?.click();
    await flush();
    buttonNamed(document.body, "Remove host")?.click();
    await flush(40);

    expect(calls.find((call) => call.cmd === "git_host_remove")?.args).toEqual({ id: "h1" });
    expect(card(host, "gitlab.corp-a.com")).toBeNull();
    expect(card(host, "github.com")).not.toBeNull();
  });
});
