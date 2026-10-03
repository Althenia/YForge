import { useQuery } from "../state/query";
import { createEffect, createMemo, createSignal, createUniqueId, For, on, onCleanup, onMount, Show } from "solid-js";
import type { IconName } from "../iconNames";
import {
  buildCommands,
  commandIcon,
  NAVIGATION_HINTS,
  navigationTargets,
  parseQuery,
  rank,
  REPOSITORY_SCOPE_CHIP,
  REPOSITORY_SCOPE_PLACEHOLDER,
  repositoryChoices,
  type PaletteCommand,
  type PaletteContext,
  type PickerOption,
} from "../state/palette";
import { useApp } from "../state/app";
import { rememberCommand } from "../state/appUiPrefs";
import { appKeys, repoKeys } from "../state/queryKeys";
import { client } from "../ipc/client";
import { Icon } from "./Icon";
import { listRowHeight, VirtualRows } from "./VirtualRows";

type Item = { key: string; label: string; icon?: IconName; note?: string; group?: string; shortcut?: string; disabledReason?: string; positions: number[]; choose: () => void };

function Highlighted(props: { text: string; positions: number[] }) {
  const parts = () => [...props.text].map((char, index) => ({ char, on: props.positions.includes(index) }));
  return (
    <span class="pal-label">
      <For each={parts()}>{(part) => (part.on ? <mark>{part.char}</mark> : <>{part.char}</>)}</For>
    </span>
  );
}

const headLabel = (context: PaletteContext): string | undefined => {
  const head = context.snapshot?.head;
  if (head === undefined) return undefined;
  return head.kind === "branch" ? head.name : head.kind === "unborn" ? head.branch : head.sha.slice(0, 7);
};

