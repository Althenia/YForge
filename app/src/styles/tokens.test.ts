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
  elevation: Group;
  themes: { light: { colors: Group; elevation: Group } };
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
  flat("elevation", surface.elevation),
);
const lightColors = { ...surface.colors, ...surface.themes.light.colors };
const expectedLight = merge(
  flat("colors", surface.themes.light.colors, lightColors),
  flat("elevation", surface.themes.light.elevation),
);

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
  it("has identical dark (root) tokens in both directions", () => {
    expect(drift(expectedDark, declarations(tokenSource, ":root"))).toEqual([]);
  });

  it("has identical light theme override tokens in both directions", () => {
    expect(drift(expectedLight, declarations(tokenSource, '[data-theme="light"]'))).toEqual([]);
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
