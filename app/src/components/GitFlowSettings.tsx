import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import type { GitFlowConfig } from "../ipc/bindings/GitFlowConfig";
import { client } from "../ipc/client";
import { repoKeys } from "../state/queryKeys";
import { useQuery } from "../state/query";
import { SettingRow } from "./SettingRow";

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

export const FLOW_DEFAULTS: GitFlowConfig = { production: "main", development: "develop", feature: "feature/", release: "release/", hotfix: "hotfix/", version_tag: "" };

const FIELDS: ReadonlyArray<{ key: keyof GitFlowConfig; label: string }> = [
  { key: "production", label: "Production branch" },
  { key: "development", label: "Development branch" },
  { key: "feature", label: "Feature prefix" },
  { key: "release", label: "Release prefix" },
  { key: "hotfix", label: "Hotfix prefix" },
  { key: "version_tag", label: "Version tag prefix" },
];

export function GitFlowSettings(props: { path: string }) {
  const queryClient = useQueryClient();
  const key = () => repoKeys.read(props.path, "gitflow");
  const stored = useQuery(() => ({ queryKey: key(), queryFn: () => client.gitFlowConfig(props.path) }));
  const [draft, setDraft] = createSignal<GitFlowConfig>(FLOW_DEFAULTS);
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<string | undefined>();

  const initialize = async () => {
    if (busy()) return;
    setBusy(true);
    setFailure(undefined);
    try {
      await client.gitFlowInit(props.path, draft());
      await queryClient.invalidateQueries({ queryKey: key() });
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3>Git Flow</h3>
      <Show when={stored.isFetched}>
        <Show
          when={stored.data}
          fallback={
            <form
              class="tool-form flow-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!busy()) void initialize();
              }}
            >
              <p class="setting-note" id="setting-git-flow" tabindex={-1}>
                Git Flow is not initialized in this repository. Initializing saves these names as gitflow.* in this repository's Git config, the way git-flow does, and adds a Git Flow section to the sidebar.
              </p>
              <For each={FIELDS}>
                {(field) => (
                  <label class="field">
                    <span class="field-label">{field.label}</span>
                    <span class="input">
                      <input type="text" aria-label={field.label} spellcheck={false} value={draft()[field.key]} disabled={busy()} onInput={(event) => setDraft({ ...draft(), [field.key]: event.currentTarget.value })} />
                    </span>
                  </label>
                )}
              </For>
              <span class="tool-form-actions">
                <button type="submit" class="btn primary" aria-busy={busy()} disabled={busy()}>
                  {busy() ? "Initializing…" : "Initialize Git Flow"}
                </button>
              </span>
            </form>
          }
        >
          {(config) => (
            <SettingRow id="git-flow" title="Git Flow" note="Initialized; saved as gitflow.* in this repository's Git config.">
              <dl class="flow-values" aria-label="Git Flow configuration">
                <For each={FIELDS}>
                  {(field) => (
                    <>
                      <dt>{field.label}</dt>
                      <dd>
                        <bdi dir="ltr">{config()[field.key] === "" ? "none" : config()[field.key]}</bdi>
                      </dd>
                    </>
                  )}
                </For>
              </dl>
            </SettingRow>
          )}
        </Show>
      </Show>
      <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
      <Show when={busy()}><p class="field-note" role="status"><span class="busy-spinner" aria-hidden="true" />Initializing Git Flow…</p></Show>
      <Show when={stored.error}>{(error) => <p class="field-note error" role="alert">{message(error())}</p>}</Show>
    </>
  );
}
