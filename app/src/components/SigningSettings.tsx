import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
import type { SigningConfig } from "../ipc/bindings/SigningConfig";
import type { SigningFormat } from "../ipc/bindings/SigningFormat";
import type { SigningScope } from "../ipc/bindings/SigningScope";
import { client } from "../ipc/client";
import { basename } from "../format";
import { useApp } from "../state/app";
import { useQuery } from "../state/query";
import { CUSTOM_KEY, SIGNING_FORMATS, signingKeyChoice, signingKeyOptions } from "../state/settingsModel";
import { SettingRow } from "./SettingRow";
import { Select } from "./Select";
import { Switch } from "./Switch";
import { TextSetting } from "./TextSetting";

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

const NO_REPOSITORY = "Open a repository to change its signing settings";

export const signingKey = ["signing"] as const;

export function SigningSettings() {
  const app = useApp();
  const queryClient = useQueryClient();
  const [scope, setScope] = createSignal<SigningScope>("global");
  const [customKey, setCustomKey] = createSignal(false);
  const [failure, setFailure] = createSignal<string | undefined>();
  const [saving, setSaving] = createSignal(false);
  const repository = () => app.activePath();
  const activeScope = (): SigningScope => (scope() === "repository" && repository() !== undefined ? "repository" : "global");
  const path = () => (activeScope() === "repository" ? (repository() ?? null) : null);
  const config = useQuery(() => ({ queryKey: [...signingKey, "config", activeScope(), path()], queryFn: () => client.signingRead(activeScope(), path()) }));
  const keys = useQuery(() => ({ queryKey: [...signingKey, "keys", config.data?.program ?? ""], queryFn: () => client.signingKeys(config.data?.program ?? "") }));

  const write = async (patch: Partial<SigningConfig>) => {
    const current = config.data;
    if (current === undefined || saving()) return;
    setSaving(true);
    setFailure(undefined);
    try {
      await client.signingWrite(activeScope(), path(), { ...current, ...patch });
      await queryClient.invalidateQueries({ queryKey: signingKey });
    } catch (error) {
      setFailure(message(error));
    } finally {
      setSaving(false);
    }
  };
  const keyChoice = (current: SigningConfig) => (customKey() ? CUSTOM_KEY : signingKeyChoice(current.key, keys.data ?? [], current.format));
  const chooseKey = (value: string) => {
    if (saving()) return;
    setCustomKey(value === CUSTOM_KEY);
    if (value !== CUSTOM_KEY) void write({ key: value });
  };

  return (
    <>
      <h3>Commit signing</h3>
      <SettingRow id="signing-scope" title="Apply signing to" note={activeScope() === "global" ? "Saved with git config --global, for every repository." : "Saved to .git/config, for this repository only."}>
        <Select
          label="Apply signing to"
          value={activeScope()}
          options={[
            { value: "global", label: "All repositories (global Git config)" },
            { value: "repository", label: repository() === undefined ? "This repository" : `This repository: ${basename(repository() as string)}`, ...(repository() === undefined ? { disabledReason: NO_REPOSITORY } : {}) },
          ]}
          disabled={saving()}
          disabledReason="Saving signing settings"
          onChange={(value) => setScope(value as SigningScope)}
        />
      </SettingRow>
      <Show when={config.data}>
        {(current) => (
          <>
            <SettingRow id="sign-commits" title="Sign commits" note="Every commit and merge commit YForge makes is signed (commit.gpgSign).">
              <Switch label="Sign commits" checked={current().sign_commits} disabled={saving()} onChange={(next) => void write({ sign_commits: next })} />
            </SettingRow>
            <SettingRow id="sign-tags" title="Sign tags" note="Every tag YForge makes is signed (tag.gpgSign); a tag without a message gets its name as the message.">
              <Switch label="Sign tags" checked={current().sign_tags} disabled={saving()} onChange={(next) => void write({ sign_tags: next })} />
            </SettingRow>
            <SettingRow id="signing-format" title="Signing format" note="OpenPGP, SSH, or X.509 (gpg.format).">
              <Select
                label="Signing format"
                value={current().format}
                options={SIGNING_FORMATS}
                disabled={saving()}
                disabledReason="Saving signing settings"
                onChange={(value) => {
                  setCustomKey(false);
                  void write({ format: value as SigningFormat });
                }}
              />
            </SettingRow>
            <SettingRow id="signing-key" title="Signing key" note="A secret OpenPGP key or a public key in ~/.ssh, by key ID or file and identity (user.signingkey).">
              <Select label="Signing key" value={keyChoice(current())} options={signingKeyOptions(keys.data ?? [], current().format)} disabled={saving()} disabledReason="Saving signing settings" onChange={chooseKey} />
              <Show when={keyChoice(current()) === CUSTOM_KEY}>
                <TextSetting label="Custom signing key" value={current().key} placeholder="Key ID, fingerprint, or path" disabled={saving()} onCommit={(value) => void write({ key: value.trim() })} />
              </Show>
            </SettingRow>
            <SettingRow id="signing-program" title="Signing program" note="gpg.program. Leave empty for Git's default.">
              <TextSetting label="Signing program" value={current().program} placeholder="gpg" disabled={saving()} onCommit={(value) => void write({ program: value.trim() })} />
            </SettingRow>
          </>
        )}
      </Show>
      <Show when={saving()}><p class="field-note" role="status" aria-busy="true"><span class="busy-spinner" aria-hidden="true" />Saving signing settings…</p></Show>
      <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
      <Show when={config.error}>{(error) => <p class="field-note error" role="alert">{message(error())}</p>}</Show>
    </>
  );
}
