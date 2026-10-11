import DOMPurify from "dompurify";
import { Marked, type Token } from "marked";
import { highlightLines, languageOf, loadLanguage, type LanguageId } from "./syntax";

type MarkdownOptions = { file?: string; previewBase?: string };
type Footnote = { tokens: Token[]; number?: number; references: string[] };

const escape = (text: string): string => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

function codeLanguage(info: string | undefined): LanguageId | undefined {
  const name = info?.trim().split(/\s+/)[0]?.toLowerCase();
  if (!name) return undefined;
  return languageOf(`code.${({ typescript: "ts", javascript: "js", rust: "rs", python: "py", shell: "sh", shellscript: "sh", html: "html", xml: "xml", yml: "yaml", yaml: "yaml", toml: "toml", ini: "toml" } as Record<string, string>)[name] ?? name}`);
}

function highlightedCode(text: string, language: LanguageId | undefined): string {
  return highlightLines(language, text.split("\n")).map((line) => line.map((part) => part.kind === undefined ? escape(part.text) : `<span class="syn-${part.kind}">${escape(part.text)}</span>`).join("")).join("\n");
}

function repositoryLink(href: string, file: string): { file: string; fragment?: string } | undefined {
  if (/^[\s/\\]|^[a-z][a-z\d+.-]*:/i.test(href)) return undefined;
  try {
    const [path = "", fragment] = href.split("#", 2);
    const decoded = decodeURIComponent(path.split("?", 1)[0] ?? "");
    if (!decoded || /[\\\u0000-\u001f]/.test(decoded) || decoded.startsWith("/")) return undefined;
    const parts = file.split("/").slice(0, -1);
    for (const part of decoded.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") { if (parts.length === 0) return undefined; parts.pop(); }
      else parts.push(part);
    }
    return parts.length === 0 ? undefined : { file: parts.join("/"), fragment };
  } catch { return undefined; }
}

function sanitize(html: string, options: MarkdownOptions): string {
  DOMPurify.addHook("uponSanitizeAttribute", (node, attribute) => {
    if (node.nodeName === "IMG" && attribute.attrName === "src") {
      try {
        const base = options.previewBase;
        const url = new URL(attribute.attrValue, base);
        if (base === undefined || url.origin !== new URL(base).origin || !url.pathname.startsWith(new URL(base).pathname.split("/").slice(0, 2).join("/") + "/")) attribute.keepAttr = false;
        else attribute.attrValue = url.href;
      } catch { attribute.keepAttr = false; }
    }
    if (node.nodeName === "A" && attribute.attrName === "href" && !attribute.attrValue.startsWith("#")) {
      node.setAttribute("title", attribute.attrValue);
      if (repositoryLink(attribute.attrValue, options.file ?? "") === undefined) attribute.keepAttr = false;
    }
  });
  let clean: DocumentFragment;
  try {
    clean = DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["form", "input", "button", "select", "textarea", "label", "datalist", "option", "optgroup", "audio", "video", "source", "track", "area"],
      FORBID_ATTR: ["style", "srcset", "background", "download", "data-markdown-file", "data-markdown-fragment"],
      RETURN_DOM_FRAGMENT: true,
    });
  } finally { DOMPurify.removeHook("uponSanitizeAttribute"); }
  for (const link of clean.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href")!;
    if (href.startsWith("#")) continue;
    const target = repositoryLink(href, options.file ?? "");
    link.removeAttribute("href");
    if (target !== undefined) {
      link.setAttribute("href", "#");
      link.setAttribute("data-markdown-file", target.file);
      if (target.fragment !== undefined) link.setAttribute("data-markdown-fragment", target.fragment);
    }
  }
  const holder = document.createElement("div");
  holder.append(clean);
  return holder.innerHTML;
}

