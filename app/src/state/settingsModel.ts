import type { AppSettings } from "../ipc/bindings/AppSettings";
import type { ConfigValue } from "../ipc/bindings/ConfigValue";
import type { PullMode } from "../ipc/bindings/PullMode";
import type { RepoSettings } from "../ipc/bindings/RepoSettings";
import { cloneUrlProblem } from "./launcher";
import { pullModes } from "./syncModel";

export const AUTO_FETCH_OPTIONS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 0, label: "Off" },
  { minutes: 5, label: "5 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 30, label: "30 min" },
];

export const defaultSettings: AppSettings = {
  theme: "system",
  density: "default",
  default_branch: "main",
  pull_mode: "fast_forward_or_merge",
  auto_fetch_minutes: 0,
  editor_command: "",
  terminal_command: "",
  telemetry_opt_in: false,
};

export const pullModeLabel = (mode: PullMode): string => pullModes.find((entry) => entry.mode === mode)?.label.replace(/^Pull: /, "") ?? mode;

export function effectivePullMode(app: AppSettings, repo: RepoSettings | undefined): { mode: PullMode; source: "repository" | "default" } {
  const override = repo?.pull_mode;
  return override === null || override === undefined ? { mode: app.pull_mode, source: "default" } : { mode: override, source: "repository" };
}

export function sourceLabel(value: ConfigValue): string {
  switch (value.source) {
    case "repository":
      return "from repository config";
    case "global":
      return "from global config";
    case "system":
      return "from system config";
    case "other":
      return "from the environment";
    case "unset":
      return "not set";
  }
}

export function remoteProblem(name: string, url: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter a remote name";
  if (/[\s/]/.test(trimmed)) return "A remote name cannot contain spaces or slashes";
  return cloneUrlProblem(url);
}

export function resolveTheme(theme: AppSettings["theme"], prefersLight: boolean): "light" | "dark" {
  return theme === "system" ? (prefersLight ? "light" : "dark") : theme;
}

export function applyAppearance(root: HTMLElement, settings: Pick<AppSettings, "theme" | "density">, prefersLight: boolean): void {
  root.dataset.theme = resolveTheme(settings.theme, prefersLight);
  root.dataset.density = settings.density;
}

export function settingsChanged(left: AppSettings, right: AppSettings): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}
