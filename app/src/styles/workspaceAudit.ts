export type RenderFinding = {
  level: "error" | "warning" | "info";
  code: string;
  selector: string;
  message?: string;
  measured: Record<string, unknown>;
};

export type RenderAudit = {
  counts: { error: number; warning: number; info: number };
  findings: RenderFinding[];
};

export type WorkspaceAuditRules = {
  radii: { panel: number; composer: number; input: number };
};

type ComputedValue = (element: Element, property: string) => string | undefined;
type ApprovedReason = "automatic-layout-margin" | "approved-component-radius";

const close = (a: number, b: number) => Math.abs(a - b) <= 0.5;
const approvedRadius = (element: Element, radius: number, token: "--rounded-lg" | "--rounded-xl") => {
  const surface = getComputedStyle(element.ownerDocument.documentElement);
  if (!close(Number.parseFloat(surface.getPropertyValue(token)), radius)) return false;
  const style = getComputedStyle(element);
  return [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].every((value) => close(Number.parseFloat(value), radius));
};

export function profileWorkspaceAudit(raw: RenderAudit, root: Element, rules: WorkspaceAuditRules, computedValue: ComputedValue) {
  const visible = (element: Element) => {
    if (element.closest("svg,[hidden],[inert]")) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return element.getClientRects().length > 0 && rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const spacing = new Map<number, { element: Element; property: string }[]>();
  for (const element of root.querySelectorAll("*")) {
    if (!visible(element)) continue;
    const style = getComputedStyle(element);
    const properties = ["padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left"];
    if (style.display.includes("flex") || style.display.includes("grid")) properties.push("row-gap", "column-gap");
    for (const property of properties) {
      if (style.display === "inline" && ["padding-top", "padding-bottom", "margin-top", "margin-bottom"].includes(property)) continue;
      const value = Math.round(Math.abs(Number.parseFloat(style.getPropertyValue(property))) * 100) / 100;
      if (!Number.isFinite(value) || value < 0.01) continue;
      const group = spacing.get(value) ?? [];
      group.push({ element, property });
      spacing.set(value, group);
    }
  }

  const reason = (finding: RenderFinding): ApprovedReason | undefined => {
    const element = root.ownerDocument.querySelector(finding.selector);
    if (element === null || !root.contains(element)) return undefined;
    if (finding.code === "spacing-off-scale") {
      const value = finding.measured.value;
      const count = finding.measured.count;
      if (typeof value !== "number" || typeof count !== "number") return undefined;
      const group = spacing.get(value) ?? [];
      if (group.length < count || group.length === 0) return undefined;
      if (group.every(({ element: item, property }) => property.startsWith("margin-") && computedValue(item, property) === "auto")) return "automatic-layout-margin";
    }
    if (finding.code === "radius-not-concentric") {
      const parent = element.parentElement;
      if (parent === null) return undefined;
      if (element.matches(".composer") && parent.matches(".panel.inspector") && approvedRadius(element, rules.radii.composer, "--rounded-xl") && approvedRadius(parent, rules.radii.panel, "--rounded-lg")) return "approved-component-radius";
      if (element.matches(".input") && parent.matches(".composer") && approvedRadius(element, rules.radii.input, "--rounded-lg") && approvedRadius(parent, rules.radii.composer, "--rounded-xl")) return "approved-component-radius";
    }
    return undefined;
  };

  const findings: RenderFinding[] = [];
  const exceptions: { finding: RenderFinding; reason: ApprovedReason }[] = [];
  for (const finding of raw.findings) {
    const approved = reason(finding);
    if (approved === undefined) findings.push(finding);
    else exceptions.push({ finding, reason: approved });
  }
  const counts = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.level] += 1;
  return { raw, counts, findings, exceptions };
}
