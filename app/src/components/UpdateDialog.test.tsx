import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdateCheck } from "../ipc/bindings/UpdateCheck";
import { buttonNamed, flush, mountWithApp } from "./testkit";
import { UpdateDialog } from "./UpdateDialog";

let dispose: (() => void) | undefined;

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await flush();
  document.body.innerHTML = "";
  clearMocks();
});

type Call = { cmd: string };

function mountDialog(options: { check?: () => Promise<UpdateCheck> | UpdateCheck; install?: () => Promise<null> | null } = {}) {
  const calls: Call[] = [];
  mockIPC(
    async (cmd) => {
      calls.push({ cmd });
      if (cmd === "app_info") return { app_version: "0.1.0", git_version: "2.50.0" };
      if (cmd === "update_check") return (options.check ?? (() => ({ kind: "up_to_date", version: "0.1.0" })))();
      if (cmd === "update_install") return (options.install ?? (() => null))();
      return null;
    },
    { shouldMockEvents: true },
  );
  const onClose = vi.fn();
  const mounted = mountWithApp(() => <UpdateDialog onClose={onClose} />);
  dispose = mounted.dispose;
  return { host: mounted.host, calls, onClose };
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;

const available: UpdateCheck = { kind: "available", current: "0.1.0", version: "0.2.0", notes: "- Jira issues in the sidebar\n- Saved tab groups" };

describe("update dialog", () => {
  it("moves keyboard focus into the dialog, keeps it there as the check finishes, and gives it back to the opener when it closes", async () => {
    let finish: (value: UpdateCheck) => void = () => undefined;
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { onClose } = mountDialog({ check: () => new Promise<UpdateCheck>((resolve) => (finish = resolve)) });
    await flush();

    expect(document.activeElement).toBe(buttonNamed(dialog(), "Cancel"));

    finish({ kind: "up_to_date", version: "0.1.0" });
    await flush();

    expect(document.activeElement).toBe(buttonNamed(dialog(), "Close"));
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();

    dispose?.();
    dispose = undefined;
    expect(document.activeElement).toBe(opener);
  });

  it("says in text that it is checking and that nothing downloads until Install and Relaunch, and Cancel closes it", async () => {
    const { calls, onClose } = mountDialog({ check: () => new Promise<UpdateCheck>(() => undefined) });
    await flush();

    const status = dialog().querySelector('[role="status"]') as HTMLElement;

    expect(dialog().getAttribute("aria-labelledby")).not.toBeNull();
    expect(dialog().querySelector("h3")?.textContent).toBe("Check for Update");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toContain("Checking github.com/Althenia/YForge for a newer version…");
    expect(dialog().textContent).toContain("You are on YForge 0.1.0. Nothing downloads until you choose Install and Relaunch.");
    expect(calls.map((call) => call.cmd)).not.toContain("update_install");

    (buttonNamed(dialog(), "Cancel") as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("states that YForge is up to date with its version", async () => {
    mountDialog({ check: () => ({ kind: "up_to_date", version: "0.1.0" }) });
    await flush();

    expect(dialog().textContent).toContain("YForge is up to date");
    expect(dialog().textContent).toContain("You are on YForge 0.1.0");
    expect(dialog().querySelector('[aria-busy="true"]')).toBeNull();
    expect(buttonNamed(dialog(), "Close")).toBeDefined();
  });

  it("offers the available version with its release notes, Later, and Install and Relaunch, and downloads nothing until it is chosen", async () => {
    const { calls, onClose } = mountDialog({ check: () => available });
    await flush();

    expect(dialog().querySelector("h3")?.textContent).toBe("YForge 0.2.0 is available");
    expect(dialog().textContent).toContain("You have 0.1.0. The update is signed with YForge's key and is checked before it installs.");
    expect([...dialog().querySelectorAll("li")].map((entry) => entry.textContent)).toEqual(["Jira issues in the sidebar", "Saved tab groups"]);
    expect(dialog().textContent).toContain("Open repositories and tabs come back after the relaunch. Uncommitted changes stay on disk.");
    expect(calls.map((call) => call.cmd)).not.toContain("update_install");

    (buttonNamed(dialog(), "Later") as HTMLButtonElement).click();

    expect(onClose).toHaveBeenCalledOnce();
    expect(calls.map((call) => call.cmd)).not.toContain("update_install");
  });

  it("says when a release has no notes", async () => {
    mountDialog({ check: () => ({ ...available, notes: "" } as UpdateCheck) });
    await flush();

    expect(dialog().textContent).toContain("No release notes were published for this version.");
  });

  it("installs only after Install and Relaunch, shows a busy status while it downloads and verifies, and cannot be dismissed meanwhile", async () => {
    const { calls, onClose } = mountDialog({ check: () => available, install: () => new Promise<null>(() => undefined) });
    await flush();

    (buttonNamed(dialog(), "Install and Relaunch") as HTMLButtonElement).click();
    await flush();
    dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(calls.map((call) => call.cmd)).toContain("update_install");
    const status = dialog().querySelector('[role="status"]') as HTMLElement;
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toContain("Downloading the update and checking its signature…");
    expect(buttonNamed(dialog(), "Later")).toBeUndefined();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reports a failed check with what happened, nothing downloaded or changed, and Try again that checks again", async () => {
    let attempt = 0;
    const { calls } = mountDialog({
      check: async () => {
        attempt += 1;
        if (attempt === 1) throw { kind: "internal", message: "github.com could not be reached", output: null };
        return available;
      },
    });
    await flush();

    const alert = dialog().querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("Could not check for updates");
    expect(alert.textContent).toContain("github.com could not be reached. You are on YForge 0.1.0; nothing was downloaded or changed.");
    expect(dialog().textContent).toContain("If a downloaded update fails its signature check, YForge discards it and says so here; it never installs an unsigned update.");

    (buttonNamed(alert, "Try again") as HTMLButtonElement).click();
    await flush();

    expect(calls.filter((call) => call.cmd === "update_check")).toHaveLength(2);
    expect(dialog().querySelector("h3")?.textContent).toBe("YForge 0.2.0 is available");
  });

  it("says an update that failed its signature check was discarded, and offers Try again and Close", async () => {
    mountDialog({
      check: () => available,
      install: async () => {
        throw { kind: "internal", message: "The downloaded update failed its signature check and was discarded; nothing was installed", output: null };
      },
    });
    await flush();

    (buttonNamed(dialog(), "Install and Relaunch") as HTMLButtonElement).click();
    await flush();

    const alert = dialog().querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("The update was not installed");
    expect(alert.textContent).toContain("failed its signature check and was discarded");
    expect(buttonNamed(alert, "Try again")).toBeDefined();
    expect(buttonNamed(dialog(), "Close")).toBeDefined();
  });

  it("closes with Escape while checking and ignores a result that arrives afterwards", async () => {
    let finish: (value: UpdateCheck) => void = () => undefined;
    const { onClose } = mountDialog({ check: () => new Promise<UpdateCheck>((resolve) => (finish = resolve)) });
    await flush();

    dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    finish(available);
    await flush();

    expect(onClose).toHaveBeenCalledOnce();
  });
});
