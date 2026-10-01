import { describe, expect, it } from "vitest";
import type { AiFeatureSummary } from "../ipc/bindings/AiFeatureSummary";
import { CONTEXT_TOKEN, FEATURE_ORDER, FEATURE_TITLES, featureAvailable, featureDraft, featureFailure, featureProblems, featureSwitchReason } from "./aiFeatures";
import { IpcError } from "../ipc/client";

const summary = (overrides: Partial<AiFeatureSummary> = {}): AiFeatureSummary => ({
  feature: "generate_commit",
  config: null,
  enabled: false,
  available: false,
  default_prompt_template: `Default ${CONTEXT_TOKEN} prompt`,
  ...overrides,
});

describe("feature drafts", () => {
  it("starts from the saved configuration when there is one", () => {
    const draft = featureDraft(summary({ config: { feature: "recompose", provider_id: "p2", model_id: "sonnet", prompt_template: "Group {context}" } }));
    expect(draft).toEqual({ providerId: "p2", modelId: "sonnet", promptTemplate: "Group {context}" });
  });

  it("starts with no provider or model and the shipped prompt when unconfigured", () => {
    expect(featureDraft(summary())).toEqual({ providerId: "", modelId: "", promptTemplate: `Default ${CONTEXT_TOKEN} prompt` });
    expect(featureDraft(undefined)).toEqual({ providerId: "", modelId: "", promptTemplate: "" });
  });
});

describe("feature problems", () => {
  const draft = (overrides: Partial<ReturnType<typeof featureDraft>> = {}) => ({ providerId: "p1", modelId: "sonnet", promptTemplate: `Do ${CONTEXT_TOKEN}`, ...overrides });

  it("accepts a complete draft", () => {
    expect(featureProblems(draft())).toEqual({});
  });

  it("requires a provider, a model, and a prompt that keeps the context token", () => {
    expect(featureProblems(draft({ providerId: "" })).providerId).toBe("Choose a provider");
    expect(featureProblems(draft({ modelId: "  " })).modelId).toBe("Choose a model");
    expect(featureProblems(draft({ promptTemplate: "" })).promptTemplate).toBe("Enter a prompt");
    expect(featureProblems(draft({ promptTemplate: "Rewrite the message" })).promptTemplate).toBe(`Keep ${CONTEXT_TOKEN} where the content goes`);
  });
});

describe("feature switch and availability", () => {
  const saved = { feature: "generate_commit" as const, provider_id: "p1", model_id: "m", prompt_template: "{context}" };

  it("keeps the switch disabled with its reason until a provider and model are saved", () => {
    expect(featureSwitchReason(summary())).toBe("Choose a provider and model to turn this on");
    expect(featureSwitchReason(undefined)).toBe("Choose a provider and model to turn this on");
    expect(featureSwitchReason(summary({ config: saved }))).toBeUndefined();
  });

  it("offers a feature's action only when the core reports it available", () => {
    const list = [summary({ config: saved, enabled: true, available: true }), summary({ feature: "recompose", config: { ...saved, feature: "recompose" }, enabled: true, available: false })];
    expect(featureAvailable(list, "generate_commit")).toBe(true);
    expect(featureAvailable(list, "recompose")).toBe(false);
    expect(featureAvailable(list, "conflict_fix")).toBe(false);
    expect(featureAvailable(undefined, "generate_commit")).toBe(false);
  });
});

describe("feature failure copy", () => {
  it("names the sign-in need for an auth-required error and keeps other messages", () => {
    expect(featureFailure(new IpcError({ kind: "ai_auth_required", message: "Sign in to Claude Code first" }))).toBe(
      "The provider needs you to sign in before it can list models. Sign in to Claude Code first",
    );
    expect(featureFailure(new IpcError({ kind: "invalid_request", message: "the model is not in the provider's list" }))).toBe("the model is not in the provider's list");
    expect(featureFailure(new Error("plain failure"))).toBe("plain failure");
  });
});

describe("feature order", () => {
  it("lists the three features in the order the core returns them", () => {
    expect(FEATURE_ORDER).toEqual(["generate_commit", "recompose", "conflict_fix"]);
    expect(FEATURE_TITLES.generate_commit).toBe("Generate commit message");
  });
});
