import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, "_src");
const read = (...parts) => readFileSync(path.join(...parts), "utf8");
const errors = [];

const config = JSON.parse(read(root, "proposal.config.json"));
const matrix = JSON.parse(read(root, "state-matrix.json"));
const axis = key => matrix.axes.find(item => item.key === key);
const screens = axis("screen")?.values ?? [];
const states = axis("state")?.values ?? [];

const mimeByExtension = { woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf", svg: "image/svg+xml", png: "image/png", webp: "image/webp" };
const inlineUrls = (css, file) => css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (whole, _quote, target) => {
  if (target.startsWith("data:") || target.startsWith("#")) return whole;
  if (/^(?:https?:)?\/\//.test(target)) { errors.push(`${path.relative(root, file)}: external url(${target}); vendor the asset locally`); return whole; }
  const asset = path.resolve(path.dirname(file), target.split(/[?#]/)[0]);
  const type = mimeByExtension[path.extname(asset).slice(1).toLowerCase()];
  if (!existsSync(asset) || !type) { errors.push(`${path.relative(root, file)}: url(${target}) is missing or has an unsupported type`); return whole; }
  return `url("data:${type};base64,${readFileSync(asset).toString("base64")}")`;
});

const external = [config.tokens, config.fonts].filter(Boolean).map(file => path.resolve(root, file));
const missingFile = external.find(file => !existsSync(file));
if (missingFile) {
  console.error(`build error: ${path.relative(root, missingFile)} not found; fix "tokens" or "fonts" in proposal.config.json (paths are relative to this workspace)`);
  process.exit(1);
}
const externalCss = external.map(file => inlineUrls(read(file), file));
const tokenCss = externalCss.join("\n");
const themeValues = axis("theme")?.values ?? [];
if (themeValues.includes("dark") && !/\[data-theme=["']?dark["']?\]/.test(tokenCss)) errors.push('token file has no :root[data-theme="dark"] values; add them or remove "dark" from the theme axis in state-matrix.json');
if (themeValues.includes("system") && !/prefers-color-scheme:\s*dark/.test(tokenCss)) errors.push('token file has no prefers-color-scheme: dark block; add it or remove "system" from the theme axis in state-matrix.json');
const styleFiles = readdirSync(path.join(src, "styles")).filter(name => name.endsWith(".css")).sort();
const styleCss = Object.fromEntries(styleFiles.map(name => [name, read(src, "styles", name)]));

const defined = new Set([...[...externalCss, ...Object.values(styleCss)].join("\n").matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
for (const [name, css] of Object.entries(styleCss)) {
  if (name !== "aliases.css") {
    const literal = css.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|hwb|lab|lch)\(/);
    if (literal) errors.push(`styles/${name}: color literal "${literal[0]}"; use a token alias`);
  }
  for (const match of css.matchAll(/var\(\s*(--[\w-]+)/g)) if (!defined.has(match[1])) errors.push(`styles/${name}: ${match[1]} is not defined by the token file or aliases.css`);
}

const cssFor = names => [...externalCss, ...names.map(name => styleCss[name])].join("\n");
const proposalCss = cssFor(["aliases.css", "base.css", ...styleFiles.filter(name => !["aliases.css", "base.css", "index.css"].includes(name))]);
const indexCss = cssFor(["aliases.css", "base.css", "index.css"]);

const screenHtml = screens.map(id => {
  const file = path.join(src, "screens", `${id}.html`);
  if (!existsSync(file)) { errors.push(`screens/${id}.html is missing`); return ""; }
  const html = readFileSync(file, "utf8");
  for (const state of states) if (!html.includes(`data-state="${state}"`)) errors.push(`screens/${id}.html has no data-state="${state}" variant`);
  return html;
}).join("\n");

const escapeHtml = value => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (template, values) => template.replace(/\{\{(\w+)\}\}/g, (whole, key) => (key in values ? values[key] : whole));
const schema = JSON.stringify({ name: config.name, axes: matrix.axes, sizes: matrix.sizes, frame: matrix.frame }).replace(/</g, "\\u003c");
const proposal = fill(read(src, "head.html"), {
  TITLE: escapeHtml(config.name),
  NAME: escapeHtml(config.name),
  CSS: proposalCss,
  CONTROLS: read(src, "controls.html"),
  SCREENS: screenHtml,
  SCHEMA: schema,
  JS: read(src, "router.js")
});
const index = fill(read(src, "index.html"), { TITLE: escapeHtml(config.name), NAME: escapeHtml(config.name), CSS: indexCss });

const indexOut = config.indexOut ?? "index.html";
for (const [name, html] of [["proposal.html", proposal], [indexOut, index]]) {
  const remote = html.match(/(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']*|@import|<link\b/);
  if (remote) errors.push(`${name}: external reference "${remote[0]}"`);
  const unresolved = html.match(/\{\{\w+\}\}/);
  if (unresolved) errors.push(`${name}: unresolved placeholder ${unresolved[0]}`);
}

if (errors.length) {
  errors.forEach(message => console.error(`build error: ${message}`));
  process.exit(1);
}
writeFileSync(path.join(root, "proposal.html"), proposal);
writeFileSync(path.resolve(root, indexOut), index);
console.log(`built proposal.html (${proposal.length} bytes) and ${indexOut} (${index.length} bytes)`);
