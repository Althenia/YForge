import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UrlIdentity } from "../ipc/bindings/UrlIdentity";
import { CloneDialog } from "./EntryDialogs";
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

const identity = (overrides: Partial<UrlIdentity>): UrlIdentity => ({ transport: "ssh", source: "agent", host: null, ssh_key_path: null, https_user: null, ...overrides });

const corpB = identity({ source: "host", host: "gitlab.corp-b.com:2222", ssh_key_path: "/Users/yui/.ssh/id_corp_b" });
const corpAHttps = identity({ transport: "https", source: "host", host: "gitlab.corp-a.com", https_user: "you" });

const DEBOUNCE_PAUSE = 400;

async function mountClone(identities: (url: string) => UrlIdentity | Error = () => identity({}), respond: (call: Call) => unknown = () => undefined) {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
      calls.push(call);
      const custom = respond(call);
      if (custom instanceof Error) throw { kind: "invalid_request", message: custom.message, output: null };
      if (custom !== undefined) return custom;
      switch (cmd) {
        case "git_identity_for_url": {
          const found = identities(String(call.args.url));
          if (found instanceof Error) throw { kind: "storage_failed", message: found.message, output: null };
          return found;
        }
        case "plugin:path|resolve_directory":
          return "/Users/yui";
        case "app_ui_prefs_load":
          return { palette_recents: [], last_parent_folder: null };
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
  const mounted = mountWithApp(() => <CloneDialog onClose={() => undefined} />);
  dispose = mounted.dispose;
  await flush(40);
  return { ...mounted, calls };
}

const urlInput = (host: ParentNode) => host.querySelector<HTMLInputElement>('input[aria-label="Repository URL"]');
const identityCalls = (calls: Call[]) => calls.filter((call) => call.cmd === "git_identity_for_url");
const identityRow = (host: ParentNode) => host.querySelector<HTMLElement>(".identity");

async function typeUrl(host: ParentNode, url: string): Promise<void> {
  type(urlInput(host), url);
  await flush(DEBOUNCE_PAUSE);
}

describe("clone dialog identity line (S40)", () => {
  it("asks for a URL before it names an identity and does not call the core yet", async () => {
    const { host, calls } = await mountClone();

    expect(identityRow(host)?.textContent).toContain("Type a URL to see which identity it uses.");
    expect(identityCalls(calls)).toEqual([]);
    expect(buttonNamed(host, "Clone")?.disabled).toBe(true);
  });

  it("asks the core once, after the typing pauses, with the final URL", async () => {
    const { host, calls } = await mountClone();

    type(urlInput(host), "git@gitlab.corp-b.com:2222/p");
    type(urlInput(host), "git@gitlab.corp-b.com:2222/payments");
    type(urlInput(host), "git@gitlab.corp-b.com:2222/payments/ledger.git");
    await flush(60);
    expect(identityCalls(calls)).toEqual([]);
    expect(identityRow(host)?.textContent).toContain("Checking which identity this URL uses");
    await flush(DEBOUNCE_PAUSE);

    expect(identityCalls(calls).map((call) => call.args)).toEqual([{ url: "git@gitlab.corp-b.com:2222/payments/ledger.git" }]);
  });

  it("states the matched identity and its SSH key path for an SSH URL", async () => {
    const { host } = await mountClone(() => corpB);

    await typeUrl(host, "git@gitlab.corp-b.com:2222/payments/ledger.git");

    const row = identityRow(host);
    expect(row?.querySelector("strong")?.textContent).toBe("Uses the gitlab.corp-b.com:2222 identity");
    expect(row?.querySelector(".mono")?.textContent).toBe("~/.ssh/id_corp_b");
  });

  it("states the HTTPS user and where the password comes from for an HTTPS URL, with Change opening Git hosts", async () => {
    const { host, app } = await mountClone(() => corpAHttps);
    const openSettings = vi.spyOn(app, "openSettings");

    await typeUrl(host, "https://gitlab.corp-a.com/platform/api.git");

    const row = identityRow(host);
    expect(row?.querySelector("strong")?.textContent).toBe("Uses the gitlab.corp-a.com identity");
    expect(row?.textContent).toContain("HTTPS as you; the password or token comes from the macOS Keychain, or YForge asks once and can save it there.");
    expect(row?.querySelector("b")?.textContent).toBe("you");
    buttonNamed(row as HTMLElement, "Change")?.click();
    expect(openSettings).toHaveBeenCalledWith("git-hosts");
  });

  it("says the SSH agent and ~/.ssh/config are used when no host matches and no app key is set", async () => {
    const { host } = await mountClone(() => identity({}));

    await typeUrl(host, "git@github.com:me/lab.git");

    expect(identityRow(host)?.querySelector("strong")?.textContent).toBe("Uses your SSH agent and ~/.ssh/config");
    expect(buttonNamed(identityRow(host) as HTMLElement, "Change")).toBeUndefined();
  });

  it("names the app-wide key when no host matches", async () => {
    const { host } = await mountClone(() => identity({ source: "app", ssh_key_path: "/Users/yui/.ssh/id_app" }));

    await typeUrl(host, "git@github.com:me/lab.git");

    expect(identityRow(host)?.querySelector("strong")?.textContent).toBe("Uses the app-wide SSH key");
    expect(identityRow(host)?.querySelector(".mono")?.textContent).toBe("~/.ssh/id_app");
  });

  it("says a matched identity without a key uses the agent, and an unmatched HTTPS URL has no host identity", async () => {
    const answers: Record<string, UrlIdentity> = {
      "git@github.com:me/lab.git": identity({ source: "host", host: "github.com" }),
      "https://example.test/repo.git": identity({ transport: "https" }),
    };
    const { host } = await mountClone((url) => answers[url] as UrlIdentity);

    await typeUrl(host, "git@github.com:me/lab.git");
    expect(identityRow(host)?.textContent).toContain("Uses the github.com identity");
    expect(identityRow(host)?.textContent).toContain("SSH with your SSH agent and ~/.ssh/config");
    await typeUrl(host, "https://example.test/repo.git");
    expect(identityRow(host)?.querySelector("strong")?.textContent).toBe("No host identity matches");
    expect(identityRow(host)?.textContent).toContain("the password or token comes from the macOS Keychain");
  });

  it("needs no identity for a local path and keeps the hint while the address is not valid", async () => {
    const { host, calls } = await mountClone(() => identity({ transport: "other" }));

    await typeUrl(host, "not a url");
    expect(identityRow(host)?.textContent).toContain("Type a URL to see which identity it uses.");
    expect(identityCalls(calls)).toEqual([]);
    await typeUrl(host, "/srv/git/repo.git");
    expect(identityRow(host)?.querySelector("strong")?.textContent).toBe("No identity is used");
  });

  it("says the identity could not be read instead of guessing", async () => {
    const { host } = await mountClone(() => new Error("the state database is locked"));

    await typeUrl(host, "git@github.com:me/lab.git");

    expect(identityRow(host)?.textContent).toContain("Could not read the identity for this URL: the state database is locked");
  });

  it("keeps naming the identity while the clone runs and offers Cancel clone", async () => {
    let finish: (root: string) => void = () => undefined;
    const { host, calls } = await mountClone(
      () => corpB,
      (call) => (call.cmd === "clone_repo" ? new Promise((resolve) => (finish = resolve)) : undefined),
    );
    await typeUrl(host, "git@gitlab.corp-b.com:2222/payments/ledger.git");

    buttonNamed(host, "Clone")?.click();
    await flush();
    const cloneId = calls.find((call) => call.cmd === "clone_repo")?.args.id;
    await emit("operation-progress", { id: cloneId, phase: "Receiving objects", percent: 42 });
    await flush();

    expect(identityRow(host)?.querySelector("strong")?.textContent).toBe("Uses the gitlab.corp-b.com:2222 identity");
    expect(host.querySelector(".entry-progress")?.textContent).toContain("Receiving objects 42%");
    expect(host.textContent).toContain("Cancelling a clone removes the partial folder.");
    buttonNamed(host, "Cancel clone")?.click();
    await flush();
    expect(calls.find((call) => call.cmd === "operation_cancel")?.args).toEqual({ id: cloneId });
    finish("/Users/yui/ledger");
    await flush(40);
  });

  it("explains a refused key, names where nothing was written, and offers Copy public key, Edit host identity, and Try again", async () => {
    let attempts = 0;
    const { host, calls, app } = await mountClone(
      () => corpB,
      (call) => {
        if (call.cmd === "ssh_public_key") return "ssh-ed25519 AAAAC3Nza yui@laptop";
        if (call.cmd !== "clone_repo") return undefined;
        attempts += 1;
        throw { kind: "auth_failed", message: "Authentication failed for git@gitlab.corp-b.com:2222/payments/ledger.git", output: "git@gitlab.corp-b.com: Permission denied (publickey)." };
      },
    );
    const openSettings = vi.spyOn(app, "openSettings");
    await typeUrl(host, "git@gitlab.corp-b.com:2222/payments/ledger.git");

    buttonNamed(host, "Clone")?.click();
    await flush(40);

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.querySelector("strong")?.textContent).toBe("gitlab.corp-b.com:2222 refused the key");
    expect(alert?.textContent).toContain("Permission denied (publickey).");
    expect(alert?.textContent).toContain("Add the public key to your account on gitlab.corp-b.com:2222, or choose another key for this host.");
    expect(alert?.textContent).toContain("Nothing was written to /Users/yui.");
    buttonNamed(alert as HTMLElement, "Copy public key")?.click();
    await flush(40);
    expect(calls.find((call) => call.cmd === "ssh_public_key")?.args).toEqual({ path: "/Users/yui/.ssh/id_corp_b" });
    expect(writeText).toHaveBeenCalledWith("ssh-ed25519 AAAAC3Nza yui@laptop");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Copied");
    buttonNamed(host.querySelector('[role="alert"]') as HTMLElement, "Edit host identity")?.click();
    expect(openSettings).toHaveBeenCalledWith("git-hosts");
    buttonNamed(host, "Try again")?.click();
    await flush(40);
    expect(attempts).toBe(2);
  });

  it("shows other failures as plain text and a refused HTTPS login without a key action", async () => {
    const { host } = await mountClone(
      () => corpAHttps,
      (call) => {
        if (call.cmd !== "clone_repo") return undefined;
        throw { kind: "auth_failed", message: "Authentication failed for https://gitlab.corp-a.com/platform/api.git", output: "fatal: Authentication failed" };
      },
    );
    await typeUrl(host, "https://gitlab.corp-a.com/platform/api.git");

    buttonNamed(host, "Clone")?.click();
    await flush(40);

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Authentication failed");
    expect(buttonNamed(alert as HTMLElement, "Copy public key")).toBeUndefined();
    expect(alert?.textContent).not.toContain("refused the key");
  });
});
