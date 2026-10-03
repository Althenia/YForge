import { describe, expect, it } from "vitest";
import type { GitFlowConfig } from "../ipc/bindings/GitFlowConfig";
import { finishLabel, finishNote, flowBranchOf, startNote } from "./gitFlow";

const config: GitFlowConfig = { production: "main", development: "develop", feature: "feature/", release: "release/", hotfix: "hotfix/", version_tag: "v" };

describe("git flow model", () => {
  it("finds the flow branch from the configured prefixes", () => {
    const custom = { ...config, feature: "feat-", release: "rel/" };
    expect(flowBranchOf(custom, "feat-login")).toEqual({ kind: "feature", name: "login", branch: "feat-login" });
    expect(flowBranchOf(custom, "release/1.0")).toBeUndefined();
    expect(flowBranchOf(custom, "hotfix/1.0.1")).toEqual({ kind: "hotfix", name: "1.0.1", branch: "hotfix/1.0.1" });
    expect(flowBranchOf(custom, "hotfix/")).toBeUndefined();
    expect(flowBranchOf(custom, undefined)).toBeUndefined();
  });

  it("describes what each action does from the stored configuration", () => {
    expect(startNote(config, "feature")).toBe("Creates feature/<name> from develop and checks it out");
    expect(startNote(config, "hotfix")).toBe("Creates hotfix/<name> from main and checks it out");
    const release = flowBranchOf(config, "release/1.0");
    expect(release && finishLabel(release)).toBe("Finish release 1.0");
    expect(release && finishNote(config, release)).toBe("Merges into main, tags v1.0, merges into develop, and deletes release/1.0");
    const feature = flowBranchOf(config, "feature/login");
    expect(feature && finishNote(config, feature)).toBe("Merges into develop and deletes feature/login");
  });
});
