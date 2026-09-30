import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { useQuery } from "../state/query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { AiFeature } from "../ipc/bindings/AiFeature";
import type { AiFeatureSummary } from "../ipc/bindings/AiFeatureSummary";
import type { ProviderSummary } from "../ipc/bindings/ProviderSummary";
import { client } from "../ipc/client";
import { CONTEXT_TOKEN, FEATURE_BLURBS, FEATURE_ORDER, FEATURE_TITLES, featureDraft, featureFailure, featureProblems, featureSource, featuresOptions } from "../state/aiFeatures";
import { providersOptions } from "../state/aiProviders";
import { aiKeys } from "../state/queryKeys";
import { Icon } from "./Icon";

function FeatureCard(props: { feature: AiFeature; summary: AiFeatureSummary | undefined; providers: readonly ProviderSummary[] }) {
  const queryClient = useQueryClient();
  const activeProviderId = () => props.providers.find((entry) => entry.active)?.config.id;
  const [draft, setDraft] = createSignal(featureDraft(props.summary, activeProviderId()));
  const [touched, setTouched] = createSignal(false);
  const [failure, setFailure] = createSignal<string | undefined>();
  let loaded: AiFeatureSummary | undefined;
  createEffect(() => {
    const summary = props.summary;
    if (summary === loaded) return;
    loaded = summary;
    setDraft(featureDraft(summary, activeProviderId()));
  });
  const problems = createMemo(() => featureProblems(draft()));
  const shown = (field: keyof ReturnType<typeof problems>) => (touched() ? problems()[field] : undefined);
  const chosen = () => props.providers.find((entry) => entry.config.id === draft().providerId);
  const models = useQuery(() => ({
    queryKey: aiKeys.models(draft().providerId === "" ? "none" : draft().providerId),
    queryFn: () => client.aiProviderModels(draft().providerId),
    enabled: draft().providerId !== "",
    staleTime: Infinity,
    retry: false,
  }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: aiKeys.features });
  const save = useMutation(() => ({
    mutationFn: () => client.aiFeatureConfigSet(props.feature, draft().providerId, draft().modelId.trim(), draft().promptTemplate),
    onSuccess: refresh,
  }));
  const reset = useMutation(() => ({ mutationFn: () => client.aiFeatureConfigReset(props.feature), onSuccess: refresh }));
  const run = async (action: () => Promise<AiFeatureSummary>) => {
    setFailure(undefined);
    try {
      await action();
    } catch (error) {
      setFailure(featureFailure(error));
    }
  };

  return (
    <section class="feature-card" aria-label={FEATURE_TITLES[props.feature]}>
      <div class="feature-head">
        <div class="provider-head-text">
          <strong>{FEATURE_TITLES[props.feature]}</strong>
          <span class="setting-note">{FEATURE_BLURBS[props.feature]}</span>
        </div>
        <span class="chip" classList={{ "chip-success": props.summary?.config !== null && props.summary?.config !== undefined }}>{featureSource(props.summary)}</span>
      </div>
      <div class="feature-grid">
        <label class="field">
          <span class="field-label">Provider</span>
          <span class="input" classList={{ invalid: shown("providerId") !== undefined }}>
            <select
              aria-label={`${FEATURE_TITLES[props.feature]} provider`}
              value={draft().providerId}
              onChange={(event) => {
                setDraft({ ...draft(), providerId: event.currentTarget.value, modelId: "" });
              }}
            >
              <option value="">Choose…</option>
              <For each={props.providers}>{(entry) => <option value={entry.config.id} selected={entry.config.id === draft().providerId}>{entry.config.name}</option>}</For>
            </select>
          </span>
          <Show when={shown("providerId")}>{(text) => <span class="field-note error">{text()}</span>}</Show>
        </label>
        <label class="field">
          <span class="field-label">Model</span>
          <span class="input" classList={{ invalid: shown("modelId") !== undefined }}>
            <input
              type="text"
              class="mono"
              aria-label={`${FEATURE_TITLES[props.feature]} model`}
              placeholder={models.isFetching ? "Loading…" : "Model id"}
              value={draft().modelId}
              onInput={(event) => setDraft({ ...draft(), modelId: event.currentTarget.value })}
            />
          </span>
          <Show when={shown("modelId")} fallback={<span class="field-note">{chosen() === undefined ? "Choose a provider first." : `${(models.data ?? []).length} models available.`}</span>}>
            {(text) => <span class="field-note error">{text()}</span>}
          </Show>
        </label>
      </div>
      <Show when={(models.data ?? []).length > 0}>
        <label class="field">
          <span class="field-label">Available models</span>
          <span class="input">
            <select aria-label={`${FEATURE_TITLES[props.feature]} available models`} value={draft().modelId} onChange={(event) => setDraft({ ...draft(), modelId: event.currentTarget.value })}>
              <option value="">Choose…</option>
              <For each={models.data ?? []}>{(entry) => <option value={entry.id}>{entry.display_name}</option>}</For>
            </select>
          </span>
        </label>
      </Show>
      <Show when={models.error}>{(error) => <p class="field-note error">{featureFailure(error())}</p>}</Show>      <label class="field">
        <span class="field-label">Prompt</span>
        <span class="input" classList={{ invalid: shown("promptTemplate") !== undefined }}>
          <textarea
            class="prompt-editor"
            aria-label={`${FEATURE_TITLES[props.feature]} prompt`}
            rows={4}
            value={draft().promptTemplate}
            onInput={(event) => setDraft({ ...draft(), promptTemplate: event.currentTarget.value })}
          />
        </span>
        <Show when={shown("promptTemplate")} fallback={<span class="field-note">Keep <code>{CONTEXT_TOKEN}</code> where YForge inserts the repository content.</span>}>
          {(text) => <span class="field-note error">{text()}</span>}
        </Show>
      </label>
      <div class="hrow">
        <button
          type="button"
          class="btn primary"
          disabled={save.isPending}
          onClick={() => {
            setTouched(true);
            if (Object.keys(problems()).length === 0) void run(() => save.mutateAsync());
          }}
        >
          <Icon name="check" size={14} />
          Save
        </button>
        <button
          type="button"
          class="btn"
          disabled={reset.isPending}
          onClick={() => {
            setTouched(false);
            setFailure(undefined);
            void reset.mutateAsync().then(
              (summary) => setDraft(featureDraft(summary, activeProviderId())),
              (error: unknown) => setFailure(featureFailure(error)),
            );
          }}
        >
          <Icon name="undo" size={14} />
          Reset to default
        </button>
      </div>
      <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
    </section>
  );
}

export function AiFeatures() {
  const providers = useQuery(providersOptions);
  const features = useQuery(featuresOptions);
  const byFeature = (feature: AiFeature) => (features.data ?? []).find((entry) => entry.feature === feature);

  return (
    <section aria-label="Per-feature AI">
      <h3>Per-feature settings</h3>
      <p class="setting-note">Each feature can use its own provider, model, and prompt. A feature with no configuration uses the active provider and the default prompt.</p>
      <For each={FEATURE_ORDER}>
        {(feature) => (
          <FeatureCard feature={feature} summary={byFeature(feature)} providers={providers.data ?? []} />
        )}
      </For>
    </section>
  );
}
