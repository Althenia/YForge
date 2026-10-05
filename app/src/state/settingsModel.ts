import type { AppSettings } from "../ipc/bindings/AppSettings";
import type { ConfigValue } from "../ipc/bindings/ConfigValue";
import type { PullMode } from "../ipc/bindings/PullMode";
import type { RepoSettings } from "../ipc/bindings/RepoSettings";
import type { SigningFormat } from "../ipc/bindings/SigningFormat";
import type { SigningKey } from "../ipc/bindings/SigningKey";
import type { ToolEntry } from "../ipc/bindings/ToolEntry";
import type { ToolsDetected } from "../ipc/bindings/ToolsDetected";
import { cloneUrlProblem } from "./entryForms";
import { pullModes } from "./syncModel";

export const AUTO_FETCH_OPTIONS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 0, label: "Off" },
  { minutes: 5, label: "5 min" },
  { minutes: 10, label: "10 min" },
  { minutes: 30, label: "30 min" },
];

export const THEME_OPTIONS: ReadonlyArray<{ value: AppSettings["theme"]; label: string }> = [
  { value: "system", label: "System" },
  { value: "dark", label: "YForge Dark" },
  { value: "light", label: "YForge Light" },
  { value: "classic", label: "Classic Dark" },
  { value: "ocean", label: "Ocean" },
  { value: "eighties", label: "Eighties" },
  { value: "gruvbox", label: "Gruvbox" },
  { value: "nord", label: "Nord" },
  { value: "dracula", label: "Dracula" },
  { value: "monokai", label: "Monokai" },
  { value: "woodland", label: "Woodland" },
];

export const defaultSettings: AppSettings = {
  theme: "system",
  density: "default",
  default_branch: "main",
  pull_mode: "fast_forward_or_merge",
  auto_fetch_minutes: 0,
  editor_command: "",
  language_servers: {},
  terminal_command: "",
  telemetry_opt_in: false,
    gravatar_avatars: true,
  ssh_key_path: null,
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

export function resolveTheme(theme: AppSettings["theme"], prefersLight: boolean): Exclude<AppSettings["theme"], "system"> {
  return theme === "system" ? (prefersLight ? "light" : "dark") : theme;
}

export function applyAppearance(root: HTMLElement, settings: Pick<AppSettings, "theme" | "density">, prefersLight: boolean): void {
  root.dataset.theme = resolveTheme(settings.theme, prefersLight);
  root.dataset.density = settings.density;
}

export function settingsChanged(left: AppSettings, right: AppSettings): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

export const SSH_AGENT_LABEL = "ssh-agent (default)";

export const sshKeyLabel = (path: string | null | undefined, keys: ReadonlyArray<{ path: string; name: string }>): string =>
  path === null || path === undefined || path === "" ? SSH_AGENT_LABEL : (keys.find((key) => key.path === path)?.name ?? path);

export type ChoiceOption = { value: string; label: string; hint?: string; disabledReason?: string };

export const NO_MERGE_TOOL_IN_GIT = "No merge.tool in your Git config";
export const NO_DIFF_TOOL_IN_GIT = "No diff.tool in your Git config";
const NOT_INSTALLED_HERE = "Not installed on this Mac";

function foundOptions(tools: readonly ToolEntry[], current: string): ChoiceOption[] {
  const missing = tools.find((tool) => tool.id === current && !tool.installed);
  return [
    ...tools.filter((tool) => tool.installed).map((tool) => ({ value: tool.id, label: tool.label })),
    ...(missing === undefined ? [] : [{ value: missing.id, label: missing.label, hint: "Not installed", disabledReason: NOT_INSTALLED_HERE }]),
  ];
}

const gitConfigOption = (tool: string | null, reason: string): ChoiceOption => ({
  value: "git_config",
  label: "Git config default",
  ...(tool === null ? { disabledReason: reason } : { hint: tool }),
});

export const mergeToolOptions = (detected: ToolsDetected, current: string): ChoiceOption[] => [
  { value: "none", label: "None" },
  gitConfigOption(detected.git_merge_tool, NO_MERGE_TOOL_IN_GIT),
  ...foundOptions(detected.compare, current),
];

export const diffToolOptions = (detected: ToolsDetected, current: string): ChoiceOption[] => [
  { value: "use_merge", label: "Use merge tool" },
  { value: "none", label: "None" },
  gitConfigOption(detected.git_diff_tool, NO_DIFF_TOOL_IN_GIT),
  ...foundOptions(detected.compare, current),
];

export const editorOptions = (detected: ToolsDetected, current: string): ChoiceOption[] => [
  { value: "none", label: "None" },
  { value: "custom", label: "Custom" },
  ...foundOptions(detected.editors, current),
];

export const SIGNING_FORMATS: ReadonlyArray<{ value: SigningFormat; label: string }> = [
  { value: "openpgp", label: "OpenPGP" },
  { value: "ssh", label: "SSH" },
  { value: "x509", label: "X.509" },
];

export const CUSTOM_KEY = "custom";

export const signingKeyOptions = (keys: readonly SigningKey[], format: SigningFormat): ChoiceOption[] => [
  { value: "", label: "Git default" },
  ...keys.filter((key) => key.format === format).map((key) => ({ value: key.id, label: key.label })),
  { value: CUSTOM_KEY, label: "Custom" },
];

export const signingKeyChoice = (key: string, keys: readonly SigningKey[], format: SigningFormat): string =>
  key === "" ? "" : keys.some((entry) => entry.id === key && entry.format === format) ? key : CUSTOM_KEY;
