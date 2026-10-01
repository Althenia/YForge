import { createSignal, For, Show, type JSX } from "solid-js";
import { basename } from "../format";
import type { TabGroupColor } from "../ipc/bindings/TabGroupColor";
import { useApp, type ClosePlan } from "../state/app";
import { closeGroupCopy, closeTabsCopy } from "../state/confirmCopy";
import type { MenuEntry } from "../state/refMenu";
import type { Anchor, MenuState } from "../state/repoActions";
import { tabMenuEntries, type TabMenuAction } from "../state/tabMenu";
import { ALIAS_LIMIT, aliasProblem, groupNameProblem, GROUP_NAME_LIMIT, repoName, type UserGroup } from "../state/tabs";
import { ConfirmDialog } from "./ConfirmDialog";
import { ContextMenu } from "./ContextMenu";
import { Popover } from "./Popover";

export const GROUP_COLORS: readonly TabGroupColor[] = ["cyan", "blue", "purple", "magenta", "pink", "red", "orange", "yellow", "green", "mint"];

export const DEFAULT_GROUP_COLOR: TabGroupColor = "blue";

export const laneOf = (color: TabGroupColor): number => GROUP_COLORS.indexOf(color);

export const colorWord = (color: TabGroupColor): string => `${color.slice(0, 1).toUpperCase()}${color.slice(1)}`;

export const tabCountText = (count: number): string => `${count} ${count === 1 ? "tab" : "tabs"}`;

export type TabGroupOverlay =
  | { kind: "tab-menu"; path: string; anchor: Anchor }
  | { kind: "add-to-group"; path: string; anchor: Anchor }
  | { kind: "chip-menu"; group: number; anchor: Anchor }
  | { kind: "new-group"; path: string; anchor: Anchor }
  | { kind: "rename-group"; group: number; anchor: Anchor }
  | { kind: "group-color"; group: number; anchor: Anchor }
  | { kind: "close-group"; group: number }
  | { kind: "alias"; path: string; anchor: Anchor }
  | { kind: "close-tabs"; plan: ClosePlan };

export const anchorBelow = (element: HTMLElement): Anchor => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.bottom };
};

export const opensMenu = (event: KeyboardEvent): boolean => event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);

type Item = Extract<MenuEntry, { kind: "item" }>;

const item = (id: string, label: string, extra: Partial<Item> = {}): MenuEntry => ({ kind: "item", id, label: [label], ...extra });

function NameField(props: { value: string; onInput: (value: string) => void }) {
  return (
    <label class="input">
      <input
        type="text"
        aria-label="Group name"
        placeholder="Group name"
        autocomplete="off"
        spellcheck={false}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        ref={(element) => queueMicrotask(() => element.select())}
      />
    </label>
  );
}

function Swatches(props: { name: string; value: TabGroupColor; onChoose: (color: TabGroupColor) => void }) {
  return (
    <div class="swatches" role="radiogroup" aria-label="Group color">
      <For each={GROUP_COLORS}>
        {(color) => (
          <label class={`swatch lane-${laneOf(color)}`}>
            <input type="radio" class="sr-only" name={props.name} checked={props.value === color} onChange={() => props.onChoose(color)} />
            <i aria-hidden="true" />
            {colorWord(color)}
          </label>
        )}
      </For>
    </div>
  );
}

function GroupForm(props: { label: string; submit: string; note?: string; name: string; color?: TabGroupColor; anchor: Anchor; onClose: () => void; onSubmit: (name: string, color: TabGroupColor) => void }) {
  const [name, setName] = createSignal(props.name);
  const [color, setColor] = createSignal<TabGroupColor>(props.color ?? DEFAULT_GROUP_COLOR);
  const problem = () => groupNameProblem(name());
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (problem() === undefined) props.onSubmit(name(), color());
  };
  return (
    <Popover anchor={props.anchor} label={props.label} onClose={props.onClose}>
      <form class="popform" onSubmit={submit}>
        <h3>{props.label}</h3>
        <NameField value={name()} onInput={setName} />
        <Show when={props.color !== undefined}>
          <Swatches name="new-group-color" value={color()} onChoose={setColor} />
        </Show>
        <span class="reason">{props.note ?? `1 to ${GROUP_NAME_LIMIT} characters.`}</span>
        <div class="hrow">
          <button type="submit" class="btn primary" disabled={problem() !== undefined}>
            {props.submit}
          </button>
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <Show when={problem()}>{(text) => <span class="reason">{text()}</span>}</Show>
        </div>
      </form>
    </Popover>
  );
}

