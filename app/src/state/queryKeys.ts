import type { DiffTarget } from "./diffModel";

export const appKeys = {
  recents: ["recents"] as const,
  home: ["home"] as const,
  info: ["app-info"] as const,
  identity: ["identity"] as const,
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
  graph: (path: string, page: number) => ["repo", path, "graph", page] as const,
  graphPages: (path: string) => ["repo", path, "graph"] as const,
  diff: (path: string, target: DiffTarget) => ["repo", path, "diff", target] as const,
  commit: (path: string, sha: string) => ["repo", path, "commit", sha] as const,
  commitChoices: (path: string) => ["repo", path, "commit-choices"] as const,
  conflict: (path: string, file: string) => ["conflict", path, file] as const,
  search: (path: string, query: string) => ["repo", path, "search", query] as const,
  paletteOptions: (path: string, command: string, step: number) => ["repo", path, "palette", command, step] as const,
  read: (path: string, ...parts: string[]) => ["repo", path, "read", ...parts] as const,
  settings: (path: string) => ["repo-settings", path] as const,
  remotes: (path: string) => ["repo", path, "remotes"] as const,
  identity: (path: string) => ["repo", path, "identity"] as const,
};
