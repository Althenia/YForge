import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { profileWorkspaceAudit, type RenderAudit, type RenderFinding, type WorkspaceAuditRules } from "./workspaceAudit";

const rules: WorkspaceAuditRules = {
  radii: { panel: 10, composer: 14, input: 10 },
};

let root: HTMLDivElement;
beforeEach(() => {
  document.documentElement.style.setProperty("--rounded-lg", "10px");
  document.documentElement.style.setProperty("--rounded-xl", "14px");
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(() => {
  root.remove();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty("--rounded-lg");
  document.documentElement.style.removeProperty("--rounded-xl");
});

const measure = (element: Element, height = 32, top = 4) => {
  const rect = new DOMRect(0, top, 100, height);
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
  vi.spyOn(element, "getClientRects").mockReturnValue(Object.assign([rect], { item: (index: number) => index === 0 ? rect : null }));
};

const fixture = (html: string) => {
  root.innerHTML = html;
  root.querySelectorAll("*").forEach((element) => measure(element));
};

const finding = (code: string, measured: Record<string, unknown> = {}, selector = "#target"): RenderFinding => ({
  code, selector, measured, level: code === "icon-label-offset" || code === "target-too-small" ? "error" : "warning",
});

const run = (findings: RenderFinding[], computedValue = (element: Element, property: string) => (element as HTMLElement).style.getPropertyValue(property)) => {
  const raw: RenderAudit = { counts: { error: findings.filter((item) => item.level === "error").length, warning: findings.filter((item) => item.level === "warning").length, info: 0 }, findings };
  Object.freeze(raw);
  Object.freeze(raw.findings);
  return profileWorkspaceAudit(raw, root, rules, computedValue);
};

const radius = (value: number) => ["top-left", "top-right", "bottom-left", "bottom-right"].map((corner) => `border-${corner}-radius:${value}px`).join(";");

describe("the approved Workspace audit profile", () => {
  it("uses the approved surface values rather than measured production values", () => {
    const surface = parse(readFileSync(resolve(import.meta.dirname, "../../DESIGN.md"), "utf8").split(/^---$/m)[1] ?? "") as { rounded: Record<string, string>; spacing: Record<string, string>; controls: Record<string, string> };
    expect(surface.rounded.lg).toBe(`${rules.radii.input}px`);
    expect(surface.rounded.xl).toBe(`${rules.radii.composer}px`);
    expect(surface.rounded.lg).toBe(`${rules.radii.panel}px`);
  });

  it("retains raw findings and every genuine or unknown violation without mutating its input", () => {
    fixture('<button id="target">Action</button>');
    const input = [finding("target-too-small"), finding("icon-size-off-scale"), finding("native-tooltip"), finding("new-detector")];
    const result = run(input);
    expect(result.raw.findings).toBe(input);
    expect(result.findings).toEqual(input);
    expect(result.counts).toEqual({ error: 1, warning: 3, info: 0 });
    expect(result.exceptions).toEqual([]);
  });

  it("recognizes automatic layout margins but retains an identical authored fixed margin", () => {
    fixture('<div id="target" style="margin-left:158px"></div>');
    const input = [finding("spacing-off-scale", { value: 158, count: 1 })];
    expect(run(input, () => "auto").exceptions[0]?.reason).toBe("automatic-layout-margin");
    expect(run(input, () => "158px").findings).toEqual(input);
  });

  it("does not excuse a grouped spacing finding containing both an auto margin and off-scale padding", () => {
    fixture('<div id="target" style="margin-left:158px"></div><div style="padding-left:158px"></div>');
    const input = [finding("spacing-off-scale", { value: 158, count: 2 })];
    expect(run(input, () => "auto").findings).toEqual(input);
  });

  it("retains a spacing finding when all of its occurrences cannot be accounted for", () => {
    fixture('<div id="target" style="margin-left:158px"></div>');
    const input = [finding("spacing-off-scale", { value: 158, count: 2 })];
    expect(run(input, () => "auto").findings).toEqual(input);
  });

  it.each([[1, 18], [2, 30]])("retains an off-scale %i-level tree indent of %ipx", (depth, padding) => {
    const guides = '<span class="tree-guide"></span>'.repeat(depth);
    fixture(`<aside class="sidebar"><div id="target" class="srow" style="padding-left:${padding}px">${guides}</div></aside>`);
    const input = [finding("spacing-off-scale", { value: padding, count: 1 })];
    expect(run(input).findings).toEqual(input);
  });

  it.each([
    ["panel inspector", 10, "composer", 14],
    ["composer", 14, "input", 10],
  ])("recognizes the approved %s/%s nesting but rejects a changed corner", (parentClass, parentRadius, childClass, childRadius) => {
    fixture(`<div class="${parentClass}" style="${radius(Number(parentRadius))}"><div id="target" class="${childClass}" style="${radius(Number(childRadius))}"></div></div>`);
    const input = [finding("radius-not-concentric")];
    expect(run(input).exceptions[0]?.reason).toBe("approved-component-radius");
    const target = root.querySelector<HTMLElement>("#target");
    if (target === null) throw new Error("Missing nested surface");
    target.style.borderTopLeftRadius = `${Number(childRadius) + 1}px`;
    expect(run(input).findings).toEqual(input);
    target.style.borderTopLeftRadius = `${childRadius}px`;
    document.documentElement.style.setProperty(Number(childRadius) === 14 ? "--rounded-xl" : "--rounded-lg", `${Number(childRadius) + 1}px`);
    expect(run(input).findings).toEqual(input);
  });

  it("does not apply component radius exceptions to an unrelated widget", () => {
    fixture(`<div class="widget" style="${radius(14)}"><div id="target" class="input" style="${radius(10)}"></div></div>`);
    const input = [finding("radius-not-concentric")];
    expect(run(input).findings).toEqual(input);
  });

  it("retains raw icon offsets on named icon-only controls", () => {
    fixture('<button aria-label="Settings"><svg id="target"></svg></button><span>Repository tab</span>');
    const input = [finding("icon-label-offset", { offset: 0.78 })];
    expect(run(input).findings).toEqual(input);
    expect(run(input).counts.error).toBe(1);
  });

  it("retains raw icon offsets even when the label line box is centered", () => {
    fixture('<button style="display:inline-flex;align-items:center"><svg id="target"></svg><span id="label">Pull 2</span></button>');
    const input = [finding("icon-label-offset", { offset: 0.7 })];
    expect(run(input).findings).toEqual(input);
    expect(run(input).counts.error).toBe(1);
  });

  it.each([[28, 6], [26, 7], [28, 8]])("retains a raw control-height finding for a %ipx peer at y=%i", (height, top) => {
    fixture('<div><button id="target" class="cmd">Palette</button><button id="peer" class="icon-btn" aria-label="Search"></button></div>');
    const peer = root.querySelector("#peer");
    if (peer === null) throw new Error("Missing peer control");
    measure(peer, height, top);
    const result = run([finding("control-height-mismatch", { kind: "row", selectors: ["#target", "#peer"] })]);
    expect(result.counts.warning).toBe(1);
    expect(result.exceptions).toEqual([]);
  });

  it("retains an off-scale inner input height despite its on-scale field frame", () => {
    fixture('<label class="input"><input id="target"></label>');
    const input = [finding("control-height-mismatch", { kind: "scale", height: 23.09 })];
    expect(run(input).findings).toEqual(input);
  });

  it("retains an off-scale switch height", () => {
    fixture('<button id="target" class="switch" role="switch" aria-label="Update on fetch"></button>');
    const target = root.querySelector("#target");
    if (target === null) throw new Error("Missing switch");
    measure(target, 18);
    const input = [finding("control-height-mismatch", { kind: "scale", height: 18 })];
    expect(run(input).findings).toEqual(input);
  });
});
