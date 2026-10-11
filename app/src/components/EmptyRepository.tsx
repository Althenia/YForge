import { createSignal, Show } from "solid-js";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { statusIcon, statusWord } from "../state/changes";
import type { RepoActions } from "../state/repoActions";
import { fileRowHeight, VirtualRows } from "./VirtualRows";
import { Icon } from "./Icon";

export function EmptyRepository(props: { snapshot: RepoSnapshot; actions: RepoActions }) {
  let scroller: HTMLDivElement | undefined;
  const [staging, setStaging] = createSignal(false);
  const files = () => props.snapshot.files.filter((file) => file.area === "untracked" || file.area === "unstaged" || file.area === "staged");
  const createFirstCommit = async () => {
    if (staging()) return;
    setStaging(true);
    try {
      if (await props.actions.stageAll()) document.querySelector<HTMLInputElement>('input[aria-label="Summary"]')?.focus();
    } finally {
      setStaging(false);
    }
  };
  return (
    <section class="panel empty-repo" aria-label="Empty repository">
      <div class="empty-repo-box">
        <header>
          <h2>This repository has no commits yet</h2>
          <p>Stage files and create the first commit to start the history.</p>
        </header>
        <Show when={files().length > 0} fallback={<p class="setting-note">Add files to this folder, then commit them.</p>}>
          <section class="empty-repo-files">
            <h3>Files · {files().length}</h3>
            <div
              class="empty-repo-list"
              ref={scroller}
              role="region"
              aria-label="Files to commit"
              tabindex="0"
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || event.altKey || event.metaKey || event.ctrlKey) return;
                const list = event.currentTarget;
                const top = event.key === "Home" ? 0 : event.key === "End" ? list.scrollHeight : event.key === "PageUp" ? list.scrollTop - list.clientHeight : event.key === "PageDown" ? list.scrollTop + list.clientHeight : undefined;
                if (top === undefined) return;
                event.preventDefault();
                list.scrollTo({ top });
              }}
            >
              <VirtualRows class="flist empty-files" items={files()} scroller={() => scroller} estimate={fileRowHeight()}>
                {(file, row) => (
                  <li class="frow" ref={row.measure} style={row.style}>
                    <span class={`badge st-${file.status}`} role="img" aria-label={statusWord[file.status]} title={statusWord[file.status]}><Icon name={statusIcon[file.status]} /></span>
                    <span class="path">
                      <bdi dir="ltr">{file.path}</bdi>
                    </span>
                  </li>
                )}
              </VirtualRows>
            </div>
          </section>
          <div class="empty-repo-actions">
            <button type="button" class="btn primary" disabled={staging()} aria-busy={staging()} onClick={() => void createFirstCommit()}>
              {staging() ? "Staging…" : "Create first commit"}
            </button>
            <Show when={staging()}><p class="setting-note" role="status"><span class="busy-spinner" aria-hidden="true" />Staging files…</p></Show>
          </div>
        </Show>
      </div>
    </section>
  );
}
