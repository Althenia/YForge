import { createForm } from "@tanstack/solid-form";
import { useQueryClient } from "@tanstack/solid-query";
import { createSignal, createResource, For, Show } from "solid-js";
import type { PlatformConnection } from "../ipc/bindings/PlatformConnection";
import type { PlatformKind } from "../ipc/bindings/PlatformKind";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import { removeConnectionCopy } from "../state/confirmCopy";
import { cardOfPlatform, CONNECTION_FIELDS, connectionFieldProblem, PLATFORM_CARDS, platformFailure, type ConnectionProblem, type ConnectionProblems, type PlatformFailure } from "../state/platformModel";
import { platformConnectionsOptions } from "../state/platformQueries";
import { platformKeys } from "../state/queryKeys";
import { useQuery } from "../state/query";
import { ConfirmDialog } from "./ConfirmDialog";
import { DialogFrame } from "./DialogFrame";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

export type PlatformDialogStart = { kind: "add" } | { kind: "edit"; connection: PlatformConnection };

type TestResult = { kind: "ok"; login: string } | { kind: "failed"; failure: PlatformFailure };

const INSECURE_WARNING =
  "Use this only for a self-hosted server with a self-signed certificate. YForge will then accept any certificate the server shows, so anyone on your network could read your token and your code. Leave it off for github.com, gitlab.com, and bitbucket.org.";

export function PlatformGlyph(props: { kind: PlatformKind }) {
  return (
    <span class="provider-logo neutral" aria-hidden="true">
      <Icon name={cardOfPlatform(props.kind).icon} />
    </span>
  );
}

