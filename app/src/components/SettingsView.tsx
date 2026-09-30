import { createForm } from "@tanstack/solid-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import type { AppSettings } from "../ipc/bindings/AppSettings";
import type { ConfigValue } from "../ipc/bindings/ConfigValue";
import type { IdentityField } from "../ipc/bindings/IdentityField";
import type { PullMode } from "../ipc/bindings/PullMode";
import type { RemoteInfo } from "../ipc/bindings/RemoteInfo";
import { client } from "../ipc/client";
import { basename } from "../format";
import { useApp } from "../state/app";
import { removeRemoteCopy, type ConfirmCopy } from "../state/confirmCopy";
import { dataOf } from "../state/queryData";
import { appKeys, repoKeys } from "../state/queryKeys";
import { SETTINGS_SECTIONS } from "../state/palette";
import { AUTO_FETCH_OPTIONS, effectivePullMode, pullModeLabel, remoteProblem, SSH_AGENT_LABEL, sourceLabel, sshKeyLabel } from "../state/settingsModel";
import { pullModes } from "../state/syncModel";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { PrivacyDiagnostics } from "./PrivacyDiagnostics";
import { SettingRow } from "./SettingRow";

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

function Segmented<T extends string>(props: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <div class="segmented" role="radiogroup" aria-label={props.label}>
      <For each={props.options}>
        {(option) => (
          <button type="button" role="radio" aria-checked={props.value === option.value} classList={{ on: props.value === option.value }} onClick={() => props.onChange(option.value)}>
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}

function TextSetting(props: { label: string; value: string; placeholder?: string; onCommit: (value: string) => void; suffix?: string }) {
  const [draft, setDraft] = createSignal<string | undefined>();
  const shown = () => draft() ?? props.value;
  const commit = () => {
    const value = draft();
    setDraft(undefined);
    if (value !== undefined && value !== props.value) props.onCommit(value);
  };
  return (
    <span class="input">
      <input
        type="text"
        aria-label={props.label}
        value={shown()}
        placeholder={props.placeholder}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => event.key === "Enter" && commit()}
      />
      <Show when={props.suffix}>{(text) => <span class="value-source">{text()}</span>}</Show>
    </span>
  );
}

const useSshKeys = () => useQuery(() => ({ queryKey: appKeys.sshKeys, queryFn: () => client.sshKeysList() }));

function SshKeyPicker(props: { label: string; value: string | null | undefined; blankLabel: string; onChange: (path: string | null) => void }) {
  const keys = useSshKeys();
  const listed = () => dataOf(keys) ?? [];
  const chosen = () => props.value ?? "";
  const custom = () => (chosen() !== "" && !listed().some((key) => key.path === chosen()) ? chosen() : undefined);
  const failure = () => (keys.error === null || keys.error === undefined ? undefined : message(keys.error));
  const browse = async () => {
    const start = listed()[0]?.path;
    const picked = await client.pickFile("Choose an SSH private key", start === undefined ? undefined : start.slice(0, start.lastIndexOf("/")));
    if (picked !== undefined) props.onChange(picked);
  };
  return (
    <>
      <span class="input">
        <select aria-label={props.label} value={chosen()} onChange={(event) => props.onChange(event.currentTarget.value === "" ? null : event.currentTarget.value)}>
          <option value="">{props.blankLabel}</option>
          <For each={listed()}>{(key) => <option value={key.path}>{key.name} · {key.algorithm}</option>}</For>
          <Show when={custom()}>{(path) => <option value={path()}>{path()}</option>}</Show>
        </select>
      </span>
      <button type="button" class="btn sm" onClick={() => void browse()}>
        Browse…
      </button>
      <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
    </>
  );
}

function Identity(props: { path: string | null }) {
  const queryClient = useQueryClient();
  const key = () => (props.path === null ? appKeys.identity : repoKeys.identity(props.path));
  const identity = useQuery(() => ({ queryKey: key(), queryFn: () => client.identityRead(props.path) }));
  const [failure, setFailure] = createSignal<string | undefined>();
  const saveIdentity = useMutation(() => ({
    mutationFn: (change: { field: IdentityField; value: string | null }) => client.identityWrite(props.path, change.field, change.value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key() }),
  }));
  const write = async (field: IdentityField, value: string | null) => {
    setFailure(undefined);
    try {
      await saveIdentity.mutateAsync({ field, value });
    } catch (error) {
      setFailure(message(error));
    }
  };
  const field = (label: string, key: IdentityField, pick: () => ConfigValue | undefined) => (
    <SettingRow title={label} note={props.path === null ? "Written on commits in every repository." : "Written on commits in this repository."}>
      <TextSetting
        label={label}
        value={pick()?.value ?? ""}
        placeholder="Not set"
        suffix={pick() === undefined ? undefined : sourceLabel(pick() as ConfigValue)}
        onCommit={(next) => void write(key, next.trim() === "" ? null : next)}
      />
      <Show when={props.path !== null && pick()?.source === "repository"}>
        <button type="button" class="btn sm" onClick={() => void write(key, null)}>
          Remove override
        </button>
      </Show>
    </SettingRow>
  );
  return (
    <>
      <h3>Identity</h3>
      {field("Name", "name", () => dataOf(identity)?.name)}
      {field("Email", "email", () => dataOf(identity)?.email)}
      <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
      <Show when={props.path === null}>
        <p class="field-note">Saved with <code>git config --global</code>.</p>
      </Show>
      <Show when={props.path !== null}>
        <p class="field-note">
          <Icon name="check" /> Changes are saved automatically to <code>.git/config</code>
        </p>
      </Show>
    </>
  );
}

