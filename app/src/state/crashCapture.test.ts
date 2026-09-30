import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flush } from "../components/testkit";
import type { CrashReport } from "../ipc/bindings/CrashReport";
import { installCrashCapture, reportCrash } from "./crashCapture";

let uninstall: (() => void) | undefined;

const settle = (event: Event) => event.preventDefault();

beforeEach(() => window.addEventListener("error", settle));

afterEach(() => {
  window.removeEventListener("error", settle);
  uninstall?.();
  uninstall = undefined;
  clearMocks();
});

function install(failing = false) {
  const reports: CrashReport[] = [];
  mockIPC((cmd, args) => {
    if (cmd !== "crash_report") return null;
    reports.push((args as { report: CrashReport }).report);
    if (failing) throw { kind: "storage_failed", message: "diagnostics store unavailable", output: null };
    return null;
  });
  return reports;
}

const rejection = (reason: unknown) => Object.assign(new Event("unhandledrejection"), { reason });

describe("frontend crash capture", () => {
  it("reports a window error with its message, stack, and the current view", async () => {
    const reports = install();
    uninstall = installCrashCapture(() => "/settings/privacy");
    const error = new TypeError("undefined is not a function");

    window.dispatchEvent(new ErrorEvent("error", { message: "Uncaught TypeError: undefined is not a function", error }));
    await flush();

    expect(reports).toEqual([{ kind: "error", message: "undefined is not a function", stack: error.stack ?? null, view: "/settings/privacy" }]);
  });

  it("reports an unhandled rejection with an Error reason and with a plain reason", async () => {
    const reports = install();
    uninstall = installCrashCapture(() => "/repo");
    const failure = new Error("load failed");

    window.dispatchEvent(rejection(failure));
    window.dispatchEvent(rejection("plain reason"));
    await flush();

    expect(reports).toEqual([
      { kind: "unhandled_rejection", message: "load failed", stack: failure.stack ?? null, view: "/repo" },
      { kind: "unhandled_rejection", message: "plain reason", stack: null, view: "/repo" },
    ]);
  });

  it("reports an error without an error object by its event message", async () => {
    const reports = install();
    uninstall = installCrashCapture(() => "/launcher");

    window.dispatchEvent(new ErrorEvent("error", { message: "Script error." }));
    await flush();

    expect(reports).toEqual([{ kind: "error", message: "Script error.", stack: null, view: "/launcher" }]);
  });

  it("stops reporting once uninstalled", async () => {
    const reports = install();
    installCrashCapture(() => "/repo")();

    window.dispatchEvent(new ErrorEvent("error", { message: "late", error: new Error("late"), cancelable: true }));
    await flush();

    expect(reports).toEqual([]);
  });

  it("reports one crash once and does not report again when the report itself fails", async () => {
    const reports = install(true);
    uninstall = installCrashCapture(() => "/repo");
    const error = new Error("render failed");

    window.dispatchEvent(new ErrorEvent("error", { message: error.message, error }));
    await flush();
    window.dispatchEvent(new ErrorEvent("error", { message: error.message, error }));
    await flush();

    expect(reports).toHaveLength(1);
  });

  it("reports an error rendered by a component through reportCrash and drops a repeat of the same crash", async () => {
    const reports = install();
    const error = new Error("cannot read properties of undefined");

    reportCrash("render", error, "/repo");
    reportCrash("render", error, "/repo");
    reportCrash("render", new Error("another failure"), "/repo");
    await flush();

    expect(reports.map((report) => [report.kind, report.message])).toEqual([
      ["render", "cannot read properties of undefined"],
      ["render", "another failure"],
    ]);
  });
});
