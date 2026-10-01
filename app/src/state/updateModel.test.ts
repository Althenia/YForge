import { describe, expect, it } from "vitest";
import { releaseNoteLines, updateFailureText } from "./updateModel";

describe("release notes", () => {
  it("turns markdown bullets and headings into plain lines and drops blanks", () => {
    expect(releaseNoteLines("## What's new\n\n- Jira issues in the sidebar\n* Saved tab groups\n• Per-host identities\n  \nPlain line")).toEqual([
      "What's new",
      "Jira issues in the sidebar",
      "Saved tab groups",
      "Per-host identities",
      "Plain line",
    ]);
  });

  it("has no lines for empty notes", () => {
    expect(releaseNoteLines("")).toEqual([]);
    expect(releaseNoteLines("  \n ")).toEqual([]);
  });
});

describe("update failure text", () => {
  it("says what happened, which version is running, and that nothing was downloaded or changed", () => {
    expect(updateFailureText("github.com could not be reached", "0.1.0")).toBe("github.com could not be reached. You are on YForge 0.1.0; nothing was downloaded or changed.");
    expect(updateFailureText("Could not fetch a valid release JSON from the remote.", "0.1.0")).toBe(
      "Could not fetch a valid release JSON from the remote. You are on YForge 0.1.0; nothing was downloaded or changed.",
    );
  });
});
