import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { useQuery } from "../state/query";
import { createSignal, For, Show } from "solid-js";
import type { ProviderSummary } from "../ipc/bindings/ProviderSummary";
import { client } from "../ipc/client";
import { cardOf, PRIVACY_LINES } from "../state/aiModel";
import { FEATURE_TITLES, featuresOptions } from "../state/aiFeatures";
import { providersOptions, refreshProviders } from "../state/aiProviders";
import { removeProviderCopy } from "../state/confirmCopy";
import { ConfirmDialog } from "./ConfirmDialog";
import { AiFeatures } from "./AiFeatures";
import { Icon } from "./Icon";
import { ProviderDialog, StatusBadge, type ProviderDialogStart } from "./ProviderDialog";
import { ProviderLogo } from "./ProviderLogo";
import { tip } from "./Tooltip";

export function PrivacyNotice() {
  return (
    <section class="privacy-notice" aria-label="What is sent">
      <h3>What is sent</h3>
      <ul>
        <For each={PRIVACY_LINES}>{(line) => <li>{line}</li>}</For>
      </ul>
    </section>
  );
}

export function AiSettings(props: { initialDialog?: ProviderDialogStart }) {
  const queryClient = useQueryClient();
  const providers = useQuery(providersOptions);
  const features = useQuery(featuresOptions);
  const [dialog, setDialog] = createSignal<ProviderDialogStart | undefined>(props.initialDialog);
  const [removal, setRemoval] = createSignal<ProviderSummary | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();
  const refresh = () => refreshProviders(queryClient);
  const remove = useMutation(() => ({ mutationFn: (summary: ProviderSummary) => client.aiProviderRemove(summary.config.id), onSuccess: refresh }));
  const list = () => providers.data ?? [];
  const usedBy = (id: string) => (features.data ?? []).filter((summary) => summary.config?.provider_id === id).map((summary) => FEATURE_TITLES[summary.feature]);

  const confirmRemoval = async () => {
    const summary = removal();
    setRemoval(undefined);
    setDialog(undefined);
    if (summary === undefined) return;
    try {
      await remove.mutateAsync(summary);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <h2>AI</h2>
      <p class="setting-note">Optional. Every Git workflow works without a provider, and nothing is ever committed, rewritten, or saved for you.</p>
      <PrivacyNotice />
      <div class="provider-head-row">
        <h3>Providers</h3>
        <button type="button" class="btn" onClick={() => setDialog({ kind: "add" })}>
          <Icon name="plus" />
          Add provider
        </button>
      </div>
      <ul class="provider-list" aria-label="AI providers" aria-busy={providers.isFetching}>
        <For each={list()} fallback={<li class="setting-note">No providers yet. Add one to use Generate, Propose resolution, and Propose with AI.</li>}>
          {(summary) => {
            const card = () => cardOf(summary.config.kind);
            return (
              <li class="provider-row">
                <ProviderLogo logo={card().logo} />
                <span class="provider-name">
                  <strong>{summary.config.name}</strong>
                  <span class="setting-note">{card().title}</span>
                </span>
                <StatusBadge summary={summary} />
                <span class="recent-acts">
                  <button type="button" class="icon-btn dense" {...tip(`Edit ${summary.config.name}`)} onClick={() => setDialog({ kind: "edit", id: summary.config.id })}>
                    <Icon name="edit" />
                  </button>
                  <button type="button" class="icon-btn dense" {...tip(`Remove ${summary.config.name}`)} onClick={() => setRemoval(summary)}>
                    <Icon name="trash" />
                  </button>
                </span>
              </li>
            );
          }}
        </For>
      </ul>
      <Show when={failure()}>
        {(text) => (
          <p class="field-note error" role="alert">
            {text()}
          </p>
        )}
      </Show>
      <p class="field-note">OpenAI and the OpenAI Blossom are trademarks of OpenAI; OpenRouter and its mark belong to OpenRouter. They identify the providers here and do not imply endorsement.</p>
      <AiFeatures />
      <Show when={dialog()} keyed>
        {(start) => <ProviderDialog start={start} onClose={() => setDialog(undefined)} onRemove={setRemoval} />}
      </Show>
      <Show when={removal()} keyed>
        {(summary) => <ConfirmDialog copy={removeProviderCopy(summary.config.name, summary.config.has_api_key, usedBy(summary.config.id))} onConfirm={() => void confirmRemoval()} onCancel={() => setRemoval(undefined)} />}
      </Show>
    </>
  );
}
