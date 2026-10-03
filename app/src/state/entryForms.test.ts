import { describe, expect, it } from "vitest";
import { cloneDestination, cloneRepoName, cloneUrlProblem, createDestination, createNameProblem } from "./entryForms";

describe("clone and create forms", () => {
  it("validates addresses: https, ssh, scp-like, and absolute local paths", () => {
    for (const good of ["https://github.com/a/b.git", "ssh://git@host/a.git", "git@github.com:a/b.git", "/srv/repos/a.git", "file:///srv/a.git"]) {
      expect(cloneUrlProblem(good)).toBeUndefined();
    }
    for (const bad of ["", "  ", "not a url", "https://", "relative/path", "C:\\repos\\a"]) {
      expect(cloneUrlProblem(bad)).toBeDefined();
    }
  });

  it("derives the repository folder from the address and previews the full path", () => {
    expect(cloneRepoName("https://github.com/example/lab-app.git")).toBe("lab-app");
    expect(cloneRepoName("git@github.com:example/lab-app.git/")).toBe("lab-app");
    expect(cloneRepoName("/srv/bare.git")).toBe("bare");
    expect(cloneRepoName("https://")).toBe("repository");
    expect(cloneDestination("~/Developer/", "https://github.com/example/lab-app.git")).toBe("~/Developer/lab-app");
    expect(createDestination("/dev", " new-repo ")).toBe("/dev/new-repo");
  });

  it("rejects empty names and names with slashes when creating", () => {
    expect(createNameProblem("")).toBeDefined();
    expect(createNameProblem("a/b")).toBeDefined();
    expect(createNameProblem("..")).toBeDefined();
    expect(createNameProblem("ok-name")).toBeUndefined();
  });
});
