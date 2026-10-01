import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cells, defaultsOf, hashOf, launch, loadProposal, options, setHash, sizeOf } from "./tools-lib.mjs";

const opts = options(process.argv.slice(2), ["proposal", "rules"]);
const proposal = loadProposal(opts.proposal);
const { schema } = proposal;
const workspace = path.dirname(proposal.file);
const rulesFile = opts.rules ?? path.join(workspace, "rules.json");
const rules = existsSync(rulesFile) ? JSON.parse(readFileSync(rulesFile, "utf8")) : [];
const defaults = defaultsOf(schema);
const axisKeys = schema.axes.map(axis => axis.key);

const failures = [];
const fail = message => failures.push(message);
const counts = { cells: 0, focus: 0, roundTrips: 0, rules: 0 };

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const external = new Set();
page.on("console", message => { if (message.type() === "error") fail(`console error: ${message.text()}`); });
page.on("pageerror", error => fail(`page error: ${error.message}`));
page.on("request", request => { if (!/^(?:file|data|blob|about):/.test(request.url())) external.add(request.url()); });

const measure = rule => {
  const scale = rule.scale;
  const frame = document.getElementById("pg-frame");
  const found = [...frame.querySelectorAll(rule.selector)].filter(element => element.offsetParent !== null);
  if (!found.length) return rule.optional ? [] : ["no visible element matches"];
  const problems = [];
  for (const element of found) {
    const box = element.getBoundingClientRect();
    const width = box.width / scale;
    const height = box.height / scale;
    const ratio = width / height;
    const checks = [["minWidth", width >= rule.minWidth], ["maxWidth", width <= rule.maxWidth], ["minHeight", height >= rule.minHeight], ["maxHeight", height <= rule.maxHeight], ["minRatio", ratio >= rule.minRatio], ["maxRatio", ratio <= rule.maxRatio]];
    for (const [key, pass] of checks) if (rule[key] !== undefined && !pass) problems.push(`${key} ${rule[key]} violated by ${width.toFixed(0)}x${height.toFixed(0)}`);
  }
  return problems;
};

const inspectLayout = () => {
  const frame = document.getElementById("pg-frame");
  const clipped = [];
  for (const element of [frame, ...frame.querySelectorAll("*")]) {
    if (element !== frame && element.offsetParent === null) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || !/hidden|clip/.test(`${style.overflowX} ${style.overflowY}`) || style.textOverflow === "ellipsis") continue;
    if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) clipped.push(`${element.tagName.toLowerCase()}.${String(element.className).trim().split(/\s+/)[0]}`);
  }
  const doc = document.documentElement;
  return { pageOverflow: doc.scrollWidth > doc.clientWidth, clipped, visible: frame.querySelectorAll(".screen:not([hidden]) > [data-state]:not([hidden])").length, scale: Number(document.getElementById("pg-scaler").dataset.scale) };
};

const inCell = (rule, cell) => Object.entries(rule.when ?? {}).every(([key, expected]) => [].concat(expected).includes(cell[key]));

await page.goto(proposal.url);
await page.waitForFunction(() => typeof window.proposalState === "function");

const state = () => page.evaluate(() => ({ ...window.proposalState(), hash: location.hash, pressed: Object.fromEntries([...document.querySelectorAll("#pg-controls button[aria-pressed=true]")].map(button => [button.dataset.axis, button.dataset.value])) }));
const expectState = (label, actual, expected) => {
  for (const key of axisKeys) if (actual[key] !== expected[key]) fail(`${label}: state ${key}=${actual[key]}, expected ${expected[key]}`);
  for (const key of axisKeys) if (actual.pressed[key] !== expected[key]) fail(`${label}: control ${key} shows ${actual.pressed[key]}, expected ${expected[key]}`);
  if (actual.hash !== hashOf(schema, expected)) fail(`${label}: hash ${actual.hash}, expected ${hashOf(schema, expected)}`);
};

await page.goto(`${proposal.url}#screen=__unknown__&${axisKeys[1]}=__unknown__&stray=1`);
await page.waitForFunction(() => typeof window.proposalState === "function");
expectState("unknown params fall back", await state(), defaults);
counts.roundTrips++;

const target = Object.fromEntries(schema.axes.map(axis => [axis.key, axis.values[axis.values.length - 1]]));
await page.goto(`${proposal.url}${hashOf(schema, target)}`);
await page.waitForFunction(() => typeof window.proposalState === "function");
expectState("hash to controls", await state(), target);
counts.roundTrips++;

