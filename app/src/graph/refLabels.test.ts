import { describe, expect, it } from "vitest";
import type { GraphRef } from "../ipc/bindings/GraphRef";
import { groupRefs, refTarget, rowLabels } from "./refLabels";

const ref = (name: string, kind: GraphRef["kind"], is_head = false): GraphRef => ({ name, kind, is_head });

describe("groupRefs", () => {
  it("merges a local branch and its remote counterpart into one label with both kinds", () => {
    const groups = groupRefs([ref("main", "local_branch", true), ref("origin/main", "remote_branch")], ["origin"]);
    expect(groups).toEqual([{ name: "main", title: "main", local: true, remote: true, tag: false, head: true, remoteRef: "origin/main" }]);
  });

  it("shows a remote-only branch by its short name with the full name as title", () => {
    const groups = groupRefs([ref("origin/feature/login", "remote_branch")], ["origin"]);
    expect(groups).toEqual([{ name: "feature/login", title: "origin/feature/login", local: false, remote: true, tag: false, head: false, remoteRef: "origin/feature/login" }]);
  });

  it("strips the longest matching remote name", () => {
    const groups = groupRefs([ref("team/fork/main", "remote_branch")], ["team", "team/fork"]);
    expect(groups[0]?.name).toBe("main");
  });

  it("keeps a tag separate from a branch with the same name", () => {
    const groups = groupRefs([ref("v1", "local_branch"), ref("v1", "tag")], []);
    expect(groups.map((group) => [group.name, group.tag])).toEqual([["v1", false], ["v1", true]]);
  });
});

describe("rowLabels", () => {
  it("shows the first branch, counts the rest, and never folds tags into the overflow", () => {
    const groups = groupRefs(
      [ref("main", "local_branch"), ref("dev", "local_branch"), ref("hotfix", "local_branch"), ref("v1", "tag"), ref("v2", "tag")],
      [],
    );
    const labels = rowLabels(groups);
    expect(labels.branch?.name).toBe("main");
    expect(labels.moreBranches.map((group) => group.name)).toEqual(["dev", "hotfix"]);
    expect(labels.tags.map((group) => group.name)).toEqual(["v1", "v2"]);
  });

  it("has no branch label for a tag-only commit", () => {
    const labels = rowLabels(groupRefs([ref("v1", "tag")], []));
    expect(labels.branch).toBeUndefined();
    expect(labels.tags).toHaveLength(1);
  });
});

describe("refTarget", () => {
  it("targets the local branch of a label that has both, remembering its remote counterpart", () => {
    const [group] = groupRefs([ref("main", "local_branch"), ref("origin/main", "remote_branch")], ["origin"]);
    expect(group && refTarget(group, "abc1234")).toEqual({ kind: "local_branch", name: "main", remoteName: "origin/main", startPoint: "abc1234" });
  });

  it("targets a remote-only label by its full remote name and a tag by its name", () => {
    const [remote] = groupRefs([ref("origin/feature/x", "remote_branch")], ["origin"]);
    const [tag] = groupRefs([ref("v1", "tag")], []);
    expect(remote && refTarget(remote, "abc")).toEqual({ kind: "remote_branch", name: "origin/feature/x", startPoint: "abc" });
    expect(tag && refTarget(tag, "abc")).toEqual({ kind: "tag", name: "v1", startPoint: "abc" });
  });
});
