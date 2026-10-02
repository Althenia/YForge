import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { AppSettings } from "../ipc/bindings/AppSettings";
import { defaultSettings } from "../state/settingsModel";
import { SettingsView } from "./SettingsView";
import { buttonNamed, flush, mountWithApp, type, choose } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

const keys = [
  { path: "/Users/yui/.ssh/id_ed25519", name: "id_ed25519", algorithm: "ssh-ed25519" },
  { path: "/Users/yui/.ssh/work", name: "work", algorithm: "ssh-rsa" },
];

function install(extra: (call: Call) => unknown = () => undefined) {
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    const custom = extra(call);
    if (custom !== undefined) return custom;
    if (cmd === "settings_save") return call.args.settings;
    if (cmd === "settings_load") return defaultSettings;
    if (cmd === "repo_aliases_list") return [];
    if (cmd === "session_load") return { tabs: ["/r"], active: 0, groups: [] };
    if (cmd === "launch_path") return "/nowhere";
    if (cmd === "repo_open") throw { kind: "not_a_repository", message: "not a repository", output: null };
    if (cmd === "activity_list" || cmd === "recents_list") return [];
    if (cmd === "identity_read") {
      return call.args.path === null
        ? { name: { value: "Global Yui", source: "global" }, email: { value: null, source: "unset" } }
        : { name: { value: "Repo Yui", source: "repository" }, email: { value: "yui@example.test", source: "global" } };
    }
    if (cmd === "remotes_list") return [{ name: "origin", fetch_url: "https://example.test/a.git", push_url: null }];
    if (cmd === "ssh_keys_list") return keys;
    return null;
  });
  return calls;
}

async function open(section: string) {
  const calls = install();
  const mounted = mountWithApp(() => <SettingsView section={section} />);
  dispose = mounted.dispose;
  await flush();
  return { ...mounted, calls };
}

const savedSettings = (calls: Call[]): AppSettings[] => calls.filter((call) => call.cmd === "settings_save").map((call) => call.args.settings as AppSettings);

