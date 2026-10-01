import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = path.dirname(fileURLToPath(import.meta.url));

export function options(argv, allowed) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (!flag.startsWith("--") || !allowed.includes(flag.slice(2)) || argv[index + 1] === undefined) {
      console.error(`usage: node ${path.basename(process.argv[1])} ${allowed.map(name => `[--${name} <value>]`).join(" ")}`);
      process.exit(2);
    }
    values[flag.slice(2)] = argv[++index];
  }
  return values;
}

export function loadProposal(file) {
  const resolved = path.resolve(file ?? path.join(root, "proposal.html"));
  if (!existsSync(resolved)) { console.error(`missing ${resolved}; run: node build.mjs`); process.exit(2); }
  const match = readFileSync(resolved, "utf8").match(/<script type="application\/json" id="pg-schema">([\s\S]*?)<\/script>/);
  if (!match) { console.error(`${resolved} has no #pg-schema block`); process.exit(2); }
  return { file: resolved, url: pathToFileURL(resolved).href, schema: JSON.parse(match[1]) };
}

export const sizeOf = (schema, cell) => schema.sizes[cell.size] ?? schema.frame;
export const hashOf = (schema, cell) => `#${schema.axes.map(axis => `${axis.key}=${encodeURIComponent(cell[axis.key])}`).join("&")}`;
export const defaultsOf = schema => Object.fromEntries(schema.axes.map(axis => [axis.key, axis.default ?? axis.values[0]]));

export function cells(schema) {
  let result = [{}];
  for (const axis of schema.axes) result = result.flatMap(cell => axis.values.map(value => ({ ...cell, [axis.key]: value })));
  return result;
}

export async function launch() {
  let playwright;
  try {
    playwright = await import("playwright-core");
  } catch {
    try {
      playwright = createRequire(path.join(process.cwd(), "noop.js"))("playwright-core");
    } catch {
      console.error("playwright-core is not resolvable from this workspace or the current directory.");
      console.error("With the user's approval, install it locally without touching global packages: npm install --no-save playwright-core");
      process.exit(2);
    }
  }
  const chromium = playwright.chromium ?? playwright.default?.chromium;
  try {
    return await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  } catch (error) {
    console.error(`Chromium did not launch: ${String(error.message).split("\n")[0]}`);
    console.error("With the user's approval install a browser (npx playwright-core install chromium), or set CHROME_PATH to a Chrome/Chromium executable.");
    process.exit(2);
  }
}

export const setHash = (page, hash) => page.evaluate(next => new Promise(resolve => {
  const done = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
  if (location.hash === next) return done();
  addEventListener("hashchange", done, { once: true });
  location.hash = next;
}), hash);
