import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import type { AiFeatureSummary } from "../ipc/bindings/AiFeatureSummary";
import type { ProviderSummary } from "../ipc/bindings/ProviderSummary";
import { AiFeatures } from "./AiFeatures";
import { buttonNamed, flush, mountWithApp, type } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

const provider = (id: string, name: string): ProviderSummary => ({
  config: { id, kind: "claude", auth_mode: "api_key", name, base_url: null, has_api_key: true, created_at: 1 },
  status: { kind: "ready" },
});

const saved = (feature: AiFeatureSummary["feature"], overrides: Partial<AiFeatureSummary> = {}): AiFeatureSummary => ({
  feature,
  config: { feature, provider_id: "p1", model_id: "sonnet", prompt_template: "Write {context}" },
  enabled: true,
  available: true,
  default_prompt_template: `Default ${feature} prompt with {context}`,
  ...overrides,
});

const features = (overrides: Partial<AiFeatureSummary> = {}): AiFeatureSummary[] =>
  (["generate_commit", "recompose", "conflict_fix"] as const).map((feature) => ({
    feature,
    config: null,
    enabled: false,
    available: false,
    default_prompt_template: `Default ${feature} prompt with {context}`,
    ...overrides,
  }));

type Call = { cmd: string; args: Record<string, unknown> };

async function mount(list: AiFeatureSummary[], respond: (call: Call) => unknown = () => undefined) {
  const calls: Call[] = [];
  mockIPC(
    (cmd, args) => {
      const call = { cmd, args: (args ?? {}) as Record<string, unknown> };
      calls.push(call);
      if (cmd === "ai_providers_list") return [provider("p1", "Claude"), provider("p2", "Local")];
      if (cmd === "ai_feature_config_list") return list;
      const custom = respond(call);
      if (custom !== undefined) return custom;
      if (cmd === "ai_models") return [{ id: "sonnet", display_name: "Claude Sonnet" }];
      return null;
    },
    { shouldMockEvents: true },
  );
  const view = mountWithApp(() => <AiFeatures />);
  dispose = view.dispose;
  await flush(60);
  return { ...view, calls };
}

const card = (title: string) => [...document.querySelectorAll<HTMLElement>(".feature-card")].find((entry) => entry.textContent?.includes(title));