function ConnectionDialog(props: { start: PlatformDialogStart; onClose: () => void; onSaved: () => void }) {
  const editing = () => (props.start.kind === "edit" ? props.start.connection : undefined);
  const [failure, setFailure] = createSignal<string | undefined>();
  const [touched, setTouched] = createSignal(false);
  const [nameEdited, setNameEdited] = createSignal(editing() !== undefined);
  const form = createForm(() => ({
    defaultValues: {
      kind: (editing()?.kind ?? "github") as PlatformKind,
      host: editing()?.host ?? "",
      name: editing()?.name ?? cardOfPlatform("github").title,
      token: "",
      insecureTls: editing()?.insecure_tls ?? false,
    },
    onSubmit: async ({ value }) => {
      setFailure(undefined);
      try {
        await client.platformConnectionAdd(value.kind, value.host.trim(), value.name.trim(), value.token.trim(), value.insecureTls);
      } catch (error) {
        setFailure(platformFailure(error).message);
        return;
      }
      const previous = editing();
      if (previous !== undefined) {
        try {
          await client.platformConnectionRemove(previous.id);
        } catch (error) {
          props.onSaved();
          setFailure(`The new connection was saved, but the old one could not be removed: ${platformFailure(error).message}`);
          return;
        }
      }
      props.onSaved();
      props.onClose();
    },
  }));
  const values = form.useSelector((state) => state.values);
  const [problems] = createResource(
    () => ({ host: values().host, name: values().name, token: values().token }),
    async (draft) => {
      const entries = await Promise.all(
        CONNECTION_FIELDS.map(async (field) => [field, await connectionFieldProblem(field, draft[field])] as const),
      );
      return Object.fromEntries(entries.filter(([, problem]) => problem !== undefined)) as ConnectionProblems;
    },
  );
  const shown = (field: ConnectionProblem) => (touched() ? problems()?.[field] : undefined);
  const latestProblems = () => problems() ?? {};
  const blocked = () => problems.loading === true || Object.keys(latestProblems()).length > 0;
  const choose = (kind: PlatformKind) => {
    form.setFieldValue("kind", kind);
    if (!nameEdited()) form.setFieldValue("name", cardOfPlatform(kind).title);
  };

  return (
    <DialogFrame title={editing() === undefined ? "Add a platform connection" : "Edit connection"} onEscape={props.onClose}>
      <form
        class="entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!blocked() && !form.state.isSubmitting) void form.handleSubmit();
        }}
      >
        <div class="segmented" role="radiogroup" aria-label="Platform">
          <For each={PLATFORM_CARDS}>
            {(card) => (
              <button type="button" role="radio" aria-checked={values().kind === card.kind} classList={{ on: values().kind === card.kind }} onClick={() => choose(card.kind)}>
                <Icon name={card.icon} />
                {card.title}
              </button>
            )}
          </For>
        </div>
        <label class="field">
          <span class="field-label">Host</span>
          <span class="input" classList={{ invalid: shown("host") !== undefined }}>
            <form.Field name="host">
              {(field) => (
                <input
                  type="text"
                  spellcheck={false}
                  autocapitalize="off"
                  aria-label="Host"
                  placeholder={cardOfPlatform(values().kind).hostPlaceholder}
                  ref={(element) => queueMicrotask(() => element.focus())}
                  value={field().state.value}
                  aria-invalid={shown("host") !== undefined}
                  onInput={(event) => field().handleChange(event.currentTarget.value)}
                />
              )}
            </form.Field>
          </span>
          <Show when={shown("host")} fallback={<span class="field-note">The address you clone from, without https:// or a path.</span>}>
            {(text) => <span class="field-note error">{text()}</span>}
          </Show>
        </label>
        <label class="field">
          <span class="field-label">Name</span>
          <span class="input" classList={{ invalid: shown("name") !== undefined }}>
            <form.Field name="name">
              {(field) => (
                <input
                  type="text"
                  aria-label="Name"
                  value={field().state.value}
                  aria-invalid={shown("name") !== undefined}
                  onInput={(event) => {
                    setNameEdited(true);
                    field().handleChange(event.currentTarget.value);
                  }}
                />
              )}
            </form.Field>
          </span>
          <Show when={shown("name")}>{(text) => <span class="field-note error">{text()}</span>}</Show>
        </label>
        <label class="field">
          <span class="field-label">Access token</span>
          <span class="input" classList={{ invalid: shown("token") !== undefined }}>
            <form.Field name="token">
              {(field) => (
                <input
                  type="password"
                  autocomplete="off"
                  aria-label="Access token"
                  placeholder={editing() === undefined ? "Paste your personal access token" : "Paste a new token"}
                  value={field().state.value}
                  aria-invalid={shown("token") !== undefined}
                  onInput={(event) => field().handleChange(event.currentTarget.value)}
                />
              )}
            </form.Field>
          </span>
          <Show when={shown("token")} fallback={<span class="field-note">{editing() === undefined ? "Stored in the macOS Keychain and never shown again." : "The saved token is never shown. Paste a new one; YForge tests it before saving."}</span>}>
            {(text) => <span class="field-note error">{text()}</span>}
          </Show>
        </label>
        <label class="choice">
          <form.Field name="insecureTls">
            {(field) => <input type="checkbox" checked={field().state.value} onChange={(event) => field().handleChange(event.currentTarget.checked)} />}
          </form.Field>
          <span class="choice-text">Accept an untrusted certificate</span>
        </label>
        <p class="field-note" classList={{ error: values().insecureTls }} role={values().insecureTls ? "alert" : undefined}>
          <Icon name="warning" size={14} /> {INSECURE_WARNING}
        </p>
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
          <button type="submit" class="btn primary" disabled={form.state.isSubmitting} aria-busy={form.state.isSubmitting}>
            {editing() === undefined ? "Add and test connection" : "Save and test connection"}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

export function PlatformSettings(props: { initialDialog?: PlatformDialogStart }) {
  const app = useApp();
  const queryClient = useQueryClient();
  const connections = useQuery(platformConnectionsOptions);
  const [dialog, setDialog] = createSignal<PlatformDialogStart | undefined>(props.initialDialog ?? (app.takePlatformAddRequest() ? { kind: "add" } : undefined));
  const [removal, setRemoval] = createSignal<PlatformConnection | undefined>();
  const [results, setResults] = createSignal<Record<string, TestResult>>({});
  const [testing, setTesting] = createSignal<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = createSignal<string | undefined>();
  const list = () => connections.data ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: platformKeys.all });

  const record = (id: string, result: TestResult | undefined) =>
    setResults((current) => {
      const { [id]: _dropped, ...rest } = current;
      return result === undefined ? rest : { ...rest, [id]: result };
    });

  async function test(connection: PlatformConnection): Promise<void> {
    setTesting((current) => new Set(current).add(connection.id));
    record(connection.id, undefined);
    try {
      record(connection.id, { kind: "ok", login: await client.platformConnectionTest(connection.id) });
    } catch (error) {
      record(connection.id, { kind: "failed", failure: platformFailure(error) });
    } finally {
      setTesting((current) => new Set([...current].filter((id) => id !== connection.id)));
    }
  }

  async function confirmRemoval(): Promise<void> {
    const connection = removal();
    setRemoval(undefined);
    if (connection === undefined) return;
    setFailure(undefined);
    try {
      await client.platformConnectionRemove(connection.id);
      record(connection.id, undefined);
    } catch (error) {
      setFailure(platformFailure(error).message);
    }
    await refresh();
  }

  return (
    <>
      <h2>Platforms</h2>
      <p class="setting-note">Connect GitHub, GitLab, or Bitbucket to list, create, and merge pull requests for repositories cloned from that host. Tokens stay in the macOS Keychain; Git itself keeps using your SSH keys and credentials.</p>
      <div class="provider-head-row">
        <h3>Connections</h3>
        <button type="button" class="btn" onClick={() => setDialog({ kind: "add" })}>
          <Icon name="plus" />
          Add connection
        </button>
      </div>
      <ul class="provider-list" aria-label="Platform connections" aria-busy={connections.isFetching}>
        <For each={list()} fallback={<li class="setting-note">No connections yet. Add one to see pull requests next to your branches.</li>}>
          {(connection) => {
            const result = () => results()[connection.id];
            const busy = () => testing().has(connection.id);
            return (
              <li class="provider-row platform-row">
                <PlatformGlyph kind={connection.kind} />
                <span class="provider-name">
                  <strong>{connection.name}</strong>
                  <span class="setting-note">
                    {cardOfPlatform(connection.kind).title} · <span class="mono">{connection.host}</span>
                  </span>
                </span>
                <Show when={connection.insecure_tls}>
                  <span class="chip chip-attention">
                    <Icon name="warning" size={14} />
                    Certificate not checked
                  </span>
                </Show>
                <span class="recent-acts">
                  <button type="button" class="btn sm" disabled={busy()} aria-busy={busy()} onClick={() => void test(connection)}>
                    <Icon name="sync" size={14} />
                    Test
                  </button>
                  <button type="button" class="icon-btn dense" {...tip(`Edit ${connection.name}`)} onClick={() => setDialog({ kind: "edit", connection })}>
                    <Icon name="edit" />
                  </button>
                  <button type="button" class="icon-btn dense" {...tip(`Remove ${connection.name}`)} onClick={() => setRemoval(connection)}>
                    <Icon name="trash" />
                  </button>
                </span>
                <Show when={result()}>
                  {(outcome) => (
                    <Show
                      when={outcome().kind === "failed" ? (outcome() as Extract<TestResult, { kind: "failed" }>).failure : undefined}
                      fallback={
                        <p class="platform-result" role="status">
                          <span class="chip chip-success">
                            <Icon name="check" size={14} />
                            Connected as {(outcome() as Extract<TestResult, { kind: "ok" }>).login}
                          </span>
                        </p>
                      }
                    >
                      {(problem) => (
                        <p class="platform-result field-note error" role="alert">
                          <Icon name="warning" size={14} />
                          {problem().message}
                          <Show when={problem().action}>
                            <button type="button" class="btn sm" onClick={() => setDialog({ kind: "edit", connection })}>
                              Edit connection
                            </button>
                          </Show>
                        </p>
                      )}
                    </Show>
                  )}
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
      <Show when={connections.error}>{(error) => <p class="field-note error" role="alert">{platformFailure(error()).message}</p>}</Show>
      <Show when={failure()}>
        {(text) => (
          <p class="field-note error" role="alert">
            {text()}
          </p>
        )}
      </Show>
      <p class="field-note">GitHub, GitLab, and Bitbucket are named only to say which service a connection reaches; YForge is not affiliated with them.</p>
      <Show when={dialog()} keyed>
        {(start) => <ConnectionDialog start={start} onClose={() => setDialog(undefined)} onSaved={() => void refresh()} />}
      </Show>
      <Show when={removal()} keyed>
        {(connection) => <ConfirmDialog copy={removeConnectionCopy(connection.name, connection.host)} onConfirm={() => void confirmRemoval()} onCancel={() => setRemoval(undefined)} />}
      </Show>
    </>
  );
}
