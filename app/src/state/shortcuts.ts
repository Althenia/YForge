export const SHORTCUTS = {
  palette: "⌘K",
  search: "⌘F",
  commit: "⌘↵",
  undo: "⌘Z",
  redo: "⌘⇧Z",
  createBranch: "⌘B",
  stash: "⌘⇧S",
  fetch: "⌘⇧F",
  pull: "⌘⇧L",
  push: "⌘⇧P",
  revealHead: "⌘⇧H",
  newTab: "⌘T",
  closeTab: "⌘W",
  reopenClosedTab: "⌘⇧T",
  nextTab: "⌃⇥",
  previousTab: "⌃⇧⇥",
  openRepository: "⌘O",
  openRepoSearch: "⌘⇧O",
  openInEditor: "⌘⇧E",
  cloneRepository: "⌘⇧C",
  createRepository: "⌘N",
  settings: "⌘,",
  activity: "⌘⇧Y",
  zoomIn: "⌘=",
  zoomOut: "⌘-",
  zoomReset: "⌘0",
  toggleSidebar: "⌘\\",
  toggleInspector: "⌥⌘\\",
} as const;

export type ShortcutKey = keyof typeof SHORTCUTS;

export type ShortcutGroup = { group: string; entries: ReadonlyArray<{ key: ShortcutKey; title: string }> };

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    group: "Application",
    entries: [
      { key: "palette", title: "Command palette" },
      { key: "settings", title: "Settings" },
      { key: "activity", title: "Activity drawer" },
      { key: "openRepository", title: "Open repository" },
      { key: "cloneRepository", title: "Clone repository" },
      { key: "createRepository", title: "Create repository" },
    ],
  },
  {
    group: "Tabs",
    entries: [
      { key: "newTab", title: "New tab" },
      { key: "closeTab", title: "Close tab" },
      { key: "reopenClosedTab", title: "Reopen closed tab" },
      { key: "nextTab", title: "Show next tab" },
      { key: "previousTab", title: "Show previous tab" },
    ],
  },
  {
    group: "Repository",
    entries: [
      { key: "openRepoSearch", title: "Open repository search" },
      { key: "openInEditor", title: "Open in external editor" },
      { key: "search", title: "Search commits" },
      { key: "revealHead", title: "Reveal HEAD" },
      { key: "commit", title: "Commit staged changes" },
      { key: "createBranch", title: "Create branch" },
      { key: "stash", title: "Stash changes" },
    ],
  },
  {
    group: "Sync",
    entries: [
      { key: "fetch", title: "Fetch all" },
      { key: "pull", title: "Pull" },
      { key: "push", title: "Push" },
    ],
  },
  {
    group: "Edit",
    entries: [
      { key: "undo", title: "Undo" },
      { key: "redo", title: "Redo" },
    ],
  },
  {
    group: "View",
    entries: [
      { key: "zoomIn", title: "Zoom in" },
      { key: "zoomOut", title: "Zoom out" },
      { key: "zoomReset", title: "Reset zoom" },
      { key: "toggleSidebar", title: "Toggle sidebar" },
      { key: "toggleInspector", title: "Toggle inspector" },
    ],
  },
];