function RemoteForm(props: { initial: { original: string | undefined; name: string; url: string }; onSubmit: (values: { name: string; url: string }) => Promise<void>; onCancel: () => void }) {
  const form = createForm(() => ({
    defaultValues: { name: props.initial.name, url: props.initial.url },
    validators: { onMount: ({ value }) => remoteProblem(value.name, value.url), onChange: ({ value }) => remoteProblem(value.name, value.url) },
    onSubmit: ({ value }) => props.onSubmit(value),
  }));
  const problem = form.useSelector((state) => state.errors[0] as string | undefined);
  const url = form.useSelector((state) => state.values.url);
  const name = form.useSelector((state) => state.values.name);
  return (
    <form
      class="remote-form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <span class="input">
        <form.Field name="name">
          {(field) => <input type="text" aria-label="Remote name" placeholder="origin" value={field().state.value} onInput={(event) => field().handleChange(event.currentTarget.value)} />}
        </form.Field>
      </span>
      <span class="input">
        <form.Field name="url">
          {(field) => (
            <input
              type="text"
              aria-label="Remote address"
              placeholder="https://github.com/example/repo.git"
              value={field().state.value}
              onInput={(event) => field().handleChange(event.currentTarget.value)}
            />
          )}
        </form.Field>
      </span>
      <button type="submit" class="btn primary" disabled={problem() !== undefined}>
        {props.initial.original === undefined ? "Add" : "Save"}
      </button>
      <button type="button" class="btn" onClick={props.onCancel}>
        Cancel
      </button>
      <Show when={url() !== "" && remoteProblem(name() || "x", url())}>{(text) => <span class="field-note error">{text()}</span>}</Show>
    </form>
  );
}

