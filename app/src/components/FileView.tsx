import { useQuery } from "../state/query";
import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js";
import { client } from "../ipc/client";
import { fileLines, fileViewError, formatBytes, previewKind, type FileViewTarget } from "../state/fileView";
import { repoKeys } from "../state/queryKeys";
import type { RepoSession } from "../state/repoSession";
import { displayText } from "../state/diffHighlight";
import { highlightLines, languageOf, loadLanguage, type LanguageId } from "../state/syntax";
import { handleMarkdownClick, renderMarkdown } from "../state/markdown";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";
import { VirtualRows } from "./VirtualRows";

const LINE_ESTIMATE = 20;

export function FileLines(props: { file: string; lines: readonly string[]; report: (failure: unknown) => void; scroller: () => HTMLElement | undefined; gutter?: (index: number) => JSX.Element; highlight?: (index: number) => boolean }) {
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
        <div class="fline" classList={{ "blame-selected": props.highlight?.(virtual.index) === true }} ref={virtual.measure} data-index={virtual.index} style={virtual.style}>
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

export function FileBody(props: { session: RepoSession; file: string; rev: string; fragment?: string; onOpenFile: (file: string, fragment?: string) => void }) {
  const content = createFileAt(props.session, () => ({ file: props.file, rev: props.rev }));
  const kind = () => previewKind(props.file);
  const [mode, setMode] = createSignal<"preview" | "source">(kind() === undefined ? "source" : "preview");
  const [preview, setPreview] = createSignal<{ id: string; url: string }>();
  const [previewError, setPreviewError] = createSignal<string>();
  createEffect(() => { setMode(kind() === undefined ? "source" : "preview"); });
  createEffect(() => {
    setPreview(undefined);
    setPreviewError(undefined);
    if (kind() === undefined || mode() !== "preview" || content.shown() === undefined) return;
    let disposed = false;
    let id: string | undefined;
    void client.previewStart(props.session.path, props.file, props.rev).then(
      ([started, url]) => {
        if (disposed) { void client.previewStop(started).catch(props.session.report); return; }
        id = started;
        setPreview({ id: started, url });
      },
      (error) => { if (!disposed) setPreviewError(fileViewError(error)); },
    );
    onCleanup(() => {
      disposed = true;
      if (id !== undefined) void client.previewStop(id).catch(props.session.report);
    });
  });
  const [markdown] = createResource(
    () => kind() === "markdown" && preview() !== undefined ? { text: content.text()?.text ?? "", file: props.file, previewBase: preview()!.url } : false,
    async (source) => {
      try { return { html: await renderMarkdown(source.text, source), failure: undefined }; }
      catch (error) { props.session.report(error); return { html: "", failure: fileViewError(error) }; }
    },
  );
  let body: HTMLDivElement | undefined;
  createEffect(() => {
    const hash = props.fragment;
    if (markdown.loading || markdown()?.html === undefined || hash === undefined) return;
    try {
      const id = decodeURIComponent(hash);
      [...(body?.querySelectorAll<HTMLElement>("article [id]") ?? [])].find((element) => element.id === id)?.scrollIntoView({ block: "start" });
    } catch { return; }
  });
  return (
    <>
    <Show when={kind() !== undefined}>
      <div class="dtool" role="toolbar" aria-label="File view mode">
        <button type="button" class="btn sm" aria-pressed={mode() === "preview"} onClick={() => setMode("preview")}>Preview</button>
        <Show when={kind() !== "image"}><button type="button" class="btn sm" aria-pressed={mode() === "source"} onClick={() => setMode("source")}>Source</button></Show>
      </div>
    </Show>
    <div class="dbody" ref={body}>
      <Show when={content.file.error}>
        {(error) => (
          <div class="graph-error" role="alert">
            {fileViewError(error())}
          </div>
        )}
      </Show>
      <Show when={mode() === "preview" && kind() !== undefined && content.shown() !== undefined}>
        <Show when={previewError()}>{(error) => <div class="graph-error" role="alert">{error()}</div>}</Show>
        <Show when={preview() === undefined && previewError() === undefined}><div class="empty" role="status" aria-busy="true"><span class="busy-spinner" aria-hidden="true" />Preparing preview…</div></Show>
        <Show when={preview()}>{(session) => <div class="file-preview">
          <Show when={kind() === "image"}><img src={session().url} alt={props.file} /></Show>
          <Show when={kind() === "markdown"}>
            <Show when={markdown()?.failure}>{(failure) => <div role="alert">{failure()}</div>}</Show>
            <article class="markdown-body markdown-file" innerHTML={markdown()?.html ?? ""} onClick={(event) => handleMarkdownClick(event, event.currentTarget, props.onOpenFile)} />
          </Show>
          <Show when={kind() === "html"}><iframe title={`${props.file} preview`} src={session().url} sandbox="allow-scripts" referrerpolicy="no-referrer" /></Show>
        </div>}</Show>
      </Show>
      <Show when={mode() === "source" && content.shown()?.kind === "binary" && content.shown()}>
        {(binary) => <div class="empty">Binary file, {formatBytes(binary().size)}. There is no text view.</div>}
      </Show>
      <Show when={mode() === "source" && content.text() !== undefined && content.lines().length === 0}>
        <div class="empty">This file is empty.</div>
      </Show>
      <Show when={mode() === "source" && content.lines().length > 0}>
        <FileLines file={props.file} lines={content.lines()} report={props.session.report} scroller={() => body} />
      </Show>
    </div>
    </>
  );
}

export function FileView(props: { session: RepoSession; target: FileViewTarget; onClose: () => void }) {
  const [target, setTarget] = createSignal(props.target);
  const [fragment, setFragment] = createSignal<string | undefined>(props.target.fragment);
  createEffect(on(() => props.target, (next) => { setTarget(next); setFragment(next.fragment); }));
  const content = createFileAt(props.session, target);
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
          <span>{target().source}</span>
          <span aria-hidden="true">›</span>
          <span class="path" aria-current="page">
            {target().file}
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
        <button type="button" class="icon-btn dense" {...tip("Open in editor")} onClick={() => void client.openPath(`${props.session.snapshot().root}/${target().file}`, "editor").catch(props.session.report)}>
          <Icon name="edit" />
        </button>
        <button type="button" class="icon-btn dense" {...tip("Close file view", "Esc")} onClick={props.onClose}>
          <Icon name="close" />
        </button>
      </div>
      <FileBody session={props.session} file={target().file} rev={target().rev} onOpenFile={(file, hash) => { setFragment(hash); setTarget({ ...target(), file }); }} fragment={fragment()} />
    </section>
  );
}
