import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createSignal } from "solid-js";
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

const detectedTools = {
  compare: [
    { id: "filemerge", label: "FileMerge", installed: true },
    { id: "kaleidoscope", label: "Kaleidoscope", installed: false },
    { id: "vscode", label: "Visual Studio Code", installed: true },
  ],
  editors: [
    { id: "vscode", label: "Visual Studio Code", installed: true },
    { id: "cursor", label: "Cursor", installed: true },
    { id: "zed", label: "Zed", installed: false },
  ],
  git_merge_tool: null,
  git_diff_tool: "opendiff",
};

const signingConfig = { sign_commits: false, sign_tags: false, format: "openpgp", key: "", program: "" };

const signingKeys = [
  { id: "AAAABBBBCCCCDDDD", label: "Yui Lin <yui@example.test> · AAAABBBBCCCCDDDD", format: "openpgp" },
  { id: "/Users/yui/.ssh/id_ed25519.pub", label: "id_ed25519.pub · yui@laptop", format: "ssh" },
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
    if (cmd === "external_tools_load") return { merge: "none", diff: "use_merge", editor: "none" };
    if (cmd === "external_tools_detected") return detectedTools;
    if (cmd === "external_tools_save") return call.args.choices;
    if (cmd === "signing_read") return signingConfig;
    if (cmd === "signing_keys") return signingKeys;
    if (cmd === "profiles_list") return { active: "default", profiles: [{ id: "default", name: "Default", author_name: "", author_email: "" }] };
    if (cmd === "lfs_status") return { installed: true, version: "3.5.1", initialized: false, patterns: [] };
    if (cmd === "git_flow_config") return null;
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

async function openRouted(start: string, extra: (call: Call) => unknown = () => undefined) {
  const calls = install(extra);
  const mounted = mountWithApp((app) => {
    const [section, setSection] = createSignal(start);
    app.openSettings = setSection;
    return <SettingsView section={section()} />;
  });
  dispose = mounted.dispose;
  await flush();
  return { ...mounted, calls };
}

const tabs = (host: ParentNode) => [...host.querySelectorAll<HTMLElement>('[role="tablist"][aria-label="Settings sections"] [role="tab"]')];
const search = (host: ParentNode) => host.querySelector<HTMLInputElement>('input[aria-label="Search settings"]');

describe("search-first settings (S47)", () => {
  it("opens with the search field above the section tabs, Repositories among them", async () => {
    const { host } = await openRouted("git");

    expect(host.querySelector(".settings-top")?.firstElementChild?.contains(search(host))).toBe(true);
    expect(tabs(host).map((tab) => tab.textContent?.trim())).toEqual(["General", "Git", "External tools", "Repositories", "Appearance", "AI", "Platforms", "Jira", "Git hosts", "Privacy & diagnostics"]);
    expect(tabs(host).find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent?.trim()).toBe("Git");
  });

  it("lists matching settings across sections with breadcrumbs, counts them on the tabs, and clears with Esc", async () => {
    const { host } = await openRouted("tools");
    type(search(host), "ssh");
    await flush();

    expect(host.querySelector('.settings-body [role="status"]')?.textContent).toBe("4 settings match “ssh”");
    expect([...host.querySelectorAll(".setting-result")].map((result) => result.querySelector(".setting-crumb")?.textContent)).toEqual(["Git › SSH", "Git › Commit signing", "Git › Commit signing", "Git hosts"]);
    expect(tabs(host).find((tab) => tab.textContent?.startsWith("Git hosts"))?.querySelector(".count")?.textContent).toBe("1");
    expect(tabs(host).find((tab) => tab.textContent?.startsWith("Git") && !tab.textContent.startsWith("Git hosts"))?.querySelector(".count")?.textContent).toBe("3");
    expect(tabs(host).every((tab) => tab.getAttribute("aria-selected") === "false")).toBe(true);
    expect(host.textContent).not.toContain("External editor");

    search(host)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flush();
    expect(search(host)?.value).toBe("");
    expect(host.textContent).toContain("External editor");
  });

  it("opens the chosen result's section and moves focus to that setting", async () => {
    const { host } = await openRouted("general");
    type(search(host), "default branch");
    await flush();
    host.querySelector<HTMLButtonElement>(".setting-result")?.click();
    await flush(40);

    expect(tabs(host).find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent?.trim()).toBe("Git");
    expect(document.activeElement?.id).toBe("setting-default-branch");
  });

  it("says when nothing matches and suggests terms", async () => {
    const { host } = await openRouted("general");
    type(search(host), "zzz");
    await flush();

    expect(host.querySelector('.settings-body [role="status"]')?.textContent).toBe("No setting matches “zzz”. Try “fetch”, “branch”, “AI”, or “folder”.");
  });

  it("lists the scanned folders in Repositories with Rescan, Stop scanning, and Add folder…", async () => {
    const { host } = await openRouted("repositories", (call) => {
      if (call.cmd === "repositories_list") return { folders: [{ path: "/u/Code", depth: 2, scanned_at: 1, repos: ["/u/Code/a"], skipped: [] }], repos: [{ path: "/u/Code/a", folder: "/u/Code", opened_at: null }] };
      if (call.cmd === "recent_statuses") return [];
      return undefined;
    });
    await flush(40);

    expect(host.querySelector('[aria-label="Scanned folders"]')?.textContent).toMatch(/\/u\/Code1 repository · 2 levels deep · scanned \w+ ago/);
    expect(host.querySelector('button[aria-label="Rescan /u/Code"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Stop scanning /u/Code"]')).not.toBeNull();
    buttonNamed(host, "Add folder…")?.click();
    await flush();
    expect(document.querySelector('[role="dialog"] h3')?.textContent).toBe("Add a folder to scan");
  });
});

const optionsOf = async (host: ParentNode, label: string) => {
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click();
  await flush();
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
};
const optionText = (option: HTMLElement) => option.querySelector(".select-option-label")?.textContent;
const closeList = async () => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  document.querySelector<HTMLElement>(".select-list")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flush();
};
const savedChoices = (calls: Call[]) => calls.filter((call) => call.cmd === "external_tools_save").map((call) => call.args.choices);