function Remotes(props: { path: string }) {
  const queryClient = useQueryClient();
  const remotes = useQuery(() => ({ queryKey: repoKeys.remotes(props.path), queryFn: () => client.remotesList(props.path) }));
  const change = useMutation(() => ({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: repoKeys.remotes(props.path) }),
  }));
  const [editing, setEditing] = createSignal<{ original: string | undefined; name: string; url: string } | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();
  const [pendingRemoval, setPendingRemoval] = createSignal<RemoteInfo | undefined>();

  const save = async (values: { name: string; url: string }) => {
    const draft = editing();
    if (draft === undefined) return;
    setFailure(undefined);
    try {
      await change.mutateAsync(() =>
        draft.original === undefined ? client.remoteAdd(props.path, values.name, values.url) : client.remoteEdit(props.path, draft.original, values.name, values.url),
      );
      setEditing(undefined);
    } catch (error) {
      setFailure(message(error));
    }
  };
  const copy = (): ConfirmCopy | undefined => {
    const remote = pendingRemoval();
    return remote === undefined ? undefined : removeRemoteCopy(remote.name, remote.fetch_url);
  };
  const confirmRemoval = async () => {
    const remote = pendingRemoval();
    setPendingRemoval(undefined);
    if (remote === undefined) return;
    try {
      await change.mutateAsync(() => client.remoteRemove(props.path, remote.name));
    } catch (error) {
      setFailure(message(error));
    }
  };

  return (
    <>
      <h3>Remotes</h3>
      <p class="setting-note">Where this repository fetches from and pushes to.</p>
      <ul class="remotes">
        <For each={dataOf(remotes) ?? []} fallback={<li class="setting-note">No remotes configured.</li>}>
          {(remote) => (
            <li>
              <span class="ref">{remote.name}</span>
              <span class="remote-url path-line" title={remote.fetch_url}>
                <bdi dir="ltr">{remote.fetch_url}</bdi>
              </span>
              <span class="setting-note">{remote.push_url === null ? "fetch and push" : `push to ${remote.push_url}`}</span>
              <span class="recent-acts">
                <button type="button" class="btn sm" onClick={() => setEditing({ original: remote.name, name: remote.name, url: remote.fetch_url })}>
                  Edit
                </button>
                <button type="button" class="btn sm text-danger" onClick={() => setPendingRemoval(remote)}>
                  Remove
                </button>
              </span>
            </li>
          )}
        </For>
      </ul>
      <Show
        when={editing()}
        keyed
        fallback={
          <button type="button" class="btn" onClick={() => setEditing({ original: undefined, name: "", url: "" })}>
            Add remote…
          </button>
        }
      >
        {(draft) => <RemoteForm initial={draft} onSubmit={save} onCancel={() => setEditing(undefined)} />}
      </Show>
      <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
      <Show when={copy()}>{(value) => <ConfirmDialog copy={value()} onConfirm={() => void confirmRemoval()} onCancel={() => setPendingRemoval(undefined)} />}</Show>
    </>
  );
}

const pullOptions = pullModes.map((entry) => ({ value: entry.mode, label: pullModeLabel(entry.mode) }));

