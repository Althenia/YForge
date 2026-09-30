import { describe, expect, it } from "vitest";
import { basename, formatAbsolute, relativeAge, splitPath } from "./format";

describe("relativeAge", () => {
  const now = 1_700_000_000;

  it.each([
    [30, "30s"],
    [120, "2m"],
    [3 * 3600, "3h"],
    [4 * 86400, "4d"],
    [21 * 86400, "3w"],
    [90 * 86400, "2mo"],
    [800 * 86400, "2y"],
  ])("formats %i seconds ago as %s", (ago, expected) => {
    expect(relativeAge(now - ago, now)).toBe(expected);
  });

  it("never reports a negative age for a future timestamp", () => {
    expect(relativeAge(now + 500, now)).toBe("0s");
  });
});

describe("path helpers", () => {
  it("takes the last path segment, ignoring trailing separators", () => {
    expect(basename("/Users/me/YForge/")).toBe("YForge");
    expect(basename("/")).toBe("/");
  });

  it("splits a path into directory and file name", () => {
    expect(splitPath("src/ipc/client.ts")).toEqual({ directory: "src/ipc/", name: "client.ts" });
    expect(splitPath("README.md")).toEqual({ directory: "", name: "README.md" });
  });
});

describe("formatAbsolute", () => {
  it("formats day, short month, year, and 24-hour time", () => {
    expect(formatAbsolute(1_790_000_000, "UTC")).toBe("21 Sep 2026 14:13");
  });
});
