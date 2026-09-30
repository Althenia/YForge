import { describe, expect, it } from "vitest";
import type { AiFeatureSummary } from "../ipc/bindings/AiFeatureSummary";
import { CONTEXT_TOKEN, FEATURE_ORDER, FEATURE_TITLES, featureDraft, featureFailure, featureProblems, featureSource } from "./aiFeatures";
import { IpcError } from "../ipc/client";

const summary = (overrides: Partial<AiFeatureSummary> = {}): AiFeatureSummary => ({
  feature: "generate_commit",
  config: null,
  default_prompt_template: `Default ${CONTEXT_TOKEN} prompt`,
  ...overrides,
});

describe("feature drafts", () => {
  it("starts from the saved configuration when there is one", () => {
    const draft = featureDraft(
      summary({ config: { feature: "recompose", provider_id: "p2", model_id: "sonnet", prompt_template: "Group {context}" } }),
      "p1",
    );
    expect(draft).toEqual({ providerId: "p2", modelId: "sonnet", promptTemplate: "Group {context}" });
  });

  it("falls back to the active provider and the shipped prompt when unconfigured", () => {
    expect(featureDraft(summary(), "p1")).toEqual({ providerId: "p1", modelId: "", promptTemplate: `Default ${CONTEXT_TOKEN} prompt` });
    expect(featureDraft(undefined, undefined)).toEqual({ providerId: "", modelId: "", promptTemplate: "" });
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

describe("feature source", () => {
  it("names the fallback in words and marks a configured feature", () => {
    expect(featureSource(summary())).toBe("Using the active provider and the default prompt");
    expect(featureSource(undefined)).toBe("Using the active provider and the default prompt");
    expect(featureSource(summary({ config: { feature: "generate_commit", provider_id: "p1", model_id: "m", prompt_template: "{context}" } }))).toBe("Configured for this feature");
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
