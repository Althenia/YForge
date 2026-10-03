import { describe, expect, it } from "vitest";
import type { ToolsDetected } from "../ipc/bindings/ToolsDetected";
import {
  applyAppearance,
  AUTO_FETCH_OPTIONS,
  defaultSettings,
  diffToolOptions,
  editorOptions,
  effectivePullMode,
  mergeToolOptions,
  pullModeLabel,
  remoteProblem,
  resolveTheme,
  settingsChanged,
  signingKeyChoice,
  signingKeyOptions,
  sourceLabel,
} from "./settingsModel";

describe("settings model", () => {
  it("offers auto-fetch as off, 5, 10, or 30 minutes", () => {
    expect(AUTO_FETCH_OPTIONS.map((option) => option.minutes)).toEqual([0, 5, 10, 30]);
  });

  it("prefers the repository pull mode over the application default and names the source", () => {
    expect(effectivePullMode(defaultSettings, undefined)).toEqual({ mode: "fast_forward_or_merge", source: "default" });
    expect(effectivePullMode(defaultSettings, { pull_mode: null })).toEqual({ mode: "fast_forward_or_merge", source: "default" });
    expect(effectivePullMode(defaultSettings, { pull_mode: "rebase" })).toEqual({ mode: "rebase", source: "repository" });
    expect(pullModeLabel("fast_forward_only")).toBe("fast-forward only");
  });

  it("words every configuration source", () => {
    const value = (source: "repository" | "global" | "system" | "other" | "unset") => ({ value: null, source });
    expect(sourceLabel(value("repository"))).toBe("from repository config");
    expect(sourceLabel(value("global"))).toBe("from global config");
    expect(sourceLabel(value("system"))).toBe("from system config");
    expect(sourceLabel(value("other"))).toBe("from the environment");
    expect(sourceLabel(value("unset"))).toBe("not set");
  });

  it("validates remote names and addresses before saving", () => {
    expect(remoteProblem("origin", "https://example.test/a.git")).toBeUndefined();
    expect(remoteProblem("", "https://example.test/a.git")).toBeDefined();
    expect(remoteProblem("bad name", "https://example.test/a.git")).toBeDefined();
    expect(remoteProblem("a/b", "https://example.test/a.git")).toBeDefined();
    expect(remoteProblem("origin", "nonsense")).toBeDefined();
  });

  it("resolves the system theme from the colour scheme and applies theme and density to the root", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
    const root = document.createElement("html");
    applyAppearance(root, { theme: "light", density: "compact" }, false);
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.density).toBe("compact");
    applyAppearance(root, { theme: "system", density: "default" }, true);
    expect([root.dataset.theme, root.dataset.density]).toEqual(["light", "default"]);
  });

  it("detects a changed settings object", () => {
    expect(settingsChanged(defaultSettings, { ...defaultSettings })).toBe(false);
    expect(settingsChanged(defaultSettings, { ...defaultSettings, density: "compact" })).toBe(true);
  });
});

const detected = (overrides: Partial<ToolsDetected> = {}): ToolsDetected => ({
  compare: [
    { id: "filemerge", label: "FileMerge", installed: true },
    { id: "beyondcompare", label: "Beyond Compare", installed: false },
  ],
  editors: [
    { id: "vscode", label: "Visual Studio Code", installed: true },
    { id: "zed", label: "Zed", installed: false },
  ],
  git_merge_tool: null,
  git_diff_tool: "opendiff",
  ...overrides,
});

describe("external tool choices (S54)", () => {
  it("offers None, Git config default, then only the merge tools found, with the reason when Git has none", () => {
    expect(mergeToolOptions(detected(), "none")).toEqual([
      { value: "none", label: "None" },
      { value: "git_config", label: "Git config default", disabledReason: "No merge.tool in your Git config" },
      { value: "filemerge", label: "FileMerge" },
    ]);
    expect(mergeToolOptions(detected({ git_merge_tool: "vimdiff" }), "none")[1]).toEqual({ value: "git_config", label: "Git config default", hint: "vimdiff" });
  });

  it("offers Use merge tool first for the diff tool and names diff.tool as the reason when Git has none", () => {
    expect(diffToolOptions(detected(), "use_merge").map((option) => option.value)).toEqual(["use_merge", "none", "git_config", "filemerge"]);
    expect(diffToolOptions(detected(), "use_merge")[2]).toEqual({ value: "git_config", label: "Git config default", hint: "opendiff" });
    expect(diffToolOptions(detected({ git_diff_tool: null }), "use_merge")[2]?.disabledReason).toBe("No diff.tool in your Git config");
  });

  it("offers None, Custom, then each editor found, and keeps a stored choice that is no longer installed visible but unselectable", () => {
    expect(editorOptions(detected(), "none").map((option) => option.label)).toEqual(["None", "Custom", "Visual Studio Code"]);
    expect(editorOptions(detected(), "zed").at(-1)).toEqual({ value: "zed", label: "Zed", hint: "Not installed", disabledReason: "Not installed on this Mac" });
  });
});

describe("commit signing choices (S59)", () => {
  const keys = [
    { id: "AAAABBBBCCCCDDDD", label: "Yui Lin <yui@example.test> · AAAABBBBCCCCDDDD", format: "openpgp" as const },
    { id: "/Users/yui/.ssh/id_ed25519.pub", label: "id_ed25519.pub · yui@laptop", format: "ssh" as const },
  ];

  it("lists the keys of the chosen format between Git default and Custom", () => {
    expect(signingKeyOptions(keys, "ssh").map((option) => option.label)).toEqual(["Git default", "id_ed25519.pub · yui@laptop", "Custom"]);
    expect(signingKeyOptions(keys, "x509").map((option) => option.value)).toEqual(["", "custom"]);
  });

  it("selects a listed key, Git default for an empty key, and Custom for any other value", () => {
    expect(signingKeyChoice("", keys, "openpgp")).toBe("");
    expect(signingKeyChoice("AAAABBBBCCCCDDDD", keys, "openpgp")).toBe("AAAABBBBCCCCDDDD");
    expect(signingKeyChoice("AAAABBBBCCCCDDDD", keys, "ssh")).toBe("custom");
    expect(signingKeyChoice("ssh-ed25519 AAAA", keys, "ssh")).toBe("custom");
  });
});