describe("external tools (S54)", () => {
  it("lists None, Git config default, then only the merge tools found, and saves the chosen tool", async () => {
    const { host, calls } = await open("tools");

    const options = await optionsOf(host, "External merge tool");
    expect(options.map(optionText)).toEqual(["None", "Git config default", "FileMerge", "Visual Studio Code"]);
    await closeList();
    await choose(host, "External merge tool", "FileMerge");

    expect(savedChoices(calls)).toEqual([{ merge: "filemerge", diff: "use_merge", editor: "none" }]);
  });

  it("makes Git config default aria-disabled with the reason when Git has no merge.tool, and ignores a click on it", async () => {
    const { host, calls } = await open("tools");

    const gitConfig = (await optionsOf(host, "External merge tool")).find((option) => optionText(option) === "Git config default");
    expect(gitConfig?.getAttribute("aria-disabled")).toBe("true");
    expect(gitConfig?.getAttribute("title")).toBe("No merge.tool in your Git config");
    gitConfig?.click();
    await flush();

    expect(savedChoices(calls)).toEqual([]);
  });

  it("enables Git config default and names the tool when merge.tool is set", async () => {
    const { host, calls } = await openRouted("tools", (call) => (call.cmd === "external_tools_detected" ? { ...detectedTools, git_merge_tool: "vimdiff" } : undefined));

    const gitConfig = (await optionsOf(host, "External merge tool")).find((option) => optionText(option) === "Git config default");
    expect(gitConfig?.hasAttribute("aria-disabled")).toBe(false);
    expect(gitConfig?.querySelector(".select-option-hint")?.textContent).toBe("vimdiff");
    gitConfig?.click();
    await flush();

    expect(savedChoices(calls)).toEqual([{ merge: "git_config", diff: "use_merge", editor: "none" }]);
  });

  it("offers Use merge tool, None, and Git config default (disabled without diff.tool) for the diff tool", async () => {
    const { host, calls } = await openRouted("tools", (call) => (call.cmd === "external_tools_detected" ? { ...detectedTools, git_diff_tool: null } : undefined));

    const options = await optionsOf(host, "External diff tool");
    expect(options.map(optionText)).toEqual(["Use merge tool", "None", "Git config default", "FileMerge", "Visual Studio Code"]);
    expect(options[2]?.getAttribute("title")).toBe("No diff.tool in your Git config");
    expect(options[2]?.getAttribute("aria-disabled")).toBe("true");
    await closeList();
    await choose(host, "External diff tool", "None");

    expect(savedChoices(calls)).toEqual([{ merge: "none", diff: "none", editor: "none" }]);
  });

  it("lists None, Custom, then each editor found, and shows the command field only for Custom", async () => {
    const { host, calls } = await openRouted("tools", (call) => (call.cmd === "external_tools_load" ? { merge: "none", diff: "use_merge", editor: "custom" } : undefined));

    expect(host.querySelector('input[aria-label="Custom editor command"]')).not.toBeNull();
    expect(host.textContent).toContain("added as the last argument");
    const options = await optionsOf(host, "External editor");
    expect(options.map(optionText)).toEqual(["None", "Custom", "Visual Studio Code", "Cursor"]);
    await closeList();
    const command = host.querySelector<HTMLInputElement>('input[aria-label="Custom editor command"]');
    type(command, " code -r ");
    command?.dispatchEvent(new FocusEvent("blur"));
    await flush();

    expect(savedSettings(calls).at(-1)?.editor_command).toBe("code -r");
    expect(calls.filter((call) => call.cmd === "external_tools_save")).toHaveLength(0);
  });

  it("hides the custom command for a found editor and saves the choice", async () => {
    const { host, calls } = await open("tools");

    expect(host.querySelector('input[aria-label="Custom editor command"]')).toBeNull();
    await choose(host, "External editor", "Cursor");

    expect(savedChoices(calls)).toEqual([{ merge: "none", diff: "use_merge", editor: "cursor" }]);
  });

  it("keeps a stored tool that is no longer installed visible but unselectable", async () => {
    const { host } = await openRouted("tools", (call) => (call.cmd === "external_tools_load" ? { merge: "kaleidoscope", diff: "use_merge", editor: "none" } : undefined));

    expect(host.querySelector('button[aria-label="External merge tool"]')?.textContent).toContain("Kaleidoscope");
    const missing = (await optionsOf(host, "External merge tool")).find((option) => optionText(option) === "Kaleidoscope");
    expect(missing?.getAttribute("aria-disabled")).toBe("true");
    expect(missing?.getAttribute("title")).toBe("Not installed on this Mac");
  });

  it("moves the external terminal command into External tools and keeps it saved with the settings", async () => {
    const general = await open("general");
    expect(general.host.querySelector('input[aria-label="External terminal command"]')).toBeNull();
    expect(general.host.querySelector('button[aria-label="External editor"]')).toBeNull();
    general.dispose();

    const { host, calls } = await open("tools");
    const terminal = host.querySelector<HTMLInputElement>('input[aria-label="External terminal command"]');
    type(terminal, "open -a iTerm");
    terminal?.dispatchEvent(new FocusEvent("blur"));
    await flush();

    expect(savedSettings(calls).at(-1)?.terminal_command).toBe("open -a iTerm");
  });

  it("detects the tools against the open repository so its merge.tool counts", async () => {
    const calls = install();
    const mounted = mountWithApp(() => <SettingsView section="tools" />);
    dispose = mounted.dispose;
    await mounted.app.boot();
    await flush();

    expect(calls.filter((call) => call.cmd === "external_tools_detected").map((call) => call.args)).toContainEqual({ path: "/r" });
  });
});

