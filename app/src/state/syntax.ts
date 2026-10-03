import type { LanguageFn } from "highlight.js";
import hljs from "highlight.js/lib/core";
import { createSignal } from "solid-js";

export type SyntaxKind = "keyword" | "string" | "number" | "comment" | "function" | "type" | "property";

export type Segment = { text: string; kind: SyntaxKind | undefined };

const loaders = {
  typescript: () => import("highlight.js/lib/languages/typescript"),
  javascript: () => import("highlight.js/lib/languages/javascript"),
  rust: () => import("highlight.js/lib/languages/rust"),
  json: () => import("highlight.js/lib/languages/json"),
  css: () => import("highlight.js/lib/languages/css"),
  xml: () => import("highlight.js/lib/languages/xml"),
  markdown: () => import("highlight.js/lib/languages/markdown"),
  yaml: () => import("highlight.js/lib/languages/yaml"),
  ini: () => import("highlight.js/lib/languages/ini"),
  python: () => import("highlight.js/lib/languages/python"),
  go: () => import("highlight.js/lib/languages/go"),
  bash: () => import("highlight.js/lib/languages/bash"),
  sql: () => import("highlight.js/lib/languages/sql"),
} satisfies Record<string, () => Promise<{ default: LanguageFn }>>;

export type LanguageId = keyof typeof loaders;

const byExtension: Record<string, LanguageId> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  rs: "rust",
  json: "json",
  jsonc: "json",
  css: "css",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  py: "python",
  go: "go",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
};

export const MAX_HIGHLIGHT_CHARS = 200_000;

export function languageOf(path: string): LanguageId | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? undefined : byExtension[name.slice(dot + 1).toLowerCase()];
}

const registered = new Set<LanguageId>();
const pending = new Map<LanguageId, Promise<void>>();

export function loadLanguage(id: LanguageId): Promise<void> {
  if (registered.has(id)) return Promise.resolve();
  const running = pending.get(id);
  if (running !== undefined) return running;
  const started = loaders[id]().then((module) => {
    hljs.registerLanguage(id, module.default);
    registered.add(id);
    pending.delete(id);
  });
  pending.set(id, started);
  return started;
}

const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };

const decode = (text: string): string => text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entity) => entities[entity] ?? entity);

const scopeKinds: Record<string, SyntaxKind> = {
  keyword: "keyword",
  "selector-tag": "keyword",
  doctag: "keyword",
  name: "keyword",
  meta: "keyword",
  string: "string",
  regexp: "string",
  char: "string",
  link: "string",
  number: "number",
  literal: "number",
  symbol: "number",
  bullet: "number",
  comment: "comment",
  quote: "comment",
  title: "function",
  section: "function",
  function: "function",
  type: "type",
  built_in: "type",
  attr: "property",
  attribute: "property",
  property: "property",
  variable: "property",
  params: "property",
  "selector-class": "property",
  "selector-id": "property",
  "selector-attr": "property",
  "selector-pseudo": "property",
  "template-variable": "property",
};

export function kindOfScope(className: string): SyntaxKind | undefined {
  const [scope = "", ...modifiers] = className.split(/\s+/);
  if (modifiers.includes("class_") || modifiers.includes("inherited__")) return "type";
  return scopeKinds[scope.replace(/^hljs-/, "")];
}

function segmentsOf(html: string): Segment[] {
  const stack: Array<SyntaxKind | undefined> = [];
  const segments: Segment[] = [];
  for (const match of html.matchAll(/<span class="([^"]*)">|<\/span>|([^<]+)/g)) {
    if (match[1] !== undefined) stack.push(kindOfScope(match[1]) ?? stack.at(-1));
    else if (match[2] === undefined) stack.pop();
    else segments.push({ text: decode(match[2]), kind: stack.at(-1) });
  }
  return segments;
}

function splitLines(segments: readonly Segment[]): Segment[][] {
  const lines: Segment[][] = [[]];
  for (const segment of segments) {
    segment.text.split("\n").forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part !== "") lines.at(-1)?.push({ text: part, kind: segment.kind });
    });
  }
  return lines;
}

const plain = (lines: readonly string[]): Segment[][] => lines.map((text) => (text === "" ? [] : [{ text, kind: undefined }]));

const [highlighting, setSyntaxHighlighting] = createSignal(true);

export { setSyntaxHighlighting };

export function highlightLines(language: LanguageId | undefined, lines: readonly string[]): Segment[][] {
  if (!highlighting() || language === undefined || !registered.has(language)) return plain(lines);
  const code = lines.join("\n");
  if (code.length > MAX_HIGHLIGHT_CHARS) return plain(lines);
  const split = splitLines(segmentsOf(hljs.highlight(code, { language, ignoreIllegals: true }).value));
  return lines.map((_, index) => split[index] ?? []);
}
