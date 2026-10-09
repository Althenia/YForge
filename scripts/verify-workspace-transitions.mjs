import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "../app/node_modules/vite/dist/node/index.js";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const cycles = Number(process.env.YFORGE_TRANSITION_CYCLES ?? 6);
assert(Number.isInteger(cycles) && cycles > 0 && cycles <= 30, "cycles must be an integer from 1 to 30");
const fixtureCode = `
import {render,createComponent} from 'solid-js/web';
import {mockIPC,mockWindows} from '@tauri-apps/api/mocks';
import {App} from '/src/App.tsx';
import {defaultSettings} from '/src/state/settingsModel.ts';
import {defaultAppUiPrefs} from '/src/state/appUiPrefs.ts';
import {defaultUiPrefs} from '/src/state/repoUiPrefs.ts';
import '/src/styles/fonts.css';
import '/src/styles/tokens.css';
import '/src/styles/app.css';
import '/src/styles/changes.css';
import '/src/styles/resolver.css';
import '/src/styles/history.css';
import '/src/styles/ai.css';
import '/src/styles/file-editor.css';
import '/src/styles/hooks.css';
import '/src/styles/settings-tools.css';
import '/src/styles/shell-extras.css';
const paths=['/synthetic/alpha','/synthetic/beta'];
const sha=(index)=>index.toString(16).padStart(40,'0');
const person={name:'Synthetic Author',email:'author@example.test',time:1700000000};
const author={name:person.name,email:person.email,initials:'SA'};
const remoteBranches=['origin/main',...Array.from({length:643},(_,i)=>'origin/feature-'+i)];
const tags=Array.from({length:577},(_,i)=>'v0.'+i);
const refs=new Map();
const addRef=(index,entry)=>refs.set(index,[...(refs.get(index)??[]),entry]);
addRef(1,{kind:'local_branch',name:'main',is_head:true});
remoteBranches.forEach((name,i)=>addRef(name==='origin/main'?2:1+i*7,{kind:'remote_branch',name,is_head:false}));
tags.forEach((name,i)=>addRef(1+i*9,{kind:'tag',name,is_head:false}));
const files=Array.from({length:5000},(_,i)=>({path:'src/work-'+String(i).padStart(4,'0')+'.ts',status:i<4500?'modified':'added',area:i<4500?'unstaged':'staged',original_path:null}));
const snapshot=(root)=>({root,main_root:root,head:{kind:'branch',name:'main',sha:sha(1)},upstream:{name:'origin/feature-0',ahead_behind:{ahead:0,behind:0}},counts:{modified:4500,added:500,deleted:0,renamed:0,untracked:0,conflicted:0},files,operation:null,operation_detail:null,last_fetch:null,worktrees:[{path:root,head:sha(1),branch:'main',bare:false,locked:false,prunable:false,current:true}],branches:['main'],remote_branches:remoteBranches,remotes:['origin'],tags,stashes:[]});
const graphRow=(index)=>({sha:index===0?null:sha(index),parents:index<6722?[sha(index+1)]:[],summary:index===0?'Working changes':index%2===0?'Small commit '+index:'Large commit '+index,body:'',author:index===0?null:author,time:index===0?null:person.time-index,refs:refs.get(index)??[],kind:index===0?'changes':'commit',column:0,edges:index<6722?[{lane:0,parent_row:index+1,parent_column:0}]:[]});
const commitFiles=(commitSha)=>Array.from({length:Number.parseInt(commitSha,16)%2===0?24:5000},(_,i)=>({path:'src/commit-'+String(i).padStart(4,'0')+'.ts',status:'modified',original_path:null,additions:4,deletions:2}));
const diff=(file)=>{
  let oldNumber=0,newNumber=0;
  const lines=Array.from({length:2000},(_,i)=>{
    const kind=i%10===0?'added':i%10===1?'removed':'context';
    return {kind,old_number:kind==='added'?null:++oldNumber,new_number:kind==='removed'?null:++newNumber,text:'const syntheticLine'+i+' = '+i+';',no_newline:false};
  });
  return {path:file,original_path:null,binary:false,old_size:50000,new_size:51000,hunks:[{old_start:1,old_lines:oldNumber,new_start:1,new_lines:newNumber,heading:'Synthetic diff',lines}]};
};
const delayed=(value,ms=80)=>new Promise((resolve)=>setTimeout(()=>resolve(value),ms));
window.fixture={calls:{},unknown:[],crashes:[],resets:[],shape:{graphCommits:6722,remoteBranches:644,tags:577,workingFiles:5000,commitFiles:[24,5000]}};
mockWindows('main');
mockIPC((cmd,args={})=>{
  window.fixture.calls[cmd]=(window.fixture.calls[cmd]??0)+1;
  switch(cmd){
    case 'settings_load':return {...defaultSettings,theme:'dark',gravatar_avatars:false};
    case 'app_ui_prefs_load':return defaultAppUiPrefs;
    case 'repo_ui_prefs_load':return defaultUiPrefs;
    case 'session_load':return {tabs:paths,active:0,groups:[]};
    case 'launch_path':return paths[0];
    case 'repo_open':if(!paths.includes(args.path))throw {kind:'not_a_repository',message:'Synthetic path not found',output:null};return delayed(snapshot(args.path));
    case 'app_info':return {app_version:'0.2.0',git_version:'2.50.0'};
    case 'repo_settings_load':return {pull_mode:null,ssh_key_path:null,submodule_update_on_fetch:false};
    case 'profiles_list':return delayed({active:'default',profiles:[{id:'default',name:'Default',author_name:person.name,author_email:person.email}]},400);
    case 'external_tools_status':return {editor:null,diff:null,merge:null};
    case 'lfs_status':return {installed:false,version:null,initialized:false,patterns:[]};
    case 'repo_graph':return delayed({total:6723,carried:[],rows:Array.from({length:Math.max(0,Math.min(args.limit,6723-args.offset))},(_,i)=>graphRow(args.offset+i))});
    case 'commit_details':return delayed({sha:args.sha,summary:(Number.parseInt(args.sha,16)%2===0?'Small':'Large')+' commit '+Number.parseInt(args.sha,16),body:'Synthetic commit body',author:person,committer:person,parents:[sha(Number.parseInt(args.sha,16)+1)],refs:refs.get(Number.parseInt(args.sha,16))??[],files:commitFiles(args.sha)},260);
    case 'commit_file_diff':case 'diff_file':return delayed(diff(args.file));
    case 'integration_preview':return {incoming:{count:1,commits:[]},outgoing:{count:1,commits:[]},fast_forward:false};
    case 'reset':window.fixture.resets.push(args);return null;
    case 'remotes_list':return [{name:'origin',fetch_url:'https://example.test/synthetic.git',push_url:null}];
    case 'worktree_list':return snapshot(args.path).worktrees.map((worktree)=>({...worktree,dirty:true}));
    case 'git_flow_config':return null;
    case 'hooks_list':return {directory:args.path+'/.git/hooks',hooks:[]};
    case 'jira_issue_keys':return args.texts.map(()=>[]);
    case 'avatar_initial':return 'SA';
    case 'activity_list':case 'recents_list':case 'recent_add':case 'repo_aliases_list':case 'switch_stashes':case 'platform_connections_list':case 'jira_connections_list':case 'ai_feature_config_list':case 'submodule_list':return [];
    case 'platform_repo_match':case 'avatar_url':case 'repo_watch':case 'menu_update':case 'session_save':case 'app_ui_prefs_save':case 'repo_ui_prefs_save':return null;
    case 'crash_report':window.fixture.crashes.push(args.report);return null;
    default:window.fixture.unknown.push(cmd);throw {kind:'internal',message:'Fixture has no verified response for '+cmd,output:null};
  }
},{shouldMockEvents:true});
const probes={frames:0,blankFrames:0,maxBlankRun:0,maxMainHeight:0,maxGraphViewport:0,maxFileViewport:0,maxCommitMargin:0,busyFrames:0,indicatorShows:0,indicatorFlashes:[],headlessInspectorFrames:0,spinnerFrames:0,heldTabFrames:0,heldClipMisses:[],graphTransitions:[],anomalies:[]};
const indicators=new Map();
let blankRun=0;
let graphState='';
let navigationReady=false;
const probe=()=>{
  probes.frames++;
  const main=document.querySelector('.main');
  const graph=document.querySelector('#root .gscroll:not([data-swap-held])');
  const files=document.querySelector('#root .inspector:not([data-swap-held]) .ilist');
  const commitList=document.querySelector('#root .inspector[aria-label="Commit"]:not([data-swap-held]) .flist');
  const busy=document.querySelector('.inspector[aria-busy="true"],.dpanel[aria-busy="true"],.graph[aria-busy="true"]');
  const now=performance.now();
  for(const element of document.querySelectorAll('#root [data-indicator]'))if(!element.closest('[data-swap-held]')&&!indicators.has(element)){indicators.set(element,{start:now,parent:element.parentElement});probes.indicatorShows++;}
  for(const [element,seen] of indicators)if(!element.isConnected){indicators.delete(element);const shown=now-seen.start;if(seen.parent?.isConnected&&shown<380&&probes.indicatorFlashes.length<12)probes.indicatorFlashes.push(Math.round(shown));}
  const commitInspector=document.querySelector('#root .inspector[aria-label="Commit"]:not([data-swap-held])');
  if(commitInspector&&!commitInspector.querySelector('.ihead h2,.ihead .ref'))probes.headlessInspectorFrames++;
  if(document.querySelector('#root .graph .busy-spinner'))probes.spinnerFrames++;
  const tabHeld=document.querySelector('body > .app[data-swap-held]');
  if(tabHeld){
    probes.heldTabFrames++;
    const bar=document.querySelector('#root .app .tabbar');
    const clip=getComputedStyle(tabHeld).clipPath;
    const inset=Number.parseFloat(clip.slice(clip.indexOf('(')+1));
    if(!(bar&&Math.abs(inset-(bar.getBoundingClientRect().bottom-tabHeld.getBoundingClientRect().top))<=1)&&probes.heldClipMisses.length<6)probes.heldClipMisses.push(clip);
  }
  const panel=document.querySelector('.graph');
  const state=panel?.className??'absent';
  if(state!==graphState){
    graphState=state;
    if(probes.graphTransitions.length<24)probes.graphTransitions.push({state,display:panel?getComputedStyle(panel).display:null,visibility:panel?getComputedStyle(panel).visibility:null,inert:panel?.inert,scrollTop:graph?.scrollTop,height:graph?.clientHeight,firstRow:graph?.querySelector('.grow')?.id});
  }
  if(busy)probes.busyFrames++;
  if(document.querySelector('.commandbar'))navigationReady=true;
  if(navigationReady&&!document.querySelector('.app,.empty-view')){probes.blankFrames++;blankRun++;probes.maxBlankRun=Math.max(probes.maxBlankRun,blankRun);}else blankRun=0;
  if(main)probes.maxMainHeight=Math.max(probes.maxMainHeight,main.clientHeight);
  if(graph)probes.maxGraphViewport=Math.max(probes.maxGraphViewport,graph.clientHeight);
  if(files)probes.maxFileViewport=Math.max(probes.maxFileViewport,files.clientHeight);
  if(commitList&&files)probes.maxCommitMargin=Math.max(probes.maxCommitMargin,Math.abs(commitList.getBoundingClientRect().top-files.getBoundingClientRect().top+files.scrollTop));
  if((main?.clientHeight>innerHeight+2||files?.clientHeight>innerHeight+2||graph?.clientHeight>innerHeight+2)&&probes.anomalies.length<12)probes.anomalies.push({hash:location.hash,busy:!!busy,viewport:innerHeight,main:main?.clientHeight,graph:graph?.clientHeight,files:files?.clientHeight});
  requestAnimationFrame(probe);
};
window.fixture.probes=probes;
render(()=>createComponent(App,{}),document.getElementById('root'));
requestAnimationFrame(probe);
`;

