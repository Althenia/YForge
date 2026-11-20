import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { Suspense } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHost } from "../ipc/bindings/GitHost";
import type { GitHostDraft } from "../ipc/bindings/GitHostDraft";
import type { GitHostSignInOptions } from "../ipc/bindings/GitHostSignInOptions";
import { GitHostsSettings } from "./GitHostsSettings";
import { buttonNamed, choose, flush, mountWithApp, type } from "./testkit";

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
  sign_in: null,
  ...overrides,
});

const corpA = identity();
const corpB = identity({ id: "h2", host: "gitlab.corp-b.com:2222", ssh_key_path: "/Users/you/.ssh/id_corp_b", https_user: "you", key_kind: "ed25519", key_fingerprint: null, has_public_key: false });
const github = identity({ id: "h3", host: "github.com", ssh_key_path: null, key_kind: null, key_fingerprint: null, has_public_key: false });
const bitbucket = identity({ id: "h4", host: "bitbucket.org", ssh_key_path: null, key_kind: null, key_fingerprint: null, has_public_key: false });

const SIGN_IN_COMMANDS = ["git_host_oauth_sign_in", "git_host_token_sign_in"];

const OAUTH_UNCONFIGURED = "Operator registration is not configured for OAuth sign-in on gitlab.corp-b.com:2222.";
const GITHUB_OAUTH = "GitHub OAuth needs a client secret, which YForge never ships; use Web sign-in or Token.";
const BITBUCKET_OAUTH = "Bitbucket Cloud OAuth needs a client secret, which YForge never ships.";
const BITBUCKET_WEB = "Bitbucket Cloud has no Web sign-in; use Token.";
const WEB_UNCONFIGURED = "Operator registration is not configured for Web sign-in on gitlab.corp-b.com:2222.";

const signInOptions = (host: string, provider: string | null): GitHostSignInOptions => {
  if (host === "github.com") return { provider: "github", provider_fixed: true, methods: ["web", "token"], unavailable: [{ method: "oauth", reason: GITHUB_OAUTH }], token_page: "https://github.com/settings/tokens/new" };
  if (host === "bitbucket.org") {
    return {
      provider: "bitbucket",
      provider_fixed: true,
      methods: ["token"],
      unavailable: [{ method: "oauth", reason: BITBUCKET_OAUTH }, { method: "web", reason: BITBUCKET_WEB }],
      token_page: "https://id.atlassian.com/manage-profile/security/api-tokens",
    };
  }
  const chosen = (provider ?? "gitlab") as GitHostSignInOptions["provider"];
  if (host === "gitlab.corp-b.com:2222") {
    return { provider: chosen, provider_fixed: false, methods: ["token"], unavailable: [{ method: "oauth", reason: OAUTH_UNCONFIGURED }, { method: "web", reason: WEB_UNCONFIGURED }], token_page: `https://${host}/-/user_settings/personal_access_tokens` };
  }
  return { provider: chosen, provider_fixed: false, methods: chosen === "gitea" ? ["oauth", "token"] : ["oauth", "web", "token"], unavailable: [], token_page: `https://${host}/-/user_settings/personal_access_tokens` };
};