for (const axis of schema.axes) {
  const before = await state();
  const next = axis.values.find(value => value !== before[axis.key]);
  if (next === undefined) continue;
  await page.click(`#pg-controls button[data-axis="${axis.key}"][data-value="${next}"]`);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const after = await state();
  expectState(`control ${axis.key} to hash`, after, { ...before, [axis.key]: next });
  if (after.hash === before.hash) continue;
  await page.goBack();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expectState(`back after ${axis.key}`, await state(), before);
  counts.roundTrips += 2;
}

const ordered = cells(schema).sort((left, right) => (left.size ?? "").localeCompare(right.size ?? ""));
let viewport = "";
for (const cell of ordered) {
  const [width, height] = sizeOf(schema, cell);
  if (viewport !== `${width}x${height}`) {
    viewport = `${width}x${height}`;
    await page.setViewportSize({ width, height: height + 400 });
  }
  await setHash(page, hashOf(schema, cell));
  const layout = await page.evaluate(inspectLayout);
  const label = axisKeys.map(key => cell[key]).join("/");
  counts.cells++;
  if (layout.visible !== 1) fail(`${label}: ${layout.visible} visible state variants, expected 1`);
  if (layout.pageOverflow) fail(`${label}: page overflows horizontally at ${width}px`);
  if (layout.clipped.length) fail(`${label}: clipped content in ${[...new Set(layout.clipped)].join(", ")}`);
  for (const rule of rules.filter(item => inCell(item, cell))) {
    counts.rules++;
    for (const problem of await page.evaluate(measure, { ...rule, scale: layout.scale }).catch(() => ["invalid selector"])) fail(`${label}: rule "${rule.name}": ${problem}`);
  }
}

await page.setViewportSize({ width: 1440, height: 1000 });
const themeAxis = schema.axes.find(axis => axis.key === "theme");
const themes = themeAxis ? themeAxis.values.filter(value => value !== "system") : [undefined];
const focusable = "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
for (const theme of themes.length ? themes : [defaults.theme]) {
  for (const screen of schema.axes.find(axis => axis.key === "screen").values) {
    for (const stateName of schema.axes.find(axis => axis.key === "state").values) {
      const cell = { ...defaults, screen, state: stateName, ...(theme ? { theme } : {}) };
      await page.goto("about:blank");
      await page.goto(`${proposal.url}${hashOf(schema, cell)}`);
      await page.waitForFunction(() => typeof window.proposalState === "function");
      const expected = await page.evaluate(selector => [...document.querySelectorAll(`#pg-controls ${selector}, #pg-link, #pg-frame ${selector}`)].filter(element => element.offsetParent !== null).length, focusable);
      let tabbed = 0;
      for (let press = 0; press < Math.min(expected + 5, 80); press++) {
        await page.keyboard.press("Tab");
        const result = await page.evaluate(() => {
          const element = document.activeElement;
          if (!element || element === document.body) return null;
          if (!element.matches("input, button, a, select, textarea, [tabindex]")) return { skip: true };
          const style = getComputedStyle(element);
          return { name: `${element.tagName.toLowerCase()}${element.dataset.value ? `[${element.dataset.value}]` : ""}`, visible: (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none" };
        });
        if (!result) break;
        if (result.skip) continue;
        tabbed++;
        counts.focus++;
        if (!result.visible) fail(`${screen}/${stateName}/${theme ?? "-"}: focus not visible on ${result.name}`);
      }
      if (tabbed < expected) fail(`${screen}/${stateName}/${theme ?? "-"}: reached ${tabbed} of ${expected} focusable elements by Tab`);
    }
  }
}

const configFile = path.join(workspace, "proposal.config.json");
const indexFile = path.resolve(workspace, existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")).indexOut ?? "index.html" : "index.html");
if (existsSync(indexFile)) await page.goto(pathToFileURL(indexFile).href);

await browser.close();
if (external.size) fail(`external requests: ${[...external].join(", ")}`);

console.log(`cells ${counts.cells}, hash checks ${counts.roundTrips}, focus stops ${counts.focus}, geometry rule evaluations ${counts.rules}, external requests ${external.size}`);
if (failures.length) {
  [...new Set(failures)].slice(0, 30).forEach(message => console.error(`FAIL ${message}`));
  console.error(`${failures.length} failures`);
  process.exit(1);
}
console.log("verify passed");
