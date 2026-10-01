import { useQueryClient } from "@tanstack/solid-query";
import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import type { GitHost } from "../ipc/bindings/GitHost";
import { client } from "../ipc/client";
import { removeGitHostCopy } from "../state/confirmCopy";
import { IDENTITY_ORDER, keyLine, SSH_AGENT_TEXT, tildePath } from "../state/gitHostsModel";
import { appKeys, gitHostKeys } from "../state/queryKeys";
import { useQuery } from "../state/query";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

type Editor = { kind: "add" } | { kind: "edit"; host: GitHost };

const message = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

const useHome = () => useQuery(() => ({ queryKey: appKeys.home, queryFn: () => client.homeDirectory(), staleTime: Infinity }));

async function copyPublicKey(keyPath: string): Promise<void> {
  await navigator.clipboard.writeText(await client.sshPublicKey(keyPath));
}

function HostForm(props: { editor: Editor; onClose: () => void; onSaved: () => void }) {
  const editing = () => (props.editor.kind === "edit" ? props.editor.host : undefined);
  const home = useHome();
  const [host, setHost] = createSignal(editing()?.host ?? "");
  const [user, setUser] = createSignal(editing()?.https_user ?? "");
  const [key, setKey] = createSignal(editing()?.ssh_key_path ?? "");
  const [passphrase, setPassphrase] = createSignal("");
  const [hostTouched, setHostTouched] = createSignal(false);
  const [newKey, setNewKey] = createSignal("");
  const [newKeyTouched, setNewKeyTouched] = createSignal(false);
  const [generated, setGenerated] = createSignal<string | undefined>();
  const [generatedFrom, setGeneratedFrom] = createSignal<string | undefined>();
  const [writing, setWriting] = createSignal<string | undefined>();
  const [savedPassphrase, setSavedPassphrase] = createSignal(false);
  const [generating, setGenerating] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [failure, setFailure] = createSignal<string | undefined>();
  const [problems] = createResource(
    () => ({ host: host(), key: key() }),
    async (draft) => ({ host: await client.gitHostFieldProblem("host", draft.host), key: await client.gitHostFieldProblem("ssh_key", draft.key) }),
  );
  const hostProblem = () => problems.latest?.host ?? undefined;
  const keyProblem = () => problems.latest?.key ?? undefined;
  const hostReady = () => (!problems.loading && hostProblem() === undefined ? host().trim() : undefined);
  const [defaultKey] = createResource(hostReady, (ready) => client.gitHostDefaultKeyPath(ready));
  createEffect(() => {
    const suggested = defaultKey.latest;
    if (suggested !== undefined && !newKeyTouched()) setNewKey(suggested);
  });
  const [newKeyProblems] = createResource(newKey, (path) => client.gitHostFieldProblem("new_key", path));
  const newKeyProblem = () => (newKey().trim() === "" ? undefined : (newKeyProblems.latest ?? undefined));
  const blocked = () => problems.loading || hostProblem() !== undefined || keyProblem() !== undefined || saving() || generating();
  const canGenerate = () =>
    !problems.loading && hostProblem() === undefined && !newKeyProblems.loading && newKey().trim() !== "" && newKeyProblem() === undefined && generatedFrom() !== newKey() && !generating() && !saving();
  const shortPath = (path: string) => tildePath(path, home.data);

  async function chooseKey(): Promise<void> {
    const dir = home.data === undefined ? undefined : `${home.data.replace(/\/$/, "")}/.ssh`;
    const picked = await client.pickFile("Choose an SSH private key", dir);
    if (picked !== undefined) {
      setKey(picked);
      setGenerated(undefined);
      setCopied(false);
    }
  }

  async function generate(): Promise<void> {
    if (!canGenerate()) return;
    setFailure(undefined);
    setCopied(false);
    const target = newKey().trim();
    const withPassphrase = passphrase() !== "";
    setWriting(target);
    setGenerating(true);
    try {
      const path = await client.gitHostGenerateKey(host().trim(), target, withPassphrase ? passphrase() : null);
      setKey(path);
      setGenerated(path);
      setGeneratedFrom(newKey());
      setSavedPassphrase(withPassphrase);
      setPassphrase("");
    } catch (error) {
      setFailure(message(error));
    } finally {
      setGenerating(false);
    }
  }

  async function copyKey(): Promise<void> {
    setFailure(undefined);
    try {
      await copyPublicKey(key());
      setCopied(true);
    } catch (error) {
      setFailure(message(error));
    }
  }

  async function save(): Promise<void> {
    setHostTouched(true);
    if (blocked()) return;
    setFailure(undefined);
    setSaving(true);
    try {
      await client.gitHostSave(editing()?.id ?? null, { host: host().trim(), ssh_key_path: key().trim() === "" ? null : key().trim(), https_user: user().trim() === "" ? null : user().trim() });
    } catch (error) {
      setFailure(message(error));
      setSaving(false);
      return;
    }
    setSaving(false);
    props.onSaved();
    props.onClose();
  }

  const reason = () => (hostProblem()?.title ?? keyProblem()?.title ?? "Enter the host to save it");

  return (
    <>
      <h3>{editing() === undefined ? "Add host" : "Edit host"}</h3>
      <form
        class="card git-host-card"
        aria-label={editing() === undefined ? "Add host" : "Edit host"}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div class="git-host-fields">
          <label class="field">
            <span class="field-label">Host</span>
            <span class="input" classList={{ invalid: hostTouched() && hostProblem() !== undefined }}>
              <input
                type="text"
                class="mono"
                spellcheck={false}
                autocapitalize="off"
                autocomplete="off"
                aria-label="Host"
                aria-invalid={hostTouched() && hostProblem() !== undefined}
                placeholder="gitlab.corp-a.com or gitlab.corp-b.com:2222"
                value={host()}
                onInput={(event) => {
                  setHostTouched(true);
                  setHost(event.currentTarget.value);
                }}
              />
            </span>
            <Show when={hostTouched() && hostProblem()}>{(problem) => <span class="field-note error">{problem().title}</span>}</Show>
          </label>
          <label class="field">
            <span class="field-label">HTTPS user name (optional)</span>
            <span class="input">
              <input type="text" spellcheck={false} autocapitalize="off" autocomplete="off" aria-label="HTTPS user name (optional)" value={user()} onInput={(event) => setUser(event.currentTarget.value)} />
            </span>
          </label>
        </div>
        <div class="field">
          <span class="field-label">SSH key</span>
          <span class="input" classList={{ invalid: keyProblem() !== undefined }}>
            <Icon name="key" size={14} />
            <input
              type="text"
              class="mono"
              spellcheck={false}
              autocapitalize="off"
              autocomplete="off"
              aria-label="SSH key"
              aria-invalid={keyProblem() !== undefined}
              placeholder={`None: uses ${SSH_AGENT_TEXT}`}
              value={key()}
              onInput={(event) => {
                setKey(event.currentTarget.value);
                setGenerated(undefined);
                setCopied(false);
              }}
            />
          </span>
          <div class="git-host-key-actions">
            <button type="button" class="btn" onClick={() => void chooseKey()}>
              Choose key file…
            </button>
            <Show when={generated() !== undefined && generated() === key()}>
              <button type="button" class="btn" onClick={() => void copyKey()}>
                Copy public key
              </button>
            </Show>
          </div>
          <Show when={generated()}>
            {(path) => (
              <p class="field-note" role="status">
                <Icon name="check" size={14} />{" "}
                {copied()
                  ? `Copied the public key. Add it to your account on ${host().trim()}.`
                  : `Generated ${shortPath(path())}.${savedPassphrase() ? " The passphrase is saved in the macOS Keychain for this key file." : ""} Copy its public key and add it to your account on ${host().trim()}.`}
              </p>
            )}
          </Show>
        </div>
        <div class="field">
          <label class="field">
            <span class="field-label">New key file</span>
            <span class="input" classList={{ invalid: newKeyProblem() !== undefined }}>
              <input
                type="text"
                class="mono"
                spellcheck={false}
                autocapitalize="off"
                autocomplete="off"
                aria-label="New key file"
                aria-invalid={newKeyProblem() !== undefined}
                placeholder="~/.ssh/yforge_gitlab.corp-a.com"
                value={newKey()}
                onInput={(event) => {
                  setNewKeyTouched(true);
                  setNewKey(event.currentTarget.value);
                }}
              />
            </span>
            <Show when={newKeyProblem()}>
              {(problem) => (
                <span class="field-note error">
                  {problem().title}.{problem().detail === null ? "" : ` ${problem().detail}`}
                </span>
              )}
            </Show>
          </label>
          <label class="field">
            <span class="field-label">Passphrase (optional)</span>
            <span class="input">
              <Icon name="lock" size={14} />
              <input type="password" autocomplete="off" aria-label="Passphrase (optional)" value={passphrase()} onInput={(event) => setPassphrase(event.currentTarget.value)} />
            </span>
            <span class="field-note">When set, YForge saves this passphrase in the macOS Keychain, keyed by the key file, so it can answer the key's passphrase prompt for you. It never writes it to a file.</span>
          </label>
          <div class="git-host-key-actions">
            <button
              type="button"
              class="btn"
              aria-disabled={!canGenerate()}
              aria-busy={generating()}
              title={canGenerate() || generating() ? undefined : "Enter a valid host and a free key file path to generate a key"}
              onClick={() => void generate()}
            >
              {generating() ? "Generating ed25519 key…" : "Generate key"}
            </button>
          </div>
          <Show when={generating()}>
            <div class="status-line" role="status" aria-busy="true">
              <Icon name="key" size={14} />
              Writing {writing()} and its .pub…
            </div>
          </Show>
        </div>
        <Show when={keyProblem()}>
          {(problem) => (
            <div class="alert" role="alert">
              <strong>{problem().title}</strong>
              <Show when={problem().detail}>{(detail) => <p>{detail()}</p>}</Show>
              <div class="acts">
                <button type="button" class="btn sm" onClick={() => void chooseKey()}>
                  Choose key file…
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
        <div class="foot">
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary" aria-disabled={blocked()} aria-busy={saving()} title={blocked() && !saving() && !generating() ? reason() : undefined}>
            Save host
          </button>
        </div>
      </form>
    </>
  );
}

export function GitHostsSettings() {
  const queryClient = useQueryClient();
  const hosts = useQuery(() => ({ queryKey: gitHostKeys.list, queryFn: () => client.gitHostsList() }));
  const home = useHome();
  const [editor, setEditor] = createSignal<Editor | undefined>();
  const [removal, setRemoval] = createSignal<GitHost | undefined>();
  const [copied, setCopied] = createSignal<string | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();
  const list = () => hosts.data ?? [];
  const empty = () => hosts.isSuccess && list().length === 0;
  const refresh = () => queryClient.invalidateQueries({ queryKey: gitHostKeys.all });

  async function copyKey(host: GitHost): Promise<void> {
    setFailure(undefined);
    setCopied(undefined);
    try {
      await copyPublicKey(host.ssh_key_path ?? "");
      setCopied(host.id);
    } catch (error) {
      setFailure(message(error));
    }
  }

  async function confirmRemoval(): Promise<void> {
    const host = removal();
    setRemoval(undefined);
    if (host === undefined) return;
    setFailure(undefined);
    try {
      await client.gitHostRemove(host.id);
    } catch (error) {
      setFailure(message(error));
    }
    await refresh();
  }

  return (
    <Show
      when={editor()}
      keyed
      fallback={
        <>
          <div class="provider-head-row">
            <h2>Git hosts</h2>
            <button type="button" class="btn" classList={{ primary: empty() }} onClick={() => setEditor({ kind: "add" })}>
              <Icon name="plus" />
              Add host
            </button>
          </div>
          <Show when={hosts.isPending}>
            <p class="setting-note" role="status" aria-busy="true">
              Loading Git hosts…
            </p>
          </Show>
          <Show when={empty()}>
            <p class="setting-note">
              No host identities yet. Today every remote uses your SSH agent and <span class="mono">~/.ssh/config</span>, plus the app-wide key from General when one is set. Add a host to use a different key or HTTPS user name per server.
            </p>
            <div class="card">
              <h4>How YForge chooses an identity</h4>
              <ol class="order">
                <For each={IDENTITY_ORDER}>{(step) => <li>{step}</li>}</For>
              </ol>
            </div>
          </Show>
          <For each={list()}>
            {(entry) => {
              const key = () => keyLine(entry, home.data);
              return (
                <section class="card git-host-card" aria-label={entry.host}>
                  <div class="card-head">
                    <span class="provider-logo neutral" aria-hidden="true">
                      <Icon name="identity" />
                    </span>
                    <span class="provider-name">
                      <strong class="mono">{entry.host}</strong>
                    </span>
                    <span class="recent-acts">
                      <Show when={entry.has_public_key}>
                        <button type="button" class="icon-btn dense" {...tip("Copy public key", undefined, `Copy public key for ${entry.host}`)} onClick={() => void copyKey(entry)}>
                          <Icon name={copied() === entry.id ? "check" : "copy"} />
                        </button>
                      </Show>
                      <button type="button" class="icon-btn dense" {...tip("Edit", undefined, `Edit ${entry.host}`)} onClick={() => setEditor({ kind: "edit", host: entry })}>
                        <Icon name="edit" />
                      </button>
                      <button type="button" class="icon-btn dense" {...tip("Remove", undefined, `Remove ${entry.host}`)} onClick={() => setRemoval(entry)}>
                        <Icon name="trash" />
                      </button>
                    </span>
                  </div>
                  <dl class="kv">
                    <dt>SSH key</dt>
                    <dd>
                      <Show when={key()} fallback={<>None: uses your SSH agent and <span class="mono">~/.ssh/config</span></>}>
                        {(line) => (
                          <>
                            <span class="mono">{line().path}</span>
                            <Show when={line().detail}>{(detail) => <> · {detail()}</>}</Show>
                          </>
                        )}
                      </Show>
                    </dd>
                    <dt>HTTPS user</dt>
                    <dd>{entry.https_user ?? "Not set: Git asks when it needs one"}</dd>
                  </dl>
                  <Show when={copied() === entry.id}>
                    <p class="sub" role="status">
                      <Icon name="check" size={14} /> Copied the public key. Add it to your account on {entry.host}.
                    </p>
                  </Show>
                </section>
              );
            }}
          </For>
          <Show when={hosts.error}>{(error) => <p class="field-note error" role="alert">{message(error())}</p>}</Show>
          <Show when={failure()}>
            {(text) => (
              <p class="field-note error" role="alert">
                {text()}
              </p>
            )}
          </Show>
          <Show when={list().length > 0}>
            <p class="field-note">HTTPS passwords and tokens are kept by Git's credential helper (the macOS Keychain), one entry per host, so two hosts never share one.</p>
          </Show>
          <Show when={removal()} keyed>
            {(entry) => <ConfirmDialog copy={removeGitHostCopy(entry.host)} onConfirm={() => void confirmRemoval()} onCancel={() => setRemoval(undefined)} />}
          </Show>
        </>
      }
    >
      {(current) => <HostForm editor={current} onClose={() => setEditor(undefined)} onSaved={() => void refresh()} />}
    </Show>
  );
}
