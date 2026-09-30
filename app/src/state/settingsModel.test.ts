import { describe, expect, it } from "vitest";
import { applyAppearance, AUTO_FETCH_OPTIONS, defaultSettings, effectivePullMode, pullModeLabel, remoteProblem, resolveTheme, settingsChanged, sourceLabel } from "./settingsModel";

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
