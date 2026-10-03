import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { client } from "../ipc/client";
import { repoKeys } from "../state/queryKeys";
import { useQuery } from "../state/query";
import { SettingRow } from "./SettingRow";

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

export const NOT_INSTALLED = "Git LFS is not installed";

export function LfsSettings(props: { path: string }) {
  const queryClient = useQueryClient();
  const key = () => repoKeys.read(props.path, "lfs");
  const status = useQuery(() => ({ queryKey: key(), queryFn: () => client.lfsStatus(props.path) }));
  const [tracking, setTracking] = createSignal<string | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();

  const attempt = async (run: () => Promise<unknown>): Promise<boolean> => {
    setFailure(undefined);
    try {
      await run();
      await queryClient.invalidateQueries({ queryKey: key() });
      return true;
    } catch (error) {
      setFailure(message(error));
      return false;
    }
  };
  const track = async () => {
    const pattern = tracking();
    if (pattern !== undefined && (await attempt(() => client.lfsTrack(props.path, pattern)))) setTracking(undefined);
  };

  return (
    <>
      <h3>Git LFS</h3>
      <Show when={status.data}>
        {(current) => (
          <Show
            when={current().installed}
            fallback={
              <SettingRow id="lfs" title="Git LFS" note="Large files are stored outside the repository by Git LFS.">
                <span class="field-note" role="status">
                  {NOT_INSTALLED}
                </span>
              </SettingRow>
            }
          >
            <SettingRow id="lfs" title="Git LFS" note="Installed on this Mac.">
              <span class="field-note" role="status">
                Git LFS {current().version}
              </span>
            </SettingRow>
            <SettingRow title="This repository" note="Initializing installs the LFS hooks into this repository only, not into your global Git config.">
              <Show
                when={current().initialized}
                fallback={
                  <button type="button" class="btn sm" onClick={() => void attempt(() => client.lfsInitialize(props.path))}>
                    Initialize LFS
                  </button>
                }
              >
                <span class="field-note" role="status">
                  Initialized for this repository
                </span>
              </Show>
            </SettingRow>
            <p class="setting-note">Tracked patterns are read from .gitattributes. Each change is written there and left unstaged for you to commit.</p>
            <ul class="tool-list" aria-label="Tracked patterns">
              <For each={current().patterns} fallback={<li class="setting-note">No pattern is tracked by Git LFS.</li>}>
                {(pattern) => (
                  <li>
                    <span class="tool-main">
                      <span class="tool-name path-line">
                        <bdi dir="ltr">{pattern}</bdi>
                      </span>
                    </span>
                    <span class="recent-acts">
                      <button type="button" class="btn sm" aria-label={`Untrack ${pattern}`} onClick={() => void attempt(() => client.lfsUntrack(props.path, pattern))}>
                        Untrack
                      </button>
                    </span>
                  </li>
                )}
              </For>
            </ul>
            <Show
              when={tracking() !== undefined}
              fallback={
                <button type="button" class="btn" onClick={() => setTracking("")}>
                  Track pattern…
                </button>
              }
            >
              <form
                class="tool-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void track();
                }}
              >
                <label class="field">
                  <span class="field-label">Pattern</span>
                  <span class="input">
                    <input type="text" aria-label="Pattern to track" placeholder="*.psd" spellcheck={false} value={tracking() ?? ""} onInput={(event) => setTracking(event.currentTarget.value)} />
                  </span>
                </label>
                <span class="tool-form-actions">
                  <button type="submit" class="btn primary">
                    Track
                  </button>
                  <button type="button" class="btn" onClick={() => setTracking(undefined)}>
                    Cancel
                  </button>
                </span>
              </form>
            </Show>
          </Show>
        )}
      </Show>
      <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
      <Show when={status.error}>{(error) => <p class="field-note error" role="alert">{message(error())}</p>}</Show>
    </>
  );
}
