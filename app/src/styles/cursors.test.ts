import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = resolve(import.meta.dirname, "../../..");
const source = resolve(root, "app/src");
const tokenFile = resolve(source, "styles/tokens.css");
const specimenFile = resolve(root, "docs/design/specimens/specimen.css");
const thisFile = resolve(import.meta.filename);
const fixtureFiles = new Set([thisFile]);

const front = parse(readFileSync(resolve(root, "app/DESIGN.md"), "utf8").split(/^---$/m)[1] ?? "") as { cursors: Record<string, string> };
const tokens = new Map(Object.entries(front.cursors).map(([name, value]) => [`--cursors-${name}`, value]));
const allowedValues = new Set([...tokens.keys()].map((name) => `var(${name})`));

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

function cursorViolations(name: string, raw: string): string[] {
  const text = stripComments(raw);
  const problems: string[] = [];
  for (const match of text.matchAll(/(?<![\w-])cursor\s*[:=]\s*([^;}\n]*)/g)) {
    const value = (match[1] ?? "").trim().replace(/,$/, "").replace(/^(["'`])(.*)\1$/, "$2");
    if (!allowedValues.has(value)) problems.push(`${name}:${lineOf(text, match.index)} cursor is "${value}", not a var(--cursors-*) token`);
  }
  for (const match of text.matchAll(/\(\s*["']cursor["'](?=\s*,)|\[\s*["']cursor["'](?=\s*\])|["']cursor["'](?=\s*:)/g)) problems.push(`${name}:${lineOf(text, match.index)} sets cursor through a string key`);
  return problems;
}

function definitions(text: string): Map<string, string> {
  return new Map([...stripComments(text).matchAll(/(?<![\w-])(--cursors-[\w-]+)\s*:\s*([^;}\n]+)/g)].map((match): [string, string] => [match[1] ?? "", (match[2] ?? "").trim()]));
}

function definitionViolations(name: string, text: string): string[] {
  return [...definitions(text).keys()].map((property) => `${name}: defines ${property} outside tokens.css`);
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : filesUnder(path);
    return /\.(css|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const scanned = [...filesUnder(source), specimenFile].filter((path) => !fixtureFiles.has(path));
const label = (path: string) => relative(root, path);

describe("cursors come only from the design tokens (S17)", () => {
  it("scans the app styles, components, and the specimen stylesheet", () => {
    expect(scanned.map(label)).toEqual(expect.arrayContaining(["app/src/styles/app.css", "app/src/components/Composer.tsx", "docs/design/specimens/specimen.css"]));
  });

  it("sets cursor only to var(--cursors-*) in every stylesheet and component", () => {
    const problems = scanned.flatMap((path) => cursorViolations(label(path), readFileSync(path, "utf8")));
    expect(problems).toEqual([]);
  });

  it("defines --cursors-* custom properties only in tokens.css, mirrored unchanged in specimen.css", () => {
    const problems = scanned
      .filter((path) => path !== specimenFile && path !== tokenFile)
      .flatMap((path) => definitionViolations(label(path), readFileSync(path, "utf8")));
    expect(problems).toEqual([]);
    expect(definitions(readFileSync(tokenFile, "utf8"))).toEqual(tokens);
    expect(definitions(readFileSync(specimenFile, "utf8"))).toEqual(tokens);
  });

  it("uses every cursor token in app.css", () => {
    const css = readFileSync(resolve(source, "styles/app.css"), "utf8");
    const unused = [...tokens.keys()].filter((name) => !css.includes(`var(${name})`));
    expect(unused).toEqual([]);
  });
});

describe("cursor violation detection", () => {
  it("flags keyword, inherit, and unknown-token cursors in CSS", () => {
    const css = ".a { cursor: pointer; }\n.b { cursor: inherit }\n.c { cursor: var(--cursors-bogus); }\n.d { cursor: var(--cursors-action) !important; }";
    expect(cursorViolations("x.css", css).map((problem) => problem.split(" cursor is ")[1])).toEqual([
      '"pointer", not a var(--cursors-*) token',
      '"inherit", not a var(--cursors-*) token',
      '"var(--cursors-bogus)", not a var(--cursors-*) token',
      '"var(--cursors-action) !important", not a var(--cursors-*) token',
    ]);
  });

  it("flags inline styles and string keys in TSX", () => {
    const tsx = 'const a = <i style={{ cursor: "pointer" }} />;\nel.style.cursor = "grab";\nel.style.setProperty("cursor", "wait");\nconst ok = <i style={{ cursor: "var(--cursors-action)" }} />;';
    expect(cursorViolations("x.tsx", tsx)).toEqual([
      'x.tsx:1 cursor is "pointer", not a var(--cursors-*) token',
      'x.tsx:2 cursor is "grab", not a var(--cursors-*) token',
      "x.tsx:3 sets cursor through a string key",
    ]);
  });

  it("flags every string-keyed cursor but not the word cursor used as a value", () => {
    const tsx = 'el.style["cursor"] = x;\nconst s = { "cursor": x };\nconst editor = { id: "cursor", label: "Cursor" };\nchoose("cursor");';
    expect(cursorViolations("x.tsx", tsx)).toEqual(["x.tsx:1 sets cursor through a string key", "x.tsx:2 sets cursor through a string key"]);
  });

  it("accepts every token reference and ignores comments", () => {
    const css = [...tokens.keys()].map((name) => `.a { cursor: var(${name}); }`).join("\n") + "\n/* cursor: pointer; */";
    expect(cursorViolations("x.css", css)).toEqual([]);
  });

  it("flags a --cursors-* definition outside tokens.css", () => {
    expect(definitionViolations("x.css", ":root { --cursors-action: pointer; }")).toEqual(["x.css: defines --cursors-action outside tokens.css"]);
    expect(definitionViolations("x.css", ".a { cursor: var(--cursors-action); }")).toEqual([]);
  });
});