const noRegistrationFields = (panel: HTMLElement) => {
  expect(panel.querySelector('input[aria-label^="Client"]')).toBeNull();
  expect(panel.querySelectorAll('input:not([aria-label="Token"])')).toHaveLength(0);
  expect([...panel.querySelectorAll(".field-label, label")].map((entry) => entry.textContent ?? "").join(" ")).not.toMatch(/client|redirect/i);
  expect(panel.textContent).not.toMatch(/client id|redirect/i);
};

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
      const settle = (value: unknown) => {
        if (cmd === "git_host_save") list = call.args.id === null ? [...list, value as GitHost] : list.map((entry) => (entry.id === call.args.id ? (value as GitHost) : entry));
        if (SIGN_IN_COMMANDS.includes(cmd)) list = list.map((entry) => (entry.id === (value as GitHost).id ? (value as GitHost) : entry));
        return value;
      };
      if (custom instanceof Promise) return custom.then(settle);
      if (custom !== undefined) return settle(custom);
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
        case "git_host_sign_in_options":
          return signInOptions(String(call.args.host), (call.args.provider ?? null) as string | null);
        case "git_host_sign_out":
          list = list.map((entry) => (entry.id === call.args.hostId ? { ...entry, sign_in: null } : entry));
          return null;
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

  it("opens the host editor without the page fallback while the host is checked", async () => {
    const { host } = await mount([], (call) =>
      call.cmd === "git_host_field_problem" ? new Promise((resolve) => setTimeout(() => resolve(null), 30)) : undefined,
    );
    const sawFallback: boolean[] = [];

    buttonNamed(host, "Add host")?.click();
    for (let step = 0; step < 8; step += 1) {
      sawFallback.push(host.textContent?.includes("Loading the page…") === true);
      await flush(10);
    }
    await flush(60);

    expect(host.querySelector("form")).not.toBeNull();
    expect(sawFallback).not.toContain(true);
    expect(host.textContent).not.toContain("Loading the page…");
  });

  it("explains the empty state and how an identity is chosen", async () => {
    const { host } = await mount([]);

    expect(host.textContent).toContain("No host identities yet.");
    expect(host.textContent).toContain("Add a host to use a different key or HTTPS user name per server.");
    expect([...host.querySelectorAll(".order li")].map((item) => item.textContent)).toEqual([
      "The repository's own SSH key (Repository settings)",
      "The folder's SSH key (Settings → Git)",
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
    expect(host.textContent).toContain("Sign-in credentials are stored per host in the macOS Keychain by YForge and used for HTTPS Git operations on that host; SSH remotes keep using the SSH key.");
    expect(host.textContent).not.toContain("credential helper");
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

  it("generates an ed25519 key at the edited path with a passphrase, names the file it writes, selects the key, and says the passphrase went to the YForge database", async () => {
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
    expect(host.textContent).toContain("saves this passphrase unencrypted in the YForge database");

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
    expect(host.textContent).toContain("The passphrase is saved in the YForge database (unencrypted) for this key file.");
    expect(buttonNamed(host, "Generate key")?.getAttribute("aria-disabled")).toBe("true");
    buttonNamed(host, "Copy public key")?.click();
    await flush(40);
    expect(writeText).toHaveBeenCalledWith("ssh-ed25519 AAAAC3Nza yforge@gitlab.corp-b.com");
    expect(host.textContent).toContain("Copied the public key.");
  });

  it("generates without a passphrase at the default path, says nothing about the saved passphrase, and reports a refused generation", async () => {
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
    expect(host.textContent).not.toContain("is saved in the YForge database");
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
    expect(dialog?.textContent).toContain("saved key passphrases stay in the YForge database");
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

const signedIn = (entry: GitHost, method: "oauth" | "web" | "token", login: string): GitHost => ({ ...entry, sign_in: { provider: entry.host === "bitbucket.org" ? "bitbucket" : entry.host === "github.com" ? "github" : "gitlab", method, login } });
const sign = (host: ParentNode, name: string) => card(host, name)?.querySelector<HTMLElement>(".git-host-sign-in-status");
const signInCard = (host: ParentNode, name: string) => host.querySelector<HTMLElement>(`[aria-label="Sign in to ${name}"]`);
const radio = (host: ParentNode, label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((entry) => entry.textContent?.trim() === label);

function watchLeaks() {
  const logged = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
  const stored = vi.spyOn(Storage.prototype, "setItem");
  const opened = vi.spyOn(window, "open").mockImplementation(() => null);
  const cookieRead = vi.fn(() => "");
  const cookieWrite = vi.fn();
  Object.defineProperty(document, "cookie", { get: cookieRead, set: cookieWrite, configurable: true });
  return {
    check(host: HTMLElement, secrets: string[]) {
      const printed = JSON.stringify([...logged.flatMap((spy) => spy.mock.calls), ...stored.mock.calls]);
      for (const secret of secrets) {
        expect(printed).not.toContain(secret);
        expect(host.innerHTML).not.toContain(secret);
        expect(document.body.innerHTML).not.toContain(secret);
        expect(location.href).not.toContain(secret);
      }
      expect(stored).not.toHaveBeenCalled();
      expect(opened).not.toHaveBeenCalled();
      expect(cookieRead).not.toHaveBeenCalled();
      expect(cookieWrite).not.toHaveBeenCalled();
      expect(document.querySelector("iframe, webview")).toBeNull();
    },
    restore() {
      for (const spy of [...logged, stored, opened]) spy.mockRestore();
      delete (document as unknown as { cookie?: string }).cookie;
    },
  };
}

describe("Settings → Git hosts sign-in", () => {
  it("states each host's sign-in as text with a glyph and offers Sign in or Sign out", async () => {
    const { host } = await mount([signedIn(github, "web", "octo"), corpA]);

    expect(sign(host, "github.com")?.textContent).toContain("Signed in as octo · Web sign-in");
    expect(sign(host, "github.com")?.querySelector("svg")).not.toBeNull();
    expect(sign(host, "gitlab.corp-a.com")?.textContent).toContain("Signed out");
    expect(sign(host, "gitlab.corp-a.com")?.querySelector("svg")).not.toBeNull();
    expect(buttonNamed(card(host, "github.com") as HTMLElement, "Sign out")).toBeDefined();
    expect(buttonNamed(card(host, "github.com") as HTMLElement, "Sign in")).toBeUndefined();
    expect(buttonNamed(card(host, "gitlab.corp-a.com") as HTMLElement, "Sign in")).toBeDefined();
    expect(buttonNamed(card(host, "gitlab.corp-a.com") as HTMLElement, "Sign out")).toBeUndefined();
  });

  it("offers OAuth, Web sign-in, and Token with their consequences and no registration fields", async () => {
    const { host, calls } = await mount([corpA]);

    buttonNamed(card(host, "gitlab.corp-a.com") as HTMLElement, "Sign in")?.click();
    await flush(40);

    const panel = signInCard(host, "gitlab.corp-a.com") as HTMLElement;
    expect(calls.find((call) => call.cmd === "git_host_sign_in_options")?.args).toEqual({ host: "gitlab.corp-a.com", provider: null });
    expect([...panel.querySelectorAll('[role="radiogroup"] [role="radio"]')].map((entry) => entry.textContent?.trim())).toEqual(["OAuth", "Web sign-in", "Token"]);
    expect(radio(panel, "OAuth")?.getAttribute("aria-checked")).toBe("true");
    expect(panel.textContent).toContain("Authorize YForge's registered OAuth app in your browser.");
    expect(panel.querySelectorAll("input")).toHaveLength(0);
    noRegistrationFields(panel);
    radio(panel, "Web sign-in")?.click();
    await flush();
    expect(panel.textContent).toContain("Sign in on the host's web page and approve the code YForge shows.");
    expect(panel.querySelectorAll("input")).toHaveLength(0);
    noRegistrationFields(panel);
    radio(panel, "Token")?.click();
    await flush();
    expect(panel.textContent).toContain("Create a token on the host's page and paste it here.");
    expect([...panel.querySelectorAll("input")].map((entry) => [entry.getAttribute("aria-label"), entry.type])).toEqual([["Token", "password"]]);
    noRegistrationFields(panel);
    expect(host.querySelector("select, option, textarea, iframe")).toBeNull();
  });

  it("offers GitHub Web sign-in and Token without a provider choice and states why OAuth is unavailable", async () => {
    const { host, calls } = await mount([github]);

    buttonNamed(card(host, "github.com") as HTMLElement, "Sign in")?.click();
    await flush(40);

    const panel = signInCard(host, "github.com") as HTMLElement;
    expect(calls.find((call) => call.cmd === "git_host_sign_in_options")?.args).toEqual({ host: "github.com", provider: null });
    expect(panel.querySelector('button[aria-label="Provider"]')).toBeNull();
    expect([...panel.querySelectorAll('[role="radio"]')].map((entry) => entry.textContent?.trim())).toEqual(["Web sign-in", "Token"]);
    expect(radio(panel, "Web sign-in")?.getAttribute("aria-checked")).toBe("true");
    expect(panel.textContent).toContain(`OAuth: ${GITHUB_OAUTH}`);
    noRegistrationFields(panel);
  });

  it("starts an OAuth sign-in, shows the browser address, and moves the host to Signed in when it finishes", async () => {
    let finish: (value: GitHost) => void = () => undefined;
    const { host, calls } = await mount([corpA], (call) => (call.cmd === "git_host_oauth_sign_in" ? new Promise<GitHost>((resolve) => (finish = resolve)) : undefined));
    buttonNamed(card(host, "gitlab.corp-a.com") as HTMLElement, "Sign in")?.click();
    await flush(40);
    const panel = signInCard(host, "gitlab.corp-a.com") as HTMLElement;
    expect(buttonNamed(panel, "Start sign-in")?.getAttribute("aria-disabled")).toBe("false");

    buttonNamed(panel, "Start sign-in")?.click();
    await flush();
    const started = calls.find((call) => call.cmd === "git_host_oauth_sign_in");
    expect(started?.args).toEqual({ operationId: expect.any(String), hostId: "h1", provider: "gitlab", method: "oauth" });
    await emit("git-host-sign-in", { operation: "another-operation", host_id: "h1", stage: { kind: "browser", url: "https://example.com/wrong" } });
    await emit("git-host-sign-in", { operation: started?.args.operationId, host_id: "h1", stage: { kind: "browser", url: "https://gitlab.corp-a.com/oauth/authorize?response_type=code" } });
    await flush();
    expect(panel.textContent).toContain("Continue in your browser");
    expect(panel.querySelector(".copy-value")?.textContent).toBe("https://gitlab.corp-a.com/oauth/authorize?response_type=code");
    expect(panel.textContent).not.toContain("https://example.com/wrong");
    expect(buttonNamed(panel, "Cancel sign-in")).toBeDefined();
    const listed = calls.filter((call) => call.cmd === "git_hosts_list").length;

    finish(signedIn(corpA, "oauth", "you"));
    await flush(60);

    expect(signInCard(host, "gitlab.corp-a.com")).toBeNull();
    expect(calls.filter((call) => call.cmd === "git_hosts_list").length).toBeGreaterThan(listed);
    expect(sign(host, "gitlab.corp-a.com")?.textContent).toContain("Signed in as you · OAuth");
  });

  it("shows the Web sign-in code and address and cancels through the operation id", async () => {
    const { host, calls } = await mount([github], (call) => {
      if (call.cmd === "git_host_oauth_sign_in") return new Promise(() => undefined);
      if (call.cmd === "operation_cancel") return true;
      return undefined;
    });
    buttonNamed(card(host, "github.com") as HTMLElement, "Sign in")?.click();
    await flush(40);
    const panel = signInCard(host, "github.com") as HTMLElement;
    radio(panel, "Web sign-in")?.click();
    await flush();
    buttonNamed(panel, "Start sign-in")?.click();
    await flush();
    const started = calls.find((call) => call.cmd === "git_host_oauth_sign_in");
    expect(started?.args).toEqual({ operationId: expect.any(String), hostId: "h3", provider: "github", method: "web" });
    await emit("git-host-sign-in", { operation: started?.args.operationId, host_id: "h3", stage: { kind: "device_code", url: "https://github.com/login/device", code: "AB12-CD34" } });
    await flush();

    expect(panel.textContent).toContain("Continue in your browser");
    expect([...panel.querySelectorAll(".copy-value")].map((entry) => entry.textContent)).toEqual(["https://github.com/login/device", "AB12-CD34"]);
    buttonNamed(panel, "Cancel sign-in")?.click();
    await flush();
    expect(calls.find((call) => call.cmd === "operation_cancel")?.args).toEqual({ id: started?.args.operationId });
  });

  it("returns to the sign-in choices without an error when a sign-in is cancelled", async () => {
    let fail: (reason: unknown) => void = () => undefined;
    const { host } = await mount([github], (call) => {
      if (call.cmd === "git_host_oauth_sign_in") return new Promise((_resolve, reject) => (fail = reject));
      if (call.cmd === "operation_cancel") {
        fail({ kind: "cancelled", message: "Sign-in cancelled", output: null });
        return true;
      }
      return undefined;
    });
    buttonNamed(card(host, "github.com") as HTMLElement, "Sign in")?.click();
    await flush(40);
    const panel = signInCard(host, "github.com") as HTMLElement;
    buttonNamed(panel, "Start sign-in")?.click();
    await flush();
    buttonNamed(panel, "Cancel sign-in")?.click();
    await flush(40);

    expect(buttonNamed(panel, "Cancel sign-in")).toBeUndefined();
    expect(buttonNamed(panel, "Start sign-in")).toBeDefined();
    expect(panel.querySelector('[role="alert"]')).toBeNull();
    expect(sign(host, "github.com")?.textContent).toContain("Signed out");
  });

  it("opens the token page through YForge, reports an invalid token, then signs in with a valid one without leaking it", async () => {
    const leaks = watchLeaks();
    try {
      let attempts = 0;
      const { host, calls } = await mount([github], (call) => {
        if (call.cmd === "git_host_open_token_page") return "https://github.com/settings/tokens/new";
        if (call.cmd !== "git_host_token_sign_in") return undefined;
        attempts += 1;
        return attempts === 1 ? new Error("github.com rejected the token") : signedIn(github, "token", "octo");
      });
      buttonNamed(card(host, "github.com") as HTMLElement, "Sign in")?.click();
      await flush(40);
      const panel = signInCard(host, "github.com") as HTMLElement;
      radio(panel, "Token")?.click();
      await flush();

      buttonNamed(panel, "Open token page")?.click();
      await flush(40);
      expect(calls.find((call) => call.cmd === "git_host_open_token_page")?.args).toEqual({ hostId: "h3", provider: "github" });
      expect(panel.textContent).toContain("Opened the token page in your browser.");
      expect(panel.querySelector(".copy-value")?.textContent).toBe("https://github.com/settings/tokens/new");

      type(input(panel, "Token"), "ghp_wrongSECRET111");
      buttonNamed(panel, "Sign in with token")?.click();
      await flush(40);
      expect(calls.filter((call) => call.cmd === "git_host_token_sign_in").map((call) => call.args)).toEqual([{ hostId: "h3", provider: "github", token: "ghp_wrongSECRET111" }]);
      expect(panel.querySelector('[role="alert"]')?.textContent).toContain("github.com rejected the token");
      expect(input(panel, "Token")?.value).toBe("");
      expect(sign(host, "github.com")?.textContent).toContain("Signed out");

      type(input(panel, "Token"), "ghp_rightSECRET222");
      buttonNamed(panel, "Sign in with token")?.click();
      await flush(60);

      expect(signInCard(host, "github.com")).toBeNull();
      expect(sign(host, "github.com")?.textContent).toContain("Signed in as octo · Token");
      const secrets = ["ghp_wrongSECRET111", "ghp_rightSECRET222"];
      expect(calls.filter((call) => call.cmd !== "git_host_token_sign_in").some((call) => secrets.some((secret) => JSON.stringify(call.args).includes(secret)))).toBe(false);
      leaks.check(host, secrets);
    } finally {
      leaks.restore();
    }
  });

  it("starts a Gitea OAuth sign-in on a host whose provider is chosen", async () => {
    let finish: (value: GitHost) => void = () => undefined;
    const { host, calls } = await mount([corpA], (call) => (call.cmd === "git_host_oauth_sign_in" ? new Promise<GitHost>((resolve) => (finish = resolve)) : undefined));
    buttonNamed(card(host, "gitlab.corp-a.com") as HTMLElement, "Sign in")?.click();
    await flush(40);
    const panel = signInCard(host, "gitlab.corp-a.com") as HTMLElement;
    await choose(panel, "Provider", "Gitea", 40);

    expect([...panel.querySelectorAll('[role="radio"]')].map((entry) => entry.textContent?.trim())).toEqual(["OAuth", "Token"]);
    noRegistrationFields(panel);
    buttonNamed(panel, "Start sign-in")?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "git_host_oauth_sign_in")?.args).toEqual({ operationId: expect.any(String), hostId: "h1", provider: "gitea", method: "oauth" });
    finish({ ...corpA, sign_in: { provider: "gitea", method: "oauth", login: "tea" } });
    await flush(60);
    expect(sign(host, "gitlab.corp-a.com")?.textContent).toContain("Signed in as tea · OAuth");
  });

  it("states why Bitbucket Cloud offers neither OAuth nor Web sign-in and signs in with a token", async () => {
    const { host, calls } = await mount([bitbucket], (call) => {
      if (call.cmd === "git_host_open_token_page") return "https://id.atlassian.com/manage-profile/security/api-tokens";
      if (call.cmd === "git_host_token_sign_in") return signedIn(bitbucket, "token", "bb");
      return undefined;
    });
    buttonNamed(card(host, "bitbucket.org") as HTMLElement, "Sign in")?.click();
    await flush(40);
    const panel = signInCard(host, "bitbucket.org") as HTMLElement;

    expect([...panel.querySelectorAll('[role="radio"]')].map((entry) => entry.textContent?.trim())).toEqual(["Token"]);
    expect(panel.textContent).toContain(`OAuth: ${BITBUCKET_OAUTH}`);
    expect(panel.textContent).toContain(`Web sign-in: ${BITBUCKET_WEB}`);
    expect(buttonNamed(panel, "Start sign-in")).toBeUndefined();
    noRegistrationFields(panel);

    buttonNamed(panel, "Open token page")?.click();
    await flush(40);
    expect(calls.find((call) => call.cmd === "git_host_open_token_page")?.args).toEqual({ hostId: "h4", provider: "bitbucket" });
    expect(panel.querySelector(".copy-value")?.textContent).toBe("https://id.atlassian.com/manage-profile/security/api-tokens");
    type(input(panel, "Token"), "ATATT-SECRET555");
    buttonNamed(panel, "Sign in with token")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "git_host_token_sign_in")?.args).toEqual({ hostId: "h4", provider: "bitbucket", token: "ATATT-SECRET555" });
    expect(sign(host, "bitbucket.org")?.textContent).toContain("Signed in as bb · Token");
  });

  it("states why OAuth and Web sign-in are unavailable on an unconfigured host and still signs in with a token and keeps SSH", async () => {
    const corpBSigned = signedIn(corpB, "token", "you");
    const { host, calls } = await mount([corpB], (call) => {
      if (call.cmd === "git_host_open_token_page") return "https://gitlab.corp-b.com:2222/-/user_settings/personal_access_tokens";
      if (call.cmd === "git_host_token_sign_in") return corpBSigned;
      return undefined;
    });
    buttonNamed(card(host, "gitlab.corp-b.com:2222") as HTMLElement, "Sign in")?.click();
    await flush(40);
    const panel = signInCard(host, "gitlab.corp-b.com:2222") as HTMLElement;

    expect([...panel.querySelectorAll('[role="radio"]')].map((entry) => entry.textContent?.trim())).toEqual(["Token"]);
    expect(panel.textContent).toContain(`OAuth: ${OAUTH_UNCONFIGURED}`);
    expect(panel.textContent).toContain(`Web sign-in: ${WEB_UNCONFIGURED}`);
    expect(buttonNamed(panel, "Start sign-in")).toBeUndefined();
    noRegistrationFields(panel);
    expect(card(host, "gitlab.corp-b.com:2222")?.querySelector(".kv")?.textContent).toContain("~/.ssh/id_corp_b");
    expect(iconButton(host, "Edit gitlab.corp-b.com:2222")).not.toBeNull();

    buttonNamed(panel, "Open token page")?.click();
    await flush(40);
    expect(calls.find((call) => call.cmd === "git_host_open_token_page")?.args).toEqual({ hostId: "h2", provider: "gitlab" });
    type(input(panel, "Token"), "glpat-SECRET444");
    buttonNamed(panel, "Sign in with token")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "git_host_token_sign_in")?.args).toEqual({ hostId: "h2", provider: "gitlab", token: "glpat-SECRET444" });
    expect(sign(host, "gitlab.corp-b.com:2222")?.textContent).toContain("Signed in as you · Token");
    expect(card(host, "gitlab.corp-b.com:2222")?.querySelector(".kv")?.textContent).toContain("~/.ssh/id_corp_b");
  });

  it("offers a provider choice only for a host whose provider is not fixed and re-reads the options for the chosen provider", async () => {
    const { host, calls } = await mount([corpA, github]);
    buttonNamed(card(host, "gitlab.corp-a.com") as HTMLElement, "Sign in")?.click();
    await flush(40);
    const panel = signInCard(host, "gitlab.corp-a.com") as HTMLElement;

    expect(panel.querySelector('button[aria-label="Provider"]')?.textContent).toContain("GitLab");
    noRegistrationFields(panel);
    await choose(panel, "Provider", "Gitea", 40);

    expect(calls.filter((call) => call.cmd === "git_host_sign_in_options").map((call) => call.args)).toContainEqual({ host: "gitlab.corp-a.com", provider: "gitea" });
    expect(panel.querySelector('button[aria-label="Provider"]')?.textContent).toContain("Gitea");
    expect([...panel.querySelectorAll('[role="radio"]')].map((entry) => entry.textContent?.trim())).toEqual(["OAuth", "Token"]);
    buttonNamed(card(host, "github.com") as HTMLElement, "Sign in")?.click();
    await flush(40);
    expect(signInCard(host, "github.com")?.querySelector('button[aria-label="Provider"]')).toBeNull();
  });

  it("signs a host out", async () => {
    const { host, calls } = await mount([signedIn(github, "web", "octo")]);

    buttonNamed(card(host, "github.com") as HTMLElement, "Sign out")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "git_host_sign_out")?.args).toEqual({ hostId: "h3" });
    expect(sign(host, "github.com")?.textContent).toContain("Signed out");
  });

  it("keeps the SSH key of a signed-in host when it is edited and saved", async () => {
    const corpASigned = signedIn(corpA, "token", "you");
    const { host, calls } = await mount([corpASigned], (call) => (call.cmd === "git_host_save" ? { ...corpASigned, https_user: "yui" } : undefined));

    expect(card(host, "gitlab.corp-a.com")?.querySelector(".kv")?.textContent).toContain("~/.ssh/yforge_gitlab.corp-a.com · ed25519 · SHA256:q4Vd…T1o");
    iconButton(host, "Edit gitlab.corp-a.com")?.click();
    await flush();
    type(input(host, "HTTPS user name (optional)"), "yui");
    buttonNamed(host, "Save host")?.click();
    await flush(60);

    expect(saves(calls).map((call) => call.args)).toEqual([{ id: "h1", draft: { host: "gitlab.corp-a.com", ssh_key_path: "/Users/you/.ssh/yforge_gitlab.corp-a.com", https_user: "yui" } }]);
    expect(card(host, "gitlab.corp-a.com")?.querySelector(".kv")?.textContent).toContain("~/.ssh/yforge_gitlab.corp-a.com · ed25519 · SHA256:q4Vd…T1o");
    expect(sign(host, "gitlab.corp-a.com")?.textContent).toContain("Signed in as you · Token");
    expect(iconButton(host, "Copy public key for gitlab.corp-a.com")).not.toBeNull();
  });
});
