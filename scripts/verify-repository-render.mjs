import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "../app/node_modules/vite/dist/node/index.js";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { chromium } = require("playwright-core");
let fixtureCode = "";
let strataCode = "";
const server = await createServer({ root: new URL("../app", import.meta.url).pathname, configFile: new URL("../app/vite.config.ts", import.meta.url).pathname, cacheDir: new URL("../app/node_modules/.vite-repository-render", import.meta.url).pathname, optimizeDeps: { include: ["@tauri-apps/api/mocks"] }, server: { port: 1421, strictPort: true, host: "127.0.0.1" }, plugins: [{ name: "repository-render-fixture", resolveId: (id) => ["virtual:repository-render", "virtual:strata-render"].includes(id) ? `\0${id}` : undefined, load: (id) => id === "\0virtual:repository-render" ? fixtureCode : id === "\0virtual:strata-render" ? strataCode : undefined }] });
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
  await page.goto("http://127.0.0.1:1421/__repository-render", { timeout: 30000 });
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
  await page.waitForFunction(() => {
    const row = document.querySelector('#fixture [data-row="src/file-0.txt"]');
    const list = document.querySelector("#fixture .flist");
    return Boolean(row && list && Math.abs(row.getBoundingClientRect().top - list.getBoundingClientRect().top) <= 1);
  }).catch(async (error) => {
    const state = await metrics();
    throw new Error(`${error.message}\n${JSON.stringify({ ...state, rows: state.rows.slice(0, 3) })}`);
  });
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
  strataCode = `
import '/src/styles/fonts.css';import '/src/styles/tokens.css';import '/src/styles/app.css';import '/src/styles/changes.css';import '/src/styles/markdown.css';import '/src/styles/shell-extras.css';
import {createComponent} from 'solid-js/web';import {mockIPC,mockWindows} from '@tauri-apps/api/mocks';
import {Workspace} from '/src/components/Workspace.tsx';import {Launchpad} from '/src/components/Launchpad.tsx';
import {readGeometry} from '/src/graph/geometry.ts';import {mountWithApp} from '/src/components/testkit.tsx';
import {defaultSettings} from '/src/state/settingsModel.ts';import {defaultUiPrefs} from '/src/state/repoUiPrefs.ts';
const person={name:'Synthetic Author',email:'synthetic@example.test',time:1700000000};
const counts={modified:3,added:0,deleted:0,renamed:0,untracked:0,conflicted:0};
const snapshot={root:'/synthetic/strata',main_root:'/synthetic/strata',head:{kind:'branch',name:'feature/readable-repository-navigation',sha:'sha0'},upstream:{name:'origin/feature/readable-repository-navigation',ahead_behind:{ahead:2,behind:1}},operation:null,operation_detail:null,last_fetch:Math.floor(Date.now()/1000)-120,remotes:['origin'],remote_branches:['origin/main'],branches:Array.from({length:500},(_,i)=>'branch-'+String(i).padStart(3,'0')),files:[],counts,tags:['v1'],stashes:[],worktrees:[]};
const repos=Array.from({length:4},(_,i)=>({path:'/synthetic/repository-'+i,folder:null,opened_at:1700000000}));
mockWindows('main');mockIPC((cmd,args)=>{
 if(cmd==='settings_load')return {...defaultSettings,profile_pictures:false};
 if(cmd==='app_ui_prefs_load')return {palette_recents:[],last_parent_folder:null,file_list_mode:'path'};
 if(cmd==='repo_ui_prefs_load')return defaultUiPrefs;
 if(cmd==='hooks_list')return {directory:'/synthetic/hooks',hooks:[]};
 if(cmd==='repositories_list')return {folders:[],repos};
 if(cmd==='recent_statuses')return repos.map(repo=>({path:repo.path,exists:true,branch:'main',unborn:false,ahead_behind:{ahead:0,behind:0},counts:{...counts,modified:0},worktrees:1,unreadable:null}));
 if(cmd==='repo_graph')return {total:100,carried:[],rows:Array.from({length:Math.min(args.limit,100-args.offset)},(_,i)=>({sha:'sha'+(args.offset+i),parents:[],summary:'Commit '+(args.offset+i),body:'Supporting graph prose',author:person.name,time:1700000000,refs:[],kind:'commit',column:(args.offset+i)%3,edges:[]}))};
 if(cmd==='commit_details')return {sha:args.sha,summary:'Readable commit summary',body:'Paragraph with **emphasis**.\\n\\n- First item\\n- Second item',author:person,committer:person,parents:[],refs:[],files:Array.from({length:24},(_,i)=>({path:'src/file-'+i+'.ts',status:'modified',original_path:null,additions:4,deletions:2}))};
 if(['ai_feature_config_list','jira_connections_list','platform_connections_list','submodule_list','worktree_list','switch_stashes','activity_list','recents_list','launchpad_wips','commit_tree_paths','repo_aliases_list'].includes(cmd))return [];
 if(cmd==='repo_open')return snapshot;
 return null;
},{shouldMockEvents:true});
const workspace=mountWithApp(()=>createComponent(Workspace,{view:{status:'ready',path:snapshot.root,snapshot,info:{app_version:'test',git_version:'test'}},geometry:readGeometry(getComputedStyle(document.documentElement))}));workspace.host.id='strata-workspace';
const launchpad=mountWithApp(()=>createComponent(Launchpad,{}));launchpad.host.id='strata-launchpad';launchpad.host.style.display='none';
window.strataReady=true;
`;
  await page.route("**/__strata-render", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><script type="module" src="/@id/virtual:strata-render"></script></body></html>' }));
  await page.goto("http://127.0.0.1:1421/__strata-render", { timeout: 30000 });
  await page.waitForFunction(() => window.strataReady);
  await page.waitForSelector('#strata-workspace .grow[role="option"]');
  const strata = [];
  for (const theme of ["dark", "light"]) {
    for (const [width, height] of [[960, 600], [1280, 720], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; document.querySelector('#strata-workspace').style.display = ''; document.querySelector('#strata-launchpad').style.display = 'none'; }, theme);
      await page.waitForFunction((width) => document.querySelector('.sidebar').classList.contains('compact') === (width < 1280), width);
      if (width === 960) {
        await page.locator('.sidebar-rail [aria-label="Show Branches"]').click();
      }
      await page.waitForSelector('.sidebar section[aria-label="Branches"] .srow');
      const sidebar = await page.locator('.sidebar').evaluate((panel) => {
        const body = panel.querySelector('.sidebar-body');
        const row = body.querySelector('section[aria-label="Branches"] .srow');
        const sec = body.querySelector('.sec');
        const count = sec.querySelector('.count');
        const guide = row.querySelector('.tree-guide:last-of-type') ?? row.querySelector('.tree-guide');
        return { width: panel.getBoundingClientRect().width, row: row.getBoundingClientRect().height, section: sec.getBoundingClientRect().height, count: [count.getBoundingClientRect().width, count.getBoundingClientRect().height], rows: body.querySelectorAll('section[aria-label="Branches"] .srow').length, guideGap: row.querySelector('.name').getBoundingClientRect().left - guide.getBoundingClientRect().right };
      });
      assert.equal(sidebar.width, width < 1280 ? 260 : width < 1440 ? 220 : 260);
      assert.equal(sidebar.row, 32);
      assert.equal(sidebar.section, 36);
      assert(sidebar.count[0] >= 24 && sidebar.count[1] === 20);
      assert(sidebar.rows > 0 && sidebar.rows < 80, 'sidebar virtualization must stay bounded at its final row height');
      assert.equal(sidebar.guideGap, 4, 'tree names must start 4px clear of their guide');
      if (width === 960) await page.locator('[aria-label="Close repository sidebar"]').click();
      await page.locator('#strata-workspace .grow[role="option"]').first().click();
      await page.waitForSelector('.commit-message p');
      const reading = await page.locator('.commit-inspector').evaluate((panel) => {
        const style = (selector) => getComputedStyle(panel.querySelector(selector));
        const bounds = panel.getBoundingClientRect();
        const body = panel.querySelector('.commit-message').getBoundingClientRect();
        return { width: bounds.width, summary: [style('.commit-summary').fontSize, style('.commit-summary').fontWeight, style('.commit-summary').color], prose: style('.commit-message').fontSize, inset: body.left - bounds.left - 1, metadata: style('.mrow').fontSize, detail: panel.querySelector('.mrow').getBoundingClientRect().height, avatar: panel.querySelector('.avatar').getBoundingClientRect().width, listHeader: panel.querySelector('.lhead').getBoundingClientRect().height, headerInset: panel.querySelector('.lhead-title').getBoundingClientRect().left - bounds.left - 1, bodyOverflow: panel.scrollWidth > panel.clientWidth, ink: getComputedStyle(panel).color };
      });
      assert.equal(reading.width, width === 960 ? 380 : width === 1280 ? 340 : 380);
      assert.deepEqual(reading.summary.slice(0, 2), ['14px', '600']);
      assert.equal(reading.summary[2], reading.ink);
      assert.equal(reading.prose, '15px');
      assert.equal(reading.inset, 16);
      assert.equal(reading.metadata, '13px');
      assert.equal(reading.detail, 28);
      assert.equal(reading.avatar, 24);
      assert.equal(reading.listHeader, 40);
      assert.equal(reading.headerInset, 16);
      assert.equal(reading.bodyOverflow, false);
      if (width === 960) await page.locator('[aria-label="Close inspector"]').click();
      const chrome = await page.locator('#strata-workspace .app').evaluate((app) => {
        const strip = app.querySelector('.chips');
        const graph = app.querySelector('.graph');
        const row = graph.querySelector('.grow[role="option"]');
        const panels = [...app.querySelectorAll('.main > .sidebar, .main > .center, .main > .inspector-slot')].filter(panel => panel.getBoundingClientRect().width > 0).map(panel => { const box = panel.getBoundingClientRect(); return { left: box.left, right: box.right, bottom: box.bottom }; });
        return { body: getComputedStyle(document.body).fontSize, strip: strip.getBoundingClientRect().height, chip: strip.querySelector('.chip-group').getBoundingClientRect().height, overflow: getComputedStyle(strip).overflowX, stripWidth: strip.clientWidth, stripScrollWidth: strip.scrollWidth, row: row.getBoundingClientRect().height, graph: graph.style.getPropertyValue('--graph-w'), refs: graph.style.getPropertyValue('--ref-w'), graphType: getComputedStyle(row.querySelector('.msg')).fontSize, headerType: getComputedStyle(graph.querySelector('.gh')).fontSize, panels, appOverflow: app.scrollWidth > app.clientWidth, command: app.querySelector('.cmd').getBoundingClientRect().width, breadcrumb: app.querySelector('.crumb').getBoundingClientRect().width };
      });
      assert.equal(chrome.body, '15px');
      assert.equal(chrome.strip, 44);
      assert.equal(chrome.chip, 32);
      assert.equal(chrome.overflow, 'auto');
      assert.equal(chrome.row, 28);
      assert.equal(chrome.graph, '70px');
      assert.equal(chrome.refs, '130px');
      assert.equal(chrome.graphType, '12px');
      assert.equal(chrome.headerType, '10px');
      assert.equal(chrome.appOverflow, false);
      for (const panel of chrome.panels) assert(panel.left >= 0 && panel.right <= width && panel.bottom <= height, 'panels must remain within the window');
      if (width === 960) {
        assert(chrome.command >= 210 && chrome.breadcrumb <= 120);
        assert(chrome.stripScrollWidth > chrome.stripWidth, 'long worded chips must scroll rather than clip');
        await page.locator('.chips [aria-label="Show inspector"]').scrollIntoViewIfNeeded();
        await page.locator('.chips [aria-label="Show inspector"]').click();
        await page.locator('[aria-label="Close inspector"]').click();
      }
      await page.evaluate(() => { document.querySelector('#strata-workspace').style.display = 'none'; document.querySelector('#strata-launchpad').style.display = ''; });
      await page.waitForSelector('.repo-row');
      const launchpad = await page.locator('.launchpad').evaluate((panel) => ({ top: getComputedStyle(panel).paddingTop, rows: [...panel.querySelectorAll('.repo-row')].map(row => row.getBoundingClientRect().height), text: getComputedStyle(panel.querySelector('.repo-row')).fontSize, button: panel.querySelector('.repo-actbar .btn').getBoundingClientRect().height, table: panel.querySelector('.repo-table').getBoundingClientRect().height, overflow: panel.scrollWidth > panel.clientWidth }));
      assert.equal(launchpad.top, '20px');
      assert.equal(launchpad.text, '14px');
      assert.equal(launchpad.button, 32);
      assert(launchpad.rows.every(row => row === 42), 'normal repository rows must remain 42px rather than stretch');
      assert.equal(launchpad.overflow, false);
      strata.push({ width, height, theme, sidebar, reading, chrome, launchpad });
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ commitFiles: 5000, initialRows: initial.rows.length, scrolledRows: scrolled.rows.length, shorterCommitFiles: 24, blankBand: false, emptyRepositoryFiles: 5000, firstCommitActionContained: true, layoutCases: 6, graphCommits: 6575, resizedGraphWidth: 164, cachedGraphRemounts: 10, strata, errors }));
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
