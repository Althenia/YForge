import { createForm } from "@tanstack/solid-form";
import { createDebouncer } from "@tanstack/solid-pacer";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { UrlIdentity } from "../ipc/bindings/UrlIdentity";
import { client, IpcError } from "../ipc/client";
import { useApp, type AppState } from "../state/app";
import { withParentFolder } from "../state/appUiPrefs";
import { CREDENTIAL_HELPER_TEXT, identityLine } from "../state/gitHostsModel";
import { cloneDestination, cloneUrlProblem, createDestination, createNameProblem } from "../state/entryForms";
import { announceOperation } from "../state/operationLabels";
import { appKeys, gitHostKeys } from "../state/queryKeys";
import { useQuery } from "../state/query";
import { DialogFrame } from "./DialogFrame";
import { Icon } from "./Icon";

const parentProblem = (parent: string): string | undefined => (parent.trim() === "" ? "Choose a destination" : undefined);

const IDENTITY_PAUSE_MS = 250;

type CloneFailure = { message: string; output: string | null; refusedKey: UrlIdentity | undefined };

const refusal = (output: string | null): string => {
  const text = output?.trim() ?? "";
  return /Permission denied \([^)]*\)/.exec(text)?.[0] ?? text.split("\n").at(-1)?.trim() ?? "";
};

let sequence = 0;
const nextId = (): string => `clone-${Date.now()}-${(sequence += 1)}`;

async function defaultParent(app: AppState): Promise<string> {
  return (await app.uiPrefs.load()).last_parent_folder ?? (await client.homeDirectory());
}

function ParentField(props: { label: string; value: string; onChange: (value: string) => void; browse: string }) {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      <span class="field-row">
        <span class="input">
          <input type="text" value={props.value} aria-label={props.label} onInput={(event) => props.onChange(event.currentTarget.value)} />
        </span>
        <button
          type="button"
          class="btn"
          onClick={async () => {
            const picked = await client.pickFolder(props.browse);
            if (picked !== undefined) props.onChange(picked);
          }}
        >
          Browse…
        </button>
      </span>
    </label>
  );
}

function HttpsDetail(props: { user: string | null }) {
  return (
    <>
      {props.user === null ? "HTTPS" : <>HTTPS as <b>{props.user}</b></>}; {CREDENTIAL_HELPER_TEXT}
    </>
  );
}

