import { describe, expect, it } from "vitest";
import { addSubmoduleProblem, deinitCopy, submoduleCheckout, submoduleEntries, submoduleStatusWord, UPDATE_ON_FETCH_OFF } from "./submoduleModel";
import type { MenuEntry } from "./refMenu";
import type { Submodule } from "../ipc/bindings/Submodule";

const item = (entries: MenuEntry[], id: string) => {
  const found = entries.find((entry) => entry.kind === "item" && entry.id === id);
  return found?.kind === "item" ? found : undefined;
};

const row = (status: Submodule["status"], path = "vendor/theme"): Submodule => ({
  name: path,
  path,
  url: "git@example.com:sample/theme.git",
  branch: "main",
  status,
  recorded: "9f0e1aabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  checked_out: status === "uninitialized" ? null : "c4d5e6fccccccccccccccccccccccccccccccccc",
});

describe("submodule model", () => {
  it("names each status in words", () => {
    expect(submoduleStatusWord("current")).toBe("current");
    expect(submoduleStatusWord("dirty")).toBe("dirty");
    expect(submoduleStatusWord("uninitialized")).toBe("uninitialized");
    expect(submoduleStatusWord("update_failed")).toBe("update failed");
  });

  it("describes deinit without staging the files inside", () => {
    const copy = deinitCopy("vendor/theme");
    expect(copy.title).toBe("Deinit vendor/theme?");
    expect(copy.confirmLabel).toBe("Deinit");
    expect(copy.warning).toBe(true);
    expect(copy.consequences.join(" ")).toContain("Deinit removes the checkout at vendor/theme");
    expect(copy.consequences.join(" ")).toContain("The gitlink stays in the index until you commit that change");
    expect(copy.consequences.join(" ")).toContain("Files inside the submodule are not staged");
  });

  it("rejects an empty URL and a path that leaves the repository", () => {
    expect(addSubmoduleProblem("vendor/icons", "")).toMatch(/url/i);
    expect(addSubmoduleProblem("../outside", "git@example.com:sample/icons.git")).toMatch(/path/i);
    expect(addSubmoduleProblem("vendor/icons", "git@example.com:sample/icons.git")).toBeUndefined();
  });

  it("joins the checkout under the parent and disables checkout actions until it exists", () => {
    expect(submoduleCheckout("/work/app", "vendor/theme")).toBe("/work/app/vendor/theme");
    const ready = submoduleEntries(row("dirty"));
    expect(item(ready, "update")?.label).toEqual(["Update"]);
    expect(item(ready, "open")?.disabledReason).toBeUndefined();
    expect(item(ready, "stage")?.disabledReason).toBeUndefined();
    const missing = submoduleEntries(row("uninitialized"));
    expect(item(missing, "update")?.label).toEqual(["Init"]);
    expect(item(missing, "open")?.disabledReason).toBe("This submodule is not checked out");
    expect(item(missing, "stage")?.disabledReason).toBe("Nothing to stage until the submodule is checked out");
    expect(item(missing, "deinit")?.disabledReason).toBeUndefined();
  });

  it("keeps update on fetch off in the default copy", () => {
    expect(UPDATE_ON_FETCH_OFF).toContain("Update on fetch is off");
  });
});
