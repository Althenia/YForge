import type { GraphRef } from "../ipc/bindings/GraphRef";
import type { RefTarget } from "../state/refMenu";

export type LabelGroup = {
  name: string;
  title: string;
  local: boolean;
  remote: boolean;
  tag: boolean;
  head: boolean;
  remoteRef: string | undefined;
};

export type RowLabels = {
  branch: LabelGroup | undefined;
  moreBranches: LabelGroup[];
  tags: LabelGroup[];
};

function shortRemoteName(name: string, remotes: readonly string[]): string {
  const remote = remotes
    .filter((candidate) => name.startsWith(`${candidate}/`))
    .sort((left, right) => right.length - left.length)[0];
  return remote === undefined ? name : name.slice(remote.length + 1);
}

export function groupRefs(refs: readonly GraphRef[], remotes: readonly string[]): LabelGroup[] {
  const groups = new Map<string, LabelGroup>();
  for (const ref of refs) {
    const name = ref.kind === "remote_branch" ? shortRemoteName(ref.name, remotes) : ref.name;
    const key = `${ref.kind === "tag" ? "tag" : "branch"}:${name}`;
    const group = groups.get(key) ?? { name, title: ref.name, local: false, remote: false, tag: false, head: false, remoteRef: undefined };
    if (ref.kind === "local_branch") {
      group.local = true;
      group.title = ref.name;
    }
    if (ref.kind === "remote_branch") {
      group.remote = true;
      group.remoteRef = ref.name;
      if (!group.local) group.title = ref.name;
    }
    if (ref.kind === "tag") group.tag = true;
    group.head ||= ref.is_head;
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function rowLabels(groups: readonly LabelGroup[]): RowLabels {
  const branches = groups.filter((group) => !group.tag);
  return {
    branch: branches[0],
    moreBranches: branches.slice(1),
    tags: groups.filter((group) => group.tag),
  };
}

export function refTarget(group: LabelGroup, startPoint: string): RefTarget {
  if (group.tag) return { kind: "tag", name: group.name, startPoint };
  if (group.local) return { kind: "local_branch", name: group.name, remoteName: group.remoteRef, startPoint };
  return { kind: "remote_branch", name: group.remoteRef ?? group.name, startPoint };
}
