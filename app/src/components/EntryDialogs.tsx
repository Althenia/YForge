import { createSignal, createUniqueId, onCleanup, onMount, Show } from "solid-js";
import { client, IpcError } from "../ipc/client";
import { useApp } from "../state/app";
import { cloneDestination, cloneUrlProblem, createDestination, createNameProblem } from "../state/launcher";
import { announceOperation } from "../state/operationLabels";
import { Icon } from "./Icon";

const PARENT_KEY = "yforge.entry.parent";

let sequence = 0;
const nextId = (): string => `clone-${Date.now()}-${(sequence += 1)}`;

async function defaultParent(): Promise<string> {
  return window.localStorage.getItem(PARENT_KEY) ?? (await client.homeDirectory());
}

function Frame(props: { title: string; children: import("solid-js").JSX.Element; onEscape: () => void }) {
  const titleId = createUniqueId();
  return (
    <div class="scrim" onPointerDown={(event) => event.target === event.currentTarget && props.onEscape()}>
      <div
        class="dialog entry-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            props.onEscape();
          }
        }}
      >
        <h3 id={titleId}>{props.title}</h3>
        {props.children}
      </div>
    </div>
  );
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

export function CloneDialog(props: { onClose: () => void }) {
  const app = useApp();
  const [url, setUrl] = createSignal("");
  const [parent, setParent] = createSignal("");
  const [openAfter, setOpenAfter] = createSignal(true);
  const [running, setRunning] = createSignal<{ id: string; phase: string; percent: number | null } | undefined>();
  const [failure, setFailure] = createSignal<string | undefined>();
  let urlInput: HTMLInputElement | undefined;

  onMount(() => {
    urlInput?.focus();
    void defaultParent().then(setParent);
    const unlisten = client.onOperationProgress((progress) => {
      const current = running();
      if (current !== undefined && current.id === progress.id) setRunning({ id: current.id, phase: progress.phase, percent: progress.percent });
    });
    onCleanup(() => void unlisten.then((stop) => stop()));
  });

  const problem = () => cloneUrlProblem(url());
  const destination = () => cloneDestination(parent(), url());
  const ready = () => problem() === undefined && parent().trim() !== "" && running() === undefined;

  async function submit(): Promise<void> {
    if (!ready()) return;
    const id = nextId();
    announceOperation(id, "clone");
    setFailure(undefined);
    setRunning({ id, phase: "Starting clone", percent: null });
    window.localStorage.setItem(PARENT_KEY, parent());
    try {
      const root = await client.cloneRepo(id, url().trim(), destination());
      setRunning(undefined);
      props.onClose();
      if (openAfter()) await app.openRepository(root);
    } catch (error) {
      setRunning(undefined);
      if (error instanceof IpcError && error.kind === "cancelled") setFailure("Clone cancelled. The partial folder was removed.");
      else setFailure(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Frame title="Clone repository" onEscape={() => (running() === undefined ? props.onClose() : undefined)}>
      <form
        class="entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label class="field">
          <span class="field-label">Repository URL</span>
          <span class="input" classList={{ invalid: url() !== "" && problem() !== undefined }}>
            <input
              type="text"
              ref={urlInput}
              value={url()}
              placeholder="https://github.com/example/lab-app.git"
              aria-label="Repository URL"
              aria-invalid={url() !== "" && problem() !== undefined}
              disabled={running() !== undefined}
              onInput={(event) => setUrl(event.currentTarget.value)}
            />
            <Show when={url() !== "" && problem() === undefined}>
              <Icon name="check" />
            </Show>
          </span>
          <Show when={url() !== "" && problem()}>{(text) => <span class="field-note error">{text()}</span>}</Show>
        </label>
        <ParentField label="Destination" value={parent()} onChange={setParent} browse="Choose where to clone" />
        <p class="field-note">
          Clones into <span class="ref">{destination()}</span>
        </p>
        <label class="check">
          <input type="checkbox" checked={openAfter()} onChange={(event) => setOpenAfter(event.currentTarget.checked)} />
          Open after clone
        </label>
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
                Cancel
              </button>
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
        <p class="field-note">Cancelling a clone removes the partial folder.</p>
        <div class="foot">
          <button type="button" class="btn" disabled={running() !== undefined} title={running() === undefined ? undefined : "Clone is unavailable while cloning"} onClick={props.onClose}>
            Close
          </button>
          <button type="submit" class="btn primary" disabled={!ready()} title={running() === undefined ? undefined : "Clone is unavailable while cloning"}>
            {failure() === undefined ? "Clone" : "Retry"}
          </button>
        </div>
      </form>
    </Frame>
  );
}

export function CreateDialog(props: { onClose: () => void }) {
  const app = useApp();
  const [name, setName] = createSignal("");
  const [parent, setParent] = createSignal("");
  const [failure, setFailure] = createSignal<{ message: string; existing: string | undefined } | undefined>();
  const [busy, setBusy] = createSignal(false);
  let nameInput: HTMLInputElement | undefined;

  onMount(() => {
    nameInput?.focus();
    void defaultParent().then(setParent);
  });

  const problem = () => createNameProblem(name());
  const path = () => createDestination(parent(), name());
  const ready = () => problem() === undefined && parent().trim() !== "" && !busy();

  async function submit(): Promise<void> {
    if (!ready()) return;
    setBusy(true);
    setFailure(undefined);
    window.localStorage.setItem(PARENT_KEY, parent());
    try {
      const root = await client.initRepo(path());
      props.onClose();
      await app.openRepository(root);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFailure({ message, existing: error instanceof IpcError && error.kind === "already_a_repository" ? path() : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame title="Create repository" onEscape={props.onClose}>
      <form
        class="entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label class="field">
          <span class="field-label">Name</span>
          <span class="input" classList={{ invalid: name() !== "" && problem() !== undefined }}>
            <input type="text" ref={nameInput} value={name()} aria-label="Name" aria-invalid={name() !== "" && problem() !== undefined} onInput={(event) => setName(event.currentTarget.value)} />
          </span>
          <Show when={name() !== "" && problem()}>{(text) => <span class="field-note error">{text()}</span>}</Show>
        </label>
        <ParentField label="Location" value={parent()} onChange={setParent} browse="Choose where to create the repository" />
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
    </Frame>
  );
}
