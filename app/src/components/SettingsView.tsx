import { createForm } from "@tanstack/solid-form";
import { useMutation, useQueryClient } from "@tanstack/solid-query";
import { useQuery } from "../state/query";
import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from "solid-js";
import type { AppSettings } from "../ipc/bindings/AppSettings";
import type { CliInstall } from "../ipc/bindings/CliInstall";
import type { ConfigValue } from "../ipc/bindings/ConfigValue";
import type { IdentityField } from "../ipc/bindings/IdentityField";
import type { PullMode } from "../ipc/bindings/PullMode";
import type { RemoteInfo } from "../ipc/bindings/RemoteInfo";
import { client } from "../ipc/client";
import { basename } from "../format";
import { useApp } from "../state/app";
import { removeRemoteCopy, type ConfirmCopy } from "../state/confirmCopy";
import { appKeys, repoKeys } from "../state/queryKeys";
import { SETTINGS_SECTIONS } from "../state/palette";
import { AUTO_FETCH_OPTIONS, effectivePullMode, pullModeLabel, remoteProblem, SSH_AGENT_LABEL, sourceLabel, sshKeyLabel } from "../state/settingsModel";
import { pullModes } from "../state/syncModel";
import { crumb, matchCounts, searchSettings, settingAnchor, type SettingEntry } from "../state/settingsSearch";
import { AiSettings } from "./AiSettings";
import { ConfirmDialog } from "./ConfirmDialog";
import { ExternalToolsSettings } from "./ExternalToolsSettings";
import { GitFlowSettings } from "./GitFlowSettings";
import { GitHostsSettings } from "./GitHostsSettings";
import { Icon } from "./Icon";
import { JiraSettings } from "./JiraSettings";
import { LfsSettings } from "./LfsSettings";
import { PlatformSettings } from "./PlatformSettings";
import { PrivacyDiagnostics } from "./PrivacyDiagnostics";
import { ProfilesSettings } from "./ProfilesSettings";
import { RepositoriesSettings } from "./RepositoriesSettings";
import { SettingRow } from "./SettingRow";
import { Select } from "./Select";
import { SigningSettings } from "./SigningSettings";
import { TextSetting } from "./TextSetting";

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

function CommandLineInstall() {
  const [busy, setBusy] = createSignal(false);
  const [installed, setInstalled] = createSignal<CliInstall | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();

  async function install(): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      setInstalled(await client.cliInstall());
    } catch (error) {
      setInstalled(undefined);
      setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingRow id="cli" title="Command line" note="Adds a yforge command to ~/.local/bin, so yforge <path> opens a repository in YForge, or in the running window. It needs no administrator rights, and it never overwrites a file that YForge did not install.">
      <div class="cli-install">
        <button type="button" class="btn sm" disabled={busy()} aria-busy={busy()} onClick={() => void install()}>
          <Icon name="terminal" />
          {installed() === undefined ? "Install yforge command" : "Reinstall yforge command"}
        </button>
        <Show when={installed()}>
          {(result) => (
            <p class="field-note" role="status" aria-label="Command line install">
              {result().replaced ? `Replaced the earlier YForge command at ${result().path}.` : `Installed ${result().path}.`} Add ~/.local/bin to your PATH if your shell does not find yforge.
            </p>
          )}
        </Show>
        <Show when={failure()}>
          {(text) => (
            <p class="field-note error" role="alert">
              {text()}
            </p>
          )}
        </Show>
      </div>
    </SettingRow>
  );
}

const useSshKeys = () => useQuery(() => ({ queryKey: appKeys.sshKeys, queryFn: () => client.sshKeysList() }));

