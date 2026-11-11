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
  shown: LabelGroup | undefined;
  more: LabelGroup[];
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
  const ordered = [...groups.filter((group) => !group.tag), ...groups.filter((group) => group.tag)];
  const shown = ordered.find((group) => group.head) ?? ordered[0];
  return { shown, more: ordered.filter((group) => group !== shown) };
}

export function refTarget(group: LabelGroup, startPoint: string): RefTarget {
  if (group.tag) return { kind: "tag", name: group.name, startPoint };
  if (group.local) return { kind: "local_branch", name: group.name, remoteName: group.remoteRef, startPoint };
  return { kind: "remote_branch", name: group.remoteRef ?? group.name, startPoint };
}

const byName = (left: LabelGroup, right: LabelGroup): number => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

export function rowRefTarget(refs: readonly GraphRef[], sha: string, remotes: readonly string[], current: string | undefined): RefTarget | undefined {
  const groups = groupRefs(refs, remotes);
  const locals = groups.filter((group) => group.local).sort(byName);
  const ordered = [
    ...locals.filter((group) => group.name === current),
    ...locals.filter((group) => group.name !== current),
    ...groups.filter((group) => !group.local && !group.tag).sort(byName),
    ...groups.filter((group) => group.tag).sort(byName),
  ];
  const first = ordered[0];
  return first === undefined ? undefined : refTarget(first, sha);
}
