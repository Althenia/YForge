import { describe, expect, it } from "vitest";
import type { GraphRef } from "../ipc/bindings/GraphRef";
import { groupRefs, refTarget, rowLabels, rowRefTarget } from "./refLabels";

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
  it("shows the checked-out branch and folds every other branch and tag into the overflow", () => {
    const groups = groupRefs(
      [ref("dev", "local_branch"), ref("main", "local_branch", true), ref("hotfix", "local_branch"), ref("v1", "tag"), ref("v2", "tag")],
      [],
    );
    const labels = rowLabels(groups);
    expect(labels.shown?.name).toBe("main");
    expect(labels.more.map((group) => group.name)).toEqual(["dev", "hotfix", "v1", "v2"]);
  });

  it("shows the first branch when none is checked out", () => {
    const labels = rowLabels(groupRefs([ref("dev", "local_branch"), ref("v1", "tag")], []));
    expect(labels.shown?.name).toBe("dev");
    expect(labels.more.map((group) => group.name)).toEqual(["v1"]);
  });

  it("shows the first tag of a tag-only commit", () => {
    const labels = rowLabels(groupRefs([ref("v1", "tag"), ref("v2", "tag")], []));
    expect(labels.shown?.name).toBe("v1");
    expect(labels.more.map((group) => group.name)).toEqual(["v2"]);
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

describe("rowRefTarget", () => {
  const pick = (refs: GraphRef[], current: string | undefined = "main") => rowRefTarget(refs, "abc1234", ["origin"], current);

  it("has no target for a row without refs", () => {
    expect(pick([])).toBeUndefined();
  });

  it("prefers the checked-out local branch, then another local branch, then a remote branch, then a tag", () => {
    const refs = [ref("v1", "tag"), ref("origin/zeta", "remote_branch"), ref("beta", "local_branch"), ref("alpha", "local_branch"), ref("main", "local_branch", true)];
    expect(pick(refs)).toMatchObject({ kind: "local_branch", name: "main" });
    expect(pick(refs.filter((entry) => entry.name !== "main"))).toMatchObject({ kind: "local_branch", name: "alpha" });
    expect(pick(refs.filter((entry) => entry.kind === "tag" || entry.kind === "remote_branch"))).toMatchObject({ kind: "remote_branch", name: "origin/zeta" });
    expect(pick([ref("v2", "tag"), ref("v1", "tag")])).toMatchObject({ kind: "tag", name: "v1" });
  });

  it("never treats a branch as checked out unless it is the current branch, so an old commit gets no current-branch menu", () => {
    const target = pick([ref("beta", "local_branch"), ref("alpha", "local_branch")], "main");
    expect(target).toMatchObject({ kind: "local_branch", name: "alpha" });
    expect(pick([ref("beta", "local_branch"), ref("main", "local_branch")], undefined)).toMatchObject({ name: "main" });
  });

  it("starts the target at the row's commit and keeps the remote counterpart of a local branch", () => {
    expect(pick([ref("main", "local_branch", true), ref("origin/main", "remote_branch")])).toEqual({ kind: "local_branch", name: "main", remoteName: "origin/main", startPoint: "abc1234" });
  });
});
