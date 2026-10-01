import { Show } from "solid-js";
import type { RepoSnapshot } from "../ipc/bindings/RepoSnapshot";
import { statusLetter } from "../state/changes";
import type { RepoActions } from "../state/repoActions";
import { fileRowHeight, VirtualRows } from "./VirtualRows";

export function EmptyRepository(props: { snapshot: RepoSnapshot; actions: RepoActions }) {
  let scroller: HTMLElement | undefined;
  const files = () => props.snapshot.files.filter((file) => file.area === "untracked" || file.area === "unstaged" || file.area === "staged");
  const createFirstCommit = async () => {
    await props.actions.stageAll();
    document.querySelector<HTMLInputElement>('input[aria-label="Summary"]')?.focus();
  };
  return (
    <section class="panel empty-repo" aria-label="Empty repository" ref={scroller}>
      <div class="empty-repo-box">
        <h2>This repository has no commits yet</h2>
        <p>Stage files and create the first commit to start the history.</p>
        <Show when={files().length > 0} fallback={<p class="setting-note">Add files to this folder, then commit them.</p>}>
          <h3>Untracked files</h3>
          <VirtualRows class="flist empty-files" items={files()} scroller={() => scroller} estimate={fileRowHeight()}>
            {(file, row) => (
              <li class="frow" ref={row.measure} style={row.style}>
                <span class={`badge st-${file.status}`}>{statusLetter[file.status]}</span>
                <span class="path">
                  <bdi dir="ltr">{file.path}</bdi>
                </span>
              </li>
            )}
          </VirtualRows>
          <button type="button" class="btn primary" onClick={() => void createFirstCommit()}>
            Create first commit
          </button>
        </Show>
      </div>
    </section>
  );
}