const server = await createServer({
  root: new URL("../app", import.meta.url).pathname,
  cacheDir: new URL("../app/node_modules/.vite-workspace-transitions", import.meta.url).pathname,
  optimizeDeps: { include: ["@tauri-apps/api/mocks"] },
  configFile: new URL("../app/vite.config.ts", import.meta.url).pathname,
  server: { port: 1422, strictPort: true, host: "127.0.0.1" },
  plugins: [{
    name: "workspace-transitions-fixture",
    resolveId: (id) => id === "virtual:workspace-transitions" ? "\0virtual:workspace-transitions" : undefined,
    load: (id) => id === "\0virtual:workspace-transitions" ? fixtureCode : undefined,
  }],
});
let browser;
let stage = "setup";
const errors = [];
const measurements = [];
const headerChecks = [];
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(5000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__workspace-transitions", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/@id/virtual:workspace-transitions"></script></body></html>' }));
  await page.goto("http://127.0.0.1:1422/__workspace-transitions", { timeout: 30000 });
  await page.waitForSelector('.gscroll .grow[role="option"]');
  assert.deepEqual(await page.evaluate(() => window.fixture.unknown), [], "fixture commands must all have verified responses");
  assert.deepEqual(errors, [], "fixture setup must not crash");

  const measure = async (selector, rows, label, limit = 100) => {
    await page.waitForFunction(({ selector, rows }) => {
      const scroller = document.querySelector(selector);
      if (!scroller) return false;
      const bounds = scroller.getBoundingClientRect();
      return [...scroller.querySelectorAll(rows)].some((row) => {
        const rect = row.getBoundingClientRect();
        return rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
    }, { selector, rows });
    const result = await page.locator(selector).evaluate((scroller, rows) => {
      const bounds = scroller.getBoundingClientRect();
      const rendered = [...scroller.querySelectorAll(rows)].map((row) => {
        const rect = row.getBoundingClientRect();
        return { id: row.dataset.row ?? row.id, top: rect.top, bottom: rect.bottom, height: rect.height, index: row.dataset.index, text: row.textContent?.slice(0, 80) };
      });
      const visible = rendered.filter((row) => row.height > 0 && row.bottom > bounds.top && row.top < bounds.bottom);
      const list = scroller.querySelector('.flist,.dtrack,.dflat,.gspacer');
      return { top: bounds.top, bottom: bounds.bottom, listTop: list?.getBoundingClientRect().top ?? bounds.top, height: scroller.clientHeight, scrollTop: scroller.scrollTop, rendered: rendered.length, visible: visible.length, first: visible[0], clickable: visible.find((row) => row.top >= bounds.top && row.bottom <= bounds.bottom), last: visible.at(-1), viewport: innerHeight };
    }, rows);
    measurements.push({ label, ...result });
    assert(result.height > 0 && result.height <= result.viewport, `${label}: viewport must be bounded`);
    assert(result.rendered > 0 && result.rendered < limit && result.visible > 0, `${label}: rows must be windowed and on screen`);
    assert(result.first.top <= Math.max(result.top, result.listTop) + result.first.height + 1, `${label}: list viewport must not start with a blank row band`);
    return result;
  };
  const liveGraph = '#root .gscroll:not([data-swap-held])';
  const liveList = '#root .inspector:not([data-swap-held]) .ilist';
  const liveRow = (id) => `#root .inspector:not([data-swap-held]) [data-row="${id}"]`;
  const liveDiff = '#root .dpanel .dbody:not([data-swap-held])';
  const liveTab = (name) => `#root .tab-main[title="/synthetic/${name}"]`;
  const graph = (label) => measure(liveGraph, '.grow[role="option"]', label);
  const inspector = (label) => measure(liveList, ".frow", label);
  const closeDiff = async () => {
    await page.locator('#root .dpanel .crumbs button').click();
    await page.waitForFunction(() => !document.querySelector('#root .dpanel'));
  };
  const tab = async (name) => {
    await page.locator(liveTab(name)).click();
    await page.waitForFunction((name) => document.querySelector('#root .tab-main[aria-selected="true"]')?.getAttribute('title') === '/synthetic/' + name, name);
    await page.waitForSelector(`${liveGraph} .grow[role="option"]`);
  };
  const selectCommit = async (index, summary) => {
    await page.locator(`#graph-row-${index} .msg`).click();
    const early = await page.evaluate(() => {
      const panel = document.querySelector('#root .inspector[aria-label="Commit"]:not([data-swap-held])');
      return { title: panel?.querySelector('.ihead h2')?.textContent, busy: panel?.getAttribute('aria-busy') };
    });
    headerChecks.push({ stage, index, ...early });
    assert.equal(early.title, summary, `${stage}: the inspector must name the selected commit from its graph row at once (S72)`);
    await page.waitForFunction((summary) => {
      const panel = document.querySelector('#root .inspector[aria-label="Commit"]:not([data-swap-held])');
      return panel?.getAttribute('aria-busy') === 'false' && panel.querySelector('.ihead h2')?.textContent === summary && panel.querySelector('.ilist.commit-body:not([aria-hidden]) .flist');
    }, summary);
  };
  const clickVisibleFile = async () => {
    const result = await inspector(`${stage}: file before Diff`);
    assert(result.clickable, "file click must target a fully on-screen row");
    await page.locator(liveRow(result.clickable.id)).click({ position: { x: 140, y: Math.min(16, result.clickable.height / 2) } });
    await page.waitForSelector(`${liveDiff} .dline`);
    await measure(liveDiff, ".dline", `${stage}: Diff rows`, 250);
    await page.locator(liveDiff).evaluate((element) => { element.scrollTop = 20000; });
    await measure(liveDiff, ".dline", `${stage}: scrolled Diff rows`, 250);
  };
  const cases = [[1440, 900, "dark"], [1280, 720, "light"], [960, 600, "dark"], [1440, 900, "light"], [1280, 720, "dark"], [960, 600, "light"]];
  for (let cycle = 0; cycle < cycles; cycle++) {
    const [width, height, theme] = cases[cycle % cases.length];
    await page.setViewportSize({ width, height });
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    stage = `cycle ${cycle + 1} ${width}x${height} ${theme}`;
    await tab(cycle % 2 === 0 ? "alpha" : "beta");
    await graph(`${stage}: cached tab graph`);
    await page.locator(liveGraph).evaluate((element) => { element.scrollTop = 4000 * 28; });
    await page.waitForSelector('#graph-row-4000');
    await graph(`${stage}: graph scroll 4000`);
    await selectCommit(4001, 'Large commit 4001');
    await inspector(`${stage}: 5000 commit files`);
    await page.locator(liveList).evaluate((element) => { element.scrollTop = 4000 * 32; });
    await page.waitForSelector(liveRow('src/commit-4000.ts'));
    await clickVisibleFile();
    await closeDiff();
    await graph(`${stage}: Graph return`);
    await selectCommit(4002, 'Small commit 4002');
    await page.waitForSelector(liveRow('src/commit-0000.ts'));
    const short = await inspector(`${stage}: 24 commit files after large`);
    assert.equal(short.first.id, "src/commit-0000.ts", "short commit must return to its first file");
    await clickVisibleFile();
    await closeDiff();
    await page.locator(liveGraph).evaluate((element) => { element.scrollTop = 0; });
    await page.waitForSelector('#graph-row-0');
    await page.locator('#graph-row-0 .msg').click();
    await page.waitForSelector('#root .inspector.changes .frow');
    await page.locator(liveList).evaluate((element) => { element.scrollTop = 3000 * 32; });
    await page.waitForSelector(liveRow('unstaged:src/work-3000.ts'));
    await clickVisibleFile();
    await closeDiff();
    await inspector(`${stage}: Changes return`);
    await page.locator(liveList).evaluate((element) => {
      const suppress = (event) => event.stopImmediatePropagation();
      element.addEventListener('scroll', suppress, { capture: true });
      element.scrollTop = 0;
      window.releaseOffsetProbe = () => element.removeEventListener('scroll', suppress, { capture: true });
    });
    await page.locator('#root .inspector:not([data-swap-held]) .ihead button').first().focus();
    await page.waitForFunction(() => {
      const list = document.querySelector('#root .inspector:not([data-swap-held]) .ilist');
      const bounds = list.getBoundingClientRect();
      return [...list.querySelectorAll('.frow')].some((row) => row.getBoundingClientRect().top >= bounds.top && row.getBoundingClientRect().bottom <= bounds.bottom);
    });
    await page.evaluate(() => window.releaseOffsetProbe());
    await inspector(`${stage}: implicit Changes offset reset`);
    await graph(`${stage}: Changes and graph`);
    await page.locator(liveTab('beta')).dispatchEvent('click');
    await page.locator(liveTab('alpha')).dispatchEvent('click');
    await page.locator(liveTab('beta')).dispatchEvent('click');
    await page.waitForFunction(() => document.querySelector('#root .tab-main[aria-selected="true"]')?.getAttribute('title') === '/synthetic/beta');
    await graph(`${stage}: rapid tab sequence final`);
    assert.equal(await page.locator('#root .commandbar').count(), 1, "final route must have exactly one workspace");
    assert.equal(await page.locator('#root .app').count(), 1, "final route must not be blank or duplicate");
    assert.deepEqual(await page.evaluate(() => window.fixture.unknown), [], "new fixture calls must be verified");
    assert.deepEqual(errors, [], "mixed transitions must not crash");
  }
  stage = "remote main activation";
  await page.locator(liveGraph).evaluate((element) => { element.scrollTop = 0; });
  const remoteMain = page.locator('#graph-row-2 .refcell > [data-ref-label][title="origin/main"]');
  await remoteMain.dblclick();
  await page.getByRole('menuitem', { name: /^Hard/ }).click();
  await page.getByRole('alertdialog').waitFor();
  assert.match(await page.getByRole('alertdialog').innerText(), /Hard reset main to origin\/main/);
  assert.deepEqual(await page.evaluate(() => window.fixture.resets), [], "double-click and reset-mode selection must not mutate Git");
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.fixture.resets), [], "reset cancellation must not mutate Git");
  await remoteMain.dblclick();
  await page.getByRole('menuitem', { name: /^Hard/ }).click();
  await page.getByRole('button', { name: 'Hard reset', exact: true }).click();
  await page.waitForFunction(() => window.fixture.resets.length === 1);
  const fixture = await page.evaluate(() => window.fixture);
  assert.deepEqual(fixture.resets, [{ path: '/synthetic/beta', target: '2'.padStart(40, '0'), mode: 'hard' }], "confirmed activation must reset the chosen remote tip, not check out the existing local branch again");
  assert.deepEqual(fixture.crashes, [], "app crash reports must stay empty");
  assert.equal(fixture.probes.blankFrames, 0, "repository tab transitions must never detach the workspace to a blank frame");
  assert(fixture.probes.indicatorShows > 0, "slow reads must show the pending indicator (S72)");
  assert.deepEqual(fixture.probes.indicatorFlashes, [], "a shown pending indicator must stay at least 400ms (S72)");
  assert.equal(fixture.probes.headlessInspectorFrames, 0, "the commit inspector must name the selected commit in every frame (S72)");
  assert.equal(fixture.probes.spinnerFrames, 0, "the graph must use the pending line and skeletons, never a spinner (S72)");
  assert(fixture.probes.heldTabFrames > 0, "a repository tab switch must hold the previous view while the next settles (S72)");
  assert.deepEqual(fixture.probes.heldClipMisses, [], "a held tab view must be clipped below the live tab bar (S72)");
  assert.equal(fixture.calls.profiles_list, 1, "repository tab transitions must reuse the application profile list instead of refetching it per composer");
  assert.deepEqual(fixture.probes.anomalies, [], "loading and transitions must not create giant viewports");
  const { graphTransitions, anomalies, indicatorFlashes, heldClipMisses, ...probeCounters } = fixture.probes;
  console.log(JSON.stringify({ result: "PASS", cycles, cases, shape: fixture.shape, calls: fixture.calls, probes: { ...probeCounters, graphTransitions: graphTransitions.length, anomalies: anomalies.length }, geometryChecks: measurements.length, headerChecks: headerChecks.length, unknownCalls: fixture.unknown.length, crashes: fixture.crashes.length, errors: errors.length }, null, 2));
} catch (failure) {
  const diagnostics = browser ? await Promise.all(browser.contexts().flatMap((context) => context.pages().map((page) => page.evaluate(() => ({ fixture: window.fixture, hash: location.hash, alerts: [...document.querySelectorAll('[role="alert"]')].map((element) => element.textContent), regions: [...document.querySelectorAll('.center,.graph,.gscroll,.gspacer,.inspector,.ilist')].map((element) => ({ className: element.className, display: getComputedStyle(element).display, height: element.clientHeight, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, top: element.getBoundingClientRect().top, rows: element.querySelectorAll('.grow').length, firstRows: [...element.querySelectorAll('.grow')].slice(0, 3).map((row) => ({ id: row.id, top: row.getBoundingClientRect().top, height: row.getBoundingClientRect().height, text: row.textContent?.slice(0, 100) })) })), body: document.body.textContent?.slice(0, 500) })).catch((error) => ({ diagnosticError: error.message }))))) : [];
  console.error(JSON.stringify({ result: "FAIL", stage, message: failure.message, diagnostics, measurements, errors }, null, 2));
  throw failure;
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
  }
}