function SshKeyPicker(props: { label: string; value: string | null | undefined; blankLabel: string; onChange: (path: string | null) => void }) {
  const keys = useSshKeys();
  const listed = () => keys.data ?? [];
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
      <Select
        label={props.label}
        value={chosen() ?? ""}
        options={[
          { value: "", label: props.blankLabel },
          ...listed().map((key) => ({ value: key.path, label: `${key.name} · ${key.algorithm}` })),
          ...(custom() === undefined ? [] : [{ value: custom() as string, label: custom() as string }]),
        ]}
        onChange={(value) => props.onChange(value === "" ? null : value)}
      />
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
    <SettingRow id={props.path === null ? `identity-${key}` : undefined} title={label} note={props.path === null ? "Written on commits in every repository." : "Written on commits in this repository."}>
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
      {field("Name", "name", () => identity.data?.name)}
      {field("Email", "email", () => identity.data?.email)}
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
        <For each={remotes.data ?? []} fallback={<li class="setting-note">No remotes configured.</li>}>
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

const headingOf = (group: string): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>(".settings-body h2, .settings-body h3, .settings-body section[aria-label]")].find((node) => node.getAttribute("aria-label") === group || node.textContent?.trim() === group) ?? null;

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
    const current = overrideMode();
    if (path === undefined) return;
    const next = { pull_mode: current?.pull_mode ?? null, ssh_key_path: key, ...(current?.submodule_update_on_fetch === true ? { submodule_update_on_fetch: true as const } : {}) };
    setFailure(await app.saveRepoSettings(path, next));
  };
  const sshKeys = useSshKeys();
  const navigation = SETTINGS_SECTIONS.filter((entry) => entry.id !== "repository");
  const [query, setQuery] = createSignal("");
  const results = createMemo(() => searchSettings(query()));
  const searching = () => query().trim() !== "";
  const counts = createMemo(() => matchCounts(results()));
  const [pending, setPending] = createSignal<SettingEntry | undefined>();
  const choose = (entry: SettingEntry) => {
    setQuery("");
    setPending(entry);
    app.openSettings(entry.section);
  };
  createEffect(() => {
    const entry = pending();
    if (entry === undefined || props.section !== entry.section || searching()) return;
    setTimeout(() => {
      setPending(undefined);
      const target = document.getElementById(settingAnchor(entry.id)) ?? headingOf(entry.group);
      if (target === null) return;
      if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus();
      target.scrollIntoView?.({ block: "nearest" });
    });
  });

  return (
    <main class="settings" aria-label="Settings">
      <div class="settings-top">
        <label class="input settings-search">
          <Icon name="search" />
          <input
            type="text"
            aria-label="Search settings"
            placeholder="Search all settings, for example “fetch” or “folder”"
            spellcheck={false}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query() !== "") {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
            }}
          />
        </label>
        <div class="settings-tabs" role="tablist" aria-label="Settings sections">
          <For each={navigation}>
            {(entry) => (
              <button
                type="button"
                role="tab"
                aria-selected={!searching() && section() === entry.id}
                classList={{ on: !searching() && section() === entry.id, dim: searching() && (counts()[entry.id] ?? 0) === 0 }}
                onClick={() => {
                  setQuery("");
                  app.openSettings(entry.id);
                }}
              >
                <Icon name={entry.icon} />
                {entry.label}
                <Show when={searching() && (counts()[entry.id] ?? 0) > 0}>
                  <b class="count">{counts()[entry.id]}</b>
                </Show>
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="settings-body">
        <Show when={searching()}>
          <p class="setting-note" role="status">
            {results().length === 0 ? `No setting matches “${query().trim()}”. Try “fetch”, “branch”, “AI”, or “folder”.` : `${results().length} ${results().length === 1 ? "setting matches" : "settings match"} “${query().trim()}”`}
          </p>
          <ul class="setting-results" aria-label="Matching settings">
            <For each={results()}>
              {(entry) => (
                <li>
                  <button type="button" class="setting-result" onClick={() => choose(entry)}>
                    <span class="setting-crumb">{crumb(entry)}</span>
                    <span class="setting-title">{entry.title}</span>
                    <span class="setting-note">{entry.note}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={!searching()}>
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
        </Show>
        <Switch>
          <Match when={searching()}>{null}</Match>
          <Match when={scope() === "repository" && repository()}>
            {(path) => (
              <>
                <h2>Repository settings</h2>
                <Identity path={path()} />
                <Remotes path={path()} />
                <h3>Pull mode override</h3>
                <SettingRow title="Pull mode" note="Strategy used when pulling into branches of this repository.">
                  <Select
                    label="Pull mode override"
                    value={overrideMode()?.pull_mode ?? ""}
                    options={[
                      { value: "", label: `Inherit · ${pullModeLabel(effectivePullMode(settings(), undefined).mode)}` },
                      ...pullOptions,
                    ]}
                    onChange={(value) => void setOverride(value === "" ? null : (value as PullMode))}
                  />
                </SettingRow>
                <h3>SSH</h3>
                <SettingRow title="SSH key" note="Key used to reach this repository's remotes over SSH. It overrides the app-wide key.">
                  <SshKeyPicker
                    label="SSH key override"
                    value={overrideMode()?.ssh_key_path}
                    blankLabel={`Inherit · ${settings().ssh_key_path === null || settings().ssh_key_path === undefined ? SSH_AGENT_LABEL : sshKeyLabel(settings().ssh_key_path, sshKeys.data ?? [])}`}
                    onChange={(key) => void setRepoKey(key)}
                  />
                </SettingRow>
                <LfsSettings path={path()} />
                <GitFlowSettings path={path()} />
              </>
            )}
          </Match>
          <Match when={section() === "general"}>
            <h2>General</h2>
            <p class="setting-note">Applies to every repository.</p>
            <CommandLineInstall />
            <ProfilesSettings />
          </Match>
          <Match when={section() === "git"}>
            <h2>Git</h2>
            <Identity path={null} />
            <h3>Defaults</h3>
            <SettingRow id="default-branch" title="Default branch" note="Name of the first branch in repositories you create.">
              <TextSetting label="Default branch" value={settings().default_branch} onCommit={(value) => void change({ default_branch: value })} />
            </SettingRow>
            <SettingRow id="pull-mode" title="Pull mode" note="Strategy used by Pull unless a repository overrides it.">
              <Select
                label="Pull mode"
                value={settings().pull_mode}
                options={pullOptions}
                onChange={(value) => void change({ pull_mode: value as PullMode })}
              />
            </SettingRow>
            <SettingRow id="auto-fetch" title="Auto-fetch" note="Fetch every remote in the background. It never asks for credentials.">
              <Segmented
                label="Auto-fetch interval"
                value={String(settings().auto_fetch_minutes)}
                options={AUTO_FETCH_OPTIONS.map((option) => ({ value: String(option.minutes), label: option.label }))}
                onChange={(value) => void change({ auto_fetch_minutes: Number(value) })}
              />
            </SettingRow>
            <h3>SSH</h3>
            <SettingRow id="ssh-key" title="SSH key" note="Key used for every repository that has no key of its own. Leave it on ssh-agent to use the agent and your default keys.">
              <SshKeyPicker label="SSH key" value={settings().ssh_key_path} blankLabel={SSH_AGENT_LABEL} onChange={(key) => void change({ ssh_key_path: key })} />
            </SettingRow>
            <SigningSettings />
          </Match>
          <Match when={section() === "tools"}>
            <ExternalToolsSettings />
          </Match>
          <Match when={section() === "repositories"}>
            <RepositoriesSettings />
          </Match>
          <Match when={section() === "ai"}>
            <AiSettings />
          </Match>
          <Match when={section() === "platforms"}>
            <PlatformSettings />
          </Match>
          <Match when={section() === "jira"}>
            <JiraSettings />
          </Match>
          <Match when={section() === "git-hosts"}>
            <GitHostsSettings />
          </Match>
          <Match when={section() === "privacy"}>
            <PrivacyDiagnostics />
          </Match>
          <Match when={section() === "appearance"}>
            <h2>Appearance</h2>
            <p class="setting-note">Applies to every repository.</p>
            <SettingRow id="theme" title="Theme" note="Dark, light, or follow the system.">
              <Segmented label="Theme" value={settings().theme} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }]} onChange={(value) => void change({ theme: value })} />
            </SettingRow>
            <SettingRow id="density" title="Density" note="Compact graph lanes are 10px apart; default lanes are 22px.">
              <Segmented label="Density" value={settings().density} options={[{ value: "compact", label: "Compact" }, { value: "default", label: "Default" }]} onChange={(value) => void change({ density: value })} />
            </SettingRow>
          </Match>
        </Switch>
        <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
      </div>
    </main>
  );
}
