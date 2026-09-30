import type { AuthPrompt } from "../ipc/bindings/AuthPrompt";
import type { AuthPromptEvent } from "../ipc/bindings/AuthPromptEvent";
import type { AuthReply } from "../ipc/bindings/AuthReply";

export type PendingPrompt = { operation: string; prompt: AuthPrompt };

export const enqueuePrompt = (queue: readonly PendingPrompt[], event: AuthPromptEvent): PendingPrompt[] => [
  ...queue.filter((pending) => pending.prompt.id !== event.prompt.id),
  { operation: event.operation, prompt: event.prompt },
];

export const dropPrompt = (queue: readonly PendingPrompt[], id: string): PendingPrompt[] => queue.filter((pending) => pending.prompt.id !== id);

export const dropOperationPrompts = (queue: readonly PendingPrompt[], operation: string): PendingPrompt[] =>
  queue.filter((pending) => pending.operation !== operation);

export type PromptCopy = { title: string; lead: string; primary: string; icon: "lock" | "key" | "warning" };

export function promptCopy(prompt: AuthPrompt, operationLabel: string): PromptCopy {
  switch (prompt.kind) {
    case "credentials":
      return {
        title: "HTTPS credentials",
        lead: `${prompt.host ?? "The remote"} needs credentials for ${operationLabel}.`,
        primary: operationLabel.charAt(0).toUpperCase() + operationLabel.slice(1),
        icon: "lock",
      };
    case "passphrase":
      return { title: "SSH key passphrase", lead: prompt.message.replace(/[:\s]+$/, "") + ".", primary: "Unlock key", icon: "key" };
    case "host_key":
      return {
        title: "Confirm host key",
        lead: `The authenticity of ${prompt.host ?? "the host"} can't be verified yet. Compare this fingerprint with the one the host publishes.`,
        primary: "Trust and continue",
        icon: "warning",
      };
  }
}

export type CredentialsDraft = { username: string; secret: string; save: boolean };

export function credentialsReply(prompt: AuthPrompt, draft: CredentialsDraft): AuthReply | undefined {
  if (draft.secret === "") return undefined;
  if (prompt.kind === "credentials") {
    const username = prompt.username ?? draft.username.trim();
    if (username === "") return undefined;
    return { kind: "credentials", username, secret: draft.secret, save: draft.save };
  }
  return { kind: "credentials", username: null, secret: draft.secret, save: false };
}

export const rejectedNotice = (host: string | null): string =>
  `${host ?? "The remote"} rejected the credentials you entered. Enter them again to retry.`;
