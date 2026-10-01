import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { cells, defaultsOf, hashOf, launch, loadProposal, options, root, setHash, sizeOf } from "./tools-lib.mjs";

const opts = options(process.argv.slice(2), ["proposal", "out"]);
const proposal = loadProposal(opts.proposal);
const { schema } = proposal;
const outDir = path.resolve(opts.out ?? "captures");
const packageRoot = path.resolve(root, "../..");
const realOut = (() => { let existing = outDir; const rest = []; while (!existsSync(existing)) { rest.unshift(path.basename(existing)); existing = path.dirname(existing); } return path.join(realpathSync(existing), ...rest); })();
if (existsSync(path.join(packageRoot, "SKILL.md")) && (realOut === realpathSync(packageRoot) || realOut.startsWith(realpathSync(packageRoot) + path.sep))) {
  console.error(`refusing to write captures inside the skill package (${outDir}); pass --out with a directory outside it`);
  process.exit(2);
}
const defaults = defaultsOf(schema);
const themeAxis = schema.axes.find(axis => axis.key === "theme");
const concrete = themeAxis?.values.filter(value => value !== "system") ?? [];
const nameOf = cell => [cell.screen, cell.state, cell.theme, cell.size, ...schema.axes.filter(axis => !["screen", "state", "theme", "size"].includes(axis.key)).map(axis => cell[axis.key])].filter(Boolean).join("-");

const browser = await launch();
mkdirSync(outDir, { recursive: true });
const written = [];
for (const cell of cells(schema).filter(item => !themeAxis || !concrete.length || concrete.includes(item.theme))) {
  const [width, height] = sizeOf(schema, cell);
  const context = await browser.newContext({ viewport: { width: width + 48, height: height + 300 }, reducedMotion: "reduce", colorScheme: cell.theme === "dark" ? "dark" : "light" });
  const page = await context.newPage();
  await page.goto(proposal.url);
  await page.waitForFunction(() => typeof window.proposalState === "function");
  await setHash(page, hashOf(schema, cell));
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const file = path.join(outDir, `${nameOf(cell)}.png`);
  await page.locator("#pg-scaler").screenshot({ path: file });
  written.push({ cell, file });
  await context.close();
}
await browser.close();
console.log(`captured ${written.length} states into ${path.relative(process.cwd(), outDir) || "."}`);

const sheet = written.filter(({ cell }) => Object.keys(defaults).every(key => ["screen", "state"].includes(key) || cell[key] === (key === "theme" ? concrete[0] ?? defaults.theme : defaults[key])));
const tool = ["magick", "montage"].find(name => { try { execFileSync(name, ["-version"], { stdio: "ignore" }); return true; } catch { return false; } });
if (!tool) {
  console.log("overview skipped: ImageMagick (magick or montage) is not installed");
} else {
  try {
    const montage = tool === "magick" ? ["magick", "montage"] : ["montage"];
    const overview = path.join(outDir, "overview.jpg");
    execFileSync(montage[0], [...montage.slice(1), "-label", "%t", ...sheet.map(item => item.file), "-tile", "4x", "-geometry", "480x+12+12", "-pointsize", "14", "-background", "white", "-quality", "82", overview], { stdio: "pipe" });
    console.log(`overview: ${path.relative(process.cwd(), overview)} (${sheet.length} labelled states)`);
  } catch (error) {
    console.log(`overview skipped: ${String(error.stderr || error.message).split("\n")[0]}`);
  }
}
