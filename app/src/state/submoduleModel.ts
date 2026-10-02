import type { Submodule } from "../ipc/bindings/Submodule";
import type { SubmoduleStatus } from "../ipc/bindings/SubmoduleStatus";
import type { ConfirmCopy } from "./confirmCopy";
import type { MenuEntry } from "./refMenu";

export const UPDATE_ON_FETCH_OFF = "Update on fetch is off. Fetch does not move this submodule.";
export const UPDATE_ON_FETCH_ON = "Update on fetch is on. Fetch checks out the recorded commit.";

const missing = (row: Submodule): boolean => row.status === "uninitialized" || row.checked_out === null;

export function submoduleStatusWord(status: SubmoduleStatus): string {
  switch (status) {
    case "current":
      return "current";
    case "dirty":
      return "dirty";
    case "uninitialized":
      return "uninitialized";
    case "update_failed":
      return "update failed";
  }
}

export function deinitCopy(path: string): ConfirmCopy {
  return {
    title: `Deinit ${path}?`,
    warning: true,
    consequences: [`Deinit removes the checkout at ${path}. The gitlink stays in the index until you commit that change. Files inside the submodule are not staged.`],
    names: [],
    confirmLabel: "Deinit",
  };
}

export function addSubmoduleProblem(path: string, url: string): string | undefined {
  const target = path.trim();
  if (target === "" || target.startsWith("/") || target.startsWith("-") || target.includes("..") || target.includes("\\") || target.includes("\n")) {
    return "Enter a path inside this repository";
  }
  const remote = url.trim();
  if (remote === "" || remote.includes("\n") || remote.startsWith("-")) return "Enter a URL";
  return undefined;
}

export function submoduleCheckout(root: string, path: string): string {
  return `${root.replace(/\/$/, "")}/${path}`;
}

export function submoduleEntries(row: Submodule): MenuEntry[] {
  const absent = missing(row);
  return [
    { kind: "item", id: "update", label: [absent ? "Init" : "Update"], icon: "sync" },
    { kind: "item", id: "open", label: ["Open as tab"], icon: "open", disabledReason: absent ? "This submodule is not checked out" : undefined },
    { kind: "item", id: "stage", label: ["Stage pointer"], icon: "commit", disabledReason: absent ? "Nothing to stage until the submodule is checked out" : undefined },
    { kind: "separator" },
    { kind: "item", id: "deinit", label: ["Deinit…"], icon: "trash", danger: true },
  ];
}
