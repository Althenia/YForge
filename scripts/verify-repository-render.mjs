import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "../app/node_modules/vite/dist/node/index.js";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { chromium } = require("playwright-core");
let fixtureCode = "";
const server = await createServer({ root: new URL("../app", import.meta.url).pathname, configFile: new URL("../app/vite.config.ts", import.meta.url).pathname, cacheDir: new URL("../app/node_modules/.vite-repository-render", import.meta.url).pathname, server: { port: 1421, strictPort: true, host: "127.0.0.1" }, plugins: [{ name: "repository-render-fixture", resolveId: (id) => id === "virtual:repository-render" ? "\0virtual:repository-render" : undefined, load: (id) => id === "\0virtual:repository-render" ? fixtureCode : undefined }] });
await server.listen();
let browser;
let page;
try {
  browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error("page error", error.message); });
  fixtureCode = `
import '/src/styles/tokens.css';import '/src/styles/app.css';import '/src/styles/changes.css';
import {createComponent} from 'solid-js/web';
import {createSignal,Show} from 'solid-js';
import {mockIPC} from '@tauri-apps/api/mocks';
import {CommitInspector} from '/src/components/CommitInspector.tsx';
import {EmptyRepository} from '/src/components/EmptyRepository.tsx';
import {GraphPanel} from '/src/components/GraphPanel.tsx';
import {readGeometry} from '/src/graph/geometry.ts';
import {mountWithApp,testSession,testUiPrefs} from '/src/components/testkit.tsx';
import {createRepoActions} from '/src/state/repoActions.ts';
const person={name:'Synthetic',email:'synthetic@example.test',time:1700000000};
const snapshot={root:'/r',head:{kind:'branch',name:'main',sha:'aaa'},operation:null,remotes:[],remote_branches:[],branches:['main'],files:[],counts:{conflicted:0}};
const [sha,setSha]=createSignal('large');window.selectCommit=setSha;
mockIPC((cmd,args)=>cmd==='commit_details'?{sha:args.sha,summary:args.sha,body:'',author:person,committer:person,parents:['aaa'],refs:[],files:Array.from({length:args.sha==='large'?5000:24},(_,i)=>({path:'src/file-'+i+'.txt',status:'modified',original_path:null,additions:400,deletions:20}))}:cmd==='repo_graph'?{total:6575,carried:[],rows:Array.from({length:Math.min(args.limit,6575-args.offset)},(_,i)=>({sha:'sha'+(args.offset+i),parents:[],summary:'Commit '+(args.offset+i),body:'',author:null,time:null,refs:[],kind:'commit',column:args.offset+i===100?24:0,edges:[]}))}:cmd==='app_ui_prefs_load'?{palette_recents:[],last_parent_folder:null,file_list_mode:'path'}:cmd==='ai_feature_config_list'||cmd==='jira_connections_list'?[]:null);
const session=testSession('/r',snapshot);
const actions=createRepoActions(session,{selectedSha:()=>undefined,onSelectionGone:()=>{},pullMode:()=> 'fast_forward_or_merge',offline:()=>false,inspectStash:()=>{},openWorktree:async()=>true,undoEntry:()=>undefined});
const mounted=mountWithApp(()=>createComponent(CommitInspector,{session,actions,get sha(){return sha()},onSelectCommit:()=>{},onOpenDiff:()=>{},onViewFile:()=>{}}));mounted.host.id='fixture';
const empty=mountWithApp(()=>createComponent(EmptyRepository,{snapshot:{...snapshot,head:{kind:'unborn',branch:'main'},files:Array.from({length:5000},(_,i)=>({path:'new-'+i+'.txt',area:i===0?'staged':'untracked',status:i===0?'added':'untracked',original_path:null}))},actions:{stageAll:async()=>true}}));empty.host.id='empty-fixture';
const [visible,setVisible]=createSignal(true);window.showGraph=setVisible;
const graphPrefs=testUiPrefs();window.graphPrefs=graphPrefs;
const graph=mountWithApp(()=>createComponent(Show,{get when(){return visible()},children:()=>createComponent(GraphPanel,{path:'/r',snapshot,incoming:new Set(),geometry:readGeometry(getComputedStyle(document.documentElement)),revision:0,covered:false,actions,dimmed:()=>false,searching:false,uiPrefs:graphPrefs,onSelect:()=>{},onRevealHead:()=>{}})}));graph.host.id='graph-fixture';window.ready=true;
`;
  await page.route("**/__repository-render", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><style>body{display:flex;gap:8px}#fixture{display:grid;height:800px;width:372px}#empty-fixture,#graph-fixture{display:grid;height:800px;width:640px}</style></head><body><script type="module" src="/@id/virtual:repository-render"></script></body></html>' }));
  await page.goto("http://127.0.0.1:1421/__repository-render");
  await page.waitForFunction(() => window.ready);
  await page.waitForSelector(".frow");
  const metrics = () => page.evaluate(() => {
    const scroller = document.querySelector(".ilist");
    const list = document.querySelector(".flist");
    const rows = [...document.querySelectorAll("#fixture .frow")];
    return { scrollTop: scroller.scrollTop, scrollTopEdge: scroller.getBoundingClientRect().top, height: scroller.clientHeight, listTop: list.getBoundingClientRect().top, listHeight: list.getBoundingClientRect().height, rows: rows.map((row) => ({ path: row.dataset.row, top: row.getBoundingClientRect().top, height: row.getBoundingClientRect().height })) };
  });
  const initial = await metrics();
  assert(initial.rows.length > 0 && initial.rows.length < 60, "large commits must render a bounded, nonempty window");
  assert(Math.abs(initial.rows[0].top - initial.listTop) <= 1, "first file must start at the list top");
  await page.locator(".ilist").evaluate((element) => { element.scrollTop = 4000 * 32; });
  await page.waitForFunction(() => document.querySelector('[data-row="src/file-4000.txt"]'));
  const scrolled = await metrics();
  const visible = scrolled.rows.find((row) => row.path === "src/file-4000.txt");
  assert(visible.top >= scrolled.scrollTopEdge && visible.top + visible.height <= scrolled.scrollTopEdge + scrolled.height, "scrolled file must lie inside its viewport");
  await page.evaluate(() => window.selectCommit("small"));
  await page.waitForFunction(() => document.querySelector(".ihead h2")?.textContent === "small", null, { timeout: 5000 });
  await page.waitForTimeout(250);
  const small = await metrics();
  assert(small.rows.some((row) => row.path === "src/file-0.txt"), "first file must render after switching to a shorter commit");
  assert(Math.abs(small.rows[0].top - small.listTop) <= 1, "first file must start at the list top without a blank band");
  assert.deepEqual(errors, []);
  const empty = await page.locator(".empty-repo").evaluate((panel) => {
    const bounds = panel.getBoundingClientRect();
    const button = panel.querySelector("button").getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, buttonTop: button.top, buttonBottom: button.bottom, rows: panel.querySelectorAll(".frow").length, heading: panel.querySelector("h3").textContent };
  });
  assert(empty.buttonTop >= empty.top && empty.buttonBottom <= empty.bottom, "first-commit action must stay visible with a large uncommitted tree");
  assert.equal(empty.heading, "Files · 5000", "mixed staged and untracked files must not all be labelled untracked");
  for (const theme of ["dark", "light"]) {
    for (const [width, height] of [[360, 440], [640, 620], [980, 740]]) {
      await page.locator("#empty-fixture").evaluate((host, { width, height, theme }) => {
        host.style.width = `${width}px`;
        host.style.height = `${height}px`;
        document.documentElement.dataset.theme = theme;
      }, { width, height, theme });
      await page.waitForFunction(() => document.querySelector(".empty-repo-list").clientHeight > 0);
      const contained = await page.locator(".empty-repo").evaluate((panel) => {
        const bounds = panel.getBoundingClientRect();
        const button = panel.querySelector("button").getBoundingClientRect();
        const first = panel.querySelector(".frow").getBoundingClientRect();
        const list = panel.querySelector(".empty-files").getBoundingClientRect();
        return button.bottom <= bounds.bottom && button.top >= bounds.top && Math.abs(first.top - list.top) <= 1;
      });
      assert(contained, `empty repository action and list must remain contained at ${width}×${height}, ${theme}`);
      await page.locator(".empty-repo-list").evaluate((list) => { list.scrollTop = list.scrollHeight; });
      await page.waitForFunction(() => document.querySelector('#empty-fixture .empty-files').lastElementChild?.textContent.includes("new-4999.txt"));
      await page.locator(".empty-repo-list").evaluate((list) => { list.scrollTop = 0; });
      await page.waitForFunction(() => document.querySelector('#empty-fixture .empty-files').firstElementChild?.textContent.includes("new-0.txt"));
    }
  }
  await page.locator(".empty-repo-list").focus();
  await page.evaluate(() => {
    window.emptyKeyboardEvents = [];
    document.addEventListener('keydown', (event) => window.emptyKeyboardEvents.push({ key: event.key, prevented: event.defaultPrevented, target: event.target.className }));
  });
  await page.keyboard.press("End");
  await page.waitForFunction(() => { const list = document.querySelector('.empty-repo-list'); return list.scrollTop + list.clientHeight >= list.scrollHeight - 1; });
  await page.waitForFunction(() => document.querySelector('#empty-fixture .empty-files').lastElementChild?.textContent.includes("new-4999.txt"));
  const endOffset = await page.locator(".empty-repo-list").evaluate((list) => list.scrollTop);
  await page.keyboard.press("PageUp");
  await page.waitForFunction((end) => document.querySelector('.empty-repo-list').scrollTop < end, endOffset);
  await page.keyboard.press("Home");
  await page.waitForFunction(() => document.querySelector('#empty-fixture .empty-files').firstElementChild?.textContent.includes("new-0.txt"));
  assert.deepEqual(errors, []);
  const graphSize = () => page.locator("#graph-fixture .graph").evaluate((panel) => Number.parseFloat(panel.style.getPropertyValue("--graph-w")));
  const divider = page.locator('[role="separator"][aria-label="Resize Graph column"]');
  assert.equal(await graphSize(), 56, "off-screen wide commits must not force the visible graph width");
  const dividerBounds = await divider.boundingBox();
  assert(dividerBounds, "graph separator must have a visible pointer target");
  const dividerX = dividerBounds.x + dividerBounds.width / 2;
  const dividerY = dividerBounds.y + dividerBounds.height / 2;
  await page.mouse.move(dividerX, dividerY);
  await page.mouse.down();
  await page.mouse.move(dividerX + 100, dividerY, { steps: 4 });
  await page.mouse.up();
  assert.equal(await graphSize(), 156, "pointer resizing must follow the chosen width");
  assert.equal(await page.evaluate(() => window.graphPrefs.prefs().columns.find((column) => column.column === "graph")?.width), 156, "pointer resizing must save the graph width");
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await graphSize(), 164, "keyboard resizing must move the graph divider by 8px");
  for (let cycle = 0; cycle < 10; cycle += 1) {
    await page.waitForSelector('#graph-fixture .grow[role="option"]');
    const graph = await page.locator("#graph-fixture .gscroll").evaluate((list) => {
      const bounds = list.getBoundingClientRect();
      const first = list.querySelector('.grow[role="option"]').getBoundingClientRect();
      return { first: first.top, top: bounds.top, count: list.querySelectorAll('.grow[role="option"]').length };
    });
    assert(Math.abs(graph.first - graph.top) <= 1 && graph.count > 0 && graph.count < 60, "cached graph remount must show visible rows at the viewport top");
    await page.evaluate(() => window.showGraph(false));
    await page.waitForFunction(() => document.querySelector("#graph-fixture .graph") === null);
    await page.evaluate(() => window.showGraph(true));
  }
  await page.waitForSelector('#graph-fixture .grow[role="option"]');
  assert.equal(await graphSize(), 164, "graph remount must retain the chosen width");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ commitFiles: 5000, initialRows: initial.rows.length, scrolledRows: scrolled.rows.length, shorterCommitFiles: 24, blankBand: false, emptyRepositoryFiles: 5000, firstCommitActionContained: true, layoutCases: 6, graphCommits: 6575, resizedGraphWidth: 164, cachedGraphRemounts: 10, errors }));
} catch (failure) {
  console.error(await page?.evaluate(() => {
    const list = document.querySelector('.empty-repo-list');
    return { scrollTop: list?.scrollTop, scrollHeight: list?.scrollHeight, clientHeight: list?.clientHeight, firstRow: list?.querySelector('.frow')?.textContent, lastRow: list?.querySelector('.frow:last-child')?.textContent, active: document.activeElement?.className, rows: list?.querySelectorAll('.frow').length, keyboard: window.emptyKeyboardEvents };
  }));
  throw failure;
} finally {
  await browser?.close();
  await server.close();
}
