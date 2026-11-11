import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import type { FolderGitConfig } from "../ipc/bindings/FolderGitConfig";
import type { SigningFormat } from "../ipc/bindings/SigningFormat";
import { client } from "../ipc/client";
import type { ConfirmCopy } from "../state/confirmCopy";
import { useQuery } from "../state/query";
import { appKeys } from "../state/queryKeys";
import { SIGNING_FORMATS, SSH_AGENT_LABEL, sshKeyLabel } from "../state/settingsModel";
import { settingAnchor } from "../state/settingsSearch";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { signingKey } from "./SigningSettings";
import { Switch } from "./Switch";

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

type Draft = {
  folder: string;
  authorName: string;
  authorEmail: string;
  sshKeyPath: string;
  signCommits: boolean;
  signTags: boolean;
  format: SigningFormat;
  signingKey: string;
  program: string;
};

const emptyDraft = (): Draft => ({ folder: "", authorName: "", authorEmail: "", sshKeyPath: "", signCommits: false, signTags: false, format: "openpgp", signingKey: "", program: "" });

const draftOf = (config: FolderGitConfig): Draft => ({
  folder: config.folder,
  authorName: config.author_name ?? "",
  authorEmail: config.author_email ?? "",
  sshKeyPath: config.ssh_key_path ?? "",
  signCommits: config.signing.sign_commits,
  signTags: config.signing.sign_tags,
  format: config.signing.format,
  signingKey: config.signing.key,
  program: config.signing.program,
});

const removeCopy = (config: FolderGitConfig): ConfirmCopy => ({
  title: "Remove this folder rule?",
  names: [config.folder],
  consequences: ["Repositories under this folder use the global Git config again. The folder rule file and the repositories are not changed."],
  confirmLabel: "Remove folder rule",
});

