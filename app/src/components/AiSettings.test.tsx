import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { ProviderStatus } from "../ipc/bindings/ProviderStatus";
import type { ProviderSummary } from "../ipc/bindings/ProviderSummary";
import { AiSettings } from "./AiSettings";
import { buttonNamed, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const summary = (id: string, overrides: Partial<ProviderSummary["config"]> = {}, status: ProviderStatus = { kind: "ready" }, active = false): ProviderSummary => ({
  config: { id, kind: "claude_code", name: "Claude Code", base_url: null, model: null, executable_path: null, has_api_key: false, created_at: 1, ...overrides },
  status,
  active,
});

type Call = { cmd: string; args: Record<string, unknown> };

async function mount(initial: ProviderSummary[], respond: (call: Call) => unknown = () => undefined) {
  const calls: Call[] = [];
  let list = initial;
  mockIPC(
    (cmd, args) => {
      const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
      calls.push(call);
      if (cmd === "ai_providers_list") return list;
      const custom = respond(call);
      if (custom !== undefined) {
        if (cmd === "ai_provider_add") list = [...list, custom as ProviderSummary];
        return custom;
      }
      return null;
    },
    { shouldMockEvents: true },
  );
  const view = mountWithApp(() => <AiSettings />);
  dispose = view.dispose;
  await flush(40);
  return { ...view, calls, setList: (next: ProviderSummary[]) => (list = next) };
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

describe("AI providers", () => {
  it("states what is sent, and lists each provider with its status word, model, and active marker", async () => {
    const { host } = await mount([
      summary("p1", { name: "Claude Code", model: "sonnet" }, { kind: "ready" }, true),
      summary("p2", { kind: "openrouter", name: "OpenRouter", has_api_key: true }, { kind: "key_rejected" }),
    ]);

    expect(host.querySelector(".privacy-notice")?.textContent).toContain("Nothing is sent until you run an AI action");
    expect(host.querySelector(".privacy-notice")?.textContent).toContain("Files named .env*");
    const rows = [...host.querySelectorAll(".provider-row")];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Ready");
    expect(rows[0]?.textContent).toContain("sonnet");
    expect(rows[0]?.textContent).toContain("Active");
    expect(rows[1]?.textContent).toContain("Key rejected");
    expect(rows[1]?.textContent).toContain("default model");
    expect(buttonNamed(rows[1] as HTMLElement, "Use")?.disabled).toBe(true);
  });

  it("says there are no providers and that Git works without one", async () => {
    const { host } = await mount([]);
    expect(host.textContent).toContain("No providers yet");
    expect(host.textContent).toContain("Every Git workflow works without a provider");
  });

  it("offers the four provider kinds as cards in the add dialog", async () => {
    const { host } = await mount([]);

    buttonNamed(host, "Add provider")?.click();
    await flush();

    const cards = [...(dialog()?.querySelectorAll(".provider-card") ?? [])].map((card) => card.querySelector(".provider-card-title")?.textContent);
    expect(cards).toEqual(["ChatGPT", "Claude Code", "OpenRouter", "OpenAI-compatible"]);
  });

  it("validates an OpenAI-compatible endpoint, then adds it with the trimmed key and moves to its panel", async () => {
    const added = summary("p9", { kind: "openai_compatible", name: "Local", base_url: "http://localhost:11434/v1", has_api_key: true });
    const { host, calls } = await mount([], (call) => (call.cmd === "ai_provider_add" ? added : undefined));
    buttonNamed(host, "Add provider")?.click();
    await flush();
    ([...document.querySelectorAll<HTMLElement>(".provider-card")].find((card) => card.textContent?.includes("OpenAI-compatible")))?.click();
    await flush();

    type(dialog()?.querySelector('input[aria-label="Name"]'), "Local");
    type(dialog()?.querySelector('input[aria-label="Base URL"]'), "http://example.com/v1");
    type(dialog()?.querySelector('input[aria-label="API key"]'), " sk-test ");
    buttonNamed(dialog() as HTMLElement, "Add provider")?.click();
    await flush();
    expect(dialog()?.textContent).toContain("http is only accepted for localhost; use https for remote endpoints");
    expect(calls.some((call) => call.cmd === "ai_provider_add")).toBe(false);

    type(dialog()?.querySelector('input[aria-label="Base URL"]'), "http://localhost:11434/v1");
    buttonNamed(dialog() as HTMLElement, "Add provider")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "ai_provider_add")?.args).toEqual({ input: { kind: "openai_compatible", name: "Local", base_url: "http://localhost:11434/v1", api_key: "sk-test" } });
    expect(dialog()?.textContent).toContain("Key saved in the macOS Keychain");
    expect(dialog()?.querySelector('input[aria-label="API key"]')).toBeNull();
  });

  it("never shows a saved key again: Replace reveals an empty field, Clear sends a clear change", async () => {
    const { host, calls } = await mount([summary("p2", { kind: "openrouter", name: "OpenRouter", has_api_key: true })], (call) => (call.cmd === "ai_provider_update" ? summary("p2", { kind: "openrouter", name: "OpenRouter" }, { kind: "key_missing" }) : undefined));
    host.querySelector<HTMLElement>('[aria-label="Edit OpenRouter"]')?.click();
    await flush(60);

    expect(dialog()?.querySelector('input[aria-label="API key"]')).toBeNull();
    buttonNamed(dialog() as HTMLElement, "Replace")?.click();
    await flush();
    expect((dialog()?.querySelector('input[aria-label="API key"]') as HTMLInputElement).value).toBe("");
    buttonNamed(dialog() as HTMLElement, "Keep the saved key")?.click();
    await flush();
    buttonNamed(dialog() as HTMLElement, "Clear")?.click();
    await flush();
    buttonNamed(dialog() as HTMLElement, "Save changes")?.click();
    await flush();
    expect(dialog()?.textContent).toContain("OpenRouter needs an API key");

    buttonNamed(dialog() as HTMLElement, "Keep it")?.click();
    await flush();
    type(dialog()?.querySelector('input[aria-label="Name"]'), "OR main");
    buttonNamed(dialog() as HTMLElement, "Save changes")?.click();
    await flush(60);
    expect(calls.find((call) => call.cmd === "ai_provider_update")?.args).toEqual({ update: { id: "p2", name: "OR main", api_key: { kind: "keep" } } });
  });

  it("shows detection and the install command when the CLI is missing", async () => {
    const { host } = await mount([summary("p3", { kind: "chatgpt", name: "ChatGPT" }, { kind: "not_installed" })]);
    host.querySelector<HTMLElement>('[aria-label="Edit ChatGPT"]')?.click();
    await flush(60);

    expect(dialog()?.textContent).toContain("The codex command was not found");
    expect(dialog()?.textContent).toContain("npm install -g @openai/codex");
    expect(dialog()?.textContent).not.toContain("Sign in with browser");
  });

  it("signs a ChatGPT provider in by device code, showing the URL and code of its own operation, and cancels through the operation id", async () => {
    let release: (status: ProviderStatus) => void = () => undefined;
    const { host, calls } = await mount([summary("p3", { kind: "chatgpt", name: "ChatGPT" }, { kind: "signed_out" })], (call) => {
      if (call.cmd === "ai_sign_in") return new Promise<ProviderStatus>((resolve) => (release = resolve));
      return undefined;
    });
    host.querySelector<HTMLElement>('[aria-label="Edit ChatGPT"]')?.click();
    await flush(60);

    expect(buttonNamed(dialog() as HTMLElement, "Sign in with browser")).toBeDefined();
    buttonNamed(dialog() as HTMLElement, "No browser? Use a code")?.click();
    await flush();
    const signIn = calls.find((call) => call.cmd === "ai_sign_in");
    expect(signIn?.args).toMatchObject({ provider: "p3", method: "device_code" });
    await emit("ai-sign-in", { operation: signIn?.args.id, provider: "p3", stage: { kind: "device_code", url: "https://auth.openai.com/codex/device", code: "AB12-CD34" } });
    await flush();
    expect(dialog()?.textContent).toContain("https://auth.openai.com/codex/device");
    expect(dialog()?.textContent).toContain("AB12-CD34");
    expect(dialog()?.querySelectorAll(".copy-row button")).toHaveLength(2);

    buttonNamed(dialog() as HTMLElement, "Cancel sign-in")?.click();
    await flush();
    expect(calls.find((call) => call.cmd === "operation_cancel")?.args).toEqual({ id: signIn?.args.id });
    release({ kind: "signed_out" });
  });

  it("offers browser sign-in only for Claude Code", async () => {
    const { host } = await mount([summary("p1", {}, { kind: "signed_out" })]);
    host.querySelector<HTMLElement>('[aria-label="Edit Claude Code"]')?.click();
    await flush(60);

    expect(buttonNamed(dialog() as HTMLElement, "Sign in with browser")).toBeDefined();
    expect(buttonNamed(dialog() as HTMLElement, "No browser? Use a code")).toBeUndefined();
  });

  it("uses a ready provider with the typed model, and lets the CLI choose its model when it is left empty", async () => {
    const { host, calls } = await mount([summary("p1", {}, { kind: "ready" })]);
    host.querySelector<HTMLElement>('[aria-label="Edit Claude Code"]')?.click();
    await flush(60);

    type(dialog()?.querySelector('input[aria-label="Model"]'), " sonnet ");
    buttonNamed(dialog() as HTMLElement, "Use this provider")?.click();
    await flush();
    expect(calls.find((call) => call.cmd === "ai_set_active")?.args).toEqual({ id: "p1", model: "sonnet" });

    type(dialog()?.querySelector('input[aria-label="Model"]'), "");
    buttonNamed(dialog() as HTMLElement, "Use this provider")?.click();
    await flush();
    expect(calls.filter((call) => call.cmd === "ai_set_active").at(-1)?.args).toEqual({ id: "p1", model: null });
  });

  it("confirms before removing a provider and names the Keychain consequence", async () => {
    const { host, calls } = await mount([summary("p2", { kind: "openrouter", name: "OpenRouter", has_api_key: true })]);

    host.querySelector<HTMLElement>('[aria-label="Remove OpenRouter"]')?.click();
    await flush();
    const confirm = document.querySelector('[role="alertdialog"]');
    expect(confirm?.textContent).toContain("Its API key is deleted from the macOS Keychain.");
    expect(calls.some((call) => call.cmd === "ai_provider_remove")).toBe(false);
    buttonNamed(confirm as HTMLElement, "Remove provider")?.click();
    await flush();

    expect(calls.find((call) => call.cmd === "ai_provider_remove")?.args).toEqual({ id: "p2" });
  });
});
