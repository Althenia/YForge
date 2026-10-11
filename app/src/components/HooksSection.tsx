import { createSignal, For, Show } from "solid-js";
import type { HookEntry } from "../ipc/bindings/HookEntry";
import type { HookMode } from "../ipc/bindings/HookMode";
import { client } from "../ipc/client";
import { useApp } from "../state/app";
import { failureNotice } from "../state/errorNotice";
import { hookConfirmCopy, hookRowLabel, hookStateWord, hooksDirectoryLabel, runVerb } from "../state/hooks";
import { repoKeys } from "../state/queryKeys";
import { useQuery } from "../state/query";
import type { Anchor, MenuState } from "../state/repoActions";
import { countLabel, matchesFilter } from "../state/sidebarModel";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu } from "./ContextMenu";
import { HookSheet, type HookSheetRequest } from "./HookSheet";
import { Icon } from "./Icon";
import { tip } from "./Tooltip";

type Pending = { hook: HookEntry; mode: HookMode };

const messageOf = failureNotice;

export function HooksSection(props: { root: string; expanded: boolean; onToggle: () => void; filter: string; commitMessage: () => string }) {
  const app = useApp();
  const list = useQuery(() => ({ queryKey: repoKeys.read(props.root, "hooks"), queryFn: () => client.hooksList(props.root) }));
  const [menu, setMenu] = createSignal<MenuState | undefined>();
  const [pending, setPending] = createSignal<Pending | undefined>();
  const [sheet, setSheet] = createSignal<HookSheetRequest | undefined>();
  const rows = () => list.data?.hooks ?? [];
  const visible = () => rows().filter((hook) => matchesFilter(props.filter, hook.name, hookStateWord(hook), hook.reason ?? ""));
  const refresh = () => app.queryClient.invalidateQueries({ queryKey: repoKeys.read(props.root, "hooks") });

  const view = (hook: HookEntry) => setSheet({ hook });

  const launch = (hook: HookEntry, mode: HookMode) => setSheet({ hook, run: { mode, message: props.commitMessage() } });

  const request = (hook: HookEntry, mode: HookMode) => {
    if (hook.reason !== null) return;
    if (hook.approved) launch(hook, mode);
    else setPending({ hook, mode });
  };

  const approve = async (target: Pending) => {
    setPending(undefined);
    try {
      await client.hookApprove(props.root, target.hook.name);
      await refresh();
      launch({ ...target.hook, approved: true }, target.mode);
    } catch (failure) {
      app.setNotice(messageOf(failure));
    }
  };

  const openMenu = (hook: HookEntry, anchor: Anchor) =>
    setMenu({
      anchor,
      entries: [
        { kind: "item", id: "view", label: ["View"], icon: "file" },
        { kind: "item", id: "run", label: ["Run"], icon: "terminal", ...(hook.reason === null ? {} : { disabledReason: hook.reason }) },
        { kind: "item", id: "test", label: ["Test"], icon: "check", ...(hook.reason === null ? {} : { disabledReason: hook.reason }) },
      ],
      run: (id) => {
        setMenu(undefined);
        if (id === "view") view(hook);
        else if (id === "run") request(hook, "run");
        else if (id === "test") request(hook, "test");
      },
    });

  const control = (hook: HookEntry, mode: HookMode, icon: "terminal" | "check") => {
    const reason = hook.reason ?? undefined;
    const label = runVerb(mode);
    return (
      <button
        type="button"
        class="icon-btn dense"
        tabindex="-1"
        aria-disabled={reason !== undefined}
        {...tip(reason ?? label, undefined, `${label} ${hook.name}`)}
        onClick={(event) => {
          event.stopPropagation();
          request(hook, mode);
        }}
      >
        <Icon name={icon} size={14} />
      </button>
    );
  };

  return (
    <section aria-label="Hooks">
      <div class="sec">
        <button type="button" class="sec-title" aria-expanded={props.expanded} onClick={() => props.onToggle()}>
          <Icon name="plug" />
          Hooks
          <span class="sec-chevron" classList={{ collapsed: !props.expanded }}>
            <Icon name="chevron" size={14} />
          </span>
        </button>
        <Show when={list.data}>
          {(data) => (
            <span class="sec-note" title={data().directory} aria-label={`Hooks directory ${data().directory}`}>
              {hooksDirectoryLabel(data().directory, props.root)}
            </span>
          )}
        </Show>
        <Show when={list.isSuccess}>
          <span class="count">{countLabel(rows().length, visible().length, props.filter !== "")}</span>
        </Show>
      </div>
      <Show when={props.expanded}>
        <Show when={list.isError}>
          <p class="submod-note">Hooks could not be loaded.</p>
        </Show>
        <Show when={list.isSuccess && rows().length === 0}>
          <p class="submod-note">No hooks</p>
        </Show>
        <For each={visible()}>
          {(hook) => (
            <div
              class="srow hook"
              role="button"
              tabindex="0"
              aria-haspopup="menu"
              data-nav={`hook:${hook.name}`}
              aria-label={hookRowLabel(hook)}
              title={hook.reason === null ? hook.path : `${hook.path} · ${hook.reason}`}
              style={{ "padding-left": "calc(var(--spacing-3) + var(--spacing-1-5))" }}
              onClick={() => view(hook)}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu(hook, { left: event.clientX, top: event.clientY });
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openMenu(hook, { left: rect.left, top: rect.bottom });
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  view(hook);
                }
              }}
            >
              <span class="tree-guide" data-level="0" style={{ "--level": 0 }} aria-hidden="true" />
              <span class="name">{hook.name}</span>
              <span class="meta">
                {hookStateWord(hook)}
              </span>
              <span class="acts">
                <button
                  type="button"
                  class="icon-btn dense"
                  tabindex="-1"
                  {...tip("View", undefined, `View ${hook.name}`)}
                  onClick={(event) => {
                    event.stopPropagation();
                    view(hook);
                  }}
                >
                  <Icon name="file" size={14} />
                </button>
                {control(hook, "run", "terminal")}
                {control(hook, "test", "check")}
              </span>
            </div>
          )}
        </For>
      </Show>
      <Show when={menu()} keyed>
        {(state) => <ContextMenu menu={state} onClose={() => setMenu(undefined)} />}
      </Show>
      <Show when={pending()} keyed>
        {(target) => <ConfirmDialog copy={hookConfirmCopy(target.hook, target.mode)} onCancel={() => setPending(undefined)} onConfirm={() => void approve(target)} />}
      </Show>
      <Show when={sheet()} keyed>
        {(request) => <HookSheet root={props.root} request={request} onClose={() => setSheet(undefined)} />}
      </Show>
    </section>
  );
}