export function CloneDialog(props: { onClose: () => void }) {
  const app = useApp();
  const form = createForm(() => ({
    defaultValues: { url: "", parent: "", openAfter: true, shallow: false, sparse: false },
    onSubmit: ({ value }) => clone(value),
  }));
  const url = form.useSelector((state) => state.values.url);
  const parent = form.useSelector((state) => state.values.parent);
  const setParent = (value: string) => form.setFieldValue("parent", value);
  const [running, setRunning] = createSignal<{ id: string; phase: string; percent: number | null } | undefined>();
  const [failure, setFailure] = createSignal<CloneFailure | undefined>();
  const [copiedKey, setCopiedKey] = createSignal(false);
  const [settledUrl, setSettledUrl] = createSignal("");
  let urlInput: HTMLInputElement | undefined;
  const home = useQuery(() => ({ queryKey: appKeys.home, queryFn: () => client.homeDirectory(), staleTime: Infinity }));
  const settle = createDebouncer((value: string) => setSettledUrl(value), { wait: IDENTITY_PAUSE_MS });

  onMount(() => {
    urlInput?.focus();
    void defaultParent(app).then(setParent);
    const unlisten = client.onOperationProgress((progress) => {
      const current = running();
      if (current !== undefined && current.id === progress.id) setRunning({ id: current.id, phase: progress.phase, percent: progress.percent });
    });
    onCleanup(() => void unlisten.then((stop) => stop()));
  });

  const problem = () => cloneUrlProblem(url());
  const destination = () => cloneDestination(parent(), url());
  createEffect(() => settle.maybeExecute(url().trim()));
  const asked = () => url().trim() !== "" && problem() === undefined;
  const identity = useQuery(() => ({
    queryKey: gitHostKeys.identity(settledUrl()),
    queryFn: () => client.gitIdentityForUrl(settledUrl()),
    enabled: asked() && settledUrl() === url().trim(),
  }));
  const knownIdentity = () => (asked() && settledUrl() === url().trim() ? (identity.data ?? undefined) : undefined);
  const canSubmit = form.useSelector((state) => state.canSubmit);
  const ready = () => canSubmit() && running() === undefined;

  async function clone(values: { url: string; parent: string; openAfter: boolean; shallow: boolean; sparse: boolean }): Promise<void> {
    const id = nextId();
    announceOperation(id, "clone");
    setFailure(undefined);
    setCopiedKey(false);
    setRunning({ id, phase: "Starting clone", percent: null });
    app.uiPrefs.update((prefs) => withParentFolder(prefs, values.parent));
    try {
      const root = await client.cloneRepo(id, values.url.trim(), cloneDestination(values.parent, values.url), { shallow: values.shallow, sparse: values.sparse });
      setRunning(undefined);
      props.onClose();
      if (values.openAfter) await app.openRepository(root);
    } catch (error) {
      setRunning(undefined);
      if (error instanceof IpcError && error.kind === "cancelled") setFailure({ message: "Clone cancelled. The partial folder was removed.", output: null, refusedKey: undefined });
      else {
        const found = knownIdentity();
        const refusedKey = error instanceof IpcError && error.kind === "auth_failed" && found?.transport === "ssh" && found.source === "host" ? found : undefined;
        setFailure({ message: error instanceof Error ? error.message : String(error), output: error instanceof IpcError ? error.output : null, refusedKey });
      }
    }
  }

  async function copyRefusedKey(path: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(await client.sshPublicKey(path));
      setCopiedKey(true);
    } catch (error) {
      setFailure((current) => (current === undefined ? current : { ...current, message: error instanceof Error ? error.message : String(error), refusedKey: undefined }));
    }
  }

  function changeIdentity(): void {
    props.onClose();
    app.openSettings("git-hosts");
  }

  return (
    <DialogFrame title="Clone repository" onEscape={() => (running() === undefined ? props.onClose() : undefined)}>
      <form
        class="entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <label class="field">
          <span class="field-label">Repository URL</span>
          <span class="input" classList={{ invalid: url() !== "" && problem() !== undefined }}>
            <form.Field name="url" validators={{ onMount: ({ value }) => cloneUrlProblem(value), onChange: ({ value }) => cloneUrlProblem(value) }}>
              {(field) => (
                <input
                  type="text"
                  ref={urlInput}
                  value={field().state.value}
                  placeholder="https://github.com/example/lab-app.git"
                  aria-label="Repository URL"
                  aria-invalid={url() !== "" && problem() !== undefined}
                  disabled={running() !== undefined}
                  onInput={(event) => field().handleChange(event.currentTarget.value)}
                />
              )}
            </form.Field>
            <Show when={url() !== "" && problem() === undefined}>
              <Icon name="check" />
            </Show>
          </span>
          <Show when={url() !== "" && problem()}>{(text) => <span class="field-note error">{text()}</span>}</Show>
        </label>
        <div class="identity" role="status" aria-busy={asked() && knownIdentity() === undefined && !identity.isError}>
          <Icon name="identity" />
          <Show
            when={knownIdentity()}
            fallback={
              <span class="sub">
                {!asked()
                  ? "Type a URL to see which identity it uses."
                  : identity.isError && settledUrl() === url().trim()
                    ? `Could not read the identity for this URL: ${identity.error instanceof Error ? identity.error.message : String(identity.error)}`
                    : "Checking which identity this URL uses…"}
              </span>
            }
          >
            {(found) => {
              const line = () => identityLine(found(), home.data);
              return (
                <>
                  <div class="identity-text">
                    <strong>{line().heading}</strong>
                    <Show when={line().detail}>
                      {(detail) => (
                        <span class="sub" classList={{ mono: detail().kind === "path" }}>
                          {detail().kind === "path" ? (detail() as { kind: "path"; path: string }).path : null}
                          {detail().kind === "text" ? (detail() as { kind: "text"; text: string }).text : null}
                          {detail().kind === "https" ? <HttpsDetail user={(detail() as { kind: "https"; user: string | null }).user} /> : null}
                        </span>
                      )}
                    </Show>
                  </div>
                  <Show when={line().hostIdentity}>
                    <span class="spacer" />
                    <button type="button" class="btn sm" disabled={running() !== undefined} onClick={changeIdentity}>
                      Change
                    </button>
                  </Show>
                </>
              );
            }}
          </Show>
        </div>
        <form.Field name="parent" validators={{ onMount: ({ value }) => parentProblem(value), onChange: ({ value }) => parentProblem(value) }}>
          {(field) => <ParentField label="Destination" value={field().state.value} onChange={field().handleChange} browse="Choose where to clone" />}
        </form.Field>
        <p class="field-note">
          Clones into <span class="ref">{destination()}</span>
        </p>
        <label class="check">
          <form.Field name="openAfter">
            {(field) => <input type="checkbox" checked={field().state.value} onChange={(event) => field().handleChange(event.currentTarget.checked)} />}
          </form.Field>
          Open after clone
        </label>
        <label class="check">
          <form.Field name="shallow">
            {(field) => <input type="checkbox" checked={field().state.value} onChange={(event) => field().handleChange(event.currentTarget.checked)} />}
          </form.Field>
          Shallow clone
        </label>
        <span class="field-note">Fetches only the latest commit of one branch; the rest of the history stays on the server and arrives when a page or a search needs it.</span>
        <label class="check">
          <form.Field name="sparse">
            {(field) => <input type="checkbox" checked={field().state.value} onChange={(event) => field().handleChange(event.currentTarget.checked)} />}
          </form.Field>
          Sparse checkout
        </label>
        <span class="field-note">Clones and checks nothing out, so you can choose the folders you want before any file is written.</span>
        <Show when={running()}>
          {(state) => (
            <div class="entry-progress" role="status">
              <span>
                {state().phase}
                {state().percent === null ? "" : ` ${state().percent}%`}
              </span>
              <span class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state().percent ?? undefined} classList={{ indeterminate: state().percent === null }}>
                <i style={{ width: `${state().percent ?? 40}%` }} />
              </span>
              <button type="button" class="btn sm" onClick={() => void client.operationCancel(state().id)}>
                Cancel clone
              </button>
            </div>
          )}
        </Show>
        <Show when={failure()}>
          {(state) => (
            <Show
              when={state().refusedKey}
              fallback={
                <p class="field-note error" role="alert">
                  {state().message}
                </p>
              }
            >
              {(refused) => (
                <div class="alert" role="alert">
                  <strong>{refused().host} refused the key</strong>
                  <p>
                    {refusal(state().output) === "" ? state().message : refusal(state().output)}. Add the public key to your account on {refused().host}, or choose another key for this host. Nothing was written to {parent()}.
                  </p>
                  <Show when={copiedKey()}>
                    <p role="status">Copied the public key.</p>
                  </Show>
                  <div class="acts">
                    <Show when={refused().ssh_key_path}>
                      {(path) => (
                        <button type="button" class="btn sm" onClick={() => void copyRefusedKey(path())}>
                          Copy public key
                        </button>
                      )}
                    </Show>
                    <button type="button" class="btn sm" onClick={changeIdentity}>
                      Edit host identity
                    </button>
                  </div>
                </div>
              )}
            </Show>
          )}
        </Show>
        <p class="field-note">Cancelling a clone removes the partial folder.</p>
        <div class="foot">
          <button type="button" class="btn" disabled={running() !== undefined} title={running() === undefined ? undefined : "Clone is unavailable while cloning"} onClick={props.onClose}>
            Close
          </button>
          <button type="submit" class="btn primary" disabled={!ready()} title={running() === undefined ? undefined : "Clone is unavailable while cloning"}>
            {failure() === undefined ? "Clone" : "Try again"}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

