import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { useQuery } from "../state/query";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { AiFeature } from "../ipc/bindings/AiFeature";
import type { AiFeatureSummary } from "../ipc/bindings/AiFeatureSummary";
import type { ProviderSummary } from "../ipc/bindings/ProviderSummary";
import { client } from "../ipc/client";
import { CONTEXT_TOKEN, FEATURE_BLURBS, FEATURE_ORDER, FEATURE_TITLES, featureDraft, featureFailure, featureProblems, featureSwitchReason, featuresOptions, type FeatureDraft } from "../state/aiFeatures";
import { modelsOptions, providersOptions } from "../state/aiProviders";
import { aiKeys } from "../state/queryKeys";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { Switch } from "./Switch";
import { TextArea } from "./TextArea";
import { tip } from "./Tooltip";

function FeatureCard(props: { feature: AiFeature; summary: AiFeatureSummary | undefined; providers: readonly ProviderSummary[] }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = createSignal(featureDraft(props.summary));
  const [failure, setFailure] = createSignal<string | undefined>();
  const [savedNote, setSavedNote] = createSignal(false);
  let loaded: AiFeatureSummary | undefined;
  createEffect(() => {
    const summary = props.summary;
    if (summary === loaded) return;
    loaded = summary;
    setDraft(featureDraft(summary));
  });
  const models = useQuery(() => modelsOptions(draft().providerId));
  const refresh = () => queryClient.invalidateQueries({ queryKey: aiKeys.features });
  const save = useMutation(() => ({
    mutationFn: (next: FeatureDraft) => client.aiFeatureConfigSet(props.feature, next.providerId, next.modelId.trim(), next.promptTemplate),
    onSuccess: refresh,
  }));
  const persist = async (next: FeatureDraft) => {
    const problems = featureProblems(next);
    if (problems.providerId !== undefined || problems.modelId !== undefined) return;
    setSavedNote(false);
    if (problems.promptTemplate !== undefined) {
      setFailure(`Not saved: ${problems.promptTemplate}`);
      return;
    }
    const current = props.summary?.config;
    if (current?.provider_id === next.providerId && current.model_id === next.modelId.trim() && current.prompt_template === next.promptTemplate) return;
    setFailure(undefined);
    try {
      await save.mutateAsync(next);
      setSavedNote(true);
    } catch (error) {
      setFailure(`Not saved: ${featureFailure(error) ?? ""}`);
    }
  };
  const reset = useMutation(() => ({ mutationFn: () => client.aiFeatureConfigReset(props.feature), onSuccess: refresh }));
  const toggle = useMutation(() => ({ mutationFn: (enabled: boolean) => client.aiFeatureConfigEnable(props.feature, enabled), onSuccess: refresh }));
  const enabled = () => props.summary?.enabled === true;
  const switchReason = () => featureSwitchReason(props.summary);
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
        <span class="feature-switch">
          <Switch
            label={`Use AI for ${FEATURE_TITLES[props.feature]}`}
            checked={enabled()}
            disabled={switchReason() !== undefined || toggle.isPending}
            disabledReason={switchReason()}
            onChange={(next) => void run(() => toggle.mutateAsync(next))}
          />
          <span class="setting-title">{enabled() ? "On" : "Off"}</span>
        </span>
      </div>
      <Show when={switchReason()}>{(reason) => <p class="setting-note">{reason()}</p>}</Show>
      <Show when={enabled() && props.summary?.available === false}>
        <p class="setting-note">The action stays hidden until this feature's provider is ready.</p>
      </Show>
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
        </label>
        <label class="field">
          <span class="field-label">Model</span>
          <span class="field-row">
            <Select
              label={`${FEATURE_TITLES[props.feature]} model`}
              value={draft().modelId}
              options={(models.data ?? []).map((entry) => ({
                value: entry.id,
                label: entry.display_name,
                hint: entry.context_window === null || entry.context_window === undefined ? undefined : `${Math.round(entry.context_window / 1000)}k`,
              }))}
              placeholder={models.isFetching ? "Loading models…" : "Choose a model…"}
              disabled={draft().providerId === ""}
              disabledReason="Choose a provider first"
              onChange={(value) => {
                const next = { ...draft(), modelId: value };
                setDraft(next);
                void persist(next);
              }}
            />
            <button
              type="button"
              class="icon-btn"
              {...tip("Reload models")}
              aria-busy={models.isFetching}
              disabled={draft().providerId === "" || models.isFetching}
              onClick={() => void models.refetch()}
            >
              <Icon name="sync" size={16} />
            </button>
          </span>
        </label>
      </div>
      <Show when={models.error}>{(error) => <p class="field-note error">{featureFailure(error())}</p>}</Show>
      <Show when={models.isSuccess && (models.data ?? []).length === 0}>
        <p class="field-note">The provider listed no models. Check the provider account, then reload.</p>
      </Show>
      <label class="field">
        <span class="field-label">Prompt</span>
        <TextArea
          label={`${FEATURE_TITLES[props.feature]} prompt`}
          value={draft().promptTemplate}
          minRows={5}
          maxRows={14}
          invalid={failure()?.includes(CONTEXT_TOKEN) === true}
          onInput={(value) => setDraft({ ...draft(), promptTemplate: value })}
          onBlur={() => void persist(draft())}
        />
        <span class="field-note">Keep <code>{CONTEXT_TOKEN}</code> where YForge inserts the repository content.</span>
      </label>
      <div class="hrow">
        <Show when={savedNote() && failure() === undefined}>
          <span class="field-note" role="status">
            <Icon name="check" size={14} />
            Saved
          </span>
        </Show>
        <span class="spacer" />
        <button
          type="button"
          class="btn"
          disabled={reset.isPending}
          onClick={() => {
            setFailure(undefined);
            setSavedNote(false);
            void reset.mutateAsync().then(
              (summary) => setDraft(featureDraft(summary)),
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
      <p class="setting-note">Each feature uses its own provider, model, and prompt. A feature's AI action shows only while the feature is on and its provider is ready.</p>
      <For each={FEATURE_ORDER}>
        {(feature) => (
          <FeatureCard feature={feature} summary={byFeature(feature)} providers={providers.data ?? []} />
        )}
      </For>
    </section>
  );
}
