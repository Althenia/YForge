import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Scalar = string | number;
type Group = Record<string, Scalar>;
type FrontMatter = {
  colors: Group;
  typography: Record<string, Group>;
  rounded: Group;
  spacing: Group;
  controls: Group;
  layout: Group;
  cursors: Group;
  elevation: Group;
  materials: Record<string, { background: string; fallback: string; blur: string; rim?: string; shadow?: string }>;
  themes: { light: { colors: Group; elevation: Group } } & Record<string, { colors: Group; elevation?: Group }>;
};

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const frontMatter = <T>(path: string): T => parse(read(path).split(/^---$/m)[1] ?? "") as T;

const brandColors = frontMatter<{ colors: Group }>("DESIGN.md").colors;
const surface = frontMatter<FrontMatter>("app/DESIGN.md");

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function resolveReference(value: Scalar, scope: Group): string {
  const text = String(value);
  const reference = /^\{colors\.([\w-]+)\}$/.exec(text)?.[1];
  if (reference === undefined) return text;
  const target = scope[reference] ?? brandColors[reference];
  if (target === undefined) throw new Error(`unresolved color reference ${text}`);
  return resolveReference(target, scope);
}

function flat(group: string, values: Group, scope: Group = {}): Map<string, string> {
  return new Map(Object.entries(values).map(([name, value]) => [`--${group}-${kebab(name)}`, resolveReference(value, scope)]));
}

function nested(group: string, roles: Record<string, Group>): Map<string, string> {
  return new Map(
    Object.entries(roles).flatMap(([role, properties]) =>
      Object.entries(properties).map(([property, value]): [string, string] => [`--${group}-${role}-${kebab(property)}`, String(value)]),
    ),
  );
}

const merge = (...maps: Map<string, string>[]) => new Map(maps.flatMap((map) => [...map]));

const expectedDark = merge(
  flat("colors", surface.colors, surface.colors),
  nested("typography", surface.typography),
  flat("rounded", surface.rounded),
  flat("spacing", surface.spacing),
  flat("controls", surface.controls),
  flat("layout", surface.layout),
  flat("cursors", surface.cursors),
  flat("elevation", surface.elevation),
);
const lightColors = { ...surface.colors, ...surface.themes.light.colors };
const expectedLight = merge(
  flat("colors", surface.themes.light.colors, lightColors),
  flat("elevation", surface.themes.light.elevation),
);

const namedThemes = ["classic", "ocean", "eighties", "gruvbox", "nord", "dracula", "monokai", "woodland"];

function declarations(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blocks = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  if (blocks.length !== 1) throw new Error(`expected exactly one ${selector} block, found ${blocks.length}`);
  const entries = [...(blocks[0]?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match): [string, string] => [match[1] ?? "", (match[2] ?? "").trim()]);
  const map = new Map(entries);
  if (map.size !== entries.length) throw new Error(`duplicate custom property in ${selector}`);
  return map;
}

function drift(expected: Map<string, string>, actual: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const [name, value] of expected) {
    const found = actual.get(name);
    if (found === undefined) problems.push(`missing in token source: ${name}`);
    else if (found !== value) problems.push(`value differs: ${name} is ${found}, front matter has ${value}`);
  }
  for (const name of actual.keys()) {
    if (!expected.has(name)) problems.push(`not in front matter: ${name}`);
  }
  return problems;
}

const tokenSource = readFileSync(resolve(import.meta.dirname, "tokens.css"), "utf8");

