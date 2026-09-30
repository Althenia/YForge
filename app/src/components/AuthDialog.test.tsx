import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { AuthPrompt } from "../ipc/bindings/AuthPrompt";
import { announceOperation } from "../state/operationLabels";
import { AuthDialog } from "./AuthDialog";
import { buttonNamed, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  clearMocks();
});

const prompt = (extra: Partial<AuthPrompt> = {}): AuthPrompt => ({
  id: "op-1/auth-1",
  kind: "credentials",
  url: "https://github.com",
  host: "github.com",
  username: null,
  message: "github.com needs credentials.",
  fingerprint: null,
  ...extra,
});

function mount(extra: Partial<AuthPrompt> = {}) {
  const replies: unknown[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "auth_respond") replies.push(args);
    return true;
  });
  announceOperation("op-1", "fetch");
  const mounted = mountWithApp(() => <AuthDialog pending={{ operation: "op-1", prompt: prompt(extra) }} />);
  dispose = mounted.dispose;
  return { ...mounted, replies };
}

describe("authentication dialog", () => {
  it("asks for a username and token, needs both, and offers saving with the credential helper", async () => {
    const { host, replies } = mount();
    await flush();

    expect(host.querySelector("h3")?.textContent).toBe("HTTPS credentials");
    expect(host.textContent).toContain("github.com needs credentials for fetch.");
    expect(host.querySelector('input[aria-label="Token"]')?.getAttribute("type")).toBe("password");
    const submit = buttonNamed(host, "Fetch");
    expect(submit?.disabled).toBe(true);
    type(host.querySelector('input[aria-label="Username"]'), "yforge-lab");
    type(host.querySelector('input[aria-label="Token"]'), "s3cret");
    await flush();
    expect(submit?.disabled).toBe(false);
    const save = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(save?.checked).toBe(true);
    submit?.click();
    await flush();

    expect(replies).toEqual([{ id: "op-1/auth-1", reply: { kind: "credentials", username: "yforge-lab", secret: "s3cret", save: true } }]);
  });

  it("uses the username already in the address and does not let it be edited", async () => {
    const { host } = mount({ username: "yui" });
    await flush();

    const username = host.querySelector<HTMLInputElement>('input[aria-label="Username"]');
    expect(username?.value).toBe("yui");
    expect(username?.readOnly).toBe(true);
  });

  it("cancels with Escape or the Cancel button", async () => {
    const { host, replies } = mount();
    await flush();

    host.querySelector("form")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await flush();

    expect(replies).toEqual([{ id: "op-1/auth-1", reply: { kind: "cancel" } }]);
  });

  it("asks for an SSH key passphrase without offering to save it", async () => {
    const { host, replies } = mount({ kind: "passphrase", host: null, url: null, message: "Enter passphrase for key '/k/id_ed25519': " });
    await flush();

    expect(host.querySelector("h3")?.textContent).toBe("SSH key passphrase");
    expect(host.textContent).toContain("Enter passphrase for key '/k/id_ed25519'.");
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    type(host.querySelector('input[aria-label="Passphrase"]'), "open sesame");
    await flush();
    buttonNamed(host, "Unlock key")?.click();
    await flush();

    expect(replies).toEqual([{ id: "op-1/auth-1", reply: { kind: "credentials", username: null, secret: "open sesame", save: false } }]);
  });

  it("shows the host key fingerprint, focuses Cancel by default, and trusts only when asked", async () => {
    const { host, replies } = mount({ kind: "host_key", host: "github.com", url: null, fingerprint: "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU", message: "The authenticity…" });
    await flush();

    expect(host.querySelector("h3")?.textContent).toBe("Confirm host key");
    expect(host.querySelector("code")?.textContent).toBe("SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU");
    expect(host.textContent).toContain("Trusting an unknown host lets it read the credentials you send.");
    expect(document.activeElement?.textContent).toBe("Cancel");
    const trust = buttonNamed(host, "Trust and continue");
    expect(trust?.classList.contains("danger")).toBe(true);
    trust?.click();
    await flush();

    expect(replies).toEqual([{ id: "op-1/auth-1", reply: { kind: "trust" } }]);
  });
});
