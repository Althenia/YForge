import type { FlowKind } from "../ipc/bindings/FlowKind";
import type { GitFlowConfig } from "../ipc/bindings/GitFlowConfig";

export const FLOW_KINDS: readonly FlowKind[] = ["feature", "release", "hotfix"];

export const prefixOf = (config: GitFlowConfig, kind: FlowKind): string => config[kind];

export const startLabel = (kind: FlowKind): string => `Start ${kind}…`;

export const startBase = (config: GitFlowConfig, kind: FlowKind): string => (kind === "hotfix" ? config.production : config.development);

export const kindTitle = (kind: FlowKind): string => `${kind[0]?.toUpperCase() ?? ""}${kind.slice(1)}`;

export type FlowBranch = { kind: FlowKind; name: string; branch: string };

export const flowBranchOf = (config: GitFlowConfig, head: string | undefined): FlowBranch | undefined => {
  if (head === undefined) return undefined;
  for (const kind of FLOW_KINDS) {
    const prefix = prefixOf(config, kind);
    if (head.startsWith(prefix) && head.length > prefix.length) return { kind, name: head.slice(prefix.length), branch: head };
  }
  return undefined;
};

export const finishLabel = (flow: FlowBranch): string => `Finish ${flow.kind} ${flow.name}`;

export const finishNote = (config: GitFlowConfig, flow: FlowBranch): string =>
  flow.kind === "feature"
    ? `Merges into ${config.development} and deletes ${flow.branch}`
    : `Merges into ${config.production}, tags ${config.version_tag}${flow.name}, merges into ${config.development}, and deletes ${flow.branch}`;

export const startNote = (config: GitFlowConfig, kind: FlowKind): string => `Creates ${prefixOf(config, kind)}<name> from ${startBase(config, kind)} and checks it out`;

export const CONFLICT_NOTICE = "Finish stopped on conflicts. Resolve them, then continue, or abort. Nothing was deleted.";
