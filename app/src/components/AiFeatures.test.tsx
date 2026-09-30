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

const provider = (id: string, name: string, active = false): ProviderSummary => ({
  config: { id, kind: "claude", auth_mode: "api_key", name, base_url: null, model: "sonnet", has_api_key: true, created_at: 1 },
  status: { kind: "ready" },
  active,
});

const features = (overrides: Partial<AiFeatureSummary> = {}): AiFeatureSummary[] =>
  (["generate_commit", "recompose", "conflict_fix"] as const).map((feature) => ({
    feature,
    config: null,
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
      if (cmd === "ai_providers_list") return [provider("p1", "Claude", true), provider("p2", "Local")];
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
  it("shows one card per feature with the default prompt and the active-provider fallback named", async () => {
    const { host } = await mount(features());

    const cards = [...host.querySelectorAll(".feature-card")];
    expect(cards).toHaveLength(3);
    expect(host.textContent).toContain("Using the active provider and the default prompt");
    expect((card("Generate commit message")?.querySelector('textarea[aria-label="Generate commit message prompt"]') as HTMLTextAreaElement).value).toContain("{context}");
  });

  it("saves the chosen provider, model, and prompt for one feature only", async () => {
    const { calls } = await mount(features(), (call) =>
      call.cmd === "ai_feature_config_set" ? { feature: "recompose", config: { feature: "recompose", provider_id: "p2", model_id: "m", prompt_template: "Do {context}" }, default_prompt_template: "Default recompose prompt with {context}" } : undefined,
    );

    const target = card("Propose with AI in Recompose") as HTMLElement;
    const selects = [...target.querySelectorAll("select")];
    selects[0]?.setAttribute("value", "p2");
    selects[0]!.value = "p2";
    selects[0]!.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    type(target.querySelector('input[aria-label="Propose with AI in Recompose model"]'), "m");
    type(target.querySelector('textarea[aria-label="Propose with AI in Recompose prompt"]'), "Do {context}");
    buttonNamed(target, "Save")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "ai_feature_config_set")?.args).toEqual({ feature: "recompose", providerId: "p2", modelId: "m", promptTemplate: "Do {context}" });
    expect(calls.filter((call) => call.cmd === "ai_feature_config_set")).toHaveLength(1);
  });

  it("refuses a prompt without the context token and says what is missing", async () => {
    const { calls } = await mount(features());

    const target = card("Propose conflict resolution") as HTMLElement;
    type(target.querySelector('textarea[aria-label="Propose conflict resolution prompt"]'), "No placeholder here");
    buttonNamed(target, "Save")?.click();
    await flush(60);

    expect(target.textContent).toContain("Keep {context} where the content goes");
    expect(calls.some((call) => call.cmd === "ai_feature_config_set")).toBe(false);
  });

  it("resets a configured feature back to the default prompt and the unconfigured state", async () => {
    const configured = features();
    configured[0] = { feature: "generate_commit", config: { feature: "generate_commit", provider_id: "p1", model_id: "sonnet", prompt_template: "Write {context}" }, default_prompt_template: "Default generate_commit prompt with {context}" };
    const { calls } = await mount(configured, (call) =>
      call.cmd === "ai_feature_config_reset" ? { feature: "generate_commit", config: null, default_prompt_template: "Default generate_commit prompt with {context}" } : undefined,
    );

    const target = card("Generate commit message") as HTMLElement;
    expect(target.textContent).toContain("Configured for this feature");
    buttonNamed(target, "Reset to default")?.click();
    await flush(60);

    expect(calls.find((call) => call.cmd === "ai_feature_config_reset")?.args).toEqual({ feature: "generate_commit" });
  });

  it("shows the auth-required detail as copy when the model list cannot be read", async () => {
    await mount(
      [{ feature: "generate_commit", config: { feature: "generate_commit", provider_id: "p2", model_id: "m", prompt_template: "{context}" }, default_prompt_template: "{context}" }],
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
