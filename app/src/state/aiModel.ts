import type { IconName } from "../iconNames";
import { IpcError } from "../ipc/client";
import type { AuthMode } from "../ipc/bindings/AuthMode";
import type { ProviderKind } from "../ipc/bindings/ProviderKind";
import type { ProviderStatus } from "../ipc/bindings/ProviderStatus";

export type LogoKey = "openai" | "openrouter" | "neutral-cli" | "neutral-api";

export type ProviderCard = {
  kind: ProviderKind;
  title: string;
  blurb: string;
  baseUrl: boolean;
  key: "required" | "optional" | "none";
  subscription: boolean;
  logo: LogoKey;
};

export const PROVIDER_CARDS: readonly ProviderCard[] = [
  {
    kind: "chatgpt",
    title: "ChatGPT",
    blurb: "OpenAI models with your API key, or your ChatGPT subscription through YForge's own browser or headless sign-in.",
    baseUrl: false,
    key: "required",
    subscription: true,
    logo: "openai",
  },
  {
    kind: "claude",
    title: "Claude",
    blurb: "Anthropic models with your API key, or your Claude Code subscription, which YForge reads from your Claude Code sign-in.",
    baseUrl: false,
    key: "required",
    subscription: true,
    logo: "neutral-cli",
  },
  {
    kind: "openrouter",
    title: "OpenRouter",
    blurb: "Any model on OpenRouter, with your API key.",
    baseUrl: false,
    key: "required",
    subscription: false,
    logo: "openrouter",
  },
  {
    kind: "openai_compatible",
    title: "OpenAI-compatible",
    blurb: "Any endpoint that speaks the OpenAI chat API. Add as many as you need.",
    baseUrl: true,
    key: "optional",
    subscription: false,
    logo: "neutral-api",
  },
];

export const cardOf = (kind: ProviderKind): ProviderCard => PROVIDER_CARDS.find((card) => card.kind === kind) as ProviderCard;

export type StatusView = { label: string; tone: "ok" | "attention" | "danger"; icon: IconName; detail?: string };

export function statusView(status: ProviderStatus): StatusView {
  switch (status.kind) {
    case "ready":
      return { label: "Ready", tone: "ok", icon: "check" };
    case "signed_out":
      return { label: "Signed out", tone: "attention", icon: "warning" };
    case "key_missing":
      return { label: "Key missing", tone: "attention", icon: "warning" };
    case "key_rejected":
      return { label: "Key rejected", tone: "danger", icon: "warning" };
    case "unreachable":
      return { label: "Unreachable", tone: "danger", icon: "warning", detail: status.message };
    case "check_failed":
      return { label: "Check failed", tone: "danger", icon: "warning", detail: status.message };
  }
}

export type ProviderDraft = { kind: ProviderKind; name: string; baseUrl: string; apiKey: string; authMode: AuthMode };

export type ProviderProblems = { name?: string; baseUrl?: string; apiKey?: string };

const NAME_LIMIT = 80;

const isLoopback = (host: string): boolean => host === "localhost" || /^127(\.\d{1,3}){3}$/.test(host) || host === "[::1]";

export function baseUrlProblem(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return "Enter the base URL";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "Enter a full address such as https://api.example.com/v1";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Use an http or https address";
  if (url.username !== "" || url.password !== "") return "Remove the credentials from the address; use the API key field";
  if (url.search !== "" || url.hash !== "") return "Remove the query or fragment from the address";
  if (url.protocol === "http:" && !isLoopback(url.hostname)) return "http is only accepted for localhost; use https for remote endpoints";
  return undefined;
}

export function providerProblems(draft: ProviderDraft): ProviderProblems {
  const card = cardOf(draft.kind);
  const problems: ProviderProblems = {};
  const name = draft.name.trim();
  if (name === "") problems.name = "Enter a name";
  else if (Array.from(name).length > NAME_LIMIT) problems.name = `Use at most ${NAME_LIMIT} characters`;
  if (card.baseUrl) {
    const problem = baseUrlProblem(draft.baseUrl);
    if (problem !== undefined) problems.baseUrl = problem;
  }
  if (draft.authMode === "api_key" && card.key === "required" && draft.apiKey.trim() === "") {
    problems.apiKey = `Paste your ${card.title} API key`;
  }
  return problems;
}

export type AiFailure = { message: string; detail?: string; action?: "open_settings" | "sign_in" };

export function aiFailure(failure: unknown): AiFailure | undefined {
  if (!(failure instanceof IpcError)) return { message: failure instanceof Error ? failure.message : String(failure) };
  const detail = failure.message;
  switch (failure.kind) {
    case "cancelled":
      return undefined;
    case "ai_not_configured":
      return { message: "No AI provider is set up. Choose one in Settings → AI.", action: "open_settings" };
    case "ai_auth_required":
      return { message: "The provider needs you to sign in again. Sign in from Settings → AI, then run this again.", detail, action: "sign_in" };
    case "ai_provider_unavailable":
      return { message: "The provider could not be reached. Nothing was changed.", detail, action: "open_settings" };
    case "ai_invalid_response":
      return { message: "The provider answered in a form YForge could not read. Nothing was changed. Try again." };
    case "ai_failed":
      return { message: "The provider reported an error. Nothing was changed.", detail };
    case "ai_timeout":
      return { message: "The provider took too long to answer. Nothing was changed. Try again." };
    default:
      return { message: detail };
  }
}

export const PRIVACY_LINES: readonly string[] = [
  "Nothing is sent until you run an AI action, and only to the provider you chose here.",
  "Generate commit sends your staged diff and the subjects of your last 10 commits. Propose resolution sends each conflict's current, incoming, and base text with 3 lines of context. Propose with AI in Recompose sends the changes of the unpushed commits.",
  "Files named .env*, *.pem, *.key, id_rsa*, or credentials* are never sent; their names are listed as withheld. Large diffs are cut and binary files go by name only.",
  "Answers are drafts you review. Nothing is committed, rewritten, or written to a file for you.",
  "API keys are stored in the macOS Keychain, never in YForge's database. YForge never reads or stores the sign-in of the Codex or Claude Code CLIs.",
];
