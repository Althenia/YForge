import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { Profile } from "../ipc/bindings/Profile";
import type { ProfileList } from "../ipc/bindings/ProfileList";
import { ProfilesSettings } from "./ProfilesSettings";
import { buttonNamed, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string; args: Record<string, unknown> };

const standard = (): ProfileList => ({
  active: "default",
  profiles: [
    { id: "default", name: "Default", author_name: "", author_email: "" },
    { id: "work", name: "Work", author_name: "Ana Ruiz", author_email: "ana@work.test" },
  ],
});

async function open(refuse?: { cmd: string; message: string }) {
  const state = standard();
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
    calls.push(call);
    if (refuse?.cmd === cmd) throw { kind: "invalid_request", message: refuse.message, output: null };
    if (cmd === "profiles_list") return structuredClone(state);
    if (cmd === "profile_save") {
      const draft = call.args.draft as Omit<Profile, "id">;
      const id = call.args.id as string | null;
      const saved = { id: id ?? "profile-3", ...draft };
      state.profiles = id === null ? [...state.profiles, saved] : state.profiles.map((profile) => (profile.id === id ? saved : profile));
      return saved;
    }
    if (cmd === "profile_delete") {
      state.profiles = state.profiles.filter((profile) => profile.id !== call.args.id);
      return null;
    }
    if (cmd === "profile_switch") {
      state.active = call.args.id as string;
      return null;
    }
    if (cmd === "session_load") return { tabs: [], active: 0, groups: [] };
    if (cmd === "settings_load") return { theme: "system", density: "default", default_branch: "main", pull_mode: "fast_forward_or_merge", auto_fetch_minutes: 0, editor_command: "", terminal_command: "", telemetry_opt_in: false, gravatar_avatars: true, ssh_key_path: null };
    if (cmd === "activity_list" || cmd === "recents_list" || cmd === "repo_aliases_list") return [];
    if (cmd === "launch_path") return "/nowhere";
    return null;
  });
  const mounted = mountWithApp(() => <ProfilesSettings />);
  dispose = mounted.dispose;
  await flush(40);
  return { ...mounted, calls, state };
}

const rows = (host: ParentNode) => [...host.querySelectorAll(".tool-list li")].map((row) => row.textContent?.replace(/\s+/g, " ").trim());
const input = (host: ParentNode, label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
const saves = (calls: Call[]) => calls.filter((call) => call.cmd === "profile_save").map((call) => call.args);

describe("profiles (S60)", () => {
  it("lists the profiles with their authors, marks the active one, and says the Default author comes from Git config", async () => {
    const { host } = await open();

    expect(rows(host)).toEqual(["DefaultActiveUses the name and email in your Git configSwitchEditDelete", "WorkAna Ruiz <ana@work.test>SwitchEditDelete"]);
    expect(host.textContent).toContain("The Default profile uses the name and email in your Git config until you give it an author.");
  });

  it("adds a profile with a name, an author name, and an author email", async () => {
    const { host, calls } = await open();

    buttonNamed(host, "Add profile…")?.click();
    await flush();
    type(input(host, "Profile name"), "Client");
    type(input(host, "Author name"), "Ana R.");
    type(input(host, "Author email"), "ana@client.test");
    buttonNamed(host, "Add profile")?.click();
    await flush(40);

    expect(saves(calls)).toEqual([{ id: null, draft: { name: "Client", author_name: "Ana R.", author_email: "ana@client.test" } }]);
    expect(rows(host)).toContain("ClientAna R. <ana@client.test>SwitchEditDelete");
    expect(input(host, "Profile name")).toBeNull();
  });

  it("renames a profile through its id and keeps the author", async () => {
    const { host, calls } = await open();

    [...host.querySelectorAll(".tool-list li")][1]?.querySelectorAll("button")[1]?.click();
    await flush();
    expect(input(host, "Profile name")?.value).toBe("Work");
    type(input(host, "Profile name"), "Client work");
    buttonNamed(host, "Save profile")?.click();
    await flush(40);

    expect(saves(calls)).toEqual([{ id: "work", draft: { name: "Client work", author_name: "Ana Ruiz", author_email: "ana@work.test" } }]);
    expect(rows(host)[1]).toBe("Client workAna Ruiz <ana@work.test>SwitchEditDelete");
  });

  it("shows the core's refusal and keeps the form open", async () => {
    const { host } = await open({ cmd: "profile_save", message: "a profile named Work already exists" });

    buttonNamed(host, "Add profile…")?.click();
    await flush();
    type(input(host, "Profile name"), "Work");
    buttonNamed(host, "Add profile")?.click();
    await flush(40);

    expect(host.querySelector('[role="alert"]')?.textContent).toBe("a profile named Work already exists");
    expect(input(host, "Profile name")?.value).toBe("Work");
  });

  it("never offers deleting the active profile or Default, and deletes another after confirmation", async () => {
    const { host, calls } = await open();
    const deletes = () => [...host.querySelectorAll(".tool-list li")].map((row) => [...row.querySelectorAll("button")].find((button) => button.textContent === "Delete") as HTMLButtonElement);

    expect(deletes()[0]?.getAttribute("aria-disabled")).toBe("true");
    expect(deletes()[0]?.getAttribute("data-tip")).toBe("The active profile cannot be deleted; switch to another profile first");
    deletes()[0]?.click();
    await flush();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();

    expect(deletes()[1]?.getAttribute("aria-disabled")).toBeNull();
    deletes()[1]?.click();
    await flush();
    expect(document.querySelector('[role="alertdialog"] h3')?.textContent).toBe("Delete profile Work");
    buttonNamed(document.body, "Cancel")?.click();
    await flush();
    expect(calls.some((call) => call.cmd === "profile_delete")).toBe(false);

    deletes()[1]?.click();
    await flush();
    buttonNamed(document.body, "Delete profile")?.click();
    await flush(40);

    expect(calls.filter((call) => call.cmd === "profile_delete").map((call) => call.args)).toEqual([{ id: "work" }]);
    expect(rows(host)).toEqual(["DefaultActiveUses the name and email in your Git configSwitchEditDelete"]);
  });

  it("explains the Default profile cannot be deleted even when another profile is active", async () => {
    const { host } = await open();

    [...host.querySelectorAll(".tool-list li")][1]?.querySelectorAll("button")[0]?.click();
    await flush(60);

    const deleteDefault = [...host.querySelectorAll(".tool-list li")][0]?.querySelectorAll("button")[2];
    expect(deleteDefault?.getAttribute("data-tip")).toBe("The Default profile cannot be deleted");
    expect(deleteDefault?.getAttribute("aria-disabled")).toBe("true");
  });

  it("saves the open tabs, switches, and loads the new profile's tabs when Switch is chosen", async () => {
    const { host, calls } = await open();

    [...host.querySelectorAll(".tool-list li")][1]?.querySelectorAll("button")[0]?.click();
    await flush(60);

    const order = calls.map((call) => call.cmd).filter((cmd) => ["session_save", "profile_switch", "session_load"].includes(cmd));
    expect(order.slice(0, 3)).toEqual(["session_save", "profile_switch", "session_load"]);
    expect(calls.find((call) => call.cmd === "profile_switch")?.args).toEqual({ id: "work" });
    expect(rows(host)[1]).toContain("Active");
    const activeSwitch = [...host.querySelectorAll(".tool-list li")][1]?.querySelectorAll("button")[0];
    expect(activeSwitch?.getAttribute("aria-disabled")).toBe("true");
  });
});
