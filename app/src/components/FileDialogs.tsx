import { createSignal, onMount, Show } from "solid-js";
import type { FilePurpose } from "../state/fileOps";
import { DialogFrame } from "./DialogFrame";
import { Select } from "./Select";

export function CreateFileDialog(props: { submit: (name: string) => Promise<string | undefined>; onClose: () => void }) {
  const [name, setName] = createSignal("");
  const [problem, setProblem] = createSignal<string | undefined>();
  const [busy, setBusy] = createSignal(false);
  let input: HTMLInputElement | undefined;

  onMount(() => input?.focus());

  const ready = () => name().trim() !== "" && !busy();

  async function create(): Promise<void> {
    if (!ready()) return;
    setBusy(true);
    setProblem(undefined);
    setProblem(await props.submit(name()));
    setBusy(false);
  }

  return (
    <DialogFrame title="Create file" onEscape={props.onClose}>
      <form
        class="entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label class="field">
          <span class="field-label">Path</span>
          <span class="input" classList={{ invalid: problem() !== undefined }}>
            <input
              type="text"
              ref={input}
              value={name()}
              aria-label="Path"
              aria-invalid={problem() !== undefined}
              placeholder="src/new-file.txt"
              onInput={(event) => {
                setName(event.currentTarget.value);
                setProblem(undefined);
              }}
            />
          </span>
        </label>
        <p class="field-note">A path relative to the repository root. Folders that do not exist are created, and the file shows in Changes as untracked.</p>
        <Show when={problem()}>
          {(reason) => (
            <p class="field-note error" role="alert">
              {reason()}
            </p>
          )}
        </Show>
        <div class="foot">
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary" aria-disabled={ready() ? undefined : "true"}>
            Create
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

const titles: Record<FilePurpose, string> = { delete: "Delete file", view: "View file", edit: "Edit file" };

const actions: Record<FilePurpose, string> = { delete: "Continue", view: "View", edit: "Edit" };

export function FilePickerDialog(props: { purpose: FilePurpose; files: readonly string[]; onChoose: (file: string) => void; onClose: () => void }) {
  const [file, setFile] = createSignal("");
  const ready = () => file() !== "";

  return (
    <DialogFrame title={titles[props.purpose]} onEscape={props.onClose}>
      <form
        class="entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready()) props.onChoose(file());
        }}
      >
        <Show when={props.files.length > 0} fallback={<p class="field-note">This repository has no files.</p>}>
          <div class="field">
            <span class="field-label">File</span>
            <Select label="File" value={file()} placeholder="Choose a file…" options={props.files.map((entry) => ({ value: entry, label: entry }))} onChange={setFile} />
          </div>
          <p class="field-note">Tracked and untracked files in the working tree; ignored files are not listed.</p>
        </Show>
        <div class="foot">
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary" aria-disabled={ready() ? undefined : "true"}>
            {actions[props.purpose]}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