describe("commit signing (S59)", () => {
  const written = (calls: Call[]) => calls.filter((call) => call.cmd === "signing_write").map((call) => call.args);

  it("reads the global Git config first and saves each change to it", async () => {
    const { host, calls } = await open("git");

    expect(calls.find((call) => call.cmd === "signing_read")?.args).toEqual({ scope: "global", path: null });
    host.querySelector<HTMLButtonElement>('button[aria-label="Sign commits"]')?.click();
    await flush();
    host.querySelector<HTMLButtonElement>('button[aria-label="Sign tags"]')?.click();
    await flush();

    expect(written(calls)).toEqual([
      { scope: "global", path: null, config: { ...signingConfig, sign_commits: true } },
      { scope: "global", path: null, config: { ...signingConfig, sign_tags: true } },
    ]);
  });

  it("applies signing to this repository when it is chosen, and disables that choice without a repository", async () => {
    const closed = await open("git");
    const closedOptions = await optionsOf(closed.host, "Apply signing to");
    expect(closedOptions.map(optionText)).toEqual(["All repositories (global Git config)", "This repository"]);
    expect(closedOptions[1]?.getAttribute("title")).toBe("Open a repository to change its signing settings");
    expect(closedOptions[1]?.getAttribute("aria-disabled")).toBe("true");
    closed.dispose();

    const calls = install();
    const mounted = mountWithApp(() => <SettingsView section="git" />);
    dispose = mounted.dispose;
    await mounted.app.boot();
    await flush();
    await choose(mounted.host, "Apply signing to", "This repository: r");
    mounted.host.querySelector<HTMLButtonElement>('button[aria-label="Sign commits"]')?.click();
    await flush();

    expect(calls.filter((call) => call.cmd === "signing_read").map((call) => call.args)).toContainEqual({ scope: "repository", path: "/r" });
    expect(written(calls)).toEqual([{ scope: "repository", path: "/r", config: { ...signingConfig, sign_commits: true } }]);
  });

  it("offers the format, the keys of that format, and Custom for the signing key", async () => {
    let stored: Record<string, unknown> = signingConfig;
    const { host, calls } = await openRouted("git", (call) => {
      if (call.cmd === "signing_write") {
        stored = call.args.config as Record<string, unknown>;
        return null;
      }
      return call.cmd === "signing_read" ? stored : undefined;
    });

    expect((await optionsOf(host, "Signing format")).map(optionText)).toEqual(["OpenPGP", "SSH", "X.509"]);
    await closeList();
    await choose(host, "Signing format", "SSH");
    expect((await optionsOf(host, "Signing key")).map(optionText)).toEqual(["Git default", "id_ed25519.pub · yui@laptop", "Custom"]);
    await closeList();
    await choose(host, "Signing format", "X.509");

    expect(written(calls).map((call) => (call.config as { format: string }).format)).toEqual(["ssh", "x509"]);
    expect((await optionsOf(host, "Signing key")).map(optionText)).toEqual(["Git default", "Custom"]);
  });

  it("lists the OpenPGP keys by identity and key ID and saves the chosen key", async () => {
    const { host, calls } = await open("git");

    expect((await optionsOf(host, "Signing key")).map(optionText)).toEqual(["Git default", "Yui Lin <yui@example.test> · AAAABBBBCCCCDDDD", "Custom"]);
    await closeList();
    await choose(host, "Signing key", "Yui Lin");

    expect(written(calls).at(-1)?.config).toMatchObject({ key: "AAAABBBBCCCCDDDD" });
  });

  it("asks for a custom key after Custom, and saves the program with its own field", async () => {
    const { host, calls } = await open("git");

    await choose(host, "Signing key", "Custom");
    const key = host.querySelector<HTMLInputElement>('input[aria-label="Custom signing key"]');
    expect(key).not.toBeNull();
    type(key, " ABCD1234 ");
    key?.dispatchEvent(new FocusEvent("blur"));
    await flush();
    const program = host.querySelector<HTMLInputElement>('input[aria-label="Signing program"]');
    type(program, "/opt/homebrew/bin/gpg");
    program?.dispatchEvent(new FocusEvent("blur"));
    await flush();

    expect(written(calls).map((call) => call.config)).toEqual([
      { ...signingConfig, key: "ABCD1234" },
      { ...signingConfig, program: "/opt/homebrew/bin/gpg" },
    ]);
  });

  it("shows the refusal of the core", async () => {
    const { host } = await openRouted("git", (call) => {
      if (call.cmd === "signing_write") throw { kind: "git_failed", message: "`git config` exited with status 255: bad config", output: null };
      return undefined;
    });

    host.querySelector<HTMLButtonElement>('button[aria-label="Sign commits"]')?.click();
    await flush();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("bad config");
  });
});

