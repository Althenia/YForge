import { afterEach, describe, expect, it, vi } from "vitest";
import { renderMarkdown, handleMarkdownClick } from "./markdown";

const base = "http://127.0.0.1:4321/token/docs/README.md";

async function render(text: string, previewBase: string | null = base) {
  const article = document.createElement("article");
  article.innerHTML = await renderMarkdown(text, { file: "docs/README.md", previewBase: previewBase ?? undefined });
  return article;
}

afterEach(() => vi.restoreAllMocks());

describe("shared Markdown", () => {
  it("renders leading YAML as collapsed, highlighted front matter without flattening it", async () => {
    const article = await render("---\nname: Forge\napproved: true\n---\n\n# Notes");
    const front = article.querySelector("details");
    expect(front?.open).toBe(false);
    expect(front?.querySelector("summary")?.textContent).toBe("Front matter");
    expect(front?.querySelector("code")?.textContent).toBe("name: Forge\napproved: true");
    expect(front?.querySelector(".syn-property")?.textContent).toBe("name:");
    expect(article.querySelector("h1")?.textContent).toBe("Notes");
    expect(article.querySelector("hr")).toBeNull();
  });

  it("keeps ordinary thematic breaks and unclosed front matter as Markdown", async () => {
    expect((await render("Paragraph\n\n---\n\nNext")).querySelector("hr")).not.toBeNull();
    expect((await render("---\nname: Forge")).querySelector("details")).toBeNull();
    expect((await render("---\r\nname: Forge\r\n---\r\nBody")).querySelector("details code")?.textContent).toBe("name: Forge");
  });

  it("renders GFM tables, read-only tasks, strikethrough, autolinks, quotes and nested lists", async () => {
    const article = await render("| Name | Value |\n| :--- | ---: |\n| Forge | 1 |\n\n- [x] Done\n- [ ] Next\n\n~~Old~~ https://example.test\n\n> Quote\n\n- Parent\n  - Child");
    expect(article.querySelector("th")?.textContent).toBe("Name");
    expect(article.querySelector("td")?.textContent).toBe("Forge");
    expect([...article.querySelectorAll('[role="checkbox"]')].map((box) => [box.getAttribute("aria-checked"), box.getAttribute("aria-disabled")])).toEqual([["true", "true"], ["false", "true"]]);
    expect(article.querySelector("del")?.textContent).toBe("Old");
    expect(article.querySelector("a")?.getAttribute("title")).toBe("https://example.test");
    expect(article.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(article.querySelector("blockquote")?.textContent).toContain("Quote");
    expect(article.querySelector("li ul li")?.textContent).toBe("Child");
  });

  it("gives all heading levels stable GitHub-style slugs, including collisions and Unicode", async () => {
    const text = "# Hello, *world*!\n## Hello, world!\n### hello-world-1\n#### Café 中文\n##### A_B\n###### `Code` &amp; text";
    const ids = ["hello-world", "hello-world-1", "hello-world-1-1", "café-中文", "a_b", "code--text"];
    expect([...(await render(text)).querySelectorAll("h1,h2,h3,h4,h5,h6")].map((head) => head.id)).toEqual(ids);
    expect([...(await render(text)).querySelectorAll("h1,h2,h3,h4,h5,h6")].map((head) => head.id)).toEqual(ids);
  });

  it("highlights fences by info string and escapes unknown-language code", async () => {
    const article = await render("```ts title=demo\nconst x = 1;\n```\n\n```yaml\nname: Forge\n```\n\n```unknown\n<script>bad()</script>\n```");
    expect(article.querySelector("pre .syn-keyword")?.textContent).toBe("const");
    expect(article.querySelector("pre .syn-property")?.textContent).toBe("name:");
    expect(article.querySelectorAll("pre code")[2]?.textContent).toBe("<script>bad()</script>");
    expect(article.querySelector("script")).toBeNull();
  });

  it.each(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"])("renders a %s alert with a visible word title and Markdown content", async (kind) => {
    const article = await render(`> [!${kind}]\n> **Read this**\n>\n> - Item`);
    expect(article.querySelector(".markdown-alert-title")?.textContent).toBe(kind[0] + kind.slice(1).toLowerCase());
    expect(article.querySelector(".markdown-alert strong")?.textContent).toBe("Read this");
    expect(article.querySelector(".markdown-alert li")?.textContent).toBe("Item");
  });

  it("renders repeated footnotes with numbered references, multiline bodies, and back links", async () => {
    const article = await render("See[^a] and again[^a], then[^b].\n\n[^a]: **First**\n\n    Another paragraph.\n[^b]: Second");
    const refs = [...article.querySelectorAll("sup a")];
    expect(refs.map((ref) => ref.textContent)).toEqual(["1", "1", "2"]);
    expect(new Set(refs.map((ref) => ref.id)).size).toBe(3);
    expect(article.querySelector(".markdown-footnotes strong")?.textContent).toBe("First");
    expect(article.querySelector(".markdown-footnotes")?.textContent).toContain("Another paragraph.");
    expect(article.querySelectorAll(".markdown-footnote-backref")).toHaveLength(3);
    expect((await render("Unknown[^missing] and `[^code]`.")).textContent).toContain("Unknown[^missing]");
    expect((await render("```\n[^a]: not a definition\n```\n\nText[^a]")).querySelector(".markdown-footnotes")).toBeNull();
  });

  it("sanitizes HTML and forbids styles, srcset, executable attributes and forged navigation metadata", async () => {
    const article = await render('<script>bad()</script><p style="color:red" onclick="bad()">Text</p><img src="../logo.png" srcset="https://example.test/a 2x" onerror="bad()"><a data-markdown-file="secret" href="javascript:bad()">Bad</a><iframe src="https://example.test"></iframe>');
    expect(article.querySelector("script,iframe,[style],[srcset],[onclick],[onerror],[data-markdown-file]")).toBeNull();
    expect(article.querySelector("a")?.hasAttribute("href")).toBe(false);
  });

  it("resolves images only inside the preview revision and refuses escapes and absent bases", async () => {
    const article = await render("![OK](../logo.png) ![Outside](../../secret.png) ![External](https://example.test/pixel) ![Data](data:image/png;base64,AA) ![Other revision](/other/a.png) ![Same revision](/token/a.png)");
    expect([...article.querySelectorAll("img")].map((image) => image.getAttribute("src"))).toEqual(["http://127.0.0.1:4321/token/logo.png", null, null, null, null, "http://127.0.0.1:4321/token/a.png"]);
    expect((await render("![No base](logo.png)", null)).querySelector("img")?.hasAttribute("src")).toBe(false);
  });

  it.each([base, null])("removes raw forms and unowned controls with preview base %s while retaining their readable content", async (previewBase) => {
    const article = await render('<form action="https://example.invalid/collect" method="post"><fieldset><legend>Fields</legend><label for="owned-control">Name<input name="name"><input type="image" src="https://example.invalid/input"><input type="checkbox" checked></label><button type="submit" formaction="https://example.invalid/submit">Continue</button><select><optgroup label="Group"><option>Choice</option></optgroup></select><textarea>Notes</textarea><datalist><option>Suggestion</option></datalist></fieldset></form>', previewBase);
    expect(article.querySelector("form,input,button,select,textarea,label,datalist,option,optgroup,[action],[formaction]")).toBeNull();
    expect(article.textContent).toContain("Fields");
    expect(article.textContent).toContain("Name");
    expect(article.textContent).toContain("Continue");
    expect(article.textContent).toContain("Notes");
  });

  it("removes raw media and non-image resource attributes without removing revision-scoped images", async () => {
    const article = await render('<video src="https://example.invalid/pixel" poster="https://example.invalid/poster" controls><source src="https://example.invalid/source"><track src="https://example.invalid/track">Video fallback</video><audio src="https://example.invalid/audio" controls>Audio fallback</audio><picture><source srcset="https://example.invalid/source 2x"><img src="../logo.png" alt="Logo"></picture><table background="https://example.invalid/background"><tr><td>Table</td></tr></table>');
    expect(article.querySelector("video,audio,source,track,[poster],[background],[srcset],[controls]")).toBeNull();
    expect([...article.querySelectorAll("[src]")].map((element) => [element.tagName, element.getAttribute("src")])).toEqual([["IMG", "http://127.0.0.1:4321/token/logo.png"]]);
    expect(article.querySelector("td")?.textContent).toBe("Table");
  });

  it("keeps raw anchors intercepted and removes alternate navigation and download attributes", async () => {
    const article = await render('<a href="other.md#notes" download="copy" ping="https://example.invalid/ping" target="_blank">File</a><a href="#local" download>Local</a><a href="https://example.invalid/visit">External</a><map><area href="https://example.invalid/area" alt="Map link"></map>');
    expect(article.querySelector("area,[download],[ping],[target],[action],[formaction]")).toBeNull();
    const links = article.querySelectorAll("a");
    expect([...links].map((link) => link.getAttribute("href"))).toEqual(["#", "#local", null]);
    expect(links[2]?.getAttribute("title")).toBe("https://example.invalid/visit");
    const open = vi.fn();
    article.addEventListener("click", (event) => handleMarkdownClick(event, article, open));
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    links[0]?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("docs/other.md", "notes");
  });

  it("retains passive raw HTML formatting, tables, details, summaries, anchors and safe images", async () => {
    const article = await render('<details><summary>More <em>context</em></summary><p id="local"><strong>Bold</strong> <kbd>Enter</kbd> H<sub>2</sub>O <sup>2</sup> <mark>Marked</mark> <code>inline</code></p><table><tr><th>Header</th><td>Cell</td></tr></table><a href="#local">Jump</a><img src="../logo.png" alt="Logo"><img src="https://example.invalid/pixel" alt="External"></details>');
    expect(article.querySelector("details")?.open).toBe(false);
    expect(article.querySelector("summary em")?.textContent).toBe("context");
    for (const [tag, text] of [["strong", "Bold"], ["kbd", "Enter"], ["sub", "2"], ["sup", "2"], ["mark", "Marked"], ["code", "inline"], ["th", "Header"], ["td", "Cell"]]) expect(article.querySelector(tag!)?.textContent).toBe(text);
    expect(article.querySelector("p")?.id).toBe("local");
    expect(article.querySelector("a")?.getAttribute("href")).toBe("#local");
    expect([...article.querySelectorAll("img")].map((image) => [image.getAttribute("src"), image.alt])).toEqual([["http://127.0.0.1:4321/token/logo.png", "Logo"], [null, "External"]]);
  });

  it("opens relative repository files, keeps fragments local, and makes external links text with URL tooltips", async () => {
    const article = await render("[File](../src/a.ts) [Encoded](./a%20b.md) [Top](#top) [Visit](https://example.test) [Escape](../../secret) [Absolute](/etc/hosts)");
    const links = article.querySelectorAll<HTMLAnchorElement>("a");
    const open = vi.fn();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    article.addEventListener("click", (clicked) => handleMarkdownClick(clicked, article, open));
    links[0]?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("src/a.ts", undefined);
    links[1]?.click();
    expect(open).toHaveBeenLastCalledWith("docs/a b.md", undefined);
    expect(links[2]?.getAttribute("href")).toBe("#top");
    expect(links[3]?.getAttribute("title")).toBe("https://example.test");
    for (const index of [3, 4, 5]) expect(links[index]?.hasAttribute("href")).toBe(false);
  });

  it("scrolls fragments only to a matching target inside the preview", async () => {
    const article = await render("[Jump](#hello)\n\n# Hello");
    const heading = article.querySelector("h1")!;
    const scroll = vi.fn();
    heading.scrollIntoView = scroll;
    article.addEventListener("click", (event) => handleMarkdownClick(event, article, vi.fn()));
    article.querySelector("a")?.click();
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
  });

  it("refuses encoded repository escapes and forwards a relative file's fragment", async () => {
    const article = await render("[Escape](%2e%2e/%2e%2e/secret) [Backslash](..%5csecret) [Fragment](other.md#notes)");
    expect([...article.querySelectorAll("a")].slice(0, 2).every((link) => !link.hasAttribute("href"))).toBe(true);
    const open = vi.fn();
    article.addEventListener("click", (event) => handleMarkdownClick(event, article, open));
    article.querySelectorAll("a")[2]?.click();
    expect(open).toHaveBeenCalledWith("docs/other.md", "notes");
  });
});
