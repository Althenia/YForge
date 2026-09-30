import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { basename } from "../format";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import { dataOf } from "../state/queryData";
import { appKeys } from "../state/queryKeys";
import { displayPath, filterRecents, openedAgo, statusChips, type RecentRow } from "../state/launcher";
import { Icon } from "./Icon";
import { Mark } from "./Mark";
import { tip } from "./Tooltip";

export function Launcher() {
  const app = useApp();
  const queryClient = useQueryClient();
  const recents = useQuery(() => ({ queryKey: appKeys.recents, queryFn: () => client.recentsList() }));
  const home = useQuery(() => ({ queryKey: appKeys.home, queryFn: () => client.homeDirectory(), staleTime: Infinity }));
  const paths = () => (dataOf(recents) ?? []).map((recent) => recent.path);
  const statuses = useQuery(() => ({
    queryKey: [...appKeys.recents, "statuses", paths()],
    queryFn: () => client.recentStatuses(paths()),
    enabled: dataOf(recents) !== undefined,
    placeholderData: keepPreviousData,
  }));
  createEffect(() => {
    if (statuses.error != null) app.setNotice(String(statuses.error));
  });
  const removeRecent = useMutation(() => ({
    mutationFn: (path: string) => client.recentRemove(path),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: appKeys.recents }),
  }));
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal(0);
  const [dropping, setDropping] = createSignal(false);
  let filter: HTMLInputElement | undefined;

  const rows = createMemo(() => {
    const found = new Map((dataOf(statuses) ?? []).map((status) => [status.path, status]));
    return (dataOf(recents) ?? []).map((recent): RecentRow => ({ recent, status: found.get(recent.path) }));
  });
  const visible = createMemo(() => filterRecents(rows(), query()));
  const now = Math.floor(Date.now() / 1000);

  onMount(() => {
    filter?.focus();
    const unlisten = client.onFolderDrop((paths) => {
      setDropping(false);
      const first = paths[0];
      if (first !== undefined) void app.openRepository(first);
    });
    onCleanup(() => void unlisten.then((stop) => stop()));
  });

  const openFolder = async () => {
    const picked = await client.pickFolder("Open a repository");
    if (picked !== undefined) await app.openRepository(picked);
  };

  const remove = async (path: string) => {
    await removeRecent.mutateAsync(path);
  };

  const locate = async (path: string) => {
    const picked = await client.pickFolder(`Locate ${basename(path)}`);
    if (picked === undefined) return;
    if (await app.openRepository(picked)) await remove(path);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const count = visible().length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => (count === 0 ? 0 : (current + (event.key === "ArrowDown" ? 1 : -1) + count) % count));
    } else if (event.key === "Enter") {
      const row = visible()[highlight()];
      if (row !== undefined && statusChips(row.status).missing === false) {
        event.preventDefault();
        void app.openRepository(row.recent.path);
      }
    }
  };

  return (
    <main
      class="launcher"
      classList={{ dropping: dropping() }}
      onDragEnter={() => setDropping(true)}
      onDragLeave={() => setDropping(false)}
    >
      <div class="launcher-box panel">
        <h1 class="launcher-logo">
          <Mark size={72} />
          <span class="sr-only">YForge</span>
        </h1>
        <div class="launcher-actions">
          <button type="button" class="btn primary" onClick={() => void openFolder()}>
            <Icon name="folder" />
            Open…
          </button>
          <button type="button" class="btn" onClick={() => app.setEntryDialog("clone")}>
            <Icon name="remote" />
            Clone…
          </button>
          <button type="button" class="btn" onClick={() => app.setEntryDialog("create")}>
            <Icon name="plus" />
            Create…
          </button>
        </div>
        <div class="dropzone" role="group" aria-label="Drop a folder to open it">
          <Icon name="folder" />
          Drop a folder to open it
        </div>
        <div class="recents-head">
          <h3>Recent</h3>
          <label class="input">
            <Icon name="search" />
            <input
              type="text"
              ref={filter}
              placeholder="Filter recent repositories"
              aria-label="Filter recent repositories"
              value={query()}
              onInput={(event) => {
                setQuery(event.currentTarget.value);
                setHighlight(0);
              }}
              onKeyDown={onKeyDown}
            />
          </label>
        </div>
        <Show
          when={rows().length > 0 || recents.isPending}
          fallback={<p class="recents-empty">No recent repositories. Open a folder, clone a URL, or create a new repository.</p>}
        >
          <ul class="recents" role="listbox" aria-label="Recent repositories">
            <For each={visible()} fallback={<li class="recents-empty">No recent repository matches “{query()}”.</li>}>
              {(row, index) => {
                const chips = () => statusChips(row.status);
                return (
                  <li
                    class="recent"
                    classList={{ sel: highlight() === index(), missing: chips().missing }}
                    role="option"
                    aria-selected={highlight() === index()}
                    onMouseEnter={() => setHighlight(index())}
                  >
                    <button
                      type="button"
                      class="recent-main"
                      disabled={chips().missing}
                      onClick={() => void app.openRepository(row.recent.path)}
                    >
                      <span class="recent-name">{basename(row.recent.path)}</span>
                      <span class="recent-meta">
                        <span class="ref">{chips().branch}</span>
                        <Show when={chips().sync}>
                          <span class="ahead">{chips().sync}</span>
                        </Show>
                        <Show when={chips().changes}>
                          <span>· {chips().changes}</span>
                        </Show>
                        <Show when={chips().worktrees}>
                          <span>· {chips().worktrees}</span>
                        </Show>
                      </span>
                      <span class="recent-path path-line" title={row.recent.path}>
                        <bdi dir="ltr">{displayPath(row.recent.path, dataOf(home))}</bdi>
                      </span>
                    </button>
                    <span class="recent-age" title={new Date(row.recent.opened_at * 1000).toLocaleString()}>
                      {openedAgo(row.recent.opened_at, now)}
                    </span>
                    <span class="recent-acts">
                      <Show
                        when={chips().missing}
                        fallback={
                          <>
                            <button
                              type="button"
                              class="icon-btn dense"
                              {...tip("Reveal in Finder", undefined, `Reveal ${basename(row.recent.path)} in Finder`)}
                              onClick={() => void client.openPath(row.recent.path, "finder")}
                            >
                              <Icon name="folder" />
                            </button>
                            <button
                              type="button"
                              class="icon-btn dense"
                              {...tip("Open in terminal", undefined, `Open ${basename(row.recent.path)} in terminal`)}
                              onClick={() => void client.openPath(row.recent.path, "terminal")}
                            >
                              <Icon name="terminal" />
                            </button>
                          </>
                        }
                      >
                        <button type="button" class="btn sm" onClick={() => void locate(row.recent.path)}>
                          Locate…
                        </button>
                      </Show>
                      <button
                        type="button"
                        class="icon-btn dense"
                        {...tip("Remove from recents; files stay untouched", undefined, `Remove ${basename(row.recent.path)} from recents`)}
                        onClick={() => void remove(row.recent.path)}
                      >
                        <Icon name="close" />
                      </button>
                    </span>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </div>
    </main>
  );
}