export function CommandPalette(props: { context: PaletteContext; scope?: "repositories"; onClose: () => void }) {
  const listId = createUniqueId();
  const [query, setQuery] = createSignal("");
  const [scoped, setScoped] = createSignal(props.scope === "repositories");
  const [pending, setPending] = createSignal<{ command: PaletteCommand; values: string[] } | undefined>();
  const [highlight, setHighlight] = createSignal(0);
  const app = useApp();
  const recent = () => app.uiPrefs.prefs().palette_recents;
  app.uiPrefs.ensure();
  const opener = document.activeElement;
  let input: HTMLInputElement | undefined;
  let scroller: HTMLDivElement | undefined;
  const [reveal, setReveal] = createSignal<{ nonce: number; index: number } | undefined>();

  const commands = createMemo(() => buildCommands(props.context));
  const parsed = createMemo(() => parseQuery(query()));
  const wantsCommits = () => pending() === undefined && parsed().mode === "#";
  const scope = () => props.context.snapshot?.root ?? "";
  const choices = useQuery(() => ({
    queryKey: repoKeys.commitChoices(scope()),
    queryFn: () => props.context.loadCommits(),
    enabled: wantsCommits(),
    gcTime: 0,
  }));
  const step = () => pending()?.command.args[pending()?.values.length ?? 0];
  const textStep = () => step()?.text === true;
  const options = useQuery(() => ({
    queryKey: repoKeys.paletteOptions(scope(), pending()?.command.id ?? "", pending()?.values.length ?? 0),
    queryFn: async () => (await step()?.options()) ?? [],
    enabled: step() !== undefined && !textStep(),
    gcTime: 0,
  }));
  const managed = useQuery(() => ({ queryKey: appKeys.repositories, queryFn: () => client.repositoriesList(), enabled: scoped() }));

  const finish = (command: PaletteCommand, values: string[]) => {
    app.uiPrefs.update((prefs) => rememberCommand(prefs, command.id));
    props.onClose();
    queueMicrotask(() => command.run(values));
  };

  const choose = (command: PaletteCommand) => {
    if (command.args.length > 0) {
      setPending({ command, values: [] });
      setQuery("");
      setHighlight(0);
    } else finish(command, []);
  };

  const pick = (option: PickerOption) => {
    const current = pending();
    if (current === undefined) return;
    const values = [...current.values, option.value];
    if (values.length >= current.command.args.length) finish(current.command, values);
    else {
      setPending({ command: current.command, values });
      setQuery("");
      setHighlight(0);
    }
  };

  const items = createMemo<Item[]>(() => {
    const current = pending();
    if (current !== undefined && textStep()) return [];
    if (current === undefined && scoped()) {
      const choices = repositoryChoices(props.context.app, managed.data?.repos.map((repo) => repo.path) ?? []);
      return rank(choices, query(), (choice) => `${choice.path} ${choice.alias ?? ""}`).map(({ item, match }) => ({
        key: item.path,
        label: item.path,
        icon: "folder" as const,
        ...(item.alias === undefined ? {} : { note: item.alias }),
        positions: match.positions.filter((position) => position < item.path.length),
        choose: () => {
          props.onClose();
          queueMicrotask(() => props.context.app.openRepository(item.path));
        },
      }));
    }
    if (current !== undefined) {
      return rank(options.data ?? [], query(), (option) => `${option.label} ${option.note ?? ""}`).map(({ item, match }) => ({
        key: item.value,
        label: item.label,
        ...(item.note === undefined ? {} : { note: item.note }),
        ...(item.disabledReason === undefined ? {} : { disabledReason: item.disabledReason }),
        positions: match.positions.filter((position) => position < item.label.length),
        choose: () => pick(item),
      }));
    }
    const { mode, text } = parsed();
    const targets = navigationTargets(props.context, choices.data ?? []);
    const asItem = (command: PaletteCommand, positions: number[]): Item => {
      const icon = commandIcon(command.id);
      return {
        key: command.id,
        label: command.title,
        ...(icon === undefined ? {} : { icon }),
        group: command.group,
        ...(command.note === undefined ? {} : { note: command.note }),
        ...(command.shortcut === undefined ? {} : { shortcut: command.shortcut }),
        ...(command.disabledReason === undefined ? {} : { disabledReason: command.disabledReason }),
        positions,
        choose: () => choose(command),
      };
    };
    const ranked = (list: PaletteCommand[]) => rank(list, text, (command) => command.title, recent(), (command) => command.id).map(({ item, match }) => asItem(item, match.positions));
    if (mode === undefined) {
      const found = ranked(commands());
      const extra = text.trim() === "" ? [] : ranked(targets.filter((target) => target.mode !== "#"));
      return [...found, ...extra];
    }
    if (mode === ">") return ranked(commands());
    return ranked(targets.filter((target) => target.mode === mode));
  });

  createEffect(() => {
    items();
    setHighlight((current) => Math.min(current, Math.max(items().length - 1, 0)));
  });

  const onKeyDown = (event: KeyboardEvent) => {
    const list = items();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => (list.length === 0 ? 0 : (current + (event.key === "ArrowDown" ? 1 : -1) + list.length) % list.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const typed = query().trim();
      if (textStep() && typed !== "") {
        pick({ value: typed, label: typed });
        return;
      }
      const item = list[highlight()];
      if (item !== undefined && item.disabledReason === undefined) item.choose();
    } else if (event.key === "Tab") {
      event.preventDefault();
      const item = list[highlight()];
      const command = pending() === undefined ? commands().find((candidate) => candidate.id === item?.key) : undefined;
      if (command !== undefined && command.args.length > 0 && command.disabledReason === undefined) choose(command);
    } else if (event.key === "Backspace" && query() === "" && pending() === undefined && scoped()) {
      event.preventDefault();
      setScoped(false);
      setHighlight(0);
    } else if (event.key === "Backspace" && query() === "" && pending() !== undefined) {
      event.preventDefault();
      const current = pending();
      if (current === undefined) return;
      setPending(current.values.length > 0 ? { command: current.command, values: current.values.slice(0, -1) } : undefined);
      setHighlight(0);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (query() !== "" && !scoped()) setQuery("");
      else props.onClose();
    }
  };

  onMount(() => {
    input?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".palette") === null) props.onClose();
    };
    document.addEventListener("pointerdown", dismiss, true);
    onCleanup(() => {
      document.removeEventListener("pointerdown", dismiss, true);
      if (opener instanceof HTMLElement) opener.focus();
    });
  });

  createEffect(on(highlight, (index) => setReveal((current) => ({ nonce: (current?.nonce ?? 0) + 1, index })), { defer: true }));

  const placeholder = () => {
    if (pending() !== undefined) return step()?.label ?? "";
    return scoped() ? REPOSITORY_SCOPE_PLACEHOLDER : "Type a command, or > actions · @ branches · # commits · : settings · / repositories";
  };
  const chipValue = (command: PaletteCommand, index: number, value: string) => (command.args[index]?.text === true ? value : value.includes(":") ? value.slice(value.indexOf(":") + 1) : value.slice(0, 7));

  return (
    <div class="palette-scrim">
      <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div class="palette-field">
          <Show when={pending()}>
            {(current) => (
              <span class="pal-chips">
                <span class="pal-chip">{current().command.title.replace(/…$/, "")}</span>
                <For each={current().values}>{(value, index) => <span class="pal-chip value">{chipValue(current().command, index(), value)}</span>}</For>
              </span>
            )}
          </Show>
          <Show when={pending() === undefined && scoped()}>
            <span class="pal-chips">
              <span class="pal-chip scope">
                {REPOSITORY_SCOPE_CHIP}
                <button type="button" class="pal-chip-remove" aria-label="Remove the Open repo filter" onClick={() => setScoped(false)}>
                  <Icon name="close" size={14} />
                </button>
              </span>
            </span>
          </Show>
          <input
            type="text"
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items().length === 0 ? undefined : `${listId}-${highlight()}`}
            aria-label="Command"
            placeholder={placeholder()}
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setHighlight(0);
            }}
          />
        </div>
        <div class="pal-list" ref={scroller}>
          <Show
            when={items().length > 0}
            fallback={
              <ul class="pal-rows" id={listId} role="listbox">
                <li class="pal-empty">{textStep() ? `Type the ${(step()?.label ?? "").toLowerCase()}, then press Enter` : options.isLoading || choices.isLoading ? "Loading…" : "No matches"}</li>
              </ul>
            }
          >
            <VirtualRows as="ul" class="pal-rows" attrs={{ id: listId, role: "listbox" }} items={items()} scroller={() => scroller} estimate={listRowHeight()} keepIndex={highlight()} reveal={reveal()} measured>
              {(item, row) => (
                <li
                  id={`${listId}-${row.index}`}
                  role="option"
                  class="pal-item"
                  classList={{ sel: highlight() === row.index, disabled: item.disabledReason !== undefined }}
                  aria-selected={highlight() === row.index}
                  aria-disabled={item.disabledReason === undefined ? undefined : "true"}
                  ref={row.measure}
                  style={row.style}
                  onMouseMove={() => setHighlight(row.index)}
                  onClick={() => item.disabledReason === undefined && item.choose()}
                >
                  <span class="pal-icon" aria-hidden="true">
                    <Show when={item.icon}>{(name) => <Icon name={name()} />}</Show>
                  </span>
                  <Highlighted text={item.label} positions={item.positions} />
                  <Show when={item.note}>{(note) => <span class="pal-note">{note()}</span>}</Show>
                  <Show when={item.disabledReason}>{(reason) => <span class="pal-reason">{reason()}</span>}</Show>
                  <Show when={item.shortcut}>{(shortcut) => <span class="kbd">{shortcut()}</span>}</Show>
                </li>
              )}
            </VirtualRows>
          </Show>
        </div>
        <div class="pal-foot">
          <span>
            <Show when={headLabel(props.context)} fallback="No repository open">
              {(label) => (
                <>
                  Current branch: <span class="ref">{label()}</span>
                </>
              )}
            </Show>
          </span>
          <span class="pal-keys">
            <For each={NAVIGATION_HINTS}>{(hint) => <span title={hint.label}><span class="kbd">{hint.prefix}</span> {hint.label}</span>}</For>
            <span>↑↓ move</span>
            <span>↵ run</span>
            <span>⇥ argument</span>
            <span>esc close</span>
          </span>
        </div>
      </div>
    </div>
  );
}
