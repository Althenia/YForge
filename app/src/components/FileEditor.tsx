import { createSignal, onMount, Show } from "solid-js";
import type { ConfirmCopy } from "../state/confirmCopy";
import type { EditingFile } from "../state/fileOps";
import { formatBytes } from "../state/fileView";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { TextArea } from "./TextArea";
import { tip } from "./Tooltip";

const MIN_ROWS = 12;
const MAX_ROWS = 100_000;

const normalized = (text: string): string => text.replace(/\r\n/g, "\n");

const discardCopy = (file: string): ConfirmCopy => ({
  title: `Discard unsaved edits to ${file}?`,
  names: [],
  confirmLabel: "Discard edits",
  consequences: ["Your edits have not been saved. Closing the editor discards them; the file on disk stays as it was."],
});

export function FileEditor(props: { target: EditingFile; save: (file: string, text: string, eol: string) => Promise<boolean>; onClose: () => void }) {
  const [text, setText] = createSignal(normalized(props.target.text));
  const [saved, setSaved] = createSignal(normalized(props.target.text));
  const [saving, setSaving] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);
  let section: HTMLElement | undefined;

  onMount(() => queueMicrotask(() => section?.querySelector("textarea")?.focus()));

  const dirty = () => text() !== saved();
  const saveReason = () => (dirty() ? undefined : "There are no unsaved changes");

  async function save(): Promise<void> {
    if (!dirty() || saving()) return;
    const content = text();
    setSaving(true);
    if (await props.save(props.target.file, content, props.target.eol)) setSaved(content);
    setSaving(false);
  }

  const close = () => (dirty() ? setConfirming(true) : props.onClose());

  return (
    <>
      <section
        ref={section}
        class="panel dpanel fpanel feditor"
        aria-label="Edit file"
        aria-busy={saving()}
        tabindex="-1"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            void save();
          }
        }}
      >
        <div class="dhead">
          <nav class="crumbs" aria-label="Breadcrumb">
            <button type="button" class="link" onClick={close}>
              Graph
            </button>
            <span aria-hidden="true">›</span>
            <span>Edit</span>
            <span aria-hidden="true">›</span>
            <span class="path" aria-current="page">
              {props.target.file}
            </span>
          </nav>
          <span class="spacer" />
          <Show when={dirty()}>
            <span class="chip" role="status">
              Unsaved changes
            </span>
          </Show>
          <span class="chip">{formatBytes(props.target.size)}</span>
          <span class="chip ref">{props.target.eol === "\r\n" ? "CRLF" : "LF"}</span>
          <button type="button" class="btn sm primary" {...tip(saveReason() ?? "Save changes", "⌘S", "Save")} aria-disabled={saveReason() === undefined ? undefined : "true"} onClick={() => void save()}>
            <Icon name="check" size={14} />
            Save
          </button>
          <button type="button" class="btn sm" {...tip("Close the editor", "Esc", "Close")} onClick={close}>
            <Icon name="close" size={14} />
            Close
          </button>
        </div>
        <div class="dbody feditor-body">
          <TextArea label="File content" value={text()} minRows={MIN_ROWS} maxRows={MAX_ROWS} onInput={setText} />
        </div>
      </section>
      <Show when={confirming()}>
        <ConfirmDialog
          copy={discardCopy(props.target.file)}
          onConfirm={() => {
            setConfirming(false);
            props.onClose();
          }}
          onCancel={() => setConfirming(false)}
        />
      </Show>
    </>
  );
}
