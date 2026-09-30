import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import { branchNameProblem, createBranchNameField } from "./branchName";

afterEach(() => clearMocks());

const gitRules = (cmd: string, args: unknown) => {
  if (cmd !== "check_branch_name") return null;
  const name = (args as { name: string }).name;
  if (/[ ~^:?*[\\]|\.\./.test(name)) throw { kind: "invalid_request", message: "Invalid request", output: null };
  return name;
};

describe("branch name problems", () => {
  it("stays quiet while the field is empty and flags duplicates and unchanged names", () => {
    expect(branchNameProblem("", ["main"])).toBeUndefined();
    expect(branchNameProblem("main", ["main"])).toBe("A branch named main already exists");
    expect(branchNameProblem("old", ["old"], "old")).toBe("Enter a different name");
    expect(branchNameProblem("fresh", ["main"])).toBeUndefined();
  });
});

describe("branch name field", () => {
  it("accepts a name only after git check-ref-format approves it", async () => {
    const asked: string[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "check_branch_name") asked.push((args as { name: string }).name);
      return gitRules(cmd, args);
    });
    const field = createBranchNameField("/r", ["main"]);

    const pending = field.setValue("feature/ok");
    expect(field.valid()).toBe(false);
    await pending;

    expect(asked).toEqual(["feature/ok"]);
    expect(field.valid()).toBe(true);
    expect(field.problem()).toBeUndefined();
  });

  it("reports names git rejects and never sends duplicates to git", async () => {
    const asked: string[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "check_branch_name") asked.push((args as { name: string }).name);
      return gitRules(cmd, args);
    });
    const field = createBranchNameField("/r", ["main"]);

    await field.setValue("bad name");
    expect(field.problem()).toBe("bad name is not a valid branch name");
    expect(field.valid()).toBe(false);
    await field.setValue("main");

    expect(field.problem()).toBe("A branch named main already exists");
    expect(asked).toEqual(["bad name"]);
  });

  it("ignores a slow answer for a name that has since been replaced", async () => {
    const releases: Array<() => void> = [];
    mockIPC((cmd, args) => {
      if (cmd !== "check_branch_name") return null;
      const name = (args as { name: string }).name;
      if (name === "slow bad") {
        return new Promise((_resolve, reject) => releases.push(() => reject({ kind: "invalid_request", message: "x", output: null })));
      }
      return name;
    });
    const field = createBranchNameField("/r", []);

    const first = field.setValue("slow bad");
    await field.setValue("good");
    releases.forEach((release) => release());
    await first;

    expect(field.valid()).toBe(true);
    expect(field.problem()).toBeUndefined();
  });
});
