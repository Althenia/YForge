import { createForm } from "@tanstack/solid-form";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { useQuery } from "../state/query";
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import type { ApiKeyChange } from "../ipc/bindings/ApiKeyChange";
import type { AuthMode } from "../ipc/bindings/AuthMode";
import type { ProviderKind } from "../ipc/bindings/ProviderKind";
import type { ProviderSummary } from "../ipc/bindings/ProviderSummary";
import { client } from "../ipc/client";
import { cardOf, PROVIDER_CARDS, providerProblems, statusView, type ProviderCard, type ProviderDraft } from "../state/aiModel";
import { modelsOptions, providersOptions } from "../state/aiProviders";
import { aiKeys } from "../state/queryKeys";
import { Icon } from "./Icon";
import { ProviderLogo } from "./ProviderLogo";
import { SignInPanel } from "./SignInPanel";
import { Select } from "./Select";
import { tip } from "./Tooltip";

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

export function StatusBadge(props: { summary: ProviderSummary }) {
  const view = () => statusView(props.summary.status);
  return (
    <span class="status-badge" classList={{ [view().tone]: true }} title={view().detail}>
      <Icon name={view().icon} size={14} />
      {view().label}
    </span>
  );
}

function CardGrid(props: { onChoose: (kind: ProviderKind) => void }) {
  return (
    <div class="provider-cards" role="group" aria-label="Provider">
      <For each={PROVIDER_CARDS}>
        {(card) => (
          <button type="button" class="provider-card" onClick={() => props.onChoose(card.kind)}>
            <ProviderLogo logo={card.logo} size={32} />
            <span class="provider-card-title">{card.title}</span>
            <span class="provider-card-blurb">{card.blurb}</span>
          </button>
        )}
      </For>
    </div>
  );
}

type KeyMode = "keep" | "set" | "clear";