export function CreateDialog(props: { onClose: () => void }) {
  const app = useApp();
  const form = createForm(() => ({
    defaultValues: { name: "", parent: "" },
    onSubmit: ({ value }) => create(value),
  }));
  const name = form.useSelector((state) => state.values.name);
  const parent = form.useSelector((state) => state.values.parent);
  const setParent = (value: string) => form.setFieldValue("parent", value);
  const [failure, setFailure] = createSignal<{ message: string; existing: string | undefined } | undefined>();
  const [busy, setBusy] = createSignal(false);
  let nameInput: HTMLInputElement | undefined;

  onMount(() => {
    nameInput?.focus();
    void defaultParent(app).then(setParent);
  });

  const problem = () => createNameProblem(name());
  const path = () => createDestination(parent(), name());
  const canSubmit = form.useSelector((state) => state.canSubmit);
  const ready = () => canSubmit() && !busy();

  async function create(values: { name: string; parent: string }): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    app.uiPrefs.update((prefs) => withParentFolder(prefs, values.parent));
    try {
      const root = await client.initRepo(createDestination(values.parent, values.name));
      props.onClose();
      await app.openRepository(root);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFailure({ message, existing: error instanceof IpcError && error.kind === "already_a_repository" ? createDestination(values.parent, values.name) : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogFrame title="Create repository" onEscape={props.onClose}>
      <form
        class="entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <label class="field">
          <span class="field-label">Name</span>
          <span class="input" classList={{ invalid: name() !== "" && problem() !== undefined }}>
            <form.Field name="name" validators={{ onMount: ({ value }) => createNameProblem(value), onChange: ({ value }) => createNameProblem(value) }}>
              {(field) => (
                <input
                  type="text"
                  ref={nameInput}
                  value={field().state.value}
                  aria-label="Name"
                  aria-invalid={name() !== "" && problem() !== undefined}
                  onInput={(event) => field().handleChange(event.currentTarget.value)}
                />
              )}
            </form.Field>
          </span>
          <Show when={name() !== "" && problem()}>{(text) => <span class="field-note error">{text()}</span>}</Show>
        </label>
        <form.Field name="parent" validators={{ onMount: ({ value }) => parentProblem(value), onChange: ({ value }) => parentProblem(value) }}>
          {(field) => <ParentField label="Location" value={field().state.value} onChange={field().handleChange} browse="Choose where to create the repository" />}
        </form.Field>
        <p class="field-note">
          Creates <span class="ref">{path()}</span> with <code>git init</code> on the default branch from Settings.
        </p>
        <Show when={failure()}>
          {(state) => (
            <p class="field-note error" role="alert">
              {state().message}
              <Show when={state().existing}>
                {(existing) => (
                  <button
                    type="button"
                    class="btn sm"
                    onClick={() => {
                      props.onClose();
                      void app.openRepository(existing());
                    }}
                  >
                    Open instead
                  </button>
                )}
              </Show>
            </p>
          )}
        </Show>
        <div class="foot">
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary" disabled={!ready()}>
            Create
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
