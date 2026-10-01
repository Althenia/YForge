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
import { Select } from "./Select";
import { TextArea } from "./TextArea";

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
          <Select
            label={`${FEATURE_TITLES[props.feature]} provider`}
            value={draft().providerId}
            options={props.providers.map((entry) => ({ value: entry.config.id, label: entry.config.name }))}
            placeholder="Choose…"
            onChange={(value) => setDraft({ ...draft(), providerId: value, modelId: "" })}
          />
          <Show when={shown("providerId")}>{(text) => <span class="field-note error">{text()}</span>}</Show>
        </label>
        <label class="field">
          <span class="field-label">Model</span>
          <Select
            label={`${FEATURE_TITLES[props.feature]} model`}
            value={draft().modelId}
            options={(models.data ?? []).map((entry) => ({
              value: entry.id,
              label: entry.display_name,
              hint: entry.context_window === null || entry.context_window === undefined ? undefined : `${Math.round(entry.context_window / 1000)}k`,
            }))}
            placeholder={models.isFetching ? "Loading…" : "Choose a model…"}
            disabled={draft().providerId === ""}
            disabledReason="Choose a provider first"
            onChange={(value) => setDraft({ ...draft(), modelId: value })}
          />
          <Show when={shown("modelId")}>{(text) => <span class="field-note error">{text()}</span>}</Show>
        </label>
      </div>
      <Show when={models.error}>{(error) => <p class="field-note error">{featureFailure(error())}</p>}</Show>
      <label class="field">
        <span class="field-label">Prompt</span>
        <TextArea
          label={`${FEATURE_TITLES[props.feature]} prompt`}
          value={draft().promptTemplate}
          minRows={5}
          maxRows={14}
          invalid={shown("promptTemplate") !== undefined}
          onInput={(value) => setDraft({ ...draft(), promptTemplate: value })}
        />
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