export async function renderMarkdown(source: string, options: MarkdownOptions = {}): Promise<string> {
  const front = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  const notes = new Map<string, Footnote>();
  const usedIds = new Set<string>();
  const md = new Marked({
    gfm: true,
    async: true,
    walkTokens: (token) => token.type === "code" && codeLanguage(token.lang) !== undefined ? loadLanguage(codeLanguage(token.lang)!) : undefined,
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const holder = document.createElement("div");
        holder.innerHTML = DOMPurify.sanitize(html);
        const slug = holder.textContent.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").replace(/ /g, "-");
        let id = slug;
        let suffix = 0;
        while (usedIds.has(id)) id = `${slug}-${++suffix}`;
        usedIds.add(id);
        return `<h${depth} id="${escape(id)}">${html}</h${depth}>\n`;
      },
      code({ text, lang }) { return `<pre><code>${highlightedCode(text, codeLanguage(lang))}</code></pre>\n`; },
      checkbox({ checked }) { return `<span class="markdown-task" role="checkbox" aria-checked="${checked}" aria-disabled="true" aria-label="${checked ? "Completed" : "Not completed"}" title="Read-only task">${checked ? "✓" : ""}</span> `; },
      tablecell({ tokens, header, align }) {
        const tag = header ? "th" : "td";
        return `<${tag}${align === null ? "" : ` class="markdown-align-${align}"`}>${this.parser.parseInline(tokens)}</${tag}>\n`;
      },
      table({ header, rows }) {
        const head = header.map((cell) => this.tablecell(cell)).join("");
        const body = rows.map((row) => `<tr>${row.map((cell) => this.tablecell(cell)).join("")}</tr>`).join("");
        return `<div class="markdown-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`;
      },
    },
    extensions: [
      {
        name: "markdownAlert",
        level: "block",
        tokenizer(src) {
          const match = /^ {0,3}>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)((?: {0,3}>[^\n]*(?:\n|$))*)/.exec(src);
          if (!match) return undefined;
          return { type: "markdownAlert", raw: match[0], alert: match[1], tokens: this.lexer.blockTokens((match[2] ?? "").replace(/^ {0,3}>[ \t]?/gm, "")) };
        },
        renderer(token) {
          const kind = String(token.alert);
          return `<div class="markdown-alert markdown-alert-${kind.toLowerCase()}"><p class="markdown-alert-title">${kind[0]}${kind.slice(1).toLowerCase()}</p>${this.parser.parse(token.tokens ?? [])}</div>\n`;
        },
        childTokens: ["tokens"],
      },
      {
        name: "markdownFootnoteDefinition",
        level: "block",
        start: (src) => src.match(/^ {0,3}\[\^[^\]\n]+\]:/m)?.index,
        tokenizer(src) {
          const match = /^ {0,3}\[\^([^\]\n]+)\]:[ \t]*([^\n]*)(?:\n|$)((?:(?: {4}|\t)[^\n]*(?:\n|$)|\n(?=(?: {4}|\t)))*)/.exec(src);
          if (!match) return undefined;
          const tokens = this.lexer.blockTokens(`${match[2]}\n${(match[3] ?? "").replace(/^(?: {4}|\t)/gm, "")}`);
          const key = match[1]!.toLowerCase();
          if (!notes.has(key)) notes.set(key, { tokens, references: [] });
          return { type: "markdownFootnoteDefinition", raw: match[0], tokens };
        },
        renderer: () => "",
        childTokens: ["tokens"],
      },
      {
        name: "markdownFootnoteReference",
        level: "inline",
        start: (src) => src.indexOf("[^"),
        tokenizer(src) {
          const match = /^\[\^([^\]\n]+)\]/.exec(src);
          return match ? { type: "markdownFootnoteReference", raw: match[0], key: match[1]!.toLowerCase() } : undefined;
        },
        renderer(token) {
          const note = notes.get(String(token.key));
          if (!note) return escape(token.raw);
          note.number ??= [...notes.values()].filter((entry) => entry.number !== undefined).length + 1;
          const ref = `markdown-fnref-${note.number}-${note.references.length + 1}`;
          note.references.push(ref);
          return `<sup><a id="${ref}" href="#markdown-fn-${note.number}" aria-label="Footnote ${note.number}">${note.number}</a></sup>`;
        },
      },
    ],
  });
  let frontHtml = "";
  if (front !== null) {
    await loadLanguage("yaml");
    frontHtml = `<details class="markdown-front-matter"><summary>Front matter</summary><pre><code>${highlightedCode(front[1]!.replace(/\r\n/g, "\n"), "yaml")}</code></pre></details>\n`;
  }
  const html = await md.parse(front === null ? source : source.slice(front[0].length));
  const bodies: string[] = [];
  const rendered = new Set<Footnote>();
  for (;;) {
    const next = [...notes.values()].filter((note) => note.number !== undefined && !rendered.has(note)).sort((a, b) => a.number! - b.number!)[0];
    if (!next) break;
    rendered.add(next);
    bodies.push(`<li id="markdown-fn-${next.number}">${md.parser(next.tokens)}${next.references.map((ref, index) => `<a class="markdown-footnote-backref" href="#${ref}" aria-label="Back to reference ${next.number}${index === 0 ? "" : ` (${index + 1})`}">↩</a>`).join(" ")}</li>`);
  }
  return sanitize(frontHtml + html + (bodies.length === 0 ? "" : `<section class="markdown-footnotes" aria-label="Footnotes"><hr><ol>${bodies.join("")}</ol></section>`), options);
}

export function handleMarkdownClick(event: MouseEvent, container: HTMLElement, openFile: (file: string, fragment?: string) => void): void {
  const link = event.target instanceof Element ? event.target.closest("a") : null;
  if (!link || !container.contains(link)) return;
  const file = link.getAttribute("data-markdown-file");
  const href = link.getAttribute("href");
  if (file !== null) {
    event.preventDefault();
    openFile(file, link.getAttribute("data-markdown-fragment") ?? undefined);
  } else if (href?.startsWith("#")) {
    event.preventDefault();
    try {
      const id = decodeURIComponent(href.slice(1));
      [...container.querySelectorAll<HTMLElement>("[id]")].find((element) => element.id === id)?.scrollIntoView({ block: "start" });
    } catch { return; }
  }
}
