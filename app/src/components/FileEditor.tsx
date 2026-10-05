import { Compartment, EditorState } from "@codemirror/state";
import { findReferences, jumpToDefinition } from "@codemirror/lsp-client";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { ConfirmCopy } from "../state/confirmCopy";
import type { EditingFile } from "../state/fileOps";
import { formatBytes } from "../state/fileView";
import { createLspSession } from "../state/lsp";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

const normalized = (text: string): string => text.replace(/\r\n/g, "\n");

const discardCopy = (file: string): ConfirmCopy => ({
  title: `Discard unsaved edits to ${file}?`,
  names: [],
  confirmLabel: "Discard edits",
  consequences: ["Your edits have not been saved. Closing the editor discards them; the file on disk stays as it was."],
});

export function FileEditor(props: { target: EditingFile; repoPath: string; servers: Readonly<Record<string, string>>; save: (file: string, text: string, eol: string) => Promise<boolean>; onClose: () => void }) {
  const [text, setText] = createSignal(normalized(props.target.text));
  const [saved, setSaved] = createSignal(normalized(props.target.text));
  const [saving, setSaving] = createSignal(false);
  const [failure, setFailure] = createSignal<string>();
  const [confirming, setConfirming] = createSignal(false);
  const [vimMode, setVimMode] = createSignal(false);
  let editorHost: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  const vimLayer = new Compartment();
  const editableLayer = new Compartment();
  const lspLayer = new Compartment();
  const lsp = createLspSession(props.repoPath, props.target.file, () => view, lspLayer);
  const extension = () => props.target.file.split(".").at(-1)?.toLowerCase() ?? "";
  const serverCommand = () => props.servers[extension()];

  onMount(() => {
    if (editorHost === undefined) return;
    view = new EditorView({
      parent: editorHost,
      state: EditorState.create({
        doc: text(),
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setText(update.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ "aria-label": "File content" }),
          vimLayer.of([]),
          editableLayer.of(EditorView.editable.of(true)),
          lspLayer.of([]),
        ],
      }),
    });
    view.focus();
    onCleanup(() => view?.destroy());
  });

  createEffect(() => {
    const enabled = vimMode();
    view?.dispatch({ effects: vimLayer.reconfigure(enabled ? vim({ status: true }) : []) });
  });

  createEffect(() => {
    const busy = saving();
    view?.dispatch({ effects: editableLayer.reconfigure(EditorView.editable.of(!busy)) });
  });

  const dirty = () => text() !== saved();
  const saveReason = () => (dirty() ? undefined : "There are no unsaved changes");

  async function save(): Promise<void> {
    if (!dirty() || saving()) return;
    const content = text();
    setSaving(true);
    setFailure(undefined);
    try {
      if (await props.save(props.target.file, content, props.target.eol)) setSaved(content);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const close = () => { if (!saving()) dirty() ? setConfirming(true) : props.onClose(); };

  return (
    <>
      <section
        class="panel dpanel fpanel feditor"
        aria-label="Edit file"
        aria-busy={saving()}
        tabindex="-1"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (vimMode() && event.target instanceof Node && editorHost?.contains(event.target)) return;
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
          <button type="button" class="btn sm" aria-pressed={vimMode()} onClick={() => setVimMode(!vimMode())}>Vim</button>
          <Show when={serverCommand()}>
            <Show when={lsp.status() === "off" || lsp.status() === "error"} fallback={
              <button type="button" class="btn sm" onClick={() => void lsp.stop()}>Stop language server</button>
            }>
              <button type="button" class="btn sm" onClick={() => void lsp.start()}>Start language server</button>
            </Show>
          </Show>
          <Show when={lsp.status() === "ready"}>
            <button type="button" class="btn sm" onClick={() => view !== undefined && jumpToDefinition(view)}>Definition</button>
            <button type="button" class="btn sm" onClick={() => view !== undefined && findReferences(view)}>References</button>
          </Show>
          <button type="button" class="btn sm primary" {...tip(saveReason() ?? "Save changes", "⌘S", "Save")} aria-busy={saving()} aria-disabled={saveReason() !== undefined || saving() ? "true" : undefined} onClick={() => void save()}>
            <Icon name="check" size={14} />
            {saving() ? "Saving…" : "Save"}
          </button>
          <button type="button" class="btn sm" disabled={saving()} {...tip("Close the editor", "Esc", "Close")} onClick={close}>
            <Icon name="close" size={14} />
            Close
          </button>
        </div>
        <div class="dbody feditor-body">
          <Show when={failure()}>{(error) => <p role="alert" class="graph-error">{error()}</p>}</Show>
          <div ref={editorHost} class="owned-code-editor" role="group" aria-label="File content" />
        </div>
        <Show when={serverCommand()}>
          <div class="feditor-lsp-status" role="status" aria-busy={lsp.status() === "connecting"}>
            <Show when={lsp.status() === "connecting"}><span class="busy-spinner" aria-hidden="true" />Connecting to language server…</Show>
            <Show when={lsp.status() === "ready"}>Language server ready</Show>
            <Show when={lsp.status() === "error"}>{lsp.failure()}</Show>
          </div>
        </Show>
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
