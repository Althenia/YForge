import type { AiFeature } from "../ipc/bindings/AiFeature";
import type { AiFeatureSummary } from "../ipc/bindings/AiFeatureSummary";
import { client, IpcError } from "../ipc/client";
import { aiKeys } from "./queryKeys";

export const FEATURE_ORDER: readonly AiFeature[] = [
  "generate_commit",
  "recompose",
  "conflict_fix",
  "explain_changes",
  "explain_commit",
  "compose_commits",
  "stash_message",
];

export const FEATURE_TITLES: Record<AiFeature, string> = {
  generate_commit: "Generate commit message",
  recompose: "Propose with AI in Recompose",
  conflict_fix: "Propose conflict resolution",
  explain_changes: "Explain changes",
  explain_commit: "Explain commit",
  compose_commits: "Compose commits",
  stash_message: "Generate stash message",
};

export const FEATURE_BLURBS: Record<AiFeature, string> = {
  generate_commit: "Writes a commit message from your staged diff, or the resulting amended commit, and the subjects of your last commits.",
  recompose: "Groups and rewords your unpushed commits into a cleaner series.",
  conflict_fix: "Proposes a resolution for each conflict from its current, incoming, and base text.",
  explain_changes: "Explains each changed file in your working tree from its diff against the last commit.",
  explain_commit: "Explains each file of the selected commit from its message and its diff against its parent.",
  compose_commits: "Groups your working changes into a series of commits with messages you can edit.",
  stash_message: "Writes a stash message from your uncommitted changes.",
};

export const CONTEXT_TOKEN = "{context}";

export const featuresOptions = () => ({ queryKey: aiKeys.features, queryFn: () => client.aiFeatureConfigList() });

export type FeatureDraft = { providerId: string; modelId: string; promptTemplate: string };

export type FeatureProblems = { providerId?: string; modelId?: string; promptTemplate?: string };

export function featureDraft(summary: AiFeatureSummary | undefined): FeatureDraft {
  const config = summary?.config;
  return {
    providerId: config?.provider_id ?? "",
    modelId: config?.model_id ?? "",
    promptTemplate: config?.prompt_template ?? summary?.default_prompt_template ?? "",
  };
}

export function featureProblems(draft: FeatureDraft): FeatureProblems {
  const problems: FeatureProblems = {};
  if (draft.providerId.trim() === "") problems.providerId = "Choose a provider";
  if (draft.modelId.trim() === "") problems.modelId = "Choose a model";
  if (draft.promptTemplate.trim() === "") problems.promptTemplate = "Enter a prompt";
  else if (!draft.promptTemplate.includes(CONTEXT_TOKEN)) problems.promptTemplate = `Keep ${CONTEXT_TOKEN} where the content goes`;
  return problems;
}

export function featureFailure(failure: unknown): string | undefined {
  if (failure instanceof IpcError) {
    if (failure.kind === "ai_auth_required") return `The provider needs you to sign in before it can list models. ${failure.message}`;
    return failure.message;
  }
  return failure instanceof Error ? failure.message.replace(/^Error:\s*/, "") : String(failure);
}

export const SWITCH_REASON = "Choose a provider and model to turn this on";

export function featureSwitchReason(summary: AiFeatureSummary | undefined): string | undefined {
  return summary?.config === null || summary?.config === undefined ? SWITCH_REASON : undefined;
}

export function featureAvailable(summaries: readonly AiFeatureSummary[] | undefined, feature: AiFeature): boolean {
  return (summaries ?? []).some((summary) => summary.feature === feature && summary.available);
}
