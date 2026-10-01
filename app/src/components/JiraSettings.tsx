import { useQueryClient } from "@tanstack/solid-query";
import { createResource, createSignal, For, Show } from "solid-js";
import type { JiraConnection } from "../ipc/bindings/JiraConnection";
import type { JiraKind } from "../ipc/bindings/JiraKind";
import { client } from "../ipc/client";
import { removeJiraConnectionCopy } from "../state/confirmCopy";
import { connectionSubtitle, JIRA_KINDS, jiraFields, jiraKindCard, jiraProblems, projectsText, siteHost, tokenNote, type JiraField } from "../state/jiraModel";
import { jiraConnectionsOptions } from "../state/jiraQueries";
import { platformFailure, type PlatformFailure } from "../state/platformModel";
import { jiraKeys } from "../state/queryKeys";
import { useQuery } from "../state/query";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

type Editor = { kind: "add" } | { kind: "edit"; connection: JiraConnection };

type TestResult = { kind: "ok"; name: string } | { kind: "failed"; failure: PlatformFailure };

const FIELD_LABELS: Record<JiraField, (kind: JiraKind) => string> = {
  site: () => "Site address",
  email: () => "Email",
  token: (kind) => jiraKindCard(kind).tokenLabel,
};

function ConnectCard(props: { editor: Editor; first: boolean; onClose: () => void; onSaved: () => void }) {
  const editing = () => (props.editor.kind === "edit" ? props.editor.connection : undefined);
  const [kind, setKind] = createSignal<JiraKind>(editing()?.kind ?? "cloud");
  const [site, setSite] = createSignal(editing()?.site ?? "");
  const [email, setEmail] = createSignal(editing()?.email ?? "");
  const [token, setToken] = createSignal("");
  const [touched, setTouched] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<string | undefined>();
  const card = () => jiraKindCard(kind());
  const [problems] = createResource(
    () => ({ kind: kind(), site: site(), email: email(), token: token() }),
    (draft) => jiraProblems(draft),
  );
  const shown = (field: JiraField) => (touched() ? problems()?.[field] : undefined);
  const blocked = () => problems.loading || Object.keys(problems() ?? {}).length > 0;
  const reason = () => (kind() === "cloud" ? "Enter the site address, the email, and the API token to connect" : "Enter the site address and the token to connect");

  async function submit(): Promise<void> {
    setTouched(true);
    if (blocked() || busy()) return;
    setFailure(undefined);
    setBusy(true);
    try {
      await client.jiraConnectionAdd(kind(), site().trim(), kind() === "cloud" ? email().trim() : null, token().trim());
    } catch (error) {
      setFailure(platformFailure(error).message);
      setBusy(false);
      return;
    }
    const previous = editing();
    if (previous !== undefined) {
      try {
        await client.jiraConnectionRemove(previous.id);
      } catch (error) {
        props.onSaved();
        setFailure(`The new connection was saved, but the old one could not be removed: ${platformFailure(error).message}`);
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    props.onSaved();
    props.onClose();
  }

  const input = (field: JiraField, value: () => string, set: (value: string) => void, extra: { type?: string; placeholder: string; mono?: boolean }) => (
    <label class="field">
      <span class="field-label">{FIELD_LABELS[field](kind())}</span>
      <span class="input" classList={{ invalid: shown(field) !== undefined }}>
        <Show when={field === "token"}>
          <Icon name="lock" size={14} />
        </Show>
        <input
          type={extra.type ?? "text"}
          classList={{ mono: extra.mono === true }}
          spellcheck={false}
          autocapitalize="off"
          autocomplete="off"
          aria-label={FIELD_LABELS[field](kind())}
          aria-invalid={shown(field) !== undefined}
          placeholder={extra.placeholder}
          value={value()}
          onInput={(event) => set(event.currentTarget.value)}
        />
      </span>
      <Show when={shown(field)}>{(text) => <span class="field-note error">{text()}</span>}</Show>
    </label>
  );

  return (
    <form
      class="card jira-card"
      aria-label={editing() === undefined ? "Connect a site" : "Edit connection"}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h4>{editing() === undefined ? "Connect a site" : "Edit connection"}</h4>
      <div class="segmented" role="radiogroup" aria-label="Jira kind">
        <For each={JIRA_KINDS}>
          {(entry) => (
            <button type="button" role="radio" aria-checked={kind() === entry.kind} classList={{ on: kind() === entry.kind }} onClick={() => setKind(entry.kind)}>
              {entry.title}
            </button>
          )}
        </For>
      </div>
      <div class="jira-fields">
        {input("site", site, setSite, { placeholder: card().sitePlaceholder, mono: true })}
        <Show when={jiraFields(kind()).includes("email")}>{input("email", email, setEmail, { placeholder: "you@example.com" })}</Show>
      </div>
      {input("token", token, setToken, { type: "password", placeholder: editing() === undefined ? card().tokenPlaceholder : "Paste a new token" })}
      <p class="field-note">{editing() === undefined ? card().tokenHint : "The saved token is never shown. Paste a new one; YForge tests it before saving."}</p>
      <Show when={failure()}>
        {(text) => (
          <p class="field-note error" role="alert">
            {text()}
          </p>
        )}
      </Show>
      <div class="jira-actions" role={busy() ? "status" : undefined} aria-busy={busy()}>
        <button type="submit" class="btn primary" aria-disabled={blocked() || busy()} aria-busy={busy()}>
          {busy() ? "Connecting…" : editing() === undefined ? "Connect" : "Save and test connection"}
        </button>
        <Show when={!props.first || editing() !== undefined}>
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
        </Show>
        <span class="field-note">{busy() ? `Checking ${siteHost(site())} and reading your projects…` : blocked() ? reason() : "YForge only reads from Jira; it never changes an issue."}</span>
      </div>
    </form>
  );
}

export function JiraSettings() {
  const queryClient = useQueryClient();
  const connections = useQuery(jiraConnectionsOptions);
  const [editor, setEditor] = createSignal<Editor | undefined>();
  const [removal, setRemoval] = createSignal<JiraConnection | undefined>();
  const [results, setResults] = createSignal<Record<string, TestResult>>({});
  const [testing, setTesting] = createSignal<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = createSignal<string | undefined>();
  const list = () => connections.data ?? [];
  const empty = () => connections.isSuccess && list().length === 0;
  const refresh = () => queryClient.invalidateQueries({ queryKey: jiraKeys.all });

  const record = (id: string, result: TestResult | undefined) =>
    setResults((current) => {
      const { [id]: _dropped, ...rest } = current;
      return result === undefined ? rest : { ...rest, [id]: result };
    });

  async function test(connection: JiraConnection): Promise<void> {
    setTesting((current) => new Set(current).add(connection.id));
    record(connection.id, undefined);
    try {
      record(connection.id, { kind: "ok", name: await client.jiraConnectionTest(connection.id) });
    } catch (error) {
      record(connection.id, { kind: "failed", failure: platformFailure(error) });
    } finally {
      setTesting((current) => new Set([...current].filter((id) => id !== connection.id)));
    }
    await refresh();
  }

  async function confirmRemoval(): Promise<void> {
    const connection = removal();
    setRemoval(undefined);
    if (connection === undefined) return;
    setFailure(undefined);
    try {
      await client.jiraConnectionRemove(connection.id);
      record(connection.id, undefined);
    } catch (error) {
      setFailure(platformFailure(error).message);
    }
    await refresh();
  }

  return (
    <>
      <div class="provider-head-row">
        <h2>Jira</h2>
        <Show when={list().length > 0 && editor() === undefined}>
          <button type="button" class="btn" onClick={() => setEditor({ kind: "add" })}>
            <Icon name="plus" />
            Connect a site
          </button>
        </Show>
      </div>
      <Show when={empty()}>
        <p class="setting-note">No Jira site is connected. Connect one to see issue summaries on branch names and commits, list the issues assigned to you, and create a branch from an issue.</p>
      </Show>
      <Show when={connections.isPending}>
        <p class="setting-note" role="status" aria-busy="true">
          Loading Jira connections…
        </p>
      </Show>
      <Show when={editor() ?? (empty() ? ({ kind: "add" } as Editor) : undefined)} keyed>
        {(current) => <ConnectCard editor={current} first={empty()} onClose={() => setEditor(undefined)} onSaved={() => void refresh()} />}
      </Show>
      <For each={list()}>
        {(connection) => {
          const result = () => results()[connection.id];
          const failed = () => {
            const outcome = result();
            return outcome?.kind === "failed" ? outcome.failure : undefined;
          };
          const busy = () => testing().has(connection.id);
          return (
            <section class="card jira-card" aria-label={connection.host}>
              <div class="card-head">
                <span class="provider-logo neutral" aria-hidden="true">
                  <Icon name="issue" />
                </span>
                <span class="provider-name">
                  <strong class="mono">{connection.host}</strong>
                  <span class="setting-note">{connectionSubtitle(connection)}</span>
                </span>
                <Show when={failed()}>
                  <span class="chip chip-danger">
                    <Icon name="warning" size={14} />
                    Authentication failed
                  </span>
                </Show>
                <span class="recent-acts">
                  <button type="button" class="icon-btn dense" disabled={busy()} aria-busy={busy()} {...tip("Test connection", undefined, `Test ${connection.host}`)} onClick={() => void test(connection)}>
                    <Icon name="sync" />
                  </button>
                  <button type="button" class="icon-btn dense" {...tip("Edit", undefined, `Edit ${connection.host}`)} onClick={() => setEditor({ kind: "edit", connection })}>
                    <Icon name="edit" />
                  </button>
                  <button type="button" class="icon-btn dense" {...tip("Remove", undefined, `Remove ${connection.host}`)} onClick={() => setRemoval(connection)}>
                    <Icon name="trash" />
                  </button>
                </span>
              </div>
              <dl class="kv">
                <dt>Projects</dt>
                <dd>{projectsText(connection)}</dd>
                <dt>Token</dt>
                <dd>{tokenNote(connection)}</dd>
              </dl>
              <Show when={result()?.kind === "ok" ? (result() as Extract<TestResult, { kind: "ok" }>) : undefined}>
                {(outcome) => (
                  <p class="platform-result" role="status">
                    <span class="chip chip-success">
                      <Icon name="check" size={14} />
                      Connected as {outcome().name}
                    </span>
                  </p>
                )}
              </Show>
              <Show when={failed()}>
                {(problem) => (
                  <div class="alert" role="alert">
                    <strong>{problem().message}</strong>
                    <Show when={problem().action}>
                      <p>The token was refused (it may have expired). Issue chips from this site show their key only until you paste a new token.</p>
                    </Show>
                    <div class="acts">
                      <Show when={problem().action}>
                        <button type="button" class="btn sm" onClick={() => setEditor({ kind: "edit", connection })}>
                          Edit connection
                        </button>
                      </Show>
                      <button type="button" class="btn sm" onClick={() => void test(connection)}>
                        Test again
                      </button>
                    </div>
                  </div>
                )}
              </Show>
            </section>
          );
        }}
      </For>
      <Show when={connections.error}>{(error) => <p class="field-note error" role="alert">{platformFailure(error()).message}</p>}</Show>
      <Show when={failure()}>
        {(text) => (
          <p class="field-note error" role="alert">
            {text()}
          </p>
        )}
      </Show>
      <Show when={list().length > 0}>
        <p class="field-note">Keys from every connected site are recognised in every repository. YForge never changes an issue.</p>
      </Show>
      <Show when={removal()} keyed>
        {(connection) => <ConfirmDialog copy={removeJiraConnectionCopy(connection.host, connection.display_name)} onConfirm={() => void confirmRemoval()} onCancel={() => setRemoval(undefined)} />}
      </Show>
    </>
  );
}