function AliasForm(props: { path: string; anchor: Anchor; onClose: () => void }) {
  const app = useApp();
  const current = repoName(props.path, app.aliases());
  const [name, setName] = createSignal(current);
  const [failure, setFailure] = createSignal<string | undefined>();
  const problem = () => aliasProblem(name());
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (problem() !== undefined) return;
    const refused = await app.setAlias(props.path, name().trim());
    if (refused === undefined) props.onClose();
    else setFailure(refused);
  };
  return (
    <Popover anchor={props.anchor} label={`Alias ${current}`} onClose={props.onClose}>
      <form class="popform" onSubmit={(event) => void submit(event)}>
        <h3>Alias repository</h3>
        <label class="field">
          <span class="field-label">
            Name shown for <span class="ref">{props.path}</span>
          </span>
          <span class="input">
            <input
              type="text"
              aria-label="Alias"
              autocomplete="off"
              spellcheck={false}
              value={name()}
              onInput={(event) => {
                setName(event.currentTarget.value);
                setFailure(undefined);
              }}
              ref={(element) => queueMicrotask(() => element.select())}
            />
          </span>
        </label>
        <span class="reason">1 to {ALIAS_LIMIT} characters. Shown on the tab, in Recent, and in the palette; the folder name stays in the tooltip.</span>
        <div class="hrow">
          <button type="submit" class="btn primary" disabled={problem() !== undefined}>
            Save alias
          </button>
          <button type="button" class="btn" onClick={props.onClose}>
            Cancel
          </button>
          <Show when={problem()}>{(text) => <span class="reason">{text()}</span>}</Show>
        </div>
        <Show when={failure()}>{(text) => <p class="field-note error" role="alert">{text()}</p>}</Show>
      </form>
    </Popover>
  );
}

