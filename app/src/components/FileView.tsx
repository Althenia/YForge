import { useQuery } from "../state/query";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
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

export function FileLines(props: { file: string; lines: readonly string[]; report: (failure: unknown) => void; scroller: () => HTMLElement | undefined; gutter?: (index: number) => JSX.Element }) {
  const lines = createMemo(() => props.lines.map(displayText));
  const [language, setLanguage] = createSignal<LanguageId | undefined>();
  createEffect(() => {
    const id = languageOf(props.file);
    setLanguage((current) => (current === id ? current : undefined));
    if (id === undefined) return;
    let stale = false;
    onCleanup(() => (stale = true));
    loadLanguage(id).then(
      () => {
        if (!stale) setLanguage(id);
      },
      props.report,
    );
  });
  const highlighted = createMemo(() => highlightLines(language(), lines()));

  return (
    <VirtualRows as="div" class="dflat" items={lines()} scroller={props.scroller} estimate={LINE_ESTIMATE}>
      {(_, virtual) => (
        <div class="fline" ref={virtual.measure} data-index={virtual.index} style={virtual.style}>
          {props.gutter?.(virtual.index)}
          <span class="ln" aria-hidden="true">
            {virtual.index + 1}
          </span>
          <span class="code">
            <For each={highlighted()[virtual.index] ?? []}>{(part) => <span classList={{ [`syn-${part.kind}`]: part.kind !== undefined }}>{part.text}</span>}</For>
          </span>
        </div>
      )}
    </VirtualRows>
  );
}

function createFileAt(session: RepoSession, target: () => { file: string; rev: string }) {
  const path = session.path;
  const file = useQuery(() => ({
    queryKey: repoKeys.fileAt(path, target().rev, target().file),
    queryFn: () => client.fileAtRevision(path, target().file, target().rev),
  }));
  const shown = () => (file.error == null ? file.data : undefined);
  const text = () => {
    const current = shown();
    return current?.kind === "text" ? current : undefined;
  };
  const lines = createMemo(() => fileLines(text()?.text ?? ""));
  return { file, shown, text, lines };
}

export function FileBody(props: { session: RepoSession; file: string; rev: string }) {
  const content = createFileAt(props.session, () => ({ file: props.file, rev: props.rev }));
  let body: HTMLDivElement | undefined;
  return (
    <div class="dbody" ref={body}>
      <Show when={content.file.error}>
        {(error) => (
          <div class="graph-error" role="alert">
            {fileViewError(error())}
          </div>
        )}
      </Show>
      <Show when={content.shown()?.kind === "binary" && content.shown()}>
        {(binary) => <div class="empty">Binary file, {formatBytes(binary().size)}. There is no text view.</div>}
      </Show>
      <Show when={content.text() !== undefined && content.lines().length === 0}>
        <div class="empty">This file is empty.</div>
      </Show>
      <Show when={content.lines().length > 0}>
        <FileLines file={props.file} lines={content.lines()} report={props.session.report} scroller={() => body} />
      </Show>
    </div>
  );
}

export function FileView(props: { session: RepoSession; target: FileViewTarget; onClose: () => void }) {
  const content = createFileAt(props.session, () => props.target);
  const lines = content.lines;

  return (
    <section
      class="panel dpanel fpanel"
      aria-label="File"
      aria-busy={content.file.isFetching}
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
        <Show when={content.text()}>
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
      <FileBody session={props.session} file={props.target.file} rev={props.target.rev} />
    </section>
  );
}
