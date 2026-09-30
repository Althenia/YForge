import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Rgba = { r: number; g: number; b: number; a: number };
type Pair = { foreground: string; backgrounds: string[]; minimum: number };

const TEXT = 4.5;
const GRAPHIC = 3;

const tokenSource = readFileSync(resolve(import.meta.dirname, "tokens.css"), "utf8");

function block(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(tokenSource);
  if (match === null) throw new Error(`missing ${selector} block in tokens.css`);
  return new Map([...(match[1] ?? "").matchAll(/--colors-([\w-]+)\s*:\s*(#[0-9A-Fa-f]+)\s*;/g)].map((entry): [string, string] => [entry[1] ?? "", entry[2] ?? ""]));
}

const dark = block(":root");
const themes: Record<string, Map<string, string>> = {
  dark,
  light: new Map([...dark, ...block('[data-theme="light"]')]),
};

function parseHex(hex: string): Rgba {
  const digits = hex.slice(1);
  if (digits.length !== 6 && digits.length !== 8) throw new Error(`unsupported color ${hex}`);
  const channel = (index: number) => Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);
  return { r: channel(0), g: channel(1), b: channel(2), a: digits.length === 8 ? channel(3) / 255 : 1 };
}

function composite(over: Rgba, under: Rgba): Rgba {
  const mix = (top: number, bottom: number) => top * over.a + bottom * (1 - over.a);
  return { r: mix(over.r, under.r), g: mix(over.g, under.g), b: mix(over.b, under.b), a: 1 };
}

function luminance({ r, g, b }: Rgba): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function ratio(foreground: Rgba, background: Rgba): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

function measure(theme: Map<string, string>, pair: Pair, background: string): number {
  const token = (name: string) => {
    const value = theme.get(name);
    if (value === undefined) throw new Error(`unknown color token ${name}`);
    return parseHex(value);
  };
  const base = composite(token(background), token("backdrop"));
  return ratio(composite(token(pair.foreground), base), base);
}

const readingSurfaces = ["canvas", "surface-1", "surface-2", "surface-3", "surface-raised", "selection"];

const syntaxKinds = ["keyword", "string", "number", "comment", "function", "type", "property"].map((kind) => `syntax-${kind}`);
const codeSurfaces = ["canvas", "accent-tint", "danger-tint", "diff-added-word", "diff-removed-word", "diff-added-selected", "diff-removed-selected"];

const pairs: Pair[] = [
  { foreground: "text", backgrounds: codeSurfaces, minimum: TEXT },
  ...syntaxKinds.map((foreground): Pair => ({ foreground, backgrounds: codeSurfaces, minimum: TEXT })),
  { foreground: "text-muted", backgrounds: ["accent-tint", "danger-tint", "diff-added-selected", "diff-removed-selected"], minimum: TEXT },
  { foreground: "status-added", backgrounds: ["accent-tint", "diff-added-selected"], minimum: TEXT },
  { foreground: "danger-ink", backgrounds: ["diff-removed-selected"], minimum: TEXT },
  { foreground: "text", backgrounds: readingSurfaces, minimum: TEXT },
  { foreground: "text-muted", backgrounds: readingSurfaces, minimum: TEXT },
  { foreground: "text-subtle", backgrounds: ["canvas"], minimum: TEXT },
  { foreground: "accent-ink", backgrounds: ["accent-tint", "surface-2"], minimum: TEXT },
  { foreground: "danger-ink", backgrounds: ["danger-tint", "attention-tint", "surface-raised"], minimum: TEXT },
  { foreground: "danger", backgrounds: ["surface-2", "attention-tint"], minimum: TEXT },
  { foreground: "attention-ink", backgrounds: ["attention-tint"], minimum: TEXT },
  { foreground: "info-ink", backgrounds: ["info-tint"], minimum: TEXT },
  { foreground: "on-accent", backgrounds: ["accent"], minimum: TEXT },
  { foreground: "text-inverse", backgrounds: ["text"], minimum: TEXT },
  { foreground: "focus", backgrounds: ["backdrop", ...readingSurfaces], minimum: GRAPHIC },
  { foreground: "rule-strong", backgrounds: ["canvas"], minimum: GRAPHIC },
];

describe("WCAG contrast arithmetic", () => {
  it("rates black on white 21:1 and identical colors 1:1", () => {
    expect(ratio(parseHex("#000000"), parseHex("#FFFFFF"))).toBeCloseTo(21, 6);
    expect(ratio(parseHex("#777777"), parseHex("#777777"))).toBeCloseTo(1, 6);
  });

  it("composites an 8-digit hex over its underlying color by alpha", () => {
    const over = parseHex("#FFFFFF12");
    expect(over.a).toBeCloseTo(18 / 255, 10);
    const result = composite(over, parseHex("#000000"));
    expect([result.r, result.g, result.b]).toEqual([18, 18, 18]);
  });
});

for (const [themeName, theme] of Object.entries(themes)) {
  describe(`${themeName} theme contrast (S10)`, () => {
    for (const pair of pairs) {
      for (const background of pair.backgrounds) {
        it(`${pair.foreground} on ${background} is at least ${pair.minimum}:1`, () => {
          const measured = measure(theme, pair, background);
          expect(measured, `${themeName}: ${pair.foreground} on ${background} measures ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(pair.minimum);
        });
      }
    }
  });
}