describe("app/DESIGN.md front matter vs src/styles/tokens.css", () => {
  it("keeps the five materials opaque and unblurred, backed by existing theme tokens", () => {
    const roles = { panel: "surface-1", graph: "canvas", raised: "surface-raised", control: "surface-2", "control-hover": "surface-3" };
    expect(Object.keys(surface.materials).sort()).toEqual(Object.keys(roles).sort());
    for (const [name, color] of Object.entries(roles)) {
      const material = surface.materials[name];
      expect(material).toMatchObject({ background: `{colors.${color}}`, fallback: `{colors.${color}}`, blur: "0px" });
      for (const theme of [undefined, "light", ...namedThemes]) {
        const colors = theme === undefined ? surface.colors : { ...surface.colors, ...surface.themes[theme]?.colors };
        const actual = merge(declarations(tokenSource, ":root"), theme === undefined ? new Map() : declarations(tokenSource, `[data-theme="${theme}"]`));
        expect(resolveReference(material?.background ?? "", colors)).toBe(actual.get(`--colors-${color}`));
        expect(resolveReference(material?.fallback ?? "", colors)).toBe(actual.get(`--colors-${color}`));
      }
    }
    expect(surface.materials.panel?.rim).toBe("1px solid {colors.rule-panel}");
    expect(surface.materials.graph?.rim).toBe("1px solid {colors.rule-panel}");
    expect(surface.materials.panel?.shadow).toBe("{elevation.panel}");
    expect(surface.materials.control?.rim).toBe("inset 0 0 0 1px {colors.rule}");
    expect(surface.materials["control-hover"]?.rim).toBe("inset 0 0 0 1px {colors.rule}");
  });
  it("sets the graph column to the approved 56px default while retaining its 56px minimum", () => {
    expect(surface.layout["graph-column"]).toBe("56px");
    expect(surface.layout["graph-column-min"]).toBe("56px");
    expect(declarations(tokenSource, ":root").get("--layout-graph-column")).toBe("56px");
  });
  it("uses the approved Strata reading scale while retaining the commit summary and graph roles", () => {
    const sizes = Object.fromEntries(Object.entries(surface.typography).map(([role, values]) => [role, values.fontSize]));
    expect(sizes).toMatchObject({ "ui-body": "15px", "ui-label": "14px", "ui-strong": "14px", "ui-small": "13px", "ui-caption": "13px", "ui-section": "13px", "ui-micro": "12px", title: "18px", heading: "21px", code: "13px", ref: "13px" });
    expect(surface.typography.title).toMatchObject({ fontWeight: 600, lineHeight: 1.4 });
    expect(surface.typography["ui-strong"]).toMatchObject({ fontWeight: 600, lineHeight: 1.54 });
    expect(Object.fromEntries(Object.entries(sizes).filter(([role]) => role.startsWith("graph")))).toEqual({ graph: "12px", "graph-strong": "12px", "graph-tag": "11px", "graph-micro": "10px", "graph-initials": "10px" });
  });
  it("owns Strata chrome geometry and flat panels without changing graph geometry", () => {
    expect(surface.controls).toMatchObject({ "row-list": "32px", "row-detail": "28px", "row-repository": "42px", "panel-header": "40px", "sidebar-section-header": "36px", "height-chip": "32px", "bar-state": "44px", "row-graph": "28px" });
    expect(surface.layout).toMatchObject({ sidebar: "260px", inspector: "380px", "sidebar-medium": "220px", "inspector-medium": "340px", "sidebar-rail": "48px", "inspector-compact": "320px", "panel-gap": "8px", "command-field-min": "210px", "graph-ref-column": "130px" });
    expect(surface.elevation.panel).toBe("none");
    expect(surface.themes.light.elevation.panel).toBe("none");
    for (const name of ["raised", "overlay", "modal"]) {
      expect(surface.elevation[name]).not.toBe("none");
      expect(surface.themes.light.elevation[name]).not.toBe("none");
    }
  });
  it("has identical dark (root) tokens in both directions", () => {
    expect(drift(expectedDark, declarations(tokenSource, ":root"))).toEqual([]);
  });

  it("has identical light theme override tokens in both directions", () => {
    expect(drift(expectedLight, declarations(tokenSource, '[data-theme="light"]'))).toEqual([]);
  });

  it("has exactly the eight additional named palette overrides in both directions", () => {
    expect(Object.keys(surface.themes).sort()).toEqual(["light", ...namedThemes].sort());
    for (const name of namedThemes) {
      const override = surface.themes[name]?.colors;
      expect(override, name).toBeDefined();
      const expected = flat("colors", override ?? {}, { ...surface.colors, ...override });
      expect(drift(expected, declarations(tokenSource, `[data-theme="${name}"]`)), name).toEqual([]);
    }
  });

  it("defines the nine cursor tokens in front matter and token source alike", () => {
    const only = (tokens: Map<string, string>) => new Map([...tokens].filter(([name]) => name.startsWith("--cursors-")));
    const actual = only(declarations(tokenSource, ":root"));
    expect(drift(only(expectedDark), actual)).toEqual([]);
    expect([...actual.keys()].sort()).toEqual(
      ["action", "text", "disabled", "drag", "dragging", "resize-column", "resize-row", "busy", "static"].map((name) => `--cursors-${name}`).sort(),
    );
  });

  it("covers every token group the surface defines for CSS use", () => {
    expect(expectedDark.size).toBeGreaterThan(200);
    expect(expectedLight.size).toBeGreaterThan(50);
  });
});

describe("drift detection", () => {
  const expected = new Map([
    ["--colors-canvas", "#0E151A"],
    ["--rounded-sm", "4px"],
  ]);

  it("reports a changed value, a missing token, and an extra token", () => {
    const actual = new Map([
      ["--colors-canvas", "#000000"],
      ["--colors-extra", "#123456"],
    ]);
    expect(drift(expected, actual)).toEqual([
      "value differs: --colors-canvas is #000000, front matter has #0E151A",
      "missing in token source: --rounded-sm",
      "not in front matter: --colors-extra",
    ]);
  });

  it("reports nothing for identical maps", () => {
    expect(drift(expected, new Map(expected))).toEqual([]);
  });
});
