import { createMemo, createRoot, createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { highlightLines, kindOfScope, languageOf, loadLanguage, MAX_HIGHLIGHT_CHARS, setSyntaxHighlighting } from "./syntax";

afterEach(() => setSyntaxHighlighting(true));

describe("language by file extension", () => {
  it.each([
    ["src/app.ts", "typescript"],
    ["src/View.TSX", "typescript"],
    ["a/b/index.js", "javascript"],
    ["x.jsx", "javascript"],
    ["crates/core/src/lib.rs", "rust"],
    ["package.json", "json"],
    ["styles/app.css", "css"],
    ["index.html", "xml"],
    ["README.md", "markdown"],
    ["ci.yml", "yaml"],
    ["Cargo.toml", "ini"],
    ["tool.py", "python"],
    ["main.go", "go"],
    ["scripts/sync.sh", "bash"],
    ["schema.sql", "sql"],
  ])("maps %s to %s", (path, language) => {
    expect(languageOf(path)).toBe(language);
  });

  it("returns nothing for an unknown extension, a bare name, or a dotfile", () => {
    expect(languageOf("notes.xyz")).toBeUndefined();
    expect(languageOf("Makefile")).toBeUndefined();
    expect(languageOf(".gitignore")).toBeUndefined();
    expect(languageOf("dir.d/Makefile")).toBeUndefined();
  });
});

describe("scope kinds", () => {
  it("maps highlight.js scopes to the seven syntax kinds and ignores the rest", () => {
    expect(kindOfScope("hljs-keyword")).toBe("keyword");
    expect(kindOfScope("hljs-string")).toBe("string");
    expect(kindOfScope("hljs-number")).toBe("number");
    expect(kindOfScope("hljs-comment")).toBe("comment");
    expect(kindOfScope("hljs-title function_")).toBe("function");
    expect(kindOfScope("hljs-title class_")).toBe("type");
    expect(kindOfScope("hljs-built_in")).toBe("type");
    expect(kindOfScope("hljs-attr")).toBe("property");
    expect(kindOfScope("hljs-operator")).toBeUndefined();
  });
});

describe("highlighting", () => {
  it("returns plain lines while the language is unknown or not loaded", () => {
    expect(highlightLines(undefined, ["let x = 1", ""])).toEqual([[{ text: "let x = 1", kind: undefined }], []]);
    expect(highlightLines("go", ["func main() {}"])[0]).toEqual([{ text: "func main() {}", kind: undefined }]);
  });

  it("tags keywords, numbers and comments after the language loaded and keeps every character", async () => {
    await loadLanguage("rust");
    const [line] = highlightLines("rust", ["fn main() { let n = 1; } // done"]);
    expect(line?.map((segment) => segment.text).join("")).toBe("fn main() { let n = 1; } // done");
    expect(line).toContainEqual({ text: "fn", kind: "keyword" });
    expect(line).toContainEqual({ text: "1", kind: "number" });
    expect(line).toContainEqual({ text: "// done", kind: "comment" });
  });

  it("decodes entities so the text equals the input", async () => {
    await loadLanguage("typescript");
    const [line] = highlightLines("typescript", ['if (a < b && c > "x") {}']);
    expect(line?.map((segment) => segment.text).join("")).toBe('if (a < b && c > "x") {}');
  });

  it("carries a comment across lines so an inner line stays a comment", async () => {
    await loadLanguage("css");
    const lines = highlightLines("css", ["/* first", "   second */", "a { color: red }"]);
    expect(lines).toHaveLength(3);
    expect(lines[1]?.[0]).toMatchObject({ kind: "comment" });
    expect(lines[2]?.some((segment) => segment.kind === "comment")).toBe(false);
  });

  it("skips highlighting above the size limit", async () => {
    await loadLanguage("json");
    const long = `"${"a".repeat(MAX_HIGHLIGHT_CHARS)}"`;
    expect(highlightLines("json", [long])[0]).toEqual([{ text: long, kind: undefined }]);
  });
});

describe("syntax highlighting switch", () => {
  it("returns plain text for a loaded language while highlighting is off and tags it again when on", async () => {
    await loadLanguage("rust");
    setSyntaxHighlighting(false);

    expect(highlightLines("rust", ["fn main() {}"])[0]).toEqual([{ text: "fn main() {}", kind: undefined }]);

    setSyntaxHighlighting(true);
    expect(highlightLines("rust", ["fn main() {}"])[0]).toContainEqual({ text: "fn", kind: "keyword" });
  });

  it("re-runs a memo that highlights when the switch changes", async () => {
    await loadLanguage("rust");
    const seen = createRoot((dispose) => {
      const [lines] = createSignal(["fn main() {}"]);
      const memo = createMemo(() => highlightLines("rust", lines()));
      return { memo, dispose };
    });

    expect(seen.memo()[0]?.some((segment) => segment.kind === "keyword")).toBe(true);
    setSyntaxHighlighting(false);
    expect(seen.memo()[0]?.some((segment) => segment.kind === "keyword")).toBe(false);
    seen.dispose();
  });
});