describe("per-feature AI settings", () => {
  it("shows one card per feature, each off with its switch disabled until a provider and model are saved", async () => {
    const { host, calls } = await mount(features());

    const cards = [...host.querySelectorAll(".feature-card")];
    expect(cards).toHaveLength(3);
    const toggle = card("Generate commit message")?.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle?.getAttribute("aria-label")).toBe("Use AI for Generate commit message");
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(toggle?.disabled).toBe(true);
    expect(toggle?.title).toBe("Choose a provider and model to turn this on");
    expect(card("Generate commit message")?.textContent).toContain("Off");
    expect(card("Generate commit message")?.textContent).toContain("Choose a provider and model to turn this on");
    expect(host.textContent).not.toContain("active provider");
    expect((card("Generate commit message")?.querySelector('textarea[aria-label="Generate commit message prompt"]') as HTMLTextAreaElement).value).toContain("{context}");
    expect(calls.some((call) => call.cmd === "ai_models")).toBe(false);
  });

  it("turns a saved feature off and on through its switch", async () => {
    const { calls } = await mount([saved("generate_commit"), ...features().slice(1)], (call) =>
      call.cmd === "ai_feature_config_enable" ? saved("generate_commit", { enabled: false, available: false }) : undefined,
    );

    const target = card("Generate commit message") as HTMLElement;
    const toggle = target.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle?.disabled).toBe(false);
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    expect(target.textContent).toContain("On");
    toggle?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "ai_feature_config_enable")?.args).toEqual({ feature: "generate_commit", enabled: false });
  });

  it("says the action stays hidden while a switched-on feature's provider is not ready", async () => {
    await mount([saved("generate_commit", { available: false }), ...features().slice(1)]);

    expect(card("Generate commit message")?.textContent).toContain("The action stays hidden until this feature's provider is ready.");
    expect(card("Propose with AI in Recompose")?.textContent).not.toContain("stays hidden");
  });

  it("loads the models as soon as a provider is chosen and reloads them from the icon button", async () => {
    const { calls } = await mount(features());

    const target = card("Propose with AI in Recompose") as HTMLElement;
    target.querySelector<HTMLButtonElement>('button[aria-label="Propose with AI in Recompose provider"]')?.click();
    await flush();
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes("Local"))?.click();
    await flush(60);
    const loads = () => calls.filter((call) => call.cmd === "ai_models" && call.args.providerId === "p2").length;
    expect(loads()).toBe(1);
    expect(buttonNamed(target, "Load models")).toBeUndefined();
    const reload = target.querySelector<HTMLButtonElement>('button[aria-label="Reload models"]');
    expect(reload?.textContent?.trim()).toBe("");
    reload?.click();
    await flush(60);

    expect(loads()).toBe(2);
  });

  it("saves by itself once a provider and model are chosen, then saves the prompt when it loses focus", async () => {
    const { calls } = await mount(features(), (call) =>
      call.cmd === "ai_feature_config_set" ? saved("recompose", { config: { feature: "recompose", provider_id: "p2", model_id: "sonnet", prompt_template: String(call.args.promptTemplate) } }) : undefined,
    );

    const target = card("Propose with AI in Recompose") as HTMLElement;
    expect(buttonNamed(target, "Save")).toBeUndefined();
    target.querySelector<HTMLButtonElement>('button[aria-label="Propose with AI in Recompose provider"]')?.click();
    await flush();
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes("Local"))?.click();
    await flush(40);
    const sets = () => calls.filter((call) => call.cmd === "ai_feature_config_set").map((call) => call.args);
    expect(sets()).toEqual([]);
    target.querySelector<HTMLButtonElement>('button[aria-label="Propose with AI in Recompose model"]')?.click();
    await flush();
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes("Claude Sonnet"))?.click();
    await flush(60);
    expect(sets()).toEqual([{ feature: "recompose", providerId: "p2", modelId: "sonnet", promptTemplate: "Default recompose prompt with {context}" }]);
    expect(target.querySelector('[role="status"]')?.textContent).toContain("Saved");

    const prompt = target.querySelector<HTMLTextAreaElement>('textarea[aria-label="Propose with AI in Recompose prompt"]');
    type(prompt, "Do {context}");
    prompt?.dispatchEvent(new FocusEvent("blur"));
    prompt?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush(60);

    expect(sets()).toEqual([
      { feature: "recompose", providerId: "p2", modelId: "sonnet", promptTemplate: "Default recompose prompt with {context}" },
      { feature: "recompose", providerId: "p2", modelId: "sonnet", promptTemplate: "Do {context}" },
    ]);
  });

  it("does not save a prompt without the context token and says why", async () => {
    const { calls } = await mount([features()[0] as AiFeatureSummary, features()[1] as AiFeatureSummary, saved("conflict_fix")]);

    const target = card("Propose conflict resolution") as HTMLElement;
    const prompt = target.querySelector<HTMLTextAreaElement>('textarea[aria-label="Propose conflict resolution prompt"]');
    type(prompt, "No placeholder here");
    prompt?.dispatchEvent(new FocusEvent("blur"));
    prompt?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush(60);

    expect(target.querySelector('[role="alert"]')?.textContent).toContain("Not saved: Keep {context} where the content goes");
    expect(calls.some((call) => call.cmd === "ai_feature_config_set")).toBe(false);
  });

  it("resets a configured feature back to the default prompt and the unconfigured state", async () => {
    const { calls } = await mount([saved("generate_commit"), ...features().slice(1)], (call) =>
      call.cmd === "ai_feature_config_reset" ? features()[0] : undefined,
    );

    const target = card("Generate commit message") as HTMLElement;
    expect(target.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
    buttonNamed(target, "Reset to default")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "ai_feature_config_reset")?.args).toEqual({ feature: "generate_commit" });
  });

  it("shows the auth-required detail as copy when the model list cannot be read", async () => {
    await mount(
      [saved("generate_commit", { config: { feature: "generate_commit", provider_id: "p2", model_id: "m", prompt_template: "{context}" } })],
      (call) => {
        if (call.cmd !== "ai_models") return undefined;
        return Promise.reject(new Error("Sign in to Claude Code first"));
      },
    );

    const target = card("Generate commit message") as HTMLElement;
    await flush(80);
    expect(target.textContent).toContain("Sign in to Claude Code first");
  });
});
