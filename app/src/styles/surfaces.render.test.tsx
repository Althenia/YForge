import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const styles = import.meta.dirname;
const read = (name: string) => readFileSync(resolve(styles, name), "utf8");
const sheets = readdirSync(styles).filter((name) => name.endsWith(".css") && name !== "fonts.css");
const tokens = read("tokens.css");
const token = (name: string, scope: string) => {
  const block = new RegExp(`${scope.replace(/[[\]"=]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(tokens)?.[1] ?? "";
  return new RegExp(`--colors-${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
};

let stylesheet: HTMLStyleElement;

beforeAll(() => {
  stylesheet = document.createElement("style");
  stylesheet.textContent = ["tokens.css", "app.css"].map(read).join("\n");
  document.head.append(stylesheet);
});

afterAll(() => stylesheet.remove());

afterEach(() => {
  document.body.innerHTML = "";
});

describe("solid surfaces told apart by tone (S14)", () => {
  it("keeps the centered command field within its approved width while breadcrumb labels can truncate", () => {
    const css = read("app.css");
    const block = css.slice(css.indexOf(".commandbar .cmd {"), css.indexOf("}", css.indexOf(".commandbar .cmd {")));
    expect(block).toContain("max-width: var(--command-w);");
    expect(block).toContain("min-width: var(--controls-hit-min);");
    expect(css).toContain(".commandbar .crumb-repo,");
    expect(css).toContain(".commandbar .branch-name {");
  });
  it("gives busy action buttons visible motion with a reduced-motion static state", () => {
    const css = read("app.css");
    expect(css).toContain('button[aria-busy="true"]:not(:has(.busy-spinner))::after');
    expect(css).toMatch(/button\[aria-busy="true"\]:not\(:has\(\.busy-spinner\)\)::after\s*\{[^}]*animation: busy-turn/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[^}]*\}\s*button\[aria-busy="true"\]:not\(:has\(\.busy-spinner\)\)::after\s*\{\s*animation: none;/);
  });
  it("permits only the approved opaque lane-color graph fade, never other gradients or translucent materials", () => {
    for (const name of sheets) {
      const css = read(name);
      const gradientRules = [...css.matchAll(/([^{}]+)\{([^{}]*linear-gradient\([^{}]*\)[^{}]*)\}/g)].map((match) => ({ selector: match[1]?.trim(), body: match[2] ?? "" }));
      expect(gradientRules.map((rule) => rule.selector), name).toEqual(name === "app.css" ? [".lane-band", ".grow.sel .lane-band"] : []);
      for (const rule of gradientRules) {
        expect(rule.body).toContain("var(--lane)");
        expect(rule.body).not.toMatch(/transparent|rgba\(/);
        expect(rule.body, rule.selector).toContain(rule.selector === ".grow.sel .lane-band" ? "var(--colors-selection) 100%" : "var(--canvas) 100%");
      }
      expect(css.replace(/[^{}]+\{[^{}]*linear-gradient\([^{}]*\)[^{}]*\}/g, ""), name).not.toMatch(/gradient\(|backdrop-filter|\.aurora|--material-glass/);
    }
  });

  it("draws the panels, the graph, and fields on their own opaque surfaces", () => {
    const css = read("app.css");
    const rule = (selector: string) => {
      const start = css.startsWith(`${selector} {`) ? 0 : css.indexOf(`\n${selector} {`);
      expect(start, selector).toBeGreaterThanOrEqual(0);
      return css.slice(start, css.indexOf("}", start));
    };
    expect(rule("body")).toContain("background: var(--colors-backdrop);");
    expect(rule(":root")).toContain("--material-panel: var(--colors-surface-1);");
    expect(rule(":root")).toContain("--material-graph: var(--colors-canvas);");
    expect(rule(".panel")).toContain("background: var(--material-panel);");
    expect(rule(".panel")).toContain("border-radius: var(--rounded-lg);");
    expect(rule(".graph")).toContain("background: var(--material-graph);");
    expect(rule(".input")).toContain("background: var(--colors-field);");
  });

  it("orders the dark tones: backdrop darkest, then the graph, then panels, then raised overlays", () => {
    const luminance = (name: string) => {
      const value = (token(name, ":root") as string).replace("#", "");
      return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)).reduce((sum, part) => sum + part, 0);
    };
    expect(luminance("backdrop")).toBeLessThan(luminance("canvas"));
    expect(luminance("canvas")).toBeLessThan(luminance("surface-1"));
    expect(luminance("surface-1")).toBeLessThan(luminance("surface-raised"));
    expect(luminance("field")).toBeLessThan(luminance("surface-1"));
  });

  it("marks selected rows with the selection-edge bar, not the accent (S6)", () => {
    const css = read("app.css");
    for (const selector of [".frow.sel::before", ".repo-row.sel::before"]) {
      const block = css.slice(css.indexOf(`${selector} {`), css.indexOf("}", css.indexOf(`${selector} {`)));
      expect(block, selector).toContain("var(--colors-selection-edge)");
    }
  });

  it("draws tree indent guides and elbows in text-muted so the structure reads at a glance", () => {
    const app = read("app.css");
    const changes = read("changes.css");
    const block = (css: string, selector: string) => css.slice(css.lastIndexOf(`\n${selector} {`), css.indexOf("}", css.lastIndexOf(`\n${selector} {`)));
    expect(block(changes, ".guide")).toContain("var(--colors-text-muted)");
    expect(block(app, ".tree-guide")).toContain("var(--colors-text-muted)");
    expect(app).not.toContain(".tree-elbow");
  });

  it("separates the graph column header fields with text-muted lines and expands the ref cell into a stack on hover", () => {
    const css = read("app.css");
    const block = (selector: string) => css.slice(css.indexOf(`\n${selector} {`), css.indexOf("}", css.indexOf(`\n${selector} {`)));
    expect(block(".ghead .gh + .gh")).toContain("var(--colors-text-muted)");
    expect(block(".refstack")).toContain("display: none");
    expect(block(".refcell:focus-within .refstack")).toContain("display: flex");
    expect(css).toContain("@media (hover: hover) {\n  .refcell:hover .refstack { display: flex; }");
  });

  it("anchors graph search below the header at the top right", () => {
    const css = read("app.css");
    const start = css.indexOf("\n.center > .searchbar {");
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).toContain("align-self: start;");
    expect(block).toContain("justify-self: end;");
    expect(block).toContain("var(--controls-graph-header)");
  });

  it("fits the settings body to its content, scrolling only when it is taller than the window", () => {
    const css = read("app.css");
    const block = css.slice(css.indexOf("\n.settings-body {"), css.indexOf("}", css.indexOf("\n.settings-body {")));
    expect(block).toContain("align-self: start;");
    expect(block).toContain("max-height: 100%;");
  });
});