function ProviderFields(props: { card: ProviderCard; provider: ProviderSummary | undefined; submitLabel: string; onSubmit: (draft: ProviderDraft, key: ApiKeyChange) => Promise<void> }) {
  const config = () => props.provider?.config;
  const form = createForm(() => ({
    defaultValues: {
      name: config()?.name ?? props.card.title,
      baseUrl: config()?.base_url ?? "",
      apiKey: "",
      authMode: (config()?.auth_mode ?? (props.card.subscription ? "subscription" : "api_key")) as AuthMode,
      keyMode: (config()?.has_api_key === true ? "keep" : "set") as KeyMode,
    },
    onSubmit: ({ value }) =>
      props.onSubmit(
        { kind: props.card.kind, name: value.name, baseUrl: value.baseUrl, apiKey: value.apiKey, authMode: value.authMode },
        value.keyMode === "keep" ? { kind: "keep" } : value.keyMode === "clear" ? { kind: "clear" } : { kind: "set", key: value.apiKey },
      ),
  }));
  const values = form.useSelector((state) => state.values);
  const draft = (): ProviderDraft => ({ kind: props.card.kind, ...values() });
  const usesKey = () => values().authMode === "api_key";
  const problems = createMemo(() => {
    const result = providerProblems({ ...draft(), apiKey: values().keyMode === "keep" ? "kept" : values().keyMode === "clear" ? "" : values().apiKey });
    if (usesKey() && values().keyMode === "clear" && props.card.key === "required") return { ...result, apiKey: `${props.card.title} needs an API key` };
    return result;
  });
  const [touched, setTouched] = createSignal(false);
  const shown = (field: keyof ReturnType<typeof problems>) => (touched() ? problems()[field] : undefined);
  const invalid = () => Object.keys(problems()).length > 0;
  const hasKey = () => config()?.has_api_key === true;
  return (
    <form
      class="entry-form"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (!invalid()) void form.handleSubmit();
      }}
    >
      <label class="field">
        <span class="field-label">Name</span>
        <span class="input" classList={{ invalid: shown("name") !== undefined }}>
          <form.Field name="name">{(field) => <input type="text" aria-label="Name" value={field().state.value} aria-invalid={shown("name") !== undefined} onInput={(event) => field().handleChange(event.currentTarget.value)} />}</form.Field>
        </span>
        <Show when={shown("name")}>{(text) => <span class="field-note error">{text()}</span>}</Show>
      </label>
      <Show when={props.card.subscription}>
        <div class="field">
          <span class="field-label">Sign-in</span>
          <span class="radio-row" role="radiogroup" aria-label="Sign-in">
            <button type="button" class="btn sm" classList={{ primary: usesKey() }} role="radio" aria-checked={usesKey()} onClick={() => form.setFieldValue("authMode", "api_key")}>
              API key
            </button>
            <button type="button" class="btn sm" classList={{ primary: !usesKey() }} role="radio" aria-checked={!usesKey()} onClick={() => form.setFieldValue("authMode", "subscription")}>
              Subscription
            </button>
          </span>
          <span class="field-note">
            {usesKey()
              ? "YForge calls the provider API with a key you paste here."
              : props.card.kind === "claude"
                ? "YForge uses your Claude Code sign-in. It never copies or stores it."
                : "YForge signs in directly, in your browser or with a code."}
          </span>
        </div>
      </Show>
      <Show when={props.card.baseUrl}>
        <label class="field">
          <span class="field-label">Base URL</span>
          <span class="input" classList={{ invalid: shown("baseUrl") !== undefined }}>
            <form.Field name="baseUrl">
              {(field) => (
                <input type="text" aria-label="Base URL" placeholder="http://localhost:11434/v1" value={field().state.value} aria-invalid={shown("baseUrl") !== undefined} onInput={(event) => field().handleChange(event.currentTarget.value)} />
              )}
            </form.Field>
          </span>
          <Show when={shown("baseUrl")} fallback={<span class="field-note">YForge appends /chat/completions and /models.</span>}>
            {(text) => <span class="field-note error">{text()}</span>}
          </Show>
        </label>
      </Show>
      <Show when={usesKey()}>
        <div class="field">
          <span class="field-label">API key</span>
          <Show
            when={values().keyMode === "keep"}
            fallback={
              <span class="input" classList={{ invalid: shown("apiKey") !== undefined }}>
                <form.Field name="apiKey">
                  {(field) => (
                    <input
                      type="password"
                      autocomplete="off"
                      aria-label="API key"
                      placeholder={props.card.key === "optional" ? "Optional" : "Paste your key"}
                      value={field().state.value}
                      disabled={values().keyMode === "clear"}
                      aria-invalid={shown("apiKey") !== undefined}
                      onInput={(event) => field().handleChange(event.currentTarget.value)}
                    />
                  )}
                </form.Field>
              </span>
            }
          >
            <span class="key-saved">
              <Icon name="lock" />
              <span>Key saved in the macOS Keychain</span>
              <button type="button" class="btn sm" onClick={() => form.setFieldValue("keyMode", "set")}>
                Replace
              </button>
              <button type="button" class="btn sm text-danger" onClick={() => form.setFieldValue("keyMode", "clear")}>
                Clear
              </button>
            </span>
          </Show>
          <Show when={values().keyMode === "clear"}>
            <span class="field-note">The key is deleted from the Keychain when you save.{" "}
              <button type="button" class="btn sm" onClick={() => form.setFieldValue("keyMode", "keep")}>
                Keep it
              </button>
            </span>
          </Show>
          <Show when={shown("apiKey")}>{(text) => <span class="field-note error">{text()}</span>}</Show>
          <Show when={hasKey() && values().keyMode === "set"}>
            <span class="field-note">
              The saved key is never shown again.{" "}
              <button type="button" class="btn sm" onClick={() => form.setFieldValue("keyMode", "keep")}>
                Keep the saved key
              </button>
            </span>
          </Show>
        </div>
      </Show>
      <div class="foot">
        <button type="submit" class="btn" classList={{ primary: props.provider === undefined }} disabled={form.state.isSubmitting}>
          {props.submitLabel}
        </button>
      </div>
    </form>
  );
}

