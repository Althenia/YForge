import type { DiffTarget } from "./diffModel";

export const appKeys = {
  recents: ["recents"] as const,
  home: ["home"] as const,
  info: ["app-info"] as const,
  identity: ["identity"] as const,
  uiPrefs: ["app-ui-prefs"] as const,
  sshKeys: ["ssh-keys"] as const,
};

export const gitHostKeys = {
  all: ["git-hosts"] as const,
  list: ["git-hosts", "list"] as const,
  identity: (url: string) => ["git-hosts", "identity", url] as const,
};

export const aiKeys = {
  providers: ["ai", "providers"] as const,
  features: ["ai", "features"] as const,
  models: (id: string) => ["ai", "models", id] as const,
};

export const platformKeys = {
  all: ["platform"] as const,
  connections: ["platform", "connections"] as const,
  match: (path: string) => ["platform", "match", path] as const,
  prs: (path: string, state: string) => ["platform", "prs", path, state] as const,
  prsOf: (path: string) => ["platform", "prs", path] as const,
  pr: (path: string, number: number) => ["platform", "pr", path, number] as const,
  prsDetailOf: (path: string) => ["platform", "pr", path] as const,
};

export const jiraKeys = {
  all: ["jira"] as const,
  connections: ["jira", "connections"] as const,
  issues: (id: string) => ["jira", "issues", id] as const,
  keys: (texts: readonly string[]) => ["jira", "keys", texts] as const,
  lookup: (keys: readonly string[]) => ["jira", "lookup", keys] as const,
};

export const launchpadKeys = {
  pulls: (id: string) => ["launchpad", "pulls", id] as const,
  wips: ["launchpad", "wips"] as const,
};

export const diagnosticsKeys = {
  crashes: ["diagnostics", "crashes"] as const,
  usage: ["diagnostics", "usage"] as const,
  history: (path: string) => ["activity-history", path] as const,
  allHistory: ["activity-history"] as const,
};

export const repoKeys = {
  all: (path: string) => ["repo", path] as const,
  snapshot: (path: string) => ["repo", path, "snapshot"] as const,
  graph: (path: string, page: number, visibility: string) => ["repo", path, "graph", visibility, page] as const,
  graphPages: (path: string) => ["repo", path, "graph"] as const,
  diff: (path: string, target: DiffTarget, ignoreWhitespace: boolean) => ["repo", path, "diff", target, { ignoreWhitespace }] as const,
  fileAt: (path: string, rev: string, file: string) => ["repo", path, "file", rev, file] as const,
  commit: (path: string, sha: string) => ["repo", path, "commit", sha] as const,
  stash: (path: string, sha: string) => ["repo", path, "stash", sha] as const,
  commitChoices: (path: string) => ["repo", path, "commit-choices"] as const,
  conflict: (path: string, file: string) => ["conflict", path, file] as const,
  search: (path: string, query: string, visibility: string) => ["repo", path, "search", visibility, query] as const,
  paletteOptions: (path: string, command: string, step: number) => ["repo", path, "palette", command, step] as const,
  read: (path: string, ...parts: string[]) => ["repo", path, "read", ...parts] as const,
  settings: (path: string) => ["repo-settings", path] as const,
  uiPrefs: (path: string) => ["repo-ui-prefs", path] as const,
  remotes: (path: string) => ["repo", path, "remotes"] as const,
  worktrees: (path: string) => ["repo", path, "worktrees"] as const,
  submodules: (path: string) => ["repo", path, "submodules"] as const,
  reflogRefs: (path: string) => ["repo", path, "reflog-refs"] as const,
  reflog: (path: string, reference: string) => ["repo", path, "reflog", reference] as const,
  snapshots: (path: string) => ["repo", path, "snapshots"] as const,
  snapshotFiles: (path: string, reference: string) => ["repo", path, "snapshot-files", reference] as const,
  identity: (path: string) => ["repo", path, "identity"] as const,
};

export const historyKeys = {
  baseChoices: (path: string) => ["history", path, "base-choices"] as const,
  rebase: (path: string, base: string) => ["history", path, "rebase", base] as const,
  recompose: (path: string, base: string) => ["history", path, "recompose", base] as const,
  squash: (path: string, shas: readonly string[]) => ["history", path, "squash", ...shas] as const,
};