export function TabGroupLayer(props: { overlay: TabGroupOverlay | undefined; onClose: () => void; onOpen: (overlay: TabGroupOverlay) => void }): JSX.Element {
  const app = useApp();
  const groups = (): UserGroup[] => app.tabs().groups;
  const groupAt = (index: number): UserGroup | undefined => groups()[index];
  const groupOfPath = (path: string): number => groups().findIndex((entry) => entry.tabs.includes(path));

  const tabMenu = (overlay: Extract<TabGroupOverlay, { kind: "tab-menu" }>): MenuState => ({
    anchor: overlay.anchor,
    entries: tabMenuEntries({
      groups: groups(),
      path: overlay.path,
      others: app.planClose("others", overlay.path).ids.length,
      right: app.planClose("right", overlay.path).ids.length,
      aliased: app.aliasOf(overlay.path) !== undefined,
      canReopen: app.canReopenClosedTab(),
    }),
    run: (id) => {
      const action = id as TabMenuAction;
      if (action === "close-tab") app.closeTabIds([overlay.path]);
      else if (action === "close-others" || action === "close-right") closeMany(action === "close-others" ? "others" : "right", overlay.path);
      else if (action === "new-group") props.onOpen({ kind: "new-group", path: overlay.path, anchor: overlay.anchor });
      else if (action === "add-to-group") props.onOpen({ kind: "add-to-group", path: overlay.path, anchor: overlay.anchor });
      else if (action === "remove-from-group") app.removeFromTabGroup(overlay.path);
      else if (action === "alias") props.onOpen({ kind: "alias", path: overlay.path, anchor: overlay.anchor });
      else if (action === "remove-alias") void app.setAlias(overlay.path, null).then((failure) => failure === undefined || app.setNotice(failure));
      else app.reopenClosedTab();
    },
  });

  const closeMany = (scope: "others" | "right", path: string) => {
    const plan = app.planClose(scope, path);
    if (plan.busy.length === 0) app.closeTabIds(plan.ids);
    else props.onOpen({ kind: "close-tabs", plan });
  };

  const addMenu = (overlay: Extract<TabGroupOverlay, { kind: "add-to-group" }>): MenuState => {
    const own = groupOfPath(overlay.path);
    return {
      anchor: overlay.anchor,
      title: ["Add to group"],
      entries: groups().flatMap((entry, index) => (index === own ? [] : [item(String(index), entry.name, { note: tabCountText(entry.tabs.length) })])),
      run: (id) => app.addToTabGroup(overlay.path, Number(id)),
    };
  };

  const chipMenu = (overlay: Extract<TabGroupOverlay, { kind: "chip-menu" }>, entry: UserGroup): MenuState => ({
    anchor: overlay.anchor,
    entries: [
      item("rename", "Rename…", { icon: "edit" }),
      item("color", "Color…", { note: colorWord(entry.color) }),
      item("ungroup", "Ungroup", { icon: "minus" }),
      { kind: "separator" },
      item("close", "Close group…", { icon: "trash", danger: true }),
    ],
    run: (id) => {
      if (id === "rename") props.onOpen({ kind: "rename-group", group: overlay.group, anchor: overlay.anchor });
      else if (id === "color") props.onOpen({ kind: "group-color", group: overlay.group, anchor: overlay.anchor });
      else if (id === "ungroup") app.ungroupTabs(overlay.group);
      else props.onOpen({ kind: "close-group", group: overlay.group });
    },
  });

  const body = (overlay: TabGroupOverlay): JSX.Element => {
    switch (overlay.kind) {
      case "tab-menu":
        return <ContextMenu menu={tabMenu(overlay)} onClose={props.onClose} />;
      case "add-to-group":
        return <ContextMenu menu={addMenu(overlay)} onClose={props.onClose} />;
      case "chip-menu":
        return <Show when={groupAt(overlay.group)}>{(entry) => <ContextMenu menu={chipMenu(overlay, entry())} onClose={props.onClose} />}</Show>;
      case "new-group":
        return (
          <GroupForm
            label="New tab group"
            submit="Create group"
            note={`1 to ${GROUP_NAME_LIMIT} characters. ${basename(overlay.path)} is added to the group.`}
            name=""
            color={DEFAULT_GROUP_COLOR}
            anchor={overlay.anchor}
            onClose={props.onClose}
            onSubmit={(name, color) => {
              props.onClose();
              app.newTabGroup(overlay.path, name, color);
            }}
          />
        );
      case "rename-group":
        return (
          <Show when={groupAt(overlay.group)}>
            {(entry) => (
              <GroupForm
                label="Rename group"
                submit="Rename"
                name={entry().name}
                anchor={overlay.anchor}
                onClose={props.onClose}
                onSubmit={(name) => {
                  props.onClose();
                  app.renameTabGroup(overlay.group, name);
                }}
              />
            )}
          </Show>
        );
      case "group-color":
        return (
          <Show when={groupAt(overlay.group)}>
            {(entry) => (
              <Popover anchor={overlay.anchor} label="Group color" onClose={props.onClose}>
                <div class="popform">
                  <h3>{entry().name}</h3>
                  <Swatches
                    name="group-color"
                    value={entry().color}
                    onChoose={(color) => {
                      props.onClose();
                      app.recolorTabGroup(overlay.group, color);
                    }}
                  />
                </div>
              </Popover>
            )}
          </Show>
        );
      case "alias":
        return <AliasForm path={overlay.path} anchor={overlay.anchor} onClose={props.onClose} />;
      case "close-tabs":
        return (
          <ConfirmDialog
            copy={closeTabsCopy(overlay.plan.ids.length, overlay.plan.busy.map((entry) => ({ name: repoName(entry.path, app.aliases()), operation: entry.operation })))}
            onCancel={props.onClose}
            onConfirm={() => {
              props.onClose();
              app.closeTabIds(overlay.plan.ids);
            }}
          />
        );
      case "close-group":
        return (
          <Show when={groupAt(overlay.group)}>
            {(entry) => (
              <ConfirmDialog
                copy={closeGroupCopy(entry().name, entry().tabs.map(basename))}
                onCancel={props.onClose}
                onConfirm={() => {
                  props.onClose();
                  app.closeTabGroup(overlay.group);
                }}
              />
            )}
          </Show>
        );
    }
  };

  return (
    <Show when={props.overlay} keyed>
      {body}
    </Show>
  );
}
