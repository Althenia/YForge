import { describe, expect, it } from "vitest";
import { defaultUiPrefs } from "./repoUiPrefs";
import { bulkMenu, countLabel, extendRange, isSectionOpen, matchesFilter, selectedIn, toggleRow, toggleSection, type RowSelection } from "./sidebarModel";

describe("section collapse", () => {
  it("is open by default, toggles per section, and leaves folder state untouched", () => {
    const prefs = { ...defaultUiPrefs, collapsed_folders: ["local:feature"] };
    expect(isSectionOpen(prefs, "branches")).toBe(true);

    const collapsed = toggleSection(prefs, "branches");
    expect(isSectionOpen(collapsed, "branches")).toBe(false);
    expect(isSectionOpen(collapsed, "tags")).toBe(true);
    expect(collapsed.collapsed_folders).toContain("local:feature");
    expect(isSectionOpen(toggleSection(collapsed, "branches"), "branches")).toBe(true);
  });
});

describe("filter", () => {
  it("matches a case-insensitive substring of any text and everything for an empty query", () => {
    expect(matchesFilter("", "anything")).toBe(true);
    expect(matchesFilter("FEAT", "origin/feature/a")).toBe(true);
    expect(matchesFilter("ure/a", "origin/feature/a")).toBe(true);
    expect(matchesFilter("zzz", "origin/feature/a", "stash@{0}")).toBe(false);
    expect(matchesFilter("stash@", "x", "stash@{0}")).toBe(true);
  });

  it("shows matched/total only while filtering", () => {
    expect(countLabel(9, 9, false)).toBe("9");
    expect(countLabel(9, 2, true)).toBe("2/9");
    expect(countLabel(9, 0, true)).toBe("0/9");
  });
});

describe("multi-select", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("toggles rows with ctrl, dropping the selection when the last row is toggled off", () => {
    const first = toggleRow(undefined, "branches", "b");
    const second = toggleRow(first, "branches", "d");
    expect(selectedIn(second, "branches")).toEqual(["b", "d"]);
    expect(toggleRow(second, "branches", "b")?.ids).toEqual(["d"]);
    expect(toggleRow(first, "branches", "b")).toBeUndefined();
  });

  it("extends from the anchor with shift in either direction and keeps the anchor", () => {
    const anchored = toggleRow(undefined, "branches", "b");
    const down = extendRange(anchored, "branches", order, "d");
    expect(down.ids).toEqual(["b", "c", "d"]);
    expect(down.anchor).toBe("b");
    expect(extendRange(down, "branches", order, "a").ids).toEqual(["a", "b"]);
  });

  it("selects only the clicked row when shift-clicking without an anchor or with a hidden anchor", () => {
    expect(extendRange(undefined, "branches", order, "c").ids).toEqual(["c"]);
    expect(extendRange({ group: "branches", ids: ["x"], anchor: "x" }, "branches", order, "c").ids).toEqual(["c"]);
  });

  it("starts a new selection when the click is in another section", () => {
    const branches: RowSelection = { group: "branches", ids: ["a", "b"], anchor: "a" };
    expect(toggleRow(branches, "stashes", "s1")).toEqual({ group: "stashes", ids: ["s1"], anchor: "s1" });
    expect(extendRange(branches, "stashes", ["s1", "s2"], "s2").ids).toEqual(["s2"]);
    expect(selectedIn(branches, "stashes")).toEqual([]);
  });
});

describe("bulk menu", () => {
  const item = (group: Parameters<typeof bulkMenu>[0], count: number, reason?: string) => {
    const entry = bulkMenu(group, count, reason)[0];
    return entry?.kind === "item" ? entry : undefined;
  };

  it("offers the section's bulk action with the row count", () => {
    expect(item("branches", 3)).toMatchObject({ id: "delete", label: ["Delete 3 branches…"], danger: true });
    expect(item("remotes", 2)).toMatchObject({ id: "fetch", label: ["Fetch 2 remotes"], note: "fetches every remote" });
    expect(item("stashes", 2)).toMatchObject({ id: "drop", label: ["Drop 2 stashes…"], danger: true });
    expect(item("worktrees", 4)).toMatchObject({ id: "remove", label: ["Remove 4 worktrees…"], danger: true });
  });

  it("carries the reason that blocks the action", () => {
    expect(item("branches", 2, "main is checked out")?.disabledReason).toBe("main is checked out");
    expect(item("branches", 2)?.disabledReason).toBeUndefined();
  });
});
