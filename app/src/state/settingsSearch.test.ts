import { describe, expect, it } from "vitest";
import { crumb, matchCounts, searchSettings, SETTINGS_INDEX } from "./settingsSearch";
import { SETTINGS_SECTIONS } from "./palette";

describe("settings search (S47)", () => {
  it("finds settings across sections by title, note, group, or section, every word required", () => {
    expect(searchSettings("fetch").map((entry) => entry.id)).toEqual(["auto-fetch"]);
    expect(searchSettings("folder").map((entry) => entry.section)).toContain("repositories");
    expect(searchSettings("ssh key").map((entry) => entry.id)).toEqual(["ssh-key", "signing-key", "git-hosts"]);
    expect(searchSettings("   ")).toEqual([]);
    expect(searchSettings("zzz")).toEqual([]);
  });

  it("counts matches per section for the tabs", () => {
    expect(matchCounts(searchSettings("ssh"))).toEqual({ git: 3, "git-hosts": 1 });
  });

  it("names each result's section and group, without repeating a section that is its own group", () => {
    const find = (id: string) => SETTINGS_INDEX.find((entry) => entry.id === id) as (typeof SETTINGS_INDEX)[number];
    expect(crumb(find("default-branch"))).toBe("Git › Defaults");
    expect(crumb(find("theme"))).toBe("Appearance");
    expect(crumb(find("scanned-folders"))).toBe("Repositories › Scanned folders");
  });

  it("indexes every External tools, signing, profiles, LFS, and Git Flow row under the section that shows it (S54, S57, S58, S59, S60)", () => {
    const where = (id: string) => SETTINGS_INDEX.find((entry) => entry.id === id)?.section;
    expect(["merge-tool", "diff-tool", "editor", "terminal"].map(where)).toEqual(["tools", "tools", "tools", "tools"]);
    expect(["signing-scope", "sign-commits", "sign-tags", "signing-format", "signing-key", "signing-program"].map(where)).toEqual(Array(6).fill("git"));
    expect(where("profiles")).toBe("general");
    expect(["lfs", "git-flow"].map(where)).toEqual(["repository", "repository"]);
    expect(searchSettings("merge tool").map((entry) => entry.id)).toContain("merge-tool");
    expect(searchSettings("diff tool").map((entry) => entry.id)).toContain("diff-tool");
    expect(searchSettings("sign commits").map((entry) => entry.id)).toContain("sign-commits");
    expect(searchSettings("lfs track")[0]?.id).toBe("lfs");
    expect(searchSettings("hotfix prefix")[0]?.id).toBe("git-flow");
    expect(searchSettings("switch profile")[0]?.id).toBe("profiles");
    expect(crumb(SETTINGS_INDEX.find((entry) => entry.id === "lfs") as (typeof SETTINGS_INDEX)[number])).toBe("This repository › Git LFS");
  });

  it("indexes only sections that exist, and every section except This repository has at least one entry", () => {
    const ids = SETTINGS_SECTIONS.map((section) => section.id);
    expect(SETTINGS_INDEX.every((entry) => ids.includes(entry.section))).toBe(true);
    expect(ids.filter((id) => id !== "repository").every((id) => SETTINGS_INDEX.some((entry) => entry.section === id))).toBe(true);
    expect(new Set(SETTINGS_INDEX.map((entry) => entry.id)).size).toBe(SETTINGS_INDEX.length);
  });
});
