import { useQuery } from "../state/query";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { client } from "../ipc/client";
import { fileLines, fileViewError, formatBytes, type FileViewTarget } from "../state/fileView";
import { repoKeys } from "../state/queryKeys";
import type { RepoSession } from "../state/repoSession";
import { displayText } from "../state/diffHighlight";
import { highlightLines, languageOf, loadLanguage, type LanguageId } from "../state/syntax";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";
import { VirtualRows } from "./VirtualRows";

const LINE_ESTIMATE = 20;

export function FileView(props: { session: RepoSession; target: FileViewTarget; onClose: () => void }) {
  const path = props.session.path;
  const file = useQuery(() => ({
    queryKey: repoKeys.fileAt(path, props.target.rev, props.target.file),
    queryFn: () => client.fileAtRevision(path, props.target.file, props.target.rev),
  }));
  const shown = () => (file.error == null ? file.data : undefined);
  const text = () => {
    const current = shown();
    return current?.kind === "text" ? current : undefined;
  };
  const lines = createMemo(() => fileLines(text()?.text ?? "").map(displayText));

  const [language, setLanguage] = createSignal<LanguageId | undefined>();
  createEffect(() => {
    const id = languageOf(props.target.file);
    setLanguage((current) => (current === id ? current : undefined));
    if (id === undefined) return;
    let stale = false;
    onCleanup(() => (stale = true));
    loadLanguage(id).then(
      () => {
        if (!stale) setLanguage(id);
      },
      props.session.report,
    );
  });
  const highlighted = createMemo(() => highlightLines(language(), lines()));

  let body: HTMLDivElement | undefined;

  return (
    <section
      class="panel dpanel fpanel"
      aria-label="File"
      aria-busy={file.isFetching}
      tabindex="-1"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          props.onClose();
        }
      }}
    >
      <div class="dhead">
        <nav class="crumbs" aria-label="Breadcrumb">
          <button type="button" class="link" onClick={props.onClose}>
            Graph
          </button>
          <span aria-hidden="true">›</span>
          <span>{props.target.source}</span>
          <span aria-hidden="true">›</span>
          <span class="path" aria-current="page">
            {props.target.file}
          </span>
        </nav>
        <span class="spacer" />
        <Show when={text()}>
          {(current) => (
            <>
              <span class="chip">
                {lines().length} {lines().length === 1 ? "line" : "lines"} · {formatBytes(current().size)}
              </span>
              <span class="chip ref">{current().eol === "\r\n" ? "CRLF" : "LF"}</span>
            </>
          )}
        </Show>
        <button type="button" class="icon-btn dense" {...tip("Open in editor")} onClick={() => void client.openPath(`${props.session.snapshot().root}/${props.target.file}`, "editor").catch(props.session.report)}>
          <Icon name="edit" />
        </button>
        <button type="button" class="icon-btn dense" {...tip("Close file view", "Esc")} onClick={props.onClose}>
          <Icon name="close" />
        </button>
      </div>
      <div class="dbody" ref={body}>
        <Show when={file.error}>
          {(error) => (
            <div class="graph-error" role="alert">
              {fileViewError(error())}
            </div>
          )}
        </Show>
        <Show when={shown()?.kind === "binary" && shown()}>
          {(binary) => <div class="empty">Binary file, {formatBytes(binary().size)}. There is no text view.</div>}
        </Show>
        <Show when={text() !== undefined && lines().length === 0}>
          <div class="empty">This file is empty.</div>
        </Show>
        <Show when={lines().length > 0}>
          <VirtualRows as="div" class="dflat" items={lines()} scroller={() => body} estimate={LINE_ESTIMATE}>
            {(_, virtual) => (
              <div class="fline" ref={virtual.measure} data-index={virtual.index} style={virtual.style}>
                <span class="ln" aria-hidden="true">
                  {virtual.index + 1}
                </span>
                <span class="code">
                  <For each={highlighted()[virtual.index] ?? []}>{(part) => <span classList={{ [`syn-${part.kind}`]: part.kind !== undefined }}>{part.text}</span>}</For>
                </span>
              </div>
            )}
          </VirtualRows>
        </Show>
      </div>
    </section>
  );
}