function ProviderPanel(props: { id: string; onRemove: (summary: ProviderSummary) => void; onDone: () => void }) {
  const queryClient = useQueryClient();
  const providers = useQuery(providersOptions);
  const summary = () => (providers.data ?? []).find((entry) => entry.config.id === props.id);
  const [failure, setFailure] = createSignal<string | undefined>();
  const [model, setModel] = createSignal<string | undefined>();
  const models = useQuery(() => modelsOptions(props.id));
  const refresh = () => queryClient.invalidateQueries({ queryKey: aiKeys.providers });
  const save = useMutation(() => ({
    mutationFn: (input: { draft: ProviderDraft; key: ApiKeyChange }) => {
      const card = cardOf(input.draft.kind);
      return client.aiProviderUpdate({
        id: props.id,
        auth_mode: input.draft.authMode,
        name: input.draft.name.trim(),
        ...(card.baseUrl ? { base_url: input.draft.baseUrl.trim() } : {}),
        api_key: input.key,
      });
    },
    onSuccess: refresh,
  }));
  const test = useMutation(() => ({ mutationFn: () => client.aiProviderTest(props.id), onSuccess: refresh }));
  const activate = useMutation(() => ({
    mutationFn: (chosen: string | null) => client.aiSetActive(props.id, chosen),
    onSuccess: refresh,
  }));
  const chosenModel = () => model() ?? summary()?.config.model ?? "";

  return (
    <Show when={summary()} fallback={<p class="setting-note">This provider no longer exists.</p>}>
      {(current) => {
        const card = () => cardOf(current().config.kind);
        const ready = () => current().status.kind === "ready";
        const view = () => statusView(current().status);
        return (
          <div class="provider-panel">
            <div class="provider-head">
              <ProviderLogo logo={card().logo} size={32} />
              <div class="provider-head-text">
                <strong>{current().config.name}</strong>
                <span class="setting-note">{card().title}</span>
              </div>
              <StatusBadge summary={current()} />
              <button type="button" class="btn sm" aria-busy={test.isPending} disabled={test.isPending} onClick={() => test.mutate()}>
                <Icon name="sync" size={14} />
                Test connection
              </button>
            </div>
            <Show when={view().detail}>{(detail) => <p class="field-note error">{detail()}</p>}</Show>
            <Show when={current().status.kind === "signed_out"}>
              <SignInPanel provider={current()} deviceCode={current().config.kind === "chatgpt"} />
            </Show>
            <Show when={current().config.auth_mode === "subscription" && current().config.kind === "claude"}>
              <p class="field-note">
                <Icon name="lock" size={14} /> YForge reads your Claude Code sign-in from the macOS Keychain. Run <code>claude</code> and sign in if this says signed out.
              </p>
            </Show>
            <ProviderFields
              card={card()}
              provider={current()}
              submitLabel="Save changes"
              onSubmit={async (draft, key) => {
                setFailure(undefined);
                try {
                  await save.mutateAsync({ draft, key });
                } catch (error) {
                  setFailure(message(error));
                }
              }}
            />
            <section class="model-pick" aria-label="Model">
              <label class="field">
                <span class="field-label">Model</span>
                <span class="field-row">
                  <Select
                    label="Model"
                    value={chosenModel()}
                    options={(models.data ?? []).map((entry) => ({
                      value: entry.id,
                      label: entry.display_name,
                      hint: entry.context_window === null || entry.context_window === undefined ? undefined : `${Math.round(entry.context_window / 1000)}k`,
                    }))}
                    placeholder={models.isFetching ? "Loading…" : "Choose a model…"}
                    disabled={!ready()}
                    disabledReason="Ready status is required: sign in or check the key first"
                    onChange={(value) => setModel(value)}
                  />
                  <button type="button" class="btn sm" aria-busy={models.isFetching} disabled={models.isFetching || !ready()} onClick={() => void models.refetch()}>
                    Load models
                  </button>
                </span>
                <span class="field-note">Load the list from the provider, then choose the model this provider should use.</span>
                <Show when={models.error}>{(error) => <span class="field-note error">{message(error())}</span>}</Show>
                <Show when={models.isSuccess && (models.data ?? []).length === 0}>
                  <span class="field-note">The provider listed no models. Check the provider account, then load again.</span>
                </Show>
              </label>
              <div class="hrow">
                <button
                  type="button"
                  class="btn primary"
                  disabled={!ready() || activate.isPending}
                  onClick={() => activate.mutate(chosenModel().trim() === "" ? null : chosenModel().trim())}
                >
                  <Icon name="check" />
                  {current().active ? "Save model" : "Use this provider"}
                </button>
                <Show when={!ready()}>
                  <span class="reason">Ready status is required: {view().label.toLowerCase()}</span>
                </Show>
                <Show when={current().active}>
                  <span class="chip chip-success">
                    <Icon name="check" size={14} />
                    Active
                  </span>
                </Show>
              </div>
            </section>
            <Show when={failure() ?? (save.error ? message(save.error) : undefined) ?? (activate.error ? message(activate.error) : undefined)}>
              {(text) => (
                <p class="field-note error" role="alert">
                  {text()}
                </p>
              )}
            </Show>
            <div class="foot split">
              <button type="button" class="btn text-danger" onClick={() => props.onRemove(current())}>
                <Icon name="trash" size={14} />
                Remove provider
              </button>
              <button type="button" class="btn" onClick={props.onDone}>
                Done
              </button>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

export type ProviderDialogStart = { kind: "add" } | { kind: "edit"; id: string };

export function ProviderDialog(props: { start: ProviderDialogStart; onClose: () => void; onRemove: (summary: ProviderSummary) => void }) {
  const queryClient = useQueryClient();
  const titleId = createUniqueId();
  const [kind, setKind] = createSignal<ProviderKind | undefined>();
  const [providerId, setProviderId] = createSignal<string | undefined>(props.start.kind === "edit" ? props.start.id : undefined);
  const [failure, setFailure] = createSignal<string | undefined>();
  const add = useMutation(() => ({
    mutationFn: (draft: ProviderDraft) => {
      const card = cardOf(draft.kind);
      return client.aiProviderAdd({
        kind: draft.kind,
        auth_mode: draft.authMode,
        name: draft.name.trim(),
        ...(card.baseUrl ? { base_url: draft.baseUrl.trim() } : {}),
        ...(draft.authMode === "api_key" && draft.apiKey.trim() !== "" ? { api_key: draft.apiKey.trim() } : {}),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: aiKeys.providers }),
  }));
  const step = () => (providerId() !== undefined ? "panel" : kind() !== undefined ? "form" : "choose");
  const title = () => (step() === "choose" ? "Add an AI provider" : step() === "form" ? `Add ${cardOf(kind() as ProviderKind).title}` : "AI provider");

  return (
    <div class="scrim" onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <div
        class="dialog provider-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            props.onClose();
          }
        }}
      >
        <h3 id={titleId}>
          <Show when={step() === "form"}>
            <button type="button" class="icon-btn dense back" {...tip("Back to providers")} onClick={() => setKind(undefined)}>
              <Icon name="chevron" />
            </button>
          </Show>
          {title()}
        </h3>
        <Show when={step() === "choose"}>
          <p class="setting-note">Nothing is sent to a provider until you run an AI action. You can add several and choose one to use.</p>
          <CardGrid onChoose={setKind} />
          <div class="foot">
            <button type="button" class="btn" onClick={props.onClose}>
              Cancel
            </button>
          </div>
        </Show>
        <Show when={step() === "form" ? kind() : undefined}>
          {(chosen) => (
            <>
              <p class="setting-note">{cardOf(chosen()).blurb}</p>
              <ProviderFields
                card={cardOf(chosen())}
                provider={undefined}
                submitLabel="Add provider"
                onSubmit={async (draft) => {
                  setFailure(undefined);
                  try {
                    setProviderId((await add.mutateAsync(draft)).config.id);
                  } catch (error) {
                    setFailure(message(error));
                  }
                }}
              />
              <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
            </>
          )}
        </Show>
        <Show when={providerId()}>{(id) => <ProviderPanel id={id()} onRemove={props.onRemove} onDone={props.onClose} />}</Show>
      </div>
    </div>
  );
}
