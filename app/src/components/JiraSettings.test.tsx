import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { JiraConnection } from "../ipc/bindings/JiraConnection";
import { JiraSettings } from "./JiraSettings";
import { buttonNamed, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const cloud = (overrides: Partial<JiraConnection> = {}): JiraConnection => ({
  id: "j1",
  kind: "cloud",
  site: "https://your-site.atlassian.net",
  host: "your-site.atlassian.net",
  email: "you@example.com",
  display_name: "Sam Lee",
  projects: [
    { key: "ABC", name: "Accounts" },
    { key: "WEB", name: "Website" },
  ],
  created_at: 1,
  ...overrides,
});

const server = (overrides: Partial<JiraConnection> = {}): JiraConnection =>
  cloud({ id: "j2", kind: "data_center", site: "https://jira.corp-b.internal", host: "jira.corp-b.internal", email: null, display_name: "you", projects: [{ key: "OPS", name: "Operations" }], ...overrides });

type Call = { cmd: string; args: Record<string, unknown> };

async function mount(initial: JiraConnection[], respond: (call: Call) => unknown = () => undefined) {
  const calls: Call[] = [];
  let list = initial;
  mockIPC(
    (cmd, args) => {
      const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
      calls.push(call);
      if (cmd === "jira_connections_list") return list;
      if (cmd === "jira_field_problem") {
        const { field, value } = call.args as { field: string; value: string };
        if (field === "site" && value.trim() === "") return "enter the site address, such as https://your-site.atlassian.net";
        if (field === "email" && !value.includes("@")) return "enter the email address of the Atlassian account that owns the API token";
        if (field === "token" && value.trim() === "") return "the access token is required";
        return null;
      }
      const custom = respond(call);
      if (cmd === "jira_connection_add" && custom !== undefined) list = [...list, custom as JiraConnection];
      if (cmd === "jira_connection_remove") list = list.filter((entry) => entry.id !== call.args.id);
      return custom ?? null;
    },
    { shouldMockEvents: true },
  );
  const view = mountWithApp(() => <JiraSettings />);
  dispose = view.dispose;
  await flush(40);
  return { ...view, calls };
}

const input = (host: ParentNode, label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);

describe("Settings → Jira", () => {
  it("says no site is connected and offers the Cloud form with a never-shown token", async () => {
    const { host } = await mount([]);

    expect(host.textContent).toContain("No Jira site is connected.");
    expect(host.querySelector('[role="radiogroup"][aria-label="Jira kind"] [aria-checked="true"]')?.textContent).toBe("Jira Cloud");
    expect(input(host, "Site address")).not.toBeNull();
    expect(input(host, "Email")).not.toBeNull();
    expect(input(host, "API token")?.type).toBe("password");
    expect(host.textContent).toContain("Stored in the macOS Keychain and never shown again");
    expect(buttonNamed(host, "Cancel")).toBeUndefined();
  });

  it("asks Data Center for a personal access token only", async () => {
    const { host } = await mount([]);

    [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((radio) => radio.textContent === "Jira Data Center")?.click();
    await flush();

    expect(input(host, "Email")).toBeNull();
    expect(input(host, "Personal access token")).not.toBeNull();
  });

  it("connects a Cloud site with the email and token and closes nothing it did not open", async () => {
    const { host, calls } = await mount([], (call) => (call.cmd === "jira_connection_add" ? cloud() : undefined));
    type(input(host, "Site address"), " https://your-site.atlassian.net ");
    type(input(host, "Email"), "you@example.com");
    type(input(host, "API token"), "tok-1");
    await flush(40);

    buttonNamed(host, "Connect")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "jira_connection_add")?.args).toEqual({ kind: "cloud", site: "https://your-site.atlassian.net", email: "you@example.com", token: "tok-1" });
    expect(host.querySelector("section.jira-card")?.textContent).toContain("Jira Cloud · Connected as Sam Lee");
    expect(host.textContent).not.toContain("tok-1");
  });

  it("sends no email for Data Center", async () => {
    const { host, calls } = await mount([], (call) => (call.cmd === "jira_connection_add" ? server() : undefined));
    [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((radio) => radio.textContent === "Jira Data Center")?.click();
    await flush();
    type(input(host, "Site address"), "https://jira.corp-b.internal");
    type(input(host, "Personal access token"), "pat-1");
    await flush(40);

    buttonNamed(host, "Connect")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "jira_connection_add")?.args).toEqual({ kind: "data_center", site: "https://jira.corp-b.internal", email: null, token: "pat-1" });
  });

  it("states the core's problems in text and does not call add while a field has one", async () => {
    const { host, calls } = await mount([]);
    await flush(40);

    const connect = buttonNamed(host, "Connect");
    expect(connect?.getAttribute("aria-disabled")).toBe("true");
    connect?.click();
    await flush(40);

    expect(host.textContent).toContain("enter the site address");
    expect(calls.some((call) => call.cmd === "jira_connection_add")).toBe(false);
  });

  it("shows a refused token as text on the form", async () => {
    const { host } = await mount([], (call) => {
      if (call.cmd === "jira_connection_add") throw { kind: "auth_failed", message: "Authentication failed for your-site.atlassian.net", output: null };
      return undefined;
    });
    type(input(host, "Site address"), "https://your-site.atlassian.net");
    type(input(host, "Email"), "you@example.com");
    type(input(host, "API token"), "bad");
    await flush(40);

    buttonNamed(host, "Connect")?.click();
    await flush(60);

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Authentication failed for your-site.atlassian.net");
  });

  it("lists each site with its glyph, subtitle, projects, and where the token lives", async () => {
    const { host } = await mount([cloud(), server()]);

    const cards = [...host.querySelectorAll("section.jira-card")];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("your-site.atlassian.net");
    expect(cards[0]?.textContent).toContain("Jira Cloud · Connected as Sam Lee");
    expect(cards[0]?.textContent).toContain("ABC Accounts · WEB Website");
    expect(cards[0]?.textContent).toContain("API token for you@example.com, stored in the macOS Keychain");
    expect(cards[1]?.textContent).toContain("Personal access token, stored in the macOS Keychain");
    expect(cards[0]?.querySelector(".provider-logo.neutral svg")).not.toBeNull();
    expect(host.querySelector("form")).toBeNull();
    expect(buttonNamed(host, "Connect a site")).toBeDefined();
  });

  it("claims no connection state in the card header until a test has run, as the platform connections do", async () => {
    const { host } = await mount([cloud()]);

    expect(host.querySelector("section.jira-card .card-head .chip")).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("tests a connection and reports Connected as the display name", async () => {
    const { host } = await mount([cloud()], (call) => (call.cmd === "jira_connection_test" ? "Sam Lee" : undefined));

    host.querySelector<HTMLButtonElement>('button[aria-label="Test your-site.atlassian.net"]')?.click();
    await flush(40);

    expect(host.querySelector('[role="status"]')?.textContent).toContain("Connected as Sam Lee");
  });

  it("reports an authentication failure in text with Edit connection", async () => {
    const { host } = await mount([server()], (call) => {
      if (call.cmd === "jira_connection_test") throw { kind: "auth_failed", message: "Authentication failed for jira.corp-b.internal", output: null };
      return undefined;
    });

    host.querySelector<HTMLButtonElement>('button[aria-label="Test jira.corp-b.internal"]')?.click();
    await flush(40);

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Authentication failed for jira.corp-b.internal");
    expect(host.textContent).toContain("Authentication failed");
    expect(buttonNamed(alert as HTMLElement, "Edit connection")).toBeDefined();
    expect(buttonNamed(alert as HTMLElement, "Test again")).toBeDefined();
  });

  it("edits by connecting the new token first and then removing the old connection", async () => {
    const { host, calls } = await mount([cloud()], (call) => (call.cmd === "jira_connection_add" ? cloud({ id: "j9" }) : undefined));
    host.querySelector<HTMLButtonElement>('button[aria-label="Edit your-site.atlassian.net"]')?.click();
    await flush();
    expect((input(host, "API token") as HTMLInputElement).value).toBe("");
    expect(host.textContent).toContain("The saved token is never shown");
    type(input(host, "API token"), "new-token");
    await flush(40);

    buttonNamed(host, "Save and test connection")?.click();
    await flush(60);

    const order = calls.map((call) => call.cmd).filter((cmd) => cmd === "jira_connection_add" || cmd === "jira_connection_remove");
    expect(order).toEqual(["jira_connection_add", "jira_connection_remove"]);
  });

  it("confirms Remove with a text-labelled danger button that is not the default focus", async () => {
    const { host, calls } = await mount([cloud()]);

    host.querySelector<HTMLButtonElement>('button[aria-label="Remove your-site.atlassian.net"]')?.click();
    await flush();
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    const remove = buttonNamed(dialog, "Remove connection");

    expect(remove?.classList.contains("danger")).toBe(true);
    expect(document.activeElement).not.toBe(remove);
    remove?.click();
    await flush(40);
    expect(calls.some((call) => call.cmd === "jira_connection_remove" && call.args.id === "j1")).toBe(true);
  });
});
