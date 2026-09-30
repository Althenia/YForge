import { describe, expect, it } from "vitest";
import { IpcError } from "../ipc/client";
import { aiFailure, baseUrlProblem, cardOf, PROVIDER_CARDS, providerProblems, statusView, type ProviderDraft } from "./aiModel";

const draft = (overrides: Partial<ProviderDraft> = {}): ProviderDraft => ({ kind: "openai_compatible", name: "Local", baseUrl: "http://localhost:11434/v1", apiKey: "", authMode: "api_key", ...overrides });

describe("provider cards", () => {
  it("offers the four provider kinds in dialog order, marks the two subscription kinds, and only the compatible kind with a base URL", () => {
    expect(PROVIDER_CARDS.map((card) => card.kind)).toEqual(["chatgpt", "claude", "openrouter", "openai_compatible"]);
    expect(PROVIDER_CARDS.filter((card) => card.subscription).map((card) => card.kind)).toEqual(["chatgpt", "claude"]);
    expect(PROVIDER_CARDS.filter((card) => card.baseUrl).map((card) => card.kind)).toEqual(["openai_compatible"]);
    expect(cardOf("chatgpt").title).toBe("ChatGPT");
    expect(cardOf("chatgpt").blurb).toMatch(/subscription/);
  });
});

describe("status view", () => {
  it("pairs every status with a text label, a glyph, and a tone (never color alone)", () => {
    expect(statusView({ kind: "ready" })).toMatchObject({ label: "Ready", tone: "ok", icon: "check" });
    expect(statusView({ kind: "signed_out" })).toMatchObject({ label: "Signed out", tone: "attention" });
    expect(statusView({ kind: "key_missing" })).toMatchObject({ label: "Key missing", tone: "attention" });
    expect(statusView({ kind: "key_rejected" })).toMatchObject({ label: "Key rejected", tone: "danger", icon: "warning" });
    expect(statusView({ kind: "unreachable", message: "no route" })).toMatchObject({ label: "Unreachable", tone: "danger", detail: "no route" });
    expect(statusView({ kind: "check_failed", message: "boom" })).toMatchObject({ label: "Check failed", tone: "danger", detail: "boom" });
  });
});

describe("base URL rules of the core", () => {
  it("accepts https and loopback http, and rejects the rest with the core's reasons", () => {
    expect(baseUrlProblem("https://api.example.com/v1")).toBeUndefined();
    expect(baseUrlProblem("http://localhost:11434/v1")).toBeUndefined();
    expect(baseUrlProblem("http://127.0.0.1:8080")).toBeUndefined();
    expect(baseUrlProblem("http://[::1]:8080")).toBeUndefined();
    expect(baseUrlProblem("")).toBe("Enter the base URL");
    expect(baseUrlProblem("http://example.com/v1")).toBe("http is only accepted for localhost; use https for remote endpoints");
    expect(baseUrlProblem("ftp://example.com")).toBe("Use an http or https address");
    expect(baseUrlProblem("https://user:pw@example.com")).toBe("Remove the credentials from the address; use the API key field");
    expect(baseUrlProblem("https://example.com/v1?x=1")).toBe("Remove the query or fragment from the address");
    expect(baseUrlProblem("not a url")).toBe("Enter a full address such as https://api.example.com/v1");
  });
});

describe("provider form problems", () => {
  it("requires a name of 1 to 80 characters", () => {
    expect(providerProblems(draft({ name: "  " })).name).toBe("Enter a name");
    expect(providerProblems(draft({ name: "x".repeat(81) })).name).toBe("Use at most 80 characters");
    expect(providerProblems(draft({ name: "x".repeat(80) })).name).toBeUndefined();
  });

  it("requires a base URL only for the OpenAI-compatible kind", () => {
    expect(providerProblems(draft({ baseUrl: "" })).baseUrl).toBe("Enter the base URL");
    expect(providerProblems(draft({ kind: "openrouter", baseUrl: "", apiKey: "k" })).baseUrl).toBeUndefined();
  });

  it("requires an API key for OpenRouter but leaves it optional for compatible endpoints", () => {
    expect(providerProblems(draft({ kind: "openrouter", baseUrl: "", apiKey: "" })).apiKey).toBe("Paste your OpenRouter API key");
    expect(providerProblems(draft({ apiKey: "" })).apiKey).toBeUndefined();
  });

  it("does not ask for a key when the provider uses a subscription sign-in", () => {
    expect(providerProblems(draft({ kind: "claude", baseUrl: "", authMode: "subscription", apiKey: "" })).apiKey).toBeUndefined();
    expect(providerProblems(draft({ kind: "claude", baseUrl: "", authMode: "api_key", apiKey: "" })).apiKey).toBe("Paste your Claude API key");
  });
});

describe("AI failures", () => {
  const failure = (kind: ConstructorParameters<typeof IpcError>[0]["kind"], message = "core message") => new IpcError({ kind, message });

  it("sends a missing provider to Settings → AI and a revoked sign-in to that provider's sign-in", () => {
    expect(aiFailure(failure("ai_not_configured"))).toEqual({ message: "No AI provider is set up. Choose one in Settings → AI.", action: "open_settings" });
    expect(aiFailure(failure("ai_auth_required", "Sign in to ChatGPT"))).toEqual({ message: "The provider needs you to sign in again. Sign in from Settings → AI, then run this again.", detail: "Sign in to ChatGPT", action: "sign_in" });
  });

  it("explains an unavailable, unreadable, failed, or timed-out provider and that nothing was changed", () => {
    expect(aiFailure(failure("ai_provider_unavailable", "claude not found"))).toMatchObject({ message: "The provider could not be reached. Nothing was changed.", detail: "claude not found", action: "open_settings" });
    expect(aiFailure(failure("ai_invalid_response"))).toMatchObject({ message: "The provider answered in a form YForge could not read. Nothing was changed. Try again." });
    expect(aiFailure(failure("ai_failed", "HTTP 500"))).toMatchObject({ message: "The provider reported an error. Nothing was changed.", detail: "HTTP 500" });
    expect(aiFailure(failure("ai_timeout"))).toMatchObject({ message: "The provider took too long to answer. Nothing was changed. Try again." });
  });

  it("stays silent for a cancelled call and passes other failures through as their own message", () => {
    expect(aiFailure(failure("cancelled"))).toBeUndefined();
    expect(aiFailure(failure("invalid_request", "nothing is staged"))).toEqual({ message: "nothing is staged" });
    expect(aiFailure(new Error("odd"))).toEqual({ message: "odd" });
  });
});