export function FolderGitSettings() {
  const queryClient = useQueryClient();
  const configs = useQuery(() => ({ queryKey: appKeys.folderConfigs, queryFn: async () => (await client.folderGitConfigsList()) ?? [] }));
  const keys = useQuery(() => ({ queryKey: appKeys.sshKeys, queryFn: () => client.sshKeysList() }));
  const [draft, setDraft] = createSignal<Draft | undefined>();
  const [removal, setRemoval] = createSignal<FolderGitConfig | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();
  const [saving, setSaving] = createSignal(false);
  const list = () => configs.data ?? [];
  const update = (patch: Partial<Draft>) => setDraft((current) => (current === undefined ? current : { ...current, ...patch }));

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appKeys.folderConfigs }),
      queryClient.invalidateQueries({ queryKey: appKeys.identity }),
      queryClient.invalidateQueries({ queryKey: ["repo"] }),
      queryClient.invalidateQueries({ queryKey: signingKey }),
    ]);
  };

  const browse = async () => {
    const picked = await client.pickFolder("Choose a folder");
    if (picked !== undefined) update({ folder: picked });
  };

  const save = async () => {
    const current = draft();
    if (current === undefined || saving()) return;
    if (current.folder.trim() === "") {
      setFailure("Enter a folder path");
      return;
    }
    setSaving(true);
    setFailure(undefined);
    try {
      await client.folderGitConfigSave({
        folder: current.folder.trim(),
        author_name: current.authorName.trim() === "" ? null : current.authorName.trim(),
        author_email: current.authorEmail.trim() === "" ? null : current.authorEmail.trim(),
        ssh_key_path: current.sshKeyPath === "" ? null : current.sshKeyPath,
        signing: { sign_commits: current.signCommits, sign_tags: current.signTags, format: current.format, key: current.signingKey.trim(), program: current.program.trim() },
      });
      setDraft(undefined);
      await invalidate();
    } catch (error) {
      setFailure(message(error));
    } finally {
      setSaving(false);
    }
  };

  const confirmRemoval = async () => {
    const config = removal();
    setRemoval(undefined);
    if (config === undefined) return;
    setFailure(undefined);
    try {
      await client.folderGitConfigRemove(config.folder);
      await invalidate();
    } catch (error) {
      setFailure(message(error));
    }
  };

  const signingSummary = (config: FolderGitConfig) =>
    `Sign commits ${config.signing.sign_commits ? "on" : "off"} · Sign tags ${config.signing.sign_tags ? "on" : "off"} · ${SIGNING_FORMATS.find((entry) => entry.value === config.signing.format)?.label ?? config.signing.format}${config.signing.key === "" ? "" : ` · ${config.signing.key}`}`;

  return (
    <>
      <h3 id={settingAnchor("folder-git-rules")}>Folder rules</h3>
      <p class="setting-note">
        Rules are stored in standard Git [includeIf "gitdir:&lt;folder&gt;/"] files. Repository .git/config overrides folder rules, folder rules override global Git config, and the active profile yields when repository or folder identity is set.
      </p>
      <ul class="provider-list" aria-label="Folder Git rules">
        <For each={list()} fallback={<li class="setting-note">No folder rules yet.</li>}>
          {(config) => (
            <li class="provider-row">
              <span class="provider-name">
                <strong class="mono">{config.folder}</strong>
                <span class="setting-note">
                  {config.author_name ?? "No author name"} · {config.author_email ?? "No author email"}
                </span>
                <span class="setting-note">SSH key: {sshKeyLabel(config.ssh_key_path, keys.data ?? [])}</span>
                <span class="setting-note">{signingSummary(config)}</span>
                <span class="setting-note mono">{config.config_path}</span>
              </span>
              <span class="recent-acts">
                <button type="button" class="btn sm" onClick={() => setDraft(draftOf(config))}>
                  Edit
                </button>
                <button type="button" class="btn sm text-danger" onClick={() => setRemoval(config)}>
                  Remove
                </button>
              </span>
            </li>
          )}
        </For>
      </ul>
      <Show
        when={draft()}
        fallback={
          <button type="button" class="btn" onClick={() => setDraft(emptyDraft())}>
            <Icon name="plus" />
            Add folder rule…
          </button>
        }
      >
        {(current) => (
          <div class="entry-form" aria-label="Folder rule">
            <label class="field">
              <span class="field-label">Folder</span>
              <span class="input">
                <input type="text" aria-label="Folder" value={current().folder} onInput={(event) => update({ folder: event.currentTarget.value })} />
              </span>
            </label>
            <button type="button" class="btn sm" onClick={() => void browse()}>
              Browse…
            </button>
            <label class="field">
              <span class="field-label">Name</span>
              <span class="input">
                <input type="text" aria-label="Name" value={current().authorName} onInput={(event) => update({ authorName: event.currentTarget.value })} />
              </span>
            </label>
            <label class="field">
              <span class="field-label">Email</span>
              <span class="input">
                <input type="text" aria-label="Email" value={current().authorEmail} onInput={(event) => update({ authorEmail: event.currentTarget.value })} />
              </span>
            </label>
            <div class="field">
              <span class="field-label">SSH key</span>
              <Select
                label="SSH key"
                value={current().sshKeyPath}
                options={[
                  { value: "", label: SSH_AGENT_LABEL },
                  ...(keys.data ?? []).map((key) => ({ value: key.path, label: `${key.name} · ${key.algorithm}` })),
                  ...(current().sshKeyPath !== "" && !(keys.data ?? []).some((key) => key.path === current().sshKeyPath) ? [{ value: current().sshKeyPath, label: current().sshKeyPath }] : []),
                ]}
                onChange={(value) => update({ sshKeyPath: value })}
              />
            </div>
            <div class="field">
              <span class="field-label">Sign commits</span>
              <Switch label="Sign commits" checked={current().signCommits} onChange={(next) => update({ signCommits: next })} />
              <span class="field-note">{current().signCommits ? "On" : "Off"}</span>
            </div>
            <div class="field">
              <span class="field-label">Sign tags</span>
              <Switch label="Sign tags" checked={current().signTags} onChange={(next) => update({ signTags: next })} />
              <span class="field-note">{current().signTags ? "On" : "Off"}</span>
            </div>
            <div class="field">
              <span class="field-label">Signing format</span>
              <Select label="Signing format" value={current().format} options={SIGNING_FORMATS} onChange={(value) => update({ format: value as SigningFormat })} />
            </div>
            <label class="field">
              <span class="field-label">Signing key</span>
              <span class="input">
                <input type="text" aria-label="Signing key" placeholder="Git default" value={current().signingKey} onInput={(event) => update({ signingKey: event.currentTarget.value })} />
              </span>
            </label>
            <div class="foot">
              <button type="button" class="btn" onClick={() => setDraft(undefined)}>
                Cancel
              </button>
              <button type="button" class="btn primary" disabled={saving()} aria-busy={saving()} onClick={() => void save()}>
                Save
              </button>
            </div>
          </div>
        )}
      </Show>
      <Show when={failure()}>
        {(text) => (
          <p class="field-note error" role="alert">
            {text()}
          </p>
        )}
      </Show>
      <Show when={configs.error}>
        {(error) => (
          <p class="field-note error" role="alert">
            {message(error())}
          </p>
        )}
      </Show>
      <Show when={removal()} keyed>
        {(config) => <ConfirmDialog copy={removeCopy(config)} onConfirm={() => void confirmRemoval()} onCancel={() => setRemoval(undefined)} />}
      </Show>
    </>
  );
}