describe("settings view", () => {
  it("saves the theme and density as soon as they are chosen and applies the saved value", async () => {
    const { host, calls, app } = await open("appearance");

    buttonNamed(host, "Light")?.click();
    await flush();
    buttonNamed(host, "Compact")?.click();
    await flush();

    expect(savedSettings(calls).map((settings) => [settings.theme, settings.density])).toEqual([
      ["light", "default"],
      ["light", "compact"],
    ]);
    expect(app.settings()).toMatchObject({ theme: "light", density: "compact" });
    expect(host.querySelector('[aria-label="Theme"] [aria-checked="true"]')?.textContent).toBe("Light");
  });

  it("offers auto-fetch as off, 5, 10, or 30 minutes and saves the chosen interval", async () => {
    const { host, calls } = await open("git");

    const options = [...host.querySelectorAll('[aria-label="Auto-fetch interval"] button')].map((button) => button.textContent);
    buttonNamed(host, "10 min")?.click();
    await flush();

    expect(options).toEqual(["Off", "5 min", "10 min", "30 min"]);
    expect(savedSettings(calls).at(-1)?.auto_fetch_minutes).toBe(10);
  });

  it("saves the default branch and pull mode, and shows a refusal from the core", async () => {
    const calls: Call[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args: (args ?? {}) as Record<string, unknown> });
      if (cmd === "settings_save") {
        const settings = (args as { settings: AppSettings }).settings;
        if (settings.default_branch === "bad name") throw { kind: "invalid_request", message: 'Invalid request: "bad name" is not a valid branch name', output: null };
        return settings;
      }
      if (cmd === "identity_read") return { name: { value: null, source: "unset" }, email: { value: null, source: "unset" } };
      return null;
    });
    const mounted = mountWithApp(() => <SettingsView section="git" />);
    dispose = mounted.dispose;
    await flush();
    const branch = mounted.host.querySelector<HTMLInputElement>('input[aria-label="Default branch"]');

    type(branch, "trunk");
    branch?.dispatchEvent(new FocusEvent("blur"));
    await flush();
    await choose(mounted.host, "Pull mode", "Rebase");
    await flush();
    type(branch, "bad name");
    branch?.dispatchEvent(new FocusEvent("blur"));
    await flush();

    const saved = calls.filter((call) => call.cmd === "settings_save").map((call) => (call.args.settings as AppSettings));
    expect(saved[0]?.default_branch).toBe("trunk");
    expect(saved[1]).toMatchObject({ default_branch: "trunk", pull_mode: "rebase" });
    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain("not a valid branch name");
    expect(mounted.app.settings().default_branch).toBe("trunk");
  });

  it("writes the identity to the global scope and clears a blanked value", async () => {
    const { host, calls } = await open("git");
    const name = host.querySelector<HTMLInputElement>('input[aria-label="Name"]');

    expect(name?.value).toBe("Global Yui");
    expect(host.textContent).toContain("from global config");
    type(name, "New Name");
    name?.dispatchEvent(new FocusEvent("blur"));
    await flush();
    type(name, "");
    name?.dispatchEvent(new FocusEvent("blur"));
    await flush();

    expect(calls.filter((call) => call.cmd === "identity_write").map((call) => call.args)).toEqual([
      { path: null, field: "name", value: "New Name" },
      { path: null, field: "name", value: null },
    ]);
  });

  it("shows the repository identity with its source and removes an override", async () => {
    install();
    const calls = install();
    const mounted = mountWithApp(() => <SettingsView section="repository" />);
    dispose = mounted.dispose;
    await mounted.app.boot();
    await flush();
    const { host } = mounted;

    expect(mounted.app.activePath()).toBe("/r");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Name"]')?.value).toBe("Repo Yui");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Email"]')?.value).toBe("yui@example.test");
    expect(host.textContent).toContain("from repository config");
    expect(host.textContent).toContain("from global config");
    expect(buttonNamed(host, "Remove override")).toBeDefined();
    buttonNamed(host, "Remove override")?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "identity_write")?.args).toEqual({ path: "/r", field: "name", value: null });
  });

  it("lists, adds, edits, and removes remotes, confirming the removal", async () => {
    const calls = install();
    const mounted = mountWithApp(() => <SettingsView section="repository" />);
    dispose = mounted.dispose;
    await mounted.app.boot();
    await flush();
    const { host } = mounted;

    expect(host.textContent).toContain("https://example.test/a.git");
    expect(host.textContent).toContain("from repository config");
    expect(host.textContent).toContain("from global config");
    buttonNamed(host, "Add remote…")?.click();
    await flush();
    type(host.querySelector('input[aria-label="Remote name"]'), "upstream");
    type(host.querySelector('input[aria-label="Remote address"]'), "nonsense");
    await flush();
    expect(buttonNamed(host, "Add")?.disabled).toBe(true);
    type(host.querySelector('input[aria-label="Remote address"]'), "https://example.test/b.git");
    await flush();
    buttonNamed(host, "Add")?.click();
    await flush();
    buttonNamed(host, "Edit")?.click();
    await flush();
    type(host.querySelector('input[aria-label="Remote address"]'), "ssh://git@example.test/a.git");
    buttonNamed(host, "Save")?.click();
    await flush();
    buttonNamed(host, "Remove")?.click();
    await flush();

    expect(document.body.textContent).toContain("Remove remote origin");
    expect(calls.some((call) => call.cmd === "remote_remove")).toBe(false);
    buttonNamed(document.body, "Remove remote")?.click();
    await flush();

    expect(calls.filter((call) => call.cmd.startsWith("remote_") && call.cmd !== "remotes_list").map((call) => [call.cmd, call.args])).toEqual([
      ["remote_add", { path: "/r", name: "upstream", url: "https://example.test/b.git" }],
      ["remote_edit", { path: "/r", name: "origin", newName: "origin", url: "ssh://git@example.test/a.git" }],
      ["remote_remove", { path: "/r", name: "origin" }],
    ]);
  });

  it("stores a pull mode override for the repository and lets it inherit again", async () => {
    const calls = install();
    const mounted = mountWithApp(() => <SettingsView section="repository" />);
    dispose = mounted.dispose;
    await mounted.app.boot();
    await flush();
    await choose(mounted.host, "Pull mode override", "Rebase");
    await flush();
    await choose(mounted.host, "Pull mode override", "Inherit");
    await flush();

    expect(calls.filter((call) => call.cmd === "repo_settings_save").map((call) => call.args)).toEqual([
      { path: "/r", settings: { pull_mode: "rebase" } },
      { path: "/r", settings: { pull_mode: null } },
    ]);
    expect(defaultSettings.pull_mode).toBe("fast_forward_or_merge");
  });

  const sshOptions = async (host: ParentNode, label: string) => {
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
    await flush();
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => option.textContent?.replace(/\s+/g, " ").trim());
    host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
    await flush();
    return options;
  };

  it("lists the keys of ~/.ssh with ssh-agent as the default and saves the chosen key for every repository", async () => {
    const { host, calls } = await open("git");

    expect(await sshOptions(host, "SSH key")).toEqual([
      "ssh-agent (default)",
      "id_ed25519 · ssh-ed25519",
      "work · ssh-rsa",
    ]);
    await choose(host, "SSH key", "work · ssh-rsa");
    await choose(host, "SSH key", "ssh-agent (default)");

    expect(savedSettings(calls).map((settings) => settings.ssh_key_path)).toEqual(["/Users/yui/.ssh/work", null]);
  });

  it("picks a key file outside ~/.ssh with Browse… starting in the key folder and shows the chosen path", async () => {
    const calls = install((call) => (call.cmd === "plugin:dialog|open" ? "/keys/deploy" : undefined));
    const mounted = mountWithApp(() => <SettingsView section="git" />);
    dispose = mounted.dispose;
    await flush();

    buttonNamed(mounted.host, "Browse…")?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "plugin:dialog|open")?.args.options).toMatchObject({ directory: false, defaultPath: "/Users/yui/.ssh" });
    expect(savedSettings(calls).at(-1)?.ssh_key_path).toBe("/keys/deploy");
    expect(mounted.host.querySelector('button[aria-label="SSH key"] .select-value')?.textContent).toBe("/keys/deploy");
  });

  it("keeps the current key when the file picker is cancelled", async () => {
    const calls = install((call) => (call.cmd === "plugin:dialog|open" ? null : undefined));
    const mounted = mountWithApp(() => <SettingsView section="git" />);
    dispose = mounted.dispose;
    await flush();

    buttonNamed(mounted.host, "Browse…")?.click();
    await flush();

    expect(savedSettings(calls)).toEqual([]);
  });

  it("explains why the key list is empty and still lets the user browse", async () => {
    const calls = install((call) => {
      if (call.cmd === "ssh_keys_list") throw { kind: "invalid_request", message: "HOME is not set, so ~/.ssh cannot be read", output: null };
      return undefined;
    });
    const mounted = mountWithApp(() => <SettingsView section="git" />);
    dispose = mounted.dispose;
    await flush();

    expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain("HOME is not set");
    expect(buttonNamed(mounted.host, "Browse…")).toBeDefined();
    expect(calls.some((call) => call.cmd === "ssh_keys_list")).toBe(true);
  });

  it("overrides the key for one repository, inherits again with a blank choice, and keeps the pull mode override", async () => {
    const calls = install((call) => (call.cmd === "repo_settings_load" ? { pull_mode: "rebase", ssh_key_path: "/Users/yui/.ssh/work" } : undefined));
    const mounted = mountWithApp(() => <SettingsView section="repository" />);
    dispose = mounted.dispose;
    await mounted.app.boot();
    await flush();

    const label = () => mounted.host.querySelector('button[aria-label="SSH key override"] .select-value')?.textContent;
    expect(label()).toBe("work · ssh-rsa");
    expect((await sshOptions(mounted.host, "SSH key override"))[0]).toBe("Inherit · ssh-agent (default)");
    await choose(mounted.host, "SSH key override", "Inherit · ssh-agent (default)");
    await choose(mounted.host, "SSH key override", "id_ed25519 · ssh-ed25519");
    await choose(mounted.host, "Pull mode override", "Fast-forward only");

    expect(calls.filter((call) => call.cmd === "repo_settings_save").map((call) => call.args.settings)).toEqual([
      { pull_mode: "rebase", ssh_key_path: null },
      { pull_mode: "rebase", ssh_key_path: "/Users/yui/.ssh/id_ed25519" },
      { pull_mode: "fast_forward_only", ssh_key_path: "/Users/yui/.ssh/id_ed25519" },
    ]);
  });

  it("keeps update on fetch when the repository key changes", async () => {
    const calls = install((call) => (call.cmd === "repo_settings_load" ? { pull_mode: "rebase", ssh_key_path: "/Users/yui/.ssh/work", submodule_update_on_fetch: true } : undefined));
    const mounted = mountWithApp(() => <SettingsView section="repository" />);
    dispose = mounted.dispose;
    await mounted.app.boot();
    await flush();

    await choose(mounted.host, "SSH key override", "Inherit · ssh-agent (default)");

    expect(calls.filter((call) => call.cmd === "repo_settings_save").map((call) => call.args.settings)).toEqual([
      { pull_mode: "rebase", ssh_key_path: null, submodule_update_on_fetch: true },
    ]);
  });

  it("names the app-wide key in the inherit choice", async () => {
    const calls = install();
    const mounted = mountWithApp(() => <SettingsView section="repository" />);
    dispose = mounted.dispose;
    await mounted.app.boot();
    mounted.app.saveSettings({ ...defaultSettings, ssh_key_path: "/Users/yui/.ssh/work" });
    await flush();

    expect((await sshOptions(mounted.host, "SSH key override"))[0]).toBe("Inherit · work");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("offers Light, Dark, and System themes and both densities", async () => {
    const { host } = await open("appearance");

    expect([...host.querySelectorAll('[aria-label="Theme"] button')].map((button) => button.textContent)).toEqual(["Light", "Dark", "System"]);
    expect([...host.querySelectorAll('[aria-label="Density"] button')].map((button) => button.textContent)).toEqual(["Compact", "Default"]);
  });

  describe("command line", () => {
    it("installs the yforge command, reporting where it went and that ~/.local/bin must be on PATH", async () => {
      const calls = install((call) => (call.cmd === "cli_install" ? { path: "/Users/yui/.local/bin/yforge", replaced: false } : undefined));
      const mounted = mountWithApp(() => <SettingsView section="general" />);
      dispose = mounted.dispose;
      await flush();

      expect(mounted.host.textContent).toContain("yforge <path>");
      expect(calls.some((call) => call.cmd === "cli_install")).toBe(false);
      buttonNamed(mounted.host, "Install yforge command")?.click();
      await flush(40);

      expect(calls.filter((call) => call.cmd === "cli_install")).toHaveLength(1);
      const result = mounted.host.querySelector('[role="status"][aria-label="Command line install"]');
      expect(result?.textContent).toContain("Installed /Users/yui/.local/bin/yforge.");
      expect(result?.textContent).toContain("Add ~/.local/bin to your PATH if your shell does not find yforge.");
    });

    it("says when it replaced an earlier copy and offers Reinstall", async () => {
      install((call) => (call.cmd === "cli_install" ? { path: "/Users/yui/.local/bin/yforge", replaced: true } : undefined));
      const mounted = mountWithApp(() => <SettingsView section="general" />);
      dispose = mounted.dispose;
      await flush();

      buttonNamed(mounted.host, "Install yforge command")?.click();
      await flush(40);

      expect(mounted.host.querySelector('[aria-label="Command line install"]')?.textContent).toContain("Replaced the earlier YForge command at /Users/yui/.local/bin/yforge.");
    });

    it("shows the refusal when another file already sits at that path, and changes nothing else", async () => {
      install((call) => {
        if (call.cmd !== "cli_install") return undefined;
        throw { kind: "invalid_request", message: "/Users/yui/.local/bin/yforge exists and was not installed by YForge", output: null };
      });
      const mounted = mountWithApp(() => <SettingsView section="general" />);
      dispose = mounted.dispose;
      await flush();

      buttonNamed(mounted.host, "Install yforge command")?.click();
      await flush(40);

      expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain("exists and was not installed by YForge");
      expect(mounted.host.querySelector('[aria-label="Command line install"]')).toBeNull();
    });
  });
});
