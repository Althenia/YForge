import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type { CrashReport } from "../ipc/bindings/CrashReport";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { flush } from "./testkit";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  clearMocks();
});

const explode = (): never => {
  throw new Error("render exploded");
};

describe("app error boundary", () => {
  it("replaces a failing view with an alert and reports the render error with the current view", async () => {
    const reports: CrashReport[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "crash_report") reports.push((args as { report: CrashReport }).report);
      return null;
    });
    const host = document.createElement("div");
    document.body.append(host);

    dispose = render(
      () => (
        <AppErrorBoundary view={() => "/settings/privacy"}>
          {explode()}
        </AppErrorBoundary>
      ),
      host,
    );
    await flush();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("YForge hit an unexpected error");
    expect(host.textContent).toContain("render exploded");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ kind: "render", message: "render exploded", view: "/settings/privacy" });
    expect(reports[0]?.stack).toContain("render exploded");
  });

  it("renders its children untouched and reports nothing when nothing fails", async () => {
    const reports: CrashReport[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "crash_report") reports.push((args as { report: CrashReport }).report);
      return null;
    });
    const host = document.createElement("div");
    document.body.append(host);

    dispose = render(() => <AppErrorBoundary view={() => "/repo"}><p>fine</p></AppErrorBoundary>, host);
    await flush();

    expect(host.textContent).toBe("fine");
    expect(reports).toEqual([]);
  });
});
