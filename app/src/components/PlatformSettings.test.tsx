import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { untrack } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { PlatformConnection } from "../ipc/bindings/PlatformConnection";
import { PlatformSettings } from "./PlatformSettings";
import { buttonNamed, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const connection = (id: string, overrides: Partial<PlatformConnection> = {}): PlatformConnection => ({
  id,
  kind: "github",
  host: "github.com",
  name: "GitHub",
  insecure_tls: false,
  created_at: 1,
  ...overrides,
});

type Call = { cmd: string; args: Record<string, unknown> };

async function mount(initial: PlatformConnection[], respond: (call: Call) => unknown = () => undefined) {
  const calls: Call[] = [];
  let list = initial;
  mockIPC(
    (cmd, args) => {
      const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
      calls.push(call);
      if (cmd === "platform_connections_list") return list;
      const custom = respond(call);
      if (cmd === "platform_connection_add" && custom !== undefined) list = [...list, custom as PlatformConnection];
      if (cmd === "platform_connection_remove") list = list.filter((entry) => entry.id !== call.args.id);
      return custom ?? null;
    },
    { shouldMockEvents: true },
  );
  const view = mountWithApp(() => <PlatformSettings />);
  dispose = view.dispose;
  await flush(40);
  return { ...view, calls };
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
const field = (label: string) => dialog()?.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);

describe("Settings → Platforms", () => {
  it("lists each connection with a neutral glyph, its name, kind, and host, and says when there are none", async () => {
    const { host } = await mount([connection("c1", { name: "Work", kind: "gitlab", host: "git.example.com:8443" }), connection("c2", { insecure_tls: true })]);

    const rows = [...host.querySelectorAll(".platform-row")];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Work");
    expect(rows[0]?.textContent).toContain("GitLab");
    expect(rows[0]?.textContent).toContain("git.example.com:8443");
    expect(rows[0]?.querySelector(".provider-logo.neutral svg")).not.toBeNull();
    expect(rows[0]?.querySelector("img")).toBeNull();
    expect(rows[0]?.textContent).not.toContain("Certificate not checked");
    expect(rows[1]?.textContent).toContain("Certificate not checked");
  });

  it("shows the empty state when no connection exists", async () => {
    const { host } = await mount([]);

    expect(host.textContent).toContain("No connections yet");
  });

  it("offers the three platforms and validates the host, name, and token before it calls the backend", async () => {
    const { host, calls } = await mount([]);
    buttonNamed(host, "Add connection")?.click();
    await flush();

    const kinds = [...(dialog()?.querySelectorAll('[role="radio"]') ?? [])].map((radio) => radio.textContent?.trim());
    expect(kinds).toEqual(["GitHub", "GitLab", "Bitbucket"]);
    type(field("Host"), "https://github.com/team");
    type(field("Name"), "  ");
    buttonNamed(dialog() as HTMLElement, "Add and test connection")?.click();
    await flush();

    expect(dialog()?.textContent).toContain("Enter the host only, such as github.com or git.example.com:8443, without https:// or a path");
    expect(dialog()?.textContent).toContain("Enter a name");
    expect(dialog()?.textContent).toContain("Paste an access token");
    expect(calls.some((call) => call.cmd === "platform_connection_add")).toBe(false);
  });

  it("states the risk of an untrusted certificate in plain language", async () => {
    const { host } = await mount([]);
    buttonNamed(host, "Add connection")?.click();
    await flush();

    expect(dialog()?.textContent).toContain("Accept an untrusted certificate");
    expect(dialog()?.textContent).toContain("anyone on your network could read your token and your code");
    expect(dialog()?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
  });

  it("adds a connection with the trimmed host, name, and token, defaults the name to the platform, and closes", async () => {
    const added = connection("c9", { kind: "gitlab", host: "git.example.com:8443", name: "GitLab", insecure_tls: true });
    const { host, calls } = await mount([], (call) => (call.cmd === "platform_connection_add" ? added : undefined));
    buttonNamed(host, "Add connection")?.click();
    await flush();

    ([...(dialog()?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].find((radio) => radio.textContent?.includes("GitLab")))?.click();
    await flush();
    expect(field("Name")?.value).toBe("GitLab");
    type(field("Host"), " Git.Example.com:8443 ");
    type(field("Access token"), " glpat-secret ");
    dialog()?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
    buttonNamed(dialog() as HTMLElement, "Add and test connection")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "platform_connection_add")?.args).toEqual({ kind: "gitlab", host: "Git.Example.com:8443", name: "GitLab", token: "glpat-secret", insecureTls: true });
    expect(dialog()).toBeNull();
    expect(host.querySelector(".platform-row")?.textContent).toContain("git.example.com:8443");
  });

  it("keeps the dialog open and shows the backend's message when the token is refused", async () => {
    const { host } = await mount([], (call) => {
      if (call.cmd === "platform_connection_add") throw { kind: "auth_failed", message: "Authentication failed for github.com", output: null };
      return undefined;
    });
    buttonNamed(host, "Add connection")?.click();
    await flush();
    type(field("Host"), "github.com");
    type(field("Access token"), "bad");
    buttonNamed(dialog() as HTMLElement, "Add and test connection")?.click();
    await flush(60);

    expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain("Authentication failed for github.com");
  });

  it("tests a connection and reports the verified login", async () => {
    const { host, calls } = await mount([connection("c1")], (call) => (call.cmd === "platform_connection_test" ? "yui" : undefined));

    buttonNamed(host.querySelector(".platform-row") as HTMLElement, "Test")?.click();
    await flush(40);

    expect(calls.find((call) => call.cmd === "platform_connection_test")?.args).toEqual({ id: "c1" });
    expect(host.querySelector(".platform-result")?.textContent).toContain("Connected as yui");
  });

  it("says Authentication failed for the host and offers Edit connection, which re-tests with a new token and replaces the old connection", async () => {
    const replacement = connection("c2", { name: "GitHub" });
    const { host, calls } = await mount([connection("c1")], (call) => {
      if (call.cmd === "platform_connection_test") throw { kind: "auth_failed", message: "Authentication failed for github.com", output: null };
      if (call.cmd === "platform_connection_add") return replacement;
      return undefined;
    });
    buttonNamed(host.querySelector(".platform-row") as HTMLElement, "Test")?.click();
    await flush(40);

    const result = host.querySelector(".platform-result");
    expect(result?.textContent).toContain("Authentication failed for github.com");
    buttonNamed(result as HTMLElement, "Edit connection")?.click();
    await flush();
    expect(field("Host")?.value).toBe("github.com");
    expect(field("Access token")?.value).toBe("");
    type(field("Access token"), "ghp_new");
    buttonNamed(dialog() as HTMLElement, "Save and test connection")?.click();
    await flush(60);

    const order = calls.filter((call) => call.cmd === "platform_connection_add" || call.cmd === "platform_connection_remove");
    expect(order.map((call) => call.cmd)).toEqual(["platform_connection_add", "platform_connection_remove"]);
    expect(order[0]?.args).toMatchObject({ kind: "github", host: "github.com", name: "GitHub", token: "ghp_new", insecureTls: false });
    expect(order[1]?.args).toEqual({ id: "c1" });
    expect(dialog()).toBeNull();
  });

  it("leaves the old connection in place when the new token is refused", async () => {
    const { host, calls } = await mount([connection("c1")], (call) => {
      if (call.cmd === "platform_connection_add") throw { kind: "auth_failed", message: "Authentication failed for github.com", output: null };
      return undefined;
    });
    host.querySelector<HTMLElement>('[aria-label="Edit GitHub"]')?.click();
    await flush();
    type(field("Access token"), "ghp_bad");
    buttonNamed(dialog() as HTMLElement, "Save and test connection")?.click();
    await flush(60);

    expect(calls.some((call) => call.cmd === "platform_connection_remove")).toBe(false);
    expect(dialog()?.textContent).toContain("Authentication failed for github.com");
  });

  it("confirms Remove with the Keychain consequence, then removes the connection", async () => {
    const { host, calls } = await mount([connection("c1", { name: "Work" })]);
    host.querySelector<HTMLElement>('[aria-label="Remove Work"]')?.click();
    await flush();

    expect(dialog()?.textContent).toContain("deleted from the macOS Keychain");
    expect(calls.some((call) => call.cmd === "platform_connection_remove")).toBe(false);
    buttonNamed(dialog() as HTMLElement, "Remove connection")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "platform_connection_remove")?.args).toEqual({ id: "c1" });
    expect(host.querySelector(".platform-row")).toBeNull();
  });

  it("opens the add dialog straight away when Add platform connection was chosen in the palette", async () => {
    mockIPC((cmd) => (cmd === "platform_connections_list" ? [] : null), { shouldMockEvents: true });
    const view = mountWithApp((app) => {
      untrack(() => app.addPlatformConnection());
      return <PlatformSettings />;
    });
    dispose = view.dispose;
    await flush(40);

    expect(dialog()?.textContent).toContain("Add a platform connection");
    expect(view.app.takePlatformAddRequest()).toBe(false);
  });
});