describe("profiles, Git LFS, and Git Flow placement", () => {
  it("shows the profiles in General, and Git LFS and Git Flow in This repository", async () => {
    const general = await open("general");
    expect(general.host.querySelector('[aria-label="Profiles"]')?.textContent).toContain("Uses the name and email in your Git config");
    general.dispose();

    const calls = install();
    const mounted = mountWithApp(() => <SettingsView section="repository" />);
    dispose = mounted.dispose;
    await mounted.app.boot();
    await flush(40);

    for (const cmd of ["lfs_status", "git_flow_config"]) {
      const asked = calls.filter((call) => call.cmd === cmd).map((call) => call.args);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.every((args) => args.path === "/r")).toBe(true);
    }
    expect(mounted.host.textContent).toContain("Git LFS 3.5.1");
    expect(buttonNamed(mounted.host, "Initialize Git Flow")).toBeDefined();
  });
});

describe("search results in This repository (S58, S57)", () => {
  it("opens This repository and moves focus to the Git LFS and Git Flow settings", async () => {
    install();
    const mounted = mountWithApp((app) => {
      const [section, setSection] = createSignal("git");
      app.openSettings = setSection;
      return <SettingsView section={section()} />;
    });
    dispose = mounted.dispose;
    await mounted.app.boot();
    await flush();

    type(search(mounted.host), "lfs");
    await flush();
    mounted.host.querySelector<HTMLButtonElement>(".setting-result")?.click();
    await flush(80);
    expect(document.activeElement?.id).toBe("setting-lfs");

    type(search(mounted.host), "hotfix prefix");
    await flush();
    mounted.host.querySelector<HTMLButtonElement>(".setting-result")?.click();
    await flush(80);
    expect(document.activeElement?.id).toBe("setting-git-flow");
  });
});