export function SettingsView(props: { section: string }) {
  const app = useApp();
  const [failure, setFailure] = createSignal<string | undefined>();
  const repository = () => app.activePath();
  const scope = () => (props.section === "repository" && repository() !== undefined ? "repository" : "all");
  const section = () => (props.section === "repository" ? "git" : props.section);
  const settings = () => app.settings();

  const change = async (patch: Partial<AppSettings>) => {
    setFailure(await app.saveSettings({ ...settings(), ...patch }));
  };
  const overrideMode = () => {
    const path = repository();
    return path === undefined ? undefined : app.repoSettings(path);
  };
  const setOverride = async (mode: PullMode | null) => {
    const path = repository();
    if (path !== undefined) setFailure(await app.saveRepoSettings(path, { ...overrideMode(), pull_mode: mode }));
  };
  const setRepoKey = async (key: string | null) => {
    const path = repository();
    if (path !== undefined) setFailure(await app.saveRepoSettings(path, { pull_mode: overrideMode()?.pull_mode ?? null, ssh_key_path: key }));
  };
  const sshKeys = useSshKeys();
  const navigation = SETTINGS_SECTIONS.filter((entry) => entry.id !== "repository");

  return (
    <main class="settings" aria-label="Settings">
      <nav class="settings-nav" aria-label="Settings sections">
        <For each={navigation}>
          {(entry) => (
            <button type="button" classList={{ sel: section() === entry.id }} aria-current={section() === entry.id ? "page" : undefined} onClick={() => app.openSettings(entry.id)}>
              <Icon name={entry.icon} />
              {entry.label}
            </button>
          )}
        </For>
      </nav>
      <div class="settings-body">
        <div class="settings-scope" role="tablist" aria-label="Settings scope">
          <button type="button" role="tab" aria-selected={scope() === "all"} classList={{ on: scope() === "all" }} onClick={() => app.openSettings(section())}>
            All repositories
          </button>
          <Show when={repository()}>
            {(path) => (
              <button type="button" role="tab" aria-selected={scope() === "repository"} classList={{ on: scope() === "repository" }} onClick={() => app.openSettings("repository")}>
                This repository: {basename(path())}
              </button>
            )}
          </Show>
        </div>
        <Switch>
          <Match when={scope() === "repository" && repository()}>
            {(path) => (
              <>
                <h2>Repository settings</h2>
                <Identity path={path()} />
                <Remotes path={path()} />
                <h3>Pull mode override</h3>
                <SettingRow title="Pull mode" note="Strategy used when pulling into branches of this repository.">
                  <select
                    aria-label="Pull mode override"
                    value={overrideMode()?.pull_mode ?? ""}
                    onChange={(event) => void setOverride(event.currentTarget.value === "" ? null : (event.currentTarget.value as PullMode))}
                  >
                    <option value="">Inherit · {pullModeLabel(effectivePullMode(settings(), undefined).mode)}</option>
                    <For each={pullOptions}>{(option) => <option value={option.value}>{option.label}</option>}</For>
                  </select>
                </SettingRow>
                <h3>SSH</h3>
                <SettingRow title="SSH key" note="Key used to reach this repository's remotes over SSH. It overrides the app-wide key.">
                  <SshKeyPicker
                    label="SSH key override"
                    value={overrideMode()?.ssh_key_path}
                    blankLabel={`Inherit · ${settings().ssh_key_path === null || settings().ssh_key_path === undefined ? SSH_AGENT_LABEL : sshKeyLabel(settings().ssh_key_path, dataOf(sshKeys) ?? [])}`}
                    onChange={(key) => void setRepoKey(key)}
                  />
                </SettingRow>
              </>
            )}
          </Match>
          <Match when={section() === "general"}>
            <h2>General</h2>
            <p class="setting-note">Applies to every repository.</p>
            <SettingRow title="External editor" note="Command that opens a file or the repository. Leave empty to use the system default.">
              <TextSetting label="External editor command" value={settings().editor_command} placeholder="code" onCommit={(value) => void change({ editor_command: value.trim() })} />
            </SettingRow>
            <SettingRow title="External terminal" note="Command that opens the repository folder. Leave empty for Terminal.">
              <TextSetting label="External terminal command" value={settings().terminal_command} placeholder="open -a iTerm" onCommit={(value) => void change({ terminal_command: value.trim() })} />
            </SettingRow>
          </Match>
          <Match when={section() === "git"}>
            <h2>Git</h2>
            <Identity path={null} />
            <h3>Defaults</h3>
            <SettingRow title="Default branch" note="Name of the first branch in repositories you create.">
              <TextSetting label="Default branch" value={settings().default_branch} onCommit={(value) => void change({ default_branch: value })} />
            </SettingRow>
            <SettingRow title="Pull mode" note="Strategy used by Pull unless a repository overrides it.">
              <select aria-label="Pull mode" value={settings().pull_mode} onChange={(event) => void change({ pull_mode: event.currentTarget.value as PullMode })}>
                <For each={pullOptions}>{(option) => <option value={option.value}>{option.label}</option>}</For>
              </select>
            </SettingRow>
            <SettingRow title="Auto-fetch" note="Fetch every remote in the background. It never asks for credentials.">
              <Segmented
                label="Auto-fetch interval"
                value={String(settings().auto_fetch_minutes)}
                options={AUTO_FETCH_OPTIONS.map((option) => ({ value: String(option.minutes), label: option.label }))}
                onChange={(value) => void change({ auto_fetch_minutes: Number(value) })}
              />
            </SettingRow>
            <h3>SSH</h3>
            <SettingRow title="SSH key" note="Key used for every repository that has no key of its own. Leave it on ssh-agent to use the agent and your default keys.">
              <SshKeyPicker label="SSH key" value={settings().ssh_key_path} blankLabel={SSH_AGENT_LABEL} onChange={(key) => void change({ ssh_key_path: key })} />
            </SettingRow>
          </Match>
          <Match when={section() === "privacy"}>
            <PrivacyDiagnostics />
          </Match>
          <Match when={section() === "appearance"}>
            <h2>Appearance</h2>
            <p class="setting-note">Applies to every repository.</p>
            <SettingRow title="Theme" note="Dark, light, or follow the system.">
              <Segmented label="Theme" value={settings().theme} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} onChange={(value) => void change({ theme: value })} />
            </SettingRow>
            <SettingRow title="Density" note="Compact graph lanes are 10px apart; default lanes are 22px.">
              <Segmented label="Density" value={settings().density} options={[{ value: "compact", label: "Compact" }, { value: "default", label: "Default" }]} onChange={(value) => void change({ density: value })} />
            </SettingRow>
          </Match>
        </Switch>
        <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
      </div>
    </main>
  );
}
